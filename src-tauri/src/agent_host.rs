use crate::commands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub const AGENT_PROTOCOL_VERSION: u32 = 1;
const SESSION_TTL_MS: u64 = 15_000;
const AGENT_REACTION_TTL_MS: u64 = 12_000;
const MAX_BRIDGE_LINE_BYTES: usize = 64 * 1024;
const CONFIG_DIR_NAME: &str = "dev.furinapet.desktop";
const DISCOVERY_FILE_NAME: &str = "agent-ipc.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDiscovery {
    pub protocol: u32,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
}

#[derive(Debug, Clone)]
struct AgentSession {
    session_id: String,
    agent: String,
    project: Option<String>,
    state: String,
    last_seen_ms: u64,
}

pub struct AgentHostState {
    sessions: Mutex<HashMap<String, AgentSession>>,
    active_session_id: Mutex<Option<String>>,
}

impl Default for AgentHostState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            active_session_id: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentReactionPayload {
    reaction: String,
    message: Option<String>,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusSnapshot {
    pub app_running: bool,
    pub protocol_version: u32,
    pub state: String,
    pub reaction: String,
    pub agent: Option<String>,
    pub project: Option<String>,
    pub session_id: Option<String>,
    pub session_count: usize,
}

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub fn discovery_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|root| root.join(CONFIG_DIR_NAME).join(DISCOVERY_FILE_NAME))
        .ok_or_else(|| "FurinaPet config directory is unavailable".into())
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let discovery = AgentDiscovery {
        protocol: AGENT_PROTOCOL_VERSION,
        host: "127.0.0.1".into(),
        port,
        token: token.clone(),
        pid: std::process::id(),
        version: app.package_info().version.to_string(),
    };
    write_discovery(&discovery)?;

    let listener_app = app.clone();
    let listener_token = token.clone();
    thread::Builder::new()
        .name("furinapet-agent-ipc".into())
        .spawn(move || {
            for incoming in listener.incoming() {
                let Ok(stream) = incoming else { break; };
                let app = listener_app.clone();
                let token = listener_token.clone();
                let _ = thread::Builder::new()
                    .name("furinapet-agent-client".into())
                    .spawn(move || {
                        let _ = handle_connection(&app, stream, &token);
                    });
            }
        })
        .map_err(|error| error.to_string())?;

    let cleanup_app = app.clone();
    thread::Builder::new()
        .name("furinapet-agent-ttl".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            let _ = cleanup_stale_sessions(&cleanup_app);
        })
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn write_discovery(discovery: &AgentDiscovery) -> Result<(), String> {
    let path = discovery_path()?;
    let parent = path.parent().ok_or("invalid discovery path")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_vec_pretty(discovery).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn handle_connection(app: &AppHandle, mut stream: TcpStream, expected_token: &str) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let reader_stream = stream.try_clone().map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(reader_stream);
    let mut line = String::new();
    let read = reader.read_line(&mut line).map_err(|error| error.to_string())?;
    if read == 0 {
        return Ok(());
    }
    if line.len() > MAX_BRIDGE_LINE_BYTES {
        return write_bridge_response(&mut stream, BridgeResponse { ok: false, result: None, error: Some("request is too large".into()) });
    }
    let request: BridgeRequest = match serde_json::from_str(&line) {
        Ok(value) => value,
        Err(_) => return write_bridge_response(&mut stream, BridgeResponse { ok: false, result: None, error: Some("invalid request".into()) }),
    };
    if request.token != expected_token {
        return write_bridge_response(&mut stream, BridgeResponse { ok: false, result: None, error: Some("unauthorized".into()) });
    }
    let response = match dispatch_bridge_request(app, &request.method, &request.params) {
        Ok(result) => BridgeResponse { ok: true, result: Some(result), error: None },
        Err(error) => BridgeResponse { ok: false, result: None, error: Some(sanitize_bridge_error(error)) },
    };
    write_bridge_response(&mut stream, response)
}

fn write_bridge_response(stream: &mut TcpStream, response: BridgeResponse) -> Result<(), String> {
    let encoded = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    stream.write_all(encoded.as_bytes()).map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())
}

fn dispatch_bridge_request(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "status" => Ok(serde_json::to_value(snapshot(&app.state::<AgentHostState>())?).map_err(|error| error.to_string())?),
        "session.start" => session_start(app, params),
        "session.heartbeat" => session_heartbeat(app, params),
        "session.state" => session_state(app, params),
        "session.end" => session_end(app, params),
        "pet.react" => pet_react(app, params),
        "pet.say" => pet_say(app, params),
        _ => Err("unsupported bridge method".into()),
    }
}

fn session_start(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let agent = optional_agent(params).unwrap_or_else(|| "mcp".into());
    let project = optional_project(params);
    let now = now_ms();
    let host = app.state::<AgentHostState>();
    {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let previous_state = sessions.get(&session_id).map(|session| session.state.clone()).unwrap_or_else(|| "idle".into());
        sessions.insert(session_id.clone(), AgentSession { session_id: session_id.clone(), agent, project, state: previous_state, last_seen_ms: now });
    }
    Ok(json!({ "sessionId": session_id, "ttlMs": SESSION_TTL_MS }))
}

fn session_heartbeat(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let host = app.state::<AgentHostState>();
    let refreshed = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let Some(session) = sessions.get_mut(&session_id) else { return Err("agent session is unavailable".into()); };
        session.last_seen_ms = now_ms();
        session.clone()
    };
    let active = host.active_session_id.lock().map_err(|_| "active agent lock is poisoned")?.clone();
    if active.as_deref() == Some(session_id.as_str()) { emit_session_state(app, &refreshed)?; }
    Ok(json!({ "sessionId": session_id, "ttlMs": SESSION_TTL_MS }))
}

fn session_state(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let state = required_string(params, "state", 24)?;
    let reaction = reaction_for_agent_state(&state).ok_or("unsupported agent state")?;
    let now = now_ms();
    let host = app.state::<AgentHostState>();
    let session = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let entry = sessions.entry(session_id.clone()).or_insert_with(|| AgentSession {
            session_id: session_id.clone(), agent: optional_agent(params).unwrap_or_else(|| "mcp".into()), project: optional_project(params), state: "idle".into(), last_seen_ms: now,
        });
        if let Some(agent) = optional_agent(params) { entry.agent = agent; }
        if let Some(project) = optional_project(params) { entry.project = Some(project); }
        entry.state = state.clone();
        entry.last_seen_ms = now;
        entry.clone()
    };
    *host.active_session_id.lock().map_err(|_| "active agent lock is poisoned")? = Some(session_id.clone());
    emit_agent_reaction(app, reaction, None, AGENT_REACTION_TTL_MS)?;
    Ok(json!({ "sessionId": session_id, "state": state, "reaction": reaction, "agent": session.agent, "project": session.project }))
}

fn session_end(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let host = app.state::<AgentHostState>();
    let next_active = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        sessions.remove(&session_id);
        sessions.values().max_by_key(|session| session.last_seen_ms).cloned()
    };
    let mut active = host.active_session_id.lock().map_err(|_| "active agent lock is poisoned")?;
    let was_active = active.as_deref() == Some(session_id.as_str());
    if was_active { *active = next_active.as_ref().map(|session| session.session_id.clone()); }
    drop(active);
    if was_active {
        if let Some(session) = next_active { emit_session_state(app, &session)?; } else { emit_agent_reaction(app, "idle", None, 200)?; }
    }
    Ok(json!({ "sessionId": session_id, "ended": true }))
}

fn pet_react(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let reaction = required_string(params, "reaction", 24)?;
    if !is_allowed_reaction(&reaction) { return Err("unsupported reaction".into()); }
    commands::trigger_reaction_inner(app, reaction.clone(), None)?;
    Ok(json!({ "reaction": reaction }))
}

fn pet_say(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let message = required_string(params, "message", 180)?;
    let message = validate_safe_message(&message)?;
    let requested_reaction = params.get("reaction").and_then(Value::as_str).map(str::to_owned);
    let reaction = if let Some(value) = requested_reaction {
        if !is_allowed_reaction(&value) { return Err("unsupported reaction".into()); }
        value
    } else {
        snapshot(&app.state::<AgentHostState>())?.reaction
    };
    commands::trigger_reaction_inner(app, reaction.clone(), Some(message))?;
    Ok(json!({ "reaction": reaction }))
}

fn cleanup_stale_sessions(app: &AppHandle) -> Result<(), String> {
    let host = app.state::<AgentHostState>();
    let cutoff = now_ms().saturating_sub(SESSION_TTL_MS);
    let mut active = host.active_session_id.lock().map_err(|_| "active agent lock is poisoned")?;
    let (active_still_exists, next_active) = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        sessions.retain(|_, session| session.last_seen_ms >= cutoff);
        let active_exists = active.as_ref().map(|id| sessions.contains_key(id)).unwrap_or(false);
        let next = sessions.values().max_by_key(|session| session.last_seen_ms).cloned();
        (active_exists, next)
    };
    if active_still_exists { return Ok(()); }
    *active = next_active.as_ref().map(|session| session.session_id.clone());
    drop(active);
    if let Some(session) = next_active { emit_session_state(app, &session)?; } else { emit_agent_reaction(app, "idle", None, 200)?; }
    Ok(())
}

fn emit_session_state(app: &AppHandle, session: &AgentSession) -> Result<(), String> {
    let reaction = reaction_for_agent_state(&session.state).unwrap_or("idle");
    emit_agent_reaction(app, reaction, None, AGENT_REACTION_TTL_MS)
}

fn emit_agent_reaction(app: &AppHandle, reaction: &str, message: Option<String>, duration_ms: u64) -> Result<(), String> {
    let payload = AgentReactionPayload { reaction: reaction.into(), message, duration_ms };
    app.emit_to("pet", "pet-reaction", payload).map_err(|error| error.to_string())
}

pub fn snapshot(state: &State<'_, AgentHostState>) -> Result<AgentStatusSnapshot, String> {
    let active_id = state.active_session_id.lock().map_err(|_| "active agent lock is poisoned")?.clone();
    let sessions = state.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
    let active = active_id.as_ref().and_then(|id| sessions.get(id));
    let agent_state = active.map(|session| session.state.as_str()).unwrap_or("idle");
    Ok(AgentStatusSnapshot {
        app_running: true,
        protocol_version: AGENT_PROTOCOL_VERSION,
        state: agent_state.into(),
        reaction: reaction_for_agent_state(agent_state).unwrap_or("idle").into(),
        agent: active.map(|session| session.agent.clone()),
        project: active.and_then(|session| session.project.clone()),
        session_id: active.map(|session| session.session_id.clone()),
        session_count: sessions.len(),
    })
}

#[tauri::command]
pub fn get_agent_status(state: State<'_, AgentHostState>) -> Result<AgentStatusSnapshot, String> { snapshot(&state) }

pub fn reaction_for_agent_state(state: &str) -> Option<&'static str> {
    match state {
        "idle" => Some("idle"), "thinking" => Some("review"), "editing" => Some("running"), "testing" => Some("running"), "waiting" => Some("waiting"), "success" => Some("jumping"), "error" => Some("failed"), _ => None,
    }
}

fn is_allowed_reaction(reaction: &str) -> bool {
    matches!(reaction, "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review")
}

fn validate_safe_message(value: &str) -> Result<String, String> {
    let message = value.trim();
    let length = message.chars().count();
    if length == 0 || length > 140 || message.contains('\n') || message.contains('\r') { return Err("message must be a single line of 1 to 140 characters".into()); }
    let lower = message.to_ascii_lowercase();
    let unsafe_fragments = ["```", "<script", "=>", "function ", "http://", "https://", "www.", "api_key", "apikey", "password", "passwd", "private key", " secret", "token=", ":\\", ":/", "\\\\", "/home/", "/users/"];
    if unsafe_fragments.iter().any(|fragment| lower.contains(fragment)) { return Err("message contains code, a URL, a path, or secret-like content".into()); }
    Ok(message.into())
}

fn required_string(params: &Value, key: &str, max_chars: usize) -> Result<String, String> {
    let value = params.get(key).and_then(Value::as_str).ok_or_else(|| format!("{key} is required"))?.trim();
    if value.is_empty() || value.chars().count() > max_chars { return Err(format!("{key} is invalid")); }
    Ok(value.into())
}

fn optional_agent(params: &Value) -> Option<String> {
    let value = params.get("agent")?.as_str()?.trim().to_ascii_lowercase();
    if value.is_empty() || value.len() > 40 || !value.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')) { return None; }
    Some(value)
}

fn optional_project(params: &Value) -> Option<String> {
    let value = params.get("project")?.as_str()?.trim();
    if value.is_empty() || value.chars().count() > 80 || value.contains('/') || value.contains('\\') || value.contains(':') { return None; }
    Some(value.into())
}

fn sanitize_bridge_error(error: String) -> String {
    if error.contains('/') || error.contains('\\') || error.to_ascii_lowercase().contains("token") { "FurinaPet Agent Bridge rejected the request".into() } else { error.chars().take(160).collect() }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0)
}
