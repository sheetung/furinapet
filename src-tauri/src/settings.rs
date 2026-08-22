use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub pet_visible: bool,
    pub always_on_top: bool,
    pub launch_at_login: bool,
    pub scale: f64,
    pub look_at_cursor: bool,
    pub auto_wander: bool,
    pub wander_probability: f64,
    pub wander_speed: f64,
    pub gravity_enabled: bool,
    pub reduced_motion: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            pet_visible: true,
            always_on_top: true,
            launch_at_login: false,
            scale: 1.0,
            look_at_cursor: true,
            auto_wander: false,
            wander_probability: 1.0,
            wander_speed: 1.0,
            gravity_enabled: true,
            reduced_motion: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub pet_visible: Option<bool>,
    pub always_on_top: Option<bool>,
    pub launch_at_login: Option<bool>,
    pub scale: Option<f64>,
    pub look_at_cursor: Option<bool>,
    pub auto_wander: Option<bool>,
    pub wander_probability: Option<f64>,
    pub wander_speed: Option<f64>,
    pub gravity_enabled: Option<bool>,
    pub reduced_motion: Option<bool>,
}

impl Settings {
    pub fn apply(&mut self, patch: SettingsPatch) -> Result<(), String> {
        if let Some(value) = patch.pet_visible { self.pet_visible = value; }
        if let Some(value) = patch.always_on_top { self.always_on_top = value; }
        if let Some(value) = patch.launch_at_login { self.launch_at_login = value; }
        if let Some(value) = patch.look_at_cursor { self.look_at_cursor = value; }
        if let Some(value) = patch.auto_wander { self.auto_wander = value; }
        if let Some(value) = patch.gravity_enabled { self.gravity_enabled = value; }
        if let Some(value) = patch.reduced_motion { self.reduced_motion = value; }
        if let Some(value) = patch.scale {
            if !(0.65..=1.5).contains(&value) { return Err("scale must be between 0.65 and 1.5".into()); }
            self.scale = (value * 20.0).round() / 20.0;
        }
        if let Some(value) = patch.wander_speed {
            if !(0.6..=1.8).contains(&value) { return Err("wanderSpeed must be between 0.6 and 1.8".into()); }
            self.wander_speed = (value * 10.0).round() / 10.0;
        }
        if let Some(value) = patch.wander_probability {
            if ![0.25, 0.5, 0.75, 1.0].contains(&value) { return Err("wanderProbability must be 0.25, 0.5, 0.75, or 1.0".into()); }
            self.wander_probability = value;
        }
        if self.reduced_motion { self.auto_wander = false; }
        Ok(())
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
}

impl AppState {
    pub fn new(settings: Settings) -> Self { Self { settings: Mutex::new(settings) } }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|dir| dir.join("settings.json")).map_err(|error| error.to_string())
}

pub fn load(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else { return Settings::default(); };
    fs::read_to_string(path).ok().and_then(|content| serde_json::from_str(&content).ok()).unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let content = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}
