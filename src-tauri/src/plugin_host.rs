use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};

use crate::commands;

const CLICK_REACTION_ID: &str = "click-reaction";
const STATE_FILE: &str = "plugin-state.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedPluginState {
    #[serde(default)]
    enabled: Vec<String>,
}

#[derive(Debug, Default)]
struct ClickMemory {
    last_click_ms: u128,
    streak: u8,
}

pub struct PluginHostState {
    enabled: Mutex<HashSet<String>>,
    click: Mutex<ClickMemory>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnapshot {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    version: &'static str,
    api_version: u8,
    enabled: bool,
    active: bool,
}

impl PluginHostState {
    pub fn load(app: &AppHandle) -> Self {
        let enabled = plugin_state_path(app)
            .ok()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str::<PersistedPluginState>(&raw).ok())
            .map(|state| state.enabled.into_iter().collect())
            .unwrap_or_default();

        Self {
            enabled: Mutex::new(enabled),
            click: Mutex::new(ClickMemory::default()),
        }
    }
}

fn plugin_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(STATE_FILE))
        .map_err(|error| error.to_string())
}

fn persist(app: &AppHandle, enabled: &HashSet<String>) -> Result<(), String> {
    let path = plugin_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut values = enabled.iter().cloned().collect::<Vec<_>>();
    values.sort();
    let bytes = serde_json::to_vec_pretty(&PersistedPluginState { enabled: values })
        .map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn is_enabled(state: &State<'_, PluginHostState>, id: &str) -> Result<bool, String> {
    state
        .enabled
        .lock()
        .map(|enabled| enabled.contains(id))
        .map_err(|_| "plugin host lock is poisoned".into())
}

#[tauri::command]
pub fn list_plugins(state: State<'_, PluginHostState>) -> Result<Vec<PluginSnapshot>, String> {
    let enabled = is_enabled(&state, CLICK_REACTION_ID)?;
    Ok(vec![PluginSnapshot {
        id: CLICK_REACTION_ID,
        name: "点击互动增强",
        description: "单击与双击桌宠触发随机动作、连续点击反馈和互动气泡。",
        version: "1.2.0",
        api_version: 1,
        enabled,
        active: enabled,
    }])
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
    enabled: bool,
) -> Result<Vec<PluginSnapshot>, String> {
    if id != CLICK_REACTION_ID {
        return Err(format!("unknown plugin: {id}"));
    }

    {
        let mut values = state.enabled.lock().map_err(|_| "plugin host lock is poisoned")?;
        if enabled {
            values.insert(id);
        } else {
            values.remove(&id);
        }
        persist(&app, &values)?;
    }

    if !enabled {
        if let Ok(mut click) = state.click.lock() {
            *click = ClickMemory::default();
        }
    }

    list_plugins(state)
}

pub fn handle_pet_event_inner(
    app: &AppHandle,
    state: &State<'_, PluginHostState>,
    name: &str,
) -> Result<bool, String> {
    if !is_enabled(state, CLICK_REACTION_ID)? {
        return Ok(false);
    }

    match name {
        "pet:clicked" => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_millis();

            let (streak, selector) = {
                let mut click = state.click.lock().map_err(|_| "plugin click lock is poisoned")?;
                click.streak = if now.saturating_sub(click.last_click_ms) < 1800 {
                    click.streak.saturating_add(1)
                } else {
                    1
                };
                click.last_click_ms = now;
                let streak = click.streak;
                if streak >= 3 {
                    click.streak = 0;
                }
                (streak, (now % 5) as usize)
            };

            if streak >= 3 {
                commands::trigger_reaction_inner(
                    app,
                    "jumping".into(),
                    Some("好啦好啦！我知道你在这里啦！✨".into()),
                )?;
                return Ok(true);
            }

            const INTERACTIONS: [(&str, &str); 5] = [
                ("waving", "嗯？是在叫我吗？"),
                ("review", "你刚刚是不是戳了我一下？"),
                ("waiting", "我有在认真陪着你哦。"),
                ("jumping", "嘿嘿，抓到你啦！"),
                ("failed", "再戳的话，我可要记仇啦……"),
            ];
            let (reaction, message) = INTERACTIONS[selector];
            commands::trigger_reaction_inner(app, reaction.into(), Some(message.into()))?;
            Ok(true)
        }
        "pet:doubleClicked" => {
            if let Ok(mut click) = state.click.lock() {
                *click = ClickMemory::default();
            }
            commands::trigger_reaction_inner(
                app,
                "jumping".into(),
                Some("哇！突然这么热情，我都吓了一跳！✨".into()),
            )?;
            Ok(true)
        }
        "pet:dragStart" | "pet:dragEnd" => Ok(false),
        _ => Err("unsupported pet event".into()),
    }
}

#[tauri::command]
pub fn publish_pet_event(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    name: String,
) -> Result<bool, String> {
    handle_pet_event_inner(&app, &state, &name)
}
