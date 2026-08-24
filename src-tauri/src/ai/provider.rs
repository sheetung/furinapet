use reqwest::Url;
use serde_json::{json, Value};

use super::{AiBehaviorContext, AiBehaviorSuggestion, AiSettings};

const MAX_PROVIDER_RESPONSE_BYTES: usize = 64 * 1024;
const SYSTEM_PROMPT: &str = r#"You are FurinaPet's high-level behavior adviser.
You do not control animation frames, coordinates, tools, files, or the user's computer.
Choose exactly one semantic goal from:
idle, wander, dock, respond-user, observe-agent, celebrate, rest.
Use only the abstract state provided. Avoid repeating the recent goals. Prefer respond-user after recent interaction, observe-agent while an Agent is working, celebrate only for clear success, and rest when energy is low.
Return one JSON object only with this schema:
{"goal":"observe-agent","confidence":0.75,"ttlMs":5000}
confidence must be 0..1. ttlMs must be 500..30000."#;

pub async fn request_suggestion(
    settings: &AiSettings,
    api_key: Option<&str>,
    context: &AiBehaviorContext,
) -> Result<AiBehaviorSuggestion, String> {
    let endpoint = chat_completions_url(&settings.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(settings.timeout_seconds))
        .user_agent("furinapet-ai/1")
        .build()
        .map_err(|_| "failed to initialize AI provider client".to_string())?;

    let user_context = serde_json::to_string(context)
        .map_err(|_| "failed to serialize AI behavior context".to_string())?;
    let body = json!({
        "model": settings.model,
        "temperature": 0.2,
        "max_tokens": 120,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_context }
        ]
    });

    let mut request = client.post(endpoint).json(&body);
    if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
        request = request.bearer_auth(key.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "AI provider request timed out".to_string()
            } else {
                "AI provider connection failed".to_string()
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("AI provider returned HTTP {}", status.as_u16()));
    }

    let bytes = response.bytes().await.map_err(|_| "failed to read AI provider response".to_string())?;
    if bytes.len() > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("AI provider response is too large".into());
    }
    let payload: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "AI provider returned invalid JSON".to_string())?;
    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| payload.pointer("/choices/0/text").and_then(Value::as_str))
        .ok_or_else(|| "AI provider response is missing message content".to_string())?;

    parse_suggestion(content)
}

fn chat_completions_url(base_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url).map_err(|_| "AI base URL is invalid".to_string())?;
    let path = url.path().trim_end_matches('/');
    let next_path = if path.ends_with("/chat/completions") {
        path.to_string()
    } else if path.is_empty() || path == "/" {
        "/chat/completions".to_string()
    } else {
        format!("{path}/chat/completions")
    };
    url.set_path(&next_path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn parse_suggestion(content: &str) -> Result<AiBehaviorSuggestion, String> {
    let trimmed = content.trim();
    let candidate = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };
    let json_slice = match (candidate.find('{'), candidate.rfind('}')) {
        (Some(start), Some(end)) if end >= start => &candidate[start..=end],
        _ => return Err("AI provider did not return a behavior JSON object".into()),
    };
    let value: Value = serde_json::from_str(json_slice)
        .map_err(|_| "AI behavior suggestion is not valid JSON".to_string())?;
    let goal = value
        .get("goal")
        .and_then(Value::as_str)
        .ok_or_else(|| "AI behavior suggestion is missing goal".to_string())?;
    if !matches!(
        goal,
        "idle" | "wander" | "dock" | "respond-user" | "observe-agent" | "celebrate" | "rest"
    ) {
        return Err("AI behavior suggestion contains an unsupported goal".into());
    }
    let confidence = value
        .get("confidence")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(0.6)
        .clamp(0.0, 1.0);
    let ttl_ms = value
        .get("ttlMs")
        .and_then(Value::as_u64)
        .unwrap_or(5000)
        .clamp(500, 30_000);

    Ok(AiBehaviorSuggestion {
        goal: goal.to_string(),
        confidence,
        ttl_ms,
    })
}
