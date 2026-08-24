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
const ACTIVITY_TTL_MS: u64 = 20_000;
const MAX_BRIDGE_LINE_BYTES: usize = 64 * 1024;
const CONFIG_DIR_NAME: &str = "dev.furinapet.desktop";
const DISCOVERY_FILE_NAME: &str = "agent-ipc.json";
const PET_BRAIN_AGENT_STATE_EVENT: &str = "pet-brain-agent-state";

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
    client_name: String,
    client_version: Option<String>,
    integration: String,
    project: Option<String>,
    state: String,
    connected_at_ms: u64,
    state_updated_ms: u64,
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
struct AgentStatePayload {
    state: String,
    session_id: Option<String>,
    agent: Option<String>,
    client_name: Option<String>,
    project: Option<String>,
    at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnectionSnapshot {
    pub session_id: String,
    pub agent: String,
    pub client_name: String,
    pub client_version: Option<String>,
    pub integration: String,
    pub project: Option<String>,
    pub state: String,
    pub working: bool,
    pub active: bool,
    pub connected_at_ms: u64,
    pub last_activity_ms: u64,
    pub last_seen_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusSnapshot {
    pub app_running: bool,
    pub protocol_version: u32,
    pub state: String,
    pub reaction: String,
    pub agent: Option<String>,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub integration: Option<String>,
    pub project: Option<String>,
    pub session_id: Option<String>,
    pub session_count: usize,
    pub connected_count: usize,
    pub working_count: usize,
    pub sessions: Vec<AgentConnectionSnapshot>,
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
        return write_bridge_response(
            &mut stream,
            BridgeResponse { ok: false, result: None, error: Some("request is too large".into()) },
        );
    }
    let request: BridgeRequest = match serde_json::from_str(&line) {
        Ok(value) => value,
        Err(_) => {
            return write_bridge_response(
                &mut stream,
                BridgeResponse { ok: false, result: None, error: Some("invalid request".into()) },
            )
        }
    };
    if request.token != expected_token {
        return write_bridge_response(
            &mut stream,
            BridgeResponse { ok: false, result: None, error: Some("unauthorized".into()) },
        );
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
        "status" => Ok(serde_json::to_value(snapshot(&app.state::<AgentHostState>())?)
            .map_err(|error| error.to_string())?),
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
    let client_name = optional_display_text(params, "clientName", 80)
        .unwrap_or_else(|| display_name_for_agent(&agent));
    let client_version = optional_display_text(params, "clientVersion", 40);
    let integration = optional_integration(params).unwrap_or_else(|| default_integration(&agent));
    let now = now_ms();
    let host = app.state::<AgentHostState>();

    {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let previous = sessions.get(&session_id).cloned();
        let state = previous
            .as_ref()
            .map(|session| session.state.clone())
            .unwrap_or_else(|| "idle".into());
        let connected_at_ms = previous
            .as_ref()
            .map(|session| session.connected_at_ms)
            .unwrap_or(now);
        let state_updated_ms = previous
            .as_ref()
            .map(|session| session.state_updated_ms)
            .unwrap_or(now);
        sessions.insert(
            session_id.clone(),
            AgentSession {
                session_id: session_id.clone(),
                agent,
                client_name,
                client_version,
                integration,
                project,
                state,
                connected_at_ms,
                state_updated_ms,
                last_seen_ms: now,
            },
        );
    }

    Ok(json!({
        "sessionId": session_id,
        "ttlMs": SESSION_TTL_MS,
        "activityTtlMs": ACTIVITY_TTL_MS
    }))
}

fn session_heartbeat(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let host = app.state::<AgentHostState>();
    {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let Some(session) = sessions.get_mut(&session_id) else {
            return Err("agent session is unavailable".into());
        };
        session.last_seen_ms = now_ms();
    }
    Ok(json!({
        "sessionId": session_id,
        "ttlMs": SESSION_TTL_MS,
        "activityTtlMs": ACTIVITY_TTL_MS
    }))
}

fn session_state(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let state = required_string(params, "state", 24)?;
    let reaction = reaction_for_agent_state(&state).ok_or("unsupported agent state")?;
    let now = now_ms();
    let host = app.state::<AgentHostState>();

    let session = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        let entry = sessions.entry(session_id.clone()).or_insert_with(|| {
            let agent = optional_agent(params).unwrap_or_else(|| "mcp".into());
            AgentSession {
                session_id: session_id.clone(),
                client_name: optional_display_text(params, "clientName", 80)
                    .unwrap_or_else(|| display_name_for_agent(&agent)),
                client_version: optional_display_text(params, "clientVersion", 40),
                integration: optional_integration(params).unwrap_or_else(|| default_integration(&agent)),
                project: optional_project(params),
                agent,
                state: "idle".into(),
                connected_at_ms: now,
                state_updated_ms: now,
                last_seen_ms: now,
            }
        });

        if let Some(agent) = optional_agent(params) {
            entry.agent = agent;
        }
        if let Some(client_name) = optional_display_text(params, "clientName", 80) {
            entry.client_name = client_name;
        }
        if let Some(client_version) = optional_display_text(params, "clientVersion", 40) {
            entry.client_version = Some(client_version);
        }
        if let Some(integration) = optional_integration(params) {
            entry.integration = integration;
        }
        if let Some(project) = optional_project(params) {
            entry.project = Some(project);
        }
        entry.state = state.clone();
        entry.state_updated_ms = now;
        entry.last_seen_ms = now;
        entry.clone()
    };

    *host
        .active_session_id
        .lock()
        .map_err(|_| "active agent lock is poisoned")? = Some(session_id.clone());
    emit_session_state(app, &session)?;

    Ok(json!({
        "sessionId": session_id,
        "state": state,
        "reaction": reaction,
        "agent": session.agent,
        "clientName": session.client_name,
        "clientVersion": session.client_version,
        "integration": session.integration,
        "project": session.project,
        "activityTtlMs": ACTIVITY_TTL_MS
    }))
}

fn session_end(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let session_id = required_string(params, "sessionId", 96)?;
    let host = app.state::<AgentHostState>();
    let next_active = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        sessions.remove(&session_id);
        sessions.values().max_by_key(|session| session.last_seen_ms).cloned()
    };
    let mut active = host
        .active_session_id
        .lock()
        .map_err(|_| "active agent lock is poisoned")?;
    let was_active = active.as_deref() == Some(session_id.as_str());
    if was_active {
        *active = next_active.as_ref().map(|session| session.session_id.clone());
    }
    drop(active);
    if was_active {
        if let Some(session) = next_active {
            emit_session_state(app, &session)?;
        } else {
            emit_idle_agent_state(app)?;
        }
    }
    Ok(json!({ "sessionId": session_id, "ended": true }))
}

fn pet_react(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let reaction = required_string(params, "reaction", 24)?;
    if !is_allowed_reaction(&reaction) {
        return Err("unsupported reaction".into());
    }
    commands::trigger_reaction_inner(app, reaction.clone(), None)?;
    Ok(json!({ "reaction": reaction }))
}

fn pet_say(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let message = required_string(params, "message", 180)?;
    let message = validate_safe_message(&message)?;
    let requested_reaction = params
        .get("reaction")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let reaction = if let Some(value) = requested_reaction {
        if !is_allowed_reaction(&value) {
            return Err("unsupported reaction".into());
        }
        value
    } else {
        snapshot(&app.state::<AgentHostState>())?.reaction
    };
    commands::trigger_reaction_inner(app, reaction.clone(), Some(message))?;
    Ok(json!({ "reaction": reaction }))
}

fn cleanup_stale_sessions(app: &AppHandle) -> Result<(), String> {
    let host = app.state::<AgentHostState>();
    let now = now_ms();
    let session_cutoff = now.saturating_sub(SESSION_TTL_MS);
    let activity_cutoff = now.saturating_sub(ACTIVITY_TTL_MS);

    let (active_exists, active_activity_expired, next_active) = {
        let mut sessions = host.sessions.lock().map_err(|_| "agent sessions lock is poisoned")?;
        sessions.retain(|_, session| session.last_seen_ms >= session_cutoff);

        let active_id = host
            .active_session_id
            .lock()
            .map_err(|_| "active agent lock is poisoned")?
            .clone();
        let mut expired_active = false;
        for session in sessions.values_mut() {
            if session.state != "idle" && session.state_updated_ms < activity_cutoff {
                if active_id.as_deref() == Some(session.session_id.as_str()) {
                    expired_active = true;
                }
                session.state = "idle".into();
                session.state_updated_ms = now;
            }
        }

        let active_exists = active_id
            .as_ref()
            .map(|id| sessions.contains_key(id))
            .unwrap_or(false);
        let next = sessions
            .values()
            .max_by_key(|session| session.last_seen_ms)
            .cloned();
        (active_exists, expired_active, next)
    };

    if active_exists {
        if active_activity_expired {
            emit_current_agent_state(app)?;
        }
        return Ok(());
    }

    {
        let mut active = host
            .active_session_id
            .lock()
            .map_err(|_| "active agent lock is poisoned")?;
        *active = next_active.as_ref().map(|session| session.session_id.clone());
    }

    if let Some(session) = next_active {
        emit_session_state(app, &session)?;
    } else {
        emit_idle_agent_state(app)?;
    }
    Ok(())
}

fn emit_session_state(app: &AppHandle, session: &AgentSession) -> Result<(), String> {
    let now = now_ms();
    let state = effective_session_state(session, now);
    let payload = AgentStatePayload {
        state: state.into(),
        session_id: Some(session.session_id.clone()),
        agent: Some(session.agent.clone()),
        client_name: Some(session.client_name.clone()),
        project: session.project.clone(),
        at: now,
    };
    app.emit_to("pet", PET_BRAIN_AGENT_STATE_EVENT, payload)
        .map_err(|error| error.to_string())
}

fn emit_idle_agent_state(app: &AppHandle) -> Result<(), String> {
    let payload = AgentStatePayload {
        state: "idle".into(),
        session_id: None,
        agent: None,
        client_name: None,
        project: None,
        at: now_ms(),
    };
    app.emit_to("pet", PET_BRAIN_AGENT_STATE_EVENT, payload)
        .map_err(|error| error.to_string())
}

fn emit_current_agent_state(app: &AppHandle) -> Result<(), String> {
    let host = app.state::<AgentHostState>();
    let session = {
        let sessions = host
            .sessions
            .lock()
            .map_err(|_| "agent sessions lock is poisoned")?;
        let active_id = host
            .active_session_id
            .lock()
            .map_err(|_| "active agent lock is poisoned")?
            .clone();
        active_id.and_then(|id| sessions.get(&id).cloned())
    };
    if let Some(session) = session {
        emit_session_state(app, &session)
    } else {
        emit_idle_agent_state(app)
    }
}

pub fn snapshot(state: &State<'_, AgentHostState>) -> Result<AgentStatusSnapshot, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "agent sessions lock is poisoned")?;
    let active_id = state
        .active_session_id
        .lock()
        .map_err(|_| "active agent lock is poisoned")?
        .clone();
    let now = now_ms();
    let active = active_id.as_ref().and_then(|id| sessions.get(id));
    let agent_state = active
        .map(|session| effective_session_state(session, now))
        .unwrap_or("idle");

    let mut connection_snapshots = sessions
        .values()
        .map(|session| connection_snapshot(session, active_id.as_deref(), now))
        .collect::<Vec<_>>();
    connection_snapshots.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| right.working.cmp(&left.working))
            .then_with(|| right.last_seen_ms.cmp(&left.last_seen_ms))
    });
    let working_count = connection_snapshots.iter().filter(|session| session.working).count();

    Ok(AgentStatusSnapshot {
        app_running: true,
        protocol_version: AGENT_PROTOCOL_VERSION,
        state: agent_state.into(),
        reaction: reaction_for_agent_state(agent_state).unwrap_or("idle").into(),
        agent: active.map(|session| session.agent.clone()),
        client_name: active.map(|session| session.client_name.clone()),
        client_version: active.and_then(|session| session.client_version.clone()),
        integration: active.map(|session| session.integration.clone()),
        project: active.and_then(|session| session.project.clone()),
        session_id: active.map(|session| session.session_id.clone()),
        session_count: sessions.len(),
        connected_count: sessions.len(),
        working_count,
        sessions: connection_snapshots,
    })
}

fn connection_snapshot(
    session: &AgentSession,
    active_session_id: Option<&str>,
    now: u64,
) -> AgentConnectionSnapshot {
    let state = effective_session_state(session, now).to_string();
    AgentConnectionSnapshot {
        session_id: session.session_id.clone(),
        agent: session.agent.clone(),
        client_name: session.client_name.clone(),
        client_version: session.client_version.clone(),
        integration: session.integration.clone(),
        project: session.project.clone(),
        working: is_working_state(&state),
        active: active_session_id == Some(session.session_id.as_str()),
        state,
        connected_at_ms: session.connected_at_ms,
        last_activity_ms: session.state_updated_ms,
        last_seen_ms: session.last_seen_ms,
    }
}

#[tauri::command]
pub fn get_agent_status(
    state: State<'_, AgentHostState>,
) -> Result<AgentStatusSnapshot, String> {
    snapshot(&state)
}

pub fn reaction_for_agent_state(state: &str) -> Option<&'static str> {
    match state {
        "idle" => Some("idle"),
        "thinking" => Some("review"),
        "editing" => Some("running"),
        "testing" => Some("running"),
        "waiting" => Some("waiting"),
        "success" => Some("jumping"),
        "error" => Some("failed"),
        _ => None,
    }
}

fn effective_session_state(session: &AgentSession, now: u64) -> &str {
    if session.state != "idle" && now.saturating_sub(session.state_updated_ms) >= ACTIVITY_TTL_MS {
        "idle"
    } else {
        session.state.as_str()
    }
}

fn is_working_state(state: &str) -> bool {
    matches!(state, "thinking" | "editing" | "testing" | "waiting")
}

fn is_allowed_reaction(reaction: &str) -> bool {
    matches!(
        reaction,
        "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review"
    )
}

fn validate_safe_message(value: &str) -> Result<String, String> {
    let message = value.trim();
    let length = message.chars().count();
    if length == 0 || length > 140 || message.contains('\n') || message.contains('\r') {
        return Err("message must be a single line of 1 to 140 characters".into());
    }
    let lower = message.to_ascii_lowercase();
    let unsafe_fragments = [
        "```",
        "<script",
        "=>",
        "function ",
        "http://",
        "https://",
        "www.",
        "api_key",
        "apikey",
        "password",
        "passwd",
        "private key",
        " secret",
        "token=",
        ":\\",
        ":/",
        "\\\\",
        "/home/",
        "/users/",
    ];
    if unsafe_fragments
        .iter()
        .any(|fragment| lower.contains(fragment))
    {
        return Err("message contains code, a URL, a path, or secret-like content".into());
    }
    Ok(message.into())
}

fn required_string(params: &Value, key: &str, max_chars: usize) -> Result<String, String> {
    let value = params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} is required"))?
        .trim();
    if value.is_empty() || value.chars().count() > max_chars {
        return Err(format!("{key} is invalid"));
    }
    Ok(value.into())
}

fn optional_agent(params: &Value) -> Option<String> {
    let value = params.get("agent")?.as_str()?.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 40
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'-' | b'_' | b'.')
        })
    {
        return None;
    }
    Some(value)
}

fn optional_project(params: &Value) -> Option<String> {
    let value = params.get("project")?.as_str()?.trim();
    if value.is_empty()
        || value.chars().count() > 80
        || value.contains('/')
        || value.contains('\\')
        || value.contains(':')
        || value.contains('\n')
        || value.contains('\r')
    {
        return None;
    }
    Some(value.into())
}

fn optional_display_text(params: &Value, key: &str, max_chars: usize) -> Option<String> {
    let value = params.get(key)?.as_str()?.trim();
    if value.is_empty()
        || value.chars().count() > max_chars
        || value.contains('\n')
        || value.contains('\r')
        || value.contains('/')
        || value.contains('\\')
    {
        return None;
    }
    Some(value.into())
}

fn optional_integration(params: &Value) -> Option<String> {
    let value = params.get("integration")?.as_str()?.trim().to_ascii_lowercase();
    match value.as_str() {
        "mcp" | "hooks" | "mcp+hooks" | "manual" => Some(value),
        _ => None,
    }
}

fn default_integration(agent: &str) -> String {
    if agent == "claude-code" {
        "hooks".into()
    } else {
        "manual".into()
    }
}

fn display_name_for_agent(agent: &str) -> String {
    match agent {
        "claude-code" => "Claude Code".into(),
        "cursor" => "Cursor".into(),
        "opencode" => "OpenCode".into(),
        "trae" | "trae-ide" => "Trae".into(),
        "codex" | "codex-cli" => "Codex".into(),
        "mcp" => "MCP Client".into(),
        other => other.to_string(),
    }
}

fn sanitize_bridge_error(error: String) -> String {
    if error.contains('/')
        || error.contains('\\')
        || error.to_ascii_lowercase().contains("token")
    {
        "FurinaPet Agent Bridge rejected the request".into()
    } else {
        error.chars().take(160).collect()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
