use crate::agent_host::{self, AgentDiscovery};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::{self, BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    sync::Arc,
    thread,
    time::Duration,
};
use uuid::Uuid;

const MAX_MCP_LINE_BYTES: usize = 256 * 1024;

#[derive(Clone)]
struct BridgeClient {
    session_id: Arc<String>,
    project: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BridgeReply {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

impl BridgeClient {
    fn new() -> Self {
        Self {
            session_id: Arc::new(format!("mcp-{}", Uuid::new_v4().simple())),
            project: current_project_name(),
        }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let discovery = load_discovery()?;
        if discovery.protocol != agent_host::AGENT_PROTOCOL_VERSION || discovery.host != "127.0.0.1" {
            return Err("FurinaPet Agent Bridge is incompatible".into());
        }
        let address: SocketAddr = format!("{}:{}", discovery.host, discovery.port)
            .parse()
            .map_err(|_| "FurinaPet Agent Bridge is unavailable".to_string())?;
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(700))
            .map_err(|_| "FurinaPet desktop app is unavailable".to_string())?;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let request = json!({
            "token": discovery.token,
            "method": method,
            "params": params,
        });
        let encoded = serde_json::to_string(&request)
            .map_err(|_| "failed to encode Agent Bridge request".to_string())?;
        stream
            .write_all(encoded.as_bytes())
            .map_err(|_| "FurinaPet Agent Bridge is unavailable".to_string())?;
        stream
            .write_all(b"\n")
            .map_err(|_| "FurinaPet Agent Bridge is unavailable".to_string())?;
        stream
            .flush()
            .map_err(|_| "FurinaPet Agent Bridge is unavailable".to_string())?;

        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|_| "FurinaPet Agent Bridge is unavailable".to_string())?;
        if read == 0 || line.len() > 64 * 1024 {
            return Err("FurinaPet Agent Bridge returned an invalid response".into());
        }
        let reply: BridgeReply = serde_json::from_str(&line)
            .map_err(|_| "FurinaPet Agent Bridge returned an invalid response".to_string())?;
        if reply.ok {
            Ok(reply.result.unwrap_or(Value::Null))
        } else {
            Err(reply
                .error
                .unwrap_or_else(|| "FurinaPet Agent Bridge rejected the request".into()))
        }
    }

    fn start_session(&self, agent: &str) {
        let mut params = json!({
            "sessionId": self.session_id.as_str(),
            "agent": sanitize_agent_name(agent),
        });
        if let Some(project) = &self.project {
            params["project"] = Value::String(project.clone());
        }
        let _ = self.call("session.start", params);
    }

    fn heartbeat(&self) {
        let _ = self.call(
            "session.heartbeat",
            json!({ "sessionId": self.session_id.as_str() }),
        );
    }

    fn end_session(&self) {
        let _ = self.call(
            "session.end",
            json!({ "sessionId": self.session_id.as_str() }),
        );
    }
}

pub fn run() -> Result<(), String> {
    let client = BridgeClient::new();
    client.start_session("mcp");

    let heartbeat_client = client.clone();
    let _ = thread::Builder::new()
        .name("furinapet-mcp-heartbeat".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            heartbeat_client.heartbeat();
        });

    let result = run_stdio_loop(&client);
    client.end_session();
    result
}

fn run_stdio_loop(client: &BridgeClient) -> Result<(), String> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    let mut reader = stdin.lock();
    let mut line = String::new();

    loop {
        line.clear();
        let read = match reader.read_line(&mut line) {
            Ok(read) => read,
            Err(error) if is_closed_pipe(&error) => break,
            Err(error) => return Err(error.to_string()),
        };
        if read == 0 {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_MCP_LINE_BYTES {
            continue;
        }

        let request: Value = match serde_json::from_str::<Value>(&line) {
            Ok(value) if value.is_object() => value,
            _ => continue,
        };

        if let Some(response) = handle_jsonrpc_request(&request, client) {
            if !write_json_line(&mut stdout, &response)? {
                break;
            }
        }
    }

    Ok(())
}

fn write_json_line<W: Write>(writer: &mut W, response: &Value) -> Result<bool, String> {
    let encoded = serde_json::to_string(response).map_err(|error| error.to_string())?;

    if let Err(error) = writer.write_all(encoded.as_bytes()) {
        if is_closed_pipe(&error) {
            return Ok(false);
        }
        return Err(error.to_string());
    }
    if let Err(error) = writer.write_all(b"\n") {
        if is_closed_pipe(&error) {
            return Ok(false);
        }
        return Err(error.to_string());
    }
    if let Err(error) = writer.flush() {
        if is_closed_pipe(&error) {
            return Ok(false);
        }
        return Err(error.to_string());
    }

    Ok(true)
}

fn is_closed_pipe(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::BrokenPipe
        || matches!(error.raw_os_error(), Some(109 | 232 | 233))
}

fn handle_jsonrpc_request(request: &Value, client: &BridgeClient) -> Option<Value> {
    let method = request.get("method")?.as_str()?;
    let id = request.get("id").cloned();
    let params = request
        .get("params")
        .cloned()
        .unwrap_or_else(|| json!({}));

    if id.is_none() {
        return None;
    }
    let id = id.unwrap_or(Value::Null);

    let result = match method {
        "initialize" => {
            let requested_protocol = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            let client_name = params
                .get("clientInfo")
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("mcp");
            client.start_session(client_name);
            Ok(json!({
                "protocolVersion": requested_protocol,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "furinapet", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Control the user's local FurinaPet companion. Use furinapet_status first. Agent state must be categorical only. Never send prompts, source code, logs, secrets, URLs, or file paths to pet speech."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(handle_tool_call(&params, client)),
        _ => Err((-32601, "Method not found")),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "furinapet_status",
            "title": "FurinaPet Status",
            "description": "Check whether the local FurinaPet desktop app is reachable and inspect the active agent state.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "idempotentHint": true }
        }),
        json!({
            "name": "furinapet_set_state",
            "title": "FurinaPet Agent State",
            "description": "Set a categorical coding-agent state on FurinaPet. Use only lifecycle state, never prompt or tool contents.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "enum": ["idle", "thinking", "editing", "testing", "waiting", "success", "error"]
                    }
                },
                "required": ["state"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "idempotentHint": true }
        }),
        json!({
            "name": "furinapet_react",
            "title": "FurinaPet React",
            "description": "Trigger a short local FurinaPet reaction.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "reaction": {
                        "type": "string",
                        "enum": ["idle", "waving", "jumping", "failed", "waiting", "running", "review"]
                    }
                },
                "required": ["reaction"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "idempotentHint": false }
        }),
        json!({
            "name": "furinapet_say",
            "title": "FurinaPet Say",
            "description": "Show one short safe status/personality message on FurinaPet. Never send code, logs, secrets, URLs, or file paths.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "minLength": 1, "maxLength": 140 },
                    "reaction": {
                        "type": "string",
                        "enum": ["idle", "waving", "jumping", "failed", "waiting", "running", "review"]
                    }
                },
                "required": ["message"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "idempotentHint": false }
        }),
    ]
}

fn handle_tool_call(params: &Value, client: &BridgeClient) -> Value {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return tool_error("Tool name is required.");
    };
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match name {
        "furinapet_status" => match client.call("status", json!({})) {
            Ok(status) => tool_success("FurinaPet is running.", status),
            Err(_) => tool_success(
                "FurinaPet desktop app is not running or its local Agent Bridge is unavailable.",
                json!({
                    "ok": false,
                    "appRunning": false,
                    "unavailableReason": "Open FurinaPet and try again."
                }),
            ),
        },
        "furinapet_set_state" => {
            let Some(state) = arguments.get("state").and_then(Value::as_str) else {
                return tool_error("Invalid state.");
            };
            if agent_host::reaction_for_agent_state(state).is_none() {
                return tool_error(
                    "Invalid state. Use idle, thinking, editing, testing, waiting, success, or error.",
                );
            }
            match client.call(
                "session.state",
                json!({
                    "sessionId": client.session_id.as_str(),
                    "state": state
                }),
            ) {
                Ok(result) => tool_success(
                    &format!("FurinaPet agent state set to {state}."),
                    result,
                ),
                Err(_) => tool_error(
                    "FurinaPet desktop app is unavailable. Open FurinaPet and try again.",
                ),
            }
        }
        "furinapet_react" => {
            let Some(reaction) = arguments.get("reaction").and_then(Value::as_str) else {
                return tool_error("Invalid reaction.");
            };
            if !matches!(
                reaction,
                "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review"
            ) {
                return tool_error("Invalid reaction.");
            }
            match client.call("pet.react", json!({ "reaction": reaction })) {
                Ok(result) => tool_success(
                    &format!("FurinaPet reaction sent: {reaction}."),
                    result,
                ),
                Err(_) => tool_error(
                    "FurinaPet desktop app is unavailable. Open FurinaPet and try again.",
                ),
            }
        }
        "furinapet_say" => {
            let Some(message) = arguments.get("message").and_then(Value::as_str) else {
                return tool_error("Message is required.");
            };
            if message.chars().count() > 140
                || message.contains('\n')
                || message.contains('\r')
            {
                return tool_error("Keep the message short and single-line.");
            }
            let reaction = arguments.get("reaction").and_then(Value::as_str);
            let mut bridge_params = json!({ "message": message });
            if let Some(reaction) = reaction {
                bridge_params["reaction"] = Value::String(reaction.into());
            }
            match client.call("pet.say", bridge_params) {
                Ok(result) => tool_success("FurinaPet message sent.", result),
                Err(error) if error.contains("message") => {
                    tool_error("Message was rejected. Avoid code, secrets, URLs, and file paths.")
                }
                Err(_) => tool_error(
                    "FurinaPet desktop app is unavailable. Open FurinaPet and try again.",
                ),
            }
        }
        _ => tool_error("Unknown FurinaPet tool."),
    }
}

fn tool_success(text: &str, structured: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": structured,
        "isError": false
    })
}

fn tool_error(text: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": true
    })
}

fn load_discovery() -> Result<AgentDiscovery, String> {
    let path = agent_host::discovery_path()?;
    let content = fs::read_to_string(path)
        .map_err(|_| "FurinaPet desktop app is unavailable".to_string())?;
    serde_json::from_str(&content)
        .map_err(|_| "FurinaPet Agent Bridge discovery is invalid".to_string())
}

fn current_project_name() -> Option<String> {
    let name = env::current_dir()
        .ok()?
        .file_name()?
        .to_string_lossy()
        .trim()
        .to_string();
    if name.is_empty()
        || name.chars().count() > 80
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        None
    } else {
        Some(name)
    }
}

fn sanitize_agent_name(value: &str) -> String {
    let lower = value.trim().to_ascii_lowercase();
    let normalized: String = lower
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .take(40)
        .collect();

    if normalized.contains("claude") {
        "claude-code".into()
    } else if normalized.contains("cursor") {
        "cursor".into()
    } else if normalized.contains("opencode") {
        "opencode".into()
    } else if normalized.is_empty() {
        "mcp".into()
    } else {
        normalized
    }
}
