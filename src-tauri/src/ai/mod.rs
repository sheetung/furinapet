mod credentials;
mod provider;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE: &str = "ai-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct AiSettings {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub cooldown_seconds: u64,
    pub timeout_seconds: u64,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            model: String::new(),
            cooldown_seconds: 45,
            timeout_seconds: 12,
        }
    }
}

pub struct AiServiceState {
    settings: Mutex<AiSettings>,
    last_request_ms: Mutex<u64>,
}

impl AiServiceState {
    pub fn load(app: &AppHandle) -> Self {
        Self {
            settings: Mutex::new(load_settings(app)),
            last_request_ms: Mutex::new(0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsSnapshot {
    enabled: bool,
    base_url: String,
    model: String,
    cooldown_seconds: u64,
    timeout_seconds: u64,
    has_api_key: bool,
    configured: bool,
    provider: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsUpdate {
    enabled: bool,
    base_url: String,
    model: String,
    cooldown_seconds: u64,
    timeout_seconds: u64,
    api_key: Option<String>,
    #[serde(default)]
    clear_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBehaviorContext {
    pub pet: AiPetContext,
    pub agent: AiAgentContext,
    pub user: AiUserContext,
    pub environment: AiEnvironmentContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPetContext {
    pub goal: String,
    pub mood: String,
    pub energy: f64,
    pub recent_goals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentContext {
    pub state: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUserContext {
    pub idle_for_ms: u64,
    pub click_streak: u32,
    pub recent_interaction: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEnvironmentContext {
    pub can_wander: bool,
    pub can_dock: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBehaviorSuggestion {
    pub goal: String,
    pub confidence: f64,
    pub ttl_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionResult {
    state: &'static str,
    suggestion: Option<AiBehaviorSuggestion>,
    message: String,
}

#[tauri::command]
pub fn get_ai_settings(state: State<'_, AiServiceState>) -> Result<AiSettingsSnapshot, String> {
    let settings = state.settings.lock().map_err(|_| "AI settings lock is poisoned")?.clone();
    Ok(settings_snapshot(&settings))
}

#[tauri::command]
pub fn update_ai_settings(
    app: AppHandle,
    state: State<'_, AiServiceState>,
    update: AiSettingsUpdate,
) -> Result<AiSettingsSnapshot, String> {
    let next = normalize_settings(&update)?;

    if next.enabled && (next.base_url.is_empty() || next.model.is_empty()) {
        return Err("启用 AI 建议前需要填写 API 地址和模型名称。".into());
    }

    if update.clear_api_key {
        credentials::delete_api_key()?;
    } else if let Some(key) = update.api_key.as_deref() {
        let key = key.trim();
        if !key.is_empty() {
            credentials::save_api_key(key)?;
        }
    }

    persist_settings(&app, &next)?;
    *state.settings.lock().map_err(|_| "AI settings lock is poisoned")? = next.clone();
    *state.last_request_ms.lock().map_err(|_| "AI cooldown lock is poisoned")? = 0;
    Ok(settings_snapshot(&next))
}

#[tauri::command]
pub async fn test_ai_provider(state: State<'_, AiServiceState>) -> Result<AiBehaviorSuggestion, String> {
    let settings = state.settings.lock().map_err(|_| "AI settings lock is poisoned")?.clone();
    ensure_configured(&settings)?;
    let key = credentials::load_api_key()?;
    let context = AiBehaviorContext {
        pet: AiPetContext {
            goal: "idle".into(),
            mood: "normal".into(),
            energy: 0.72,
            recent_goals: vec!["wander".into(), "idle".into()],
        },
        agent: AiAgentContext { state: "thinking".into(), connected: true },
        user: AiUserContext { idle_for_ms: 18_000, click_streak: 0, recent_interaction: false },
        environment: AiEnvironmentContext { can_wander: true, can_dock: true },
    };
    provider::request_suggestion(&settings, key.as_deref(), &context).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApiCredentials {
    base_url: String,
    model: String,
    api_key: String,
    timeout_seconds: u64,
}

#[tauri::command]
pub fn get_ai_api_credentials(state: State<'_, AiServiceState>) -> Result<AiApiCredentials, String> {
    let settings = state.settings.lock().map_err(|_| "AI settings lock is poisoned")?.clone();
    let api_key = credentials::load_api_key()?.unwrap_or_default();
    Ok(AiApiCredentials {
        base_url: settings.base_url,
        model: settings.model,
        api_key,
        timeout_seconds: settings.timeout_seconds,
    })
}

#[tauri::command]
pub async fn request_ai_behavior_suggestion(
    state: State<'_, AiServiceState>,
    context: AiBehaviorContext,
) -> Result<AiSuggestionResult, String> {
    validate_context(&context)?;
    let settings = state.settings.lock().map_err(|_| "AI settings lock is poisoned")?.clone();
    if !settings.enabled {
        return Ok(AiSuggestionResult {
            state: "skipped",
            suggestion: None,
            message: "AI behavior suggestions are disabled".into(),
        });
    }
    ensure_configured(&settings)?;

    let now = now_ms();
    {
        let mut last = state.last_request_ms.lock().map_err(|_| "AI cooldown lock is poisoned")?;
        let cooldown_ms = settings.cooldown_seconds.saturating_mul(1000);
        if *last > 0 && now.saturating_sub(*last) < cooldown_ms {
            return Ok(AiSuggestionResult {
                state: "skipped",
                suggestion: None,
                message: "AI suggestion cooldown is active".into(),
            });
        }
        *last = now;
    }

    let key = credentials::load_api_key()?;
    let suggestion = provider::request_suggestion(&settings, key.as_deref(), &context).await?;
    Ok(AiSuggestionResult {
        state: "suggested",
        suggestion: Some(suggestion),
        message: "AI behavior suggestion accepted".into(),
    })
}

fn settings_snapshot(settings: &AiSettings) -> AiSettingsSnapshot {
    AiSettingsSnapshot {
        enabled: settings.enabled,
        base_url: settings.base_url.clone(),
        model: settings.model.clone(),
        cooldown_seconds: settings.cooldown_seconds,
        timeout_seconds: settings.timeout_seconds,
        has_api_key: credentials::has_api_key(),
        configured: !settings.base_url.is_empty() && !settings.model.is_empty(),
        provider: "openai-compatible",
    }
}

fn normalize_settings(update: &AiSettingsUpdate) -> Result<AiSettings, String> {
    let base_url = update.base_url.trim().trim_end_matches('/').to_string();
    let model = update.model.trim().to_string();
    if model.chars().count() > 120 || model.contains('\n') || model.contains('\r') {
        return Err("AI 模型名称无效。".into());
    }
    if !base_url.is_empty() {
        validate_base_url(&base_url)?;
    }
    if !(15..=300).contains(&update.cooldown_seconds) {
        return Err("AI 建议间隔必须在 15 到 300 秒之间。".into());
    }
    if !(5..=60).contains(&update.timeout_seconds) {
        return Err("AI 请求超时必须在 5 到 60 秒之间。".into());
    }
    Ok(AiSettings {
        enabled: update.enabled,
        base_url,
        model,
        cooldown_seconds: update.cooldown_seconds,
        timeout_seconds: update.timeout_seconds,
    })
}

fn validate_base_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "AI API 地址无效。".to_string())?;
    if url.username() != "" || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("AI API 地址不能包含用户名、密码、查询参数或 fragment。".into());
    }
    match url.scheme() {
        "https" => Ok(()),
        "http" => {
            let host = url.host_str().unwrap_or_default();
            if matches!(host, "localhost" | "127.0.0.1" | "::1") {
                Ok(())
            } else {
                Err("远程 AI API 必须使用 HTTPS；HTTP 仅允许 localhost。".into())
            }
        }
        _ => Err("AI API 地址仅支持 HTTPS，或本机 HTTP。".into()),
    }
}

fn ensure_configured(settings: &AiSettings) -> Result<(), String> {
    if settings.base_url.is_empty() || settings.model.is_empty() {
        Err("AI Provider 尚未配置。".into())
    } else {
        Ok(())
    }
}

fn validate_context(context: &AiBehaviorContext) -> Result<(), String> {
    if !matches!(
        context.pet.goal.as_str(),
        "idle" | "wander" | "dock" | "respond-user" | "observe-agent" | "celebrate" | "rest"
    ) {
        return Err("invalid Pet Brain goal in AI context".into());
    }
    if !matches!(context.pet.mood.as_str(), "happy" | "normal" | "focused" | "tired") {
        return Err("invalid Pet Brain mood in AI context".into());
    }
    if !context.pet.energy.is_finite() || !(0.0..=1.0).contains(&context.pet.energy) {
        return Err("invalid Pet Brain energy in AI context".into());
    }
    if context.pet.recent_goals.len() > 8
        || context.pet.recent_goals.iter().any(|goal| !matches!(
            goal.as_str(),
            "idle" | "wander" | "dock" | "respond-user" | "observe-agent" | "celebrate" | "rest"
        ))
    {
        return Err("invalid recent goals in AI context".into());
    }
    if !matches!(
        context.agent.state.as_str(),
        "idle" | "thinking" | "editing" | "testing" | "waiting" | "success" | "error"
    ) {
        return Err("invalid agent state in AI context".into());
    }
    if context.user.click_streak > 100 {
        return Err("invalid click streak in AI context".into());
    }
    Ok(())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|error| error.to_string())
}

fn load_settings(app: &AppHandle) -> AiSettings {
    let Ok(path) = settings_path(app) else { return AiSettings::default(); };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AiSettings>(&raw).ok())
        .unwrap_or_default()
}

fn persist_settings(app: &AppHandle, settings: &AiSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
