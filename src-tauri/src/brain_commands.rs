use serde::Serialize;
use tauri::{AppHandle, Emitter};

const PET_BRAIN_INTENT_EVENT: &str = "pet-brain-intent";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrainIntentPayload {
    source: String,
    goal: String,
    priority: f64,
    ttl_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
}

#[tauri::command]
pub fn submit_pet_brain_intent(
    app: AppHandle,
    source: String,
    goal: String,
    priority: Option<f64>,
    ttl_ms: Option<u64>,
    id: Option<String>,
) -> Result<(), String> {
    if !matches!(source.as_str(), "system" | "user" | "agent" | "plugin" | "ai") {
        return Err("unsupported brain intent source".into());
    }
    if !matches!(
        goal.as_str(),
        "idle" | "wander" | "dock" | "respond-user" | "observe-agent" | "celebrate" | "rest"
    ) {
        return Err("unsupported brain goal".into());
    }

    let source_cap = match source.as_str() {
        "user" | "system" => 1.0,
        "agent" | "plugin" => 0.95,
        "ai" => 0.82,
        _ => 0.8,
    };
    let priority = priority.unwrap_or(0.65).clamp(0.0, source_cap);
    let ttl_ms = ttl_ms.unwrap_or(5_000).clamp(250, 60_000);
    let id = id.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 120 || trimmed.contains('\n') || trimmed.contains('\r') {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    app.emit_to(
        "pet",
        PET_BRAIN_INTENT_EVENT,
        BrainIntentPayload {
            source,
            goal,
            priority,
            ttl_ms,
            id,
        },
    )
    .map_err(|error| error.to_string())
}
