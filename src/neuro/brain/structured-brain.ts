/**
 * Structured Brain Provider (neuro L4 — AI brain).
 *
 * Calls an OpenAI-compatible API and returns a full NeuroBrainIntent
 * (goal + attention + emotionDelta + motorTendency + confidence) instead
 * of the legacy single-goal suggestion. Reuses the same baseUrl/model/apiKey
 * stored in Rust-side AI settings — no separate configuration needed.
 *
 * This is the "API-compatible" first step per the LMC plan: the real brain
 * is still a cloud/local LLM, but now it speaks the full BrainIntent protocol.
 * Later, FunctionGemma/MotorNet can replace this provider transparently.
 */

import type { NeuroBrainIntent, EmotionState, TargetRef, SocialIntent } from "../contracts";
import { normalizeBrainIntent, NEUTRAL_MOTOR_TENDENCY } from "../contracts";
import type { CharacterState } from "../contracts";
import type { WorldState } from "../contracts";
import type { PetGoalId } from "../../pet-brain/types";
import { invoke } from "@tauri-apps/api/core";

/* ------------------------------------------------------------------ */
/*  Context building                                                   */
/* ------------------------------------------------------------------ */

export interface BrainProviderContext {
  world: WorldState;
  character: CharacterState;
  recentGoals: PetGoalId[];
  userIdleMs: number;
  agentConnected: boolean;
}

function buildSystemPrompt(): string {
  return `You are the brain of a small desktop pet character named Furina. You observe the world through structured sensors and decide what the character wants to do next.

You MUST respond with a single JSON object (no markdown, no explanation) matching this schema:
{
  "goal": one of ["idle","wander","dock","respond-user","observe-agent","celebrate","rest"],
  "attention": { "target": one of ["none","pointer","user","agent","self"], "strength": 0..1 } | null,
  "emotionDelta": { "happiness": number, "affection": number, "curiosity": number, "annoyance": number, "fear": number, "boredom": number, "sleepiness": number } | null,
  "socialIntent": one of ["none","greet","complain","tease","comfort","brag","withdraw","plead"] | null,
  "motorTendency": { "approach": 0..1, "avoidance": 0..1, "energy": 0..1, "expressiveness": 0..1 },
  "confidence": 0..1
}

Rules:
- goal: what the character wants to do RIGHT NOW.
- attention: who/what the character is focused on. null = no specific focus.
- emotionDelta: small adjustments to emotions (typically -0.15 to +0.15). null = no change.
- socialIntent: how the character wants to relate to the user right now. null = not relevant.
- motorTendency: how the character physically expresses the intent.
- confidence: how sure you are about this decision (0.5-1.0).
- NEVER output animation names, coordinates, or joint data.
- Keep responses concise. The character is a small desktop pet, not a human.`;
}

function buildUserMessage(ctx: BrainProviderContext): string {
  const { world, character, recentGoals, userIdleMs, agentConnected } = ctx;
  return JSON.stringify({
    worldState: {
      pointer: {
        speed: Math.round(world.pointer.speed),
        motion: world.pointer.motion,
        targetRegion: world.pointer.targetRegion,
        distanceToCharacter: +world.pointer.distanceToCharacter.toFixed(2),
      },
      interaction: {
        type: world.interaction.type,
        clickStreak: world.interaction.clickStreak,
        intensity: +world.interaction.intensity.toFixed(2),
      },
      agent: { state: world.agent.state, connected: world.agent.connected },
      environment: { userIdleMs: world.environment.userIdleMs },
    },
    characterState: {
      emotion: roundEmotion(character.emotion),
      energy: +character.energy.toFixed(2),
      arousal: +character.arousal.toFixed(2),
      attention: character.attention,
      currentGoal: character.currentGoal,
    },
    context: {
      recentGoals: recentGoals.slice(-4),
      userIdleMs,
      agentConnected,
    },
  });
}

function roundEmotion(e: EmotionState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(e) as (keyof EmotionState)[]) {
    out[key] = +e[key].toFixed(2);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Failure logging (rate-limited)                                     */
/* ------------------------------------------------------------------ */

const WARN_INTERVAL_MS = 60_000;
const lastWarnAt = new Map<string, number>();

/**
 * Structured-brain failures fall back to the legacy suggestion path (or to
 * local autonomy), so they must not spam the console — but a misconfigured
 * provider that never surfaces would be undebuggable. One warn per category
 * per minute.
 */
function warnFailure(category: string, message: string) {
  const now = Date.now();
  const last = lastWarnAt.get(category) ?? 0;
  if (now - last < WARN_INTERVAL_MS) return;
  lastWarnAt.set(category, now);
  console.warn(`[neuro:brain] ${category}: ${message}`);
}

/* ------------------------------------------------------------------ */
/*  API call                                                           */
/* ------------------------------------------------------------------ */

const ALLOWED_GOALS = new Set<PetGoalId>([
  "idle", "wander", "dock", "respond-user", "observe-agent", "celebrate", "rest",
]);

const ALLOWED_TARGETS = new Set<TargetRef>([
  "none", "pointer", "user", "agent", "self",
]);

interface AiApiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutSeconds: number;
}

async function getAiApiSettings(): Promise<AiApiSettings | null> {
  try {
    const settings = await invoke<{ baseUrl: string; model: string; apiKey: string; timeoutSeconds: number }>(
      "get_ai_api_credentials",
    );
    if (!settings.baseUrl || !settings.model || !settings.apiKey) return null;
    return settings;
  } catch (error) {
    warnFailure("credentials", `get_ai_api_credentials invoke failed: ${String(error)}`);
    return null;
  }
}

export interface StructuredBrainResult {
  intent: NeuroBrainIntent;
  raw: unknown;
  latencyMs: number;
}

/**
 * Call the OpenAI-compatible API and return a structured BrainIntent.
 * Returns null if the API is not configured, the call fails, or the
 * response cannot be parsed into a valid BrainIntent.
 */
export async function requestStructuredBrain(
  ctx: BrainProviderContext,
): Promise<StructuredBrainResult | null> {
  const settings = await getAiApiSettings();
  if (!settings) return null;

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);

  try {
    const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserMessage(ctx) },
        ],
        temperature: 0.7,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      warnFailure("http", `${response.status} ${response.statusText || ""} from ${settings.model}`);
      return null;
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      warnFailure("empty-response", `no message content from ${settings.model}`);
      return null;
    }

    const parsed = parseBrainIntentResponse(content);
    if (!parsed) {
      warnFailure("parse", `response did not validate as BrainIntent: ${content.slice(0, 160)}`);
      return null;
    }

    return {
      intent: parsed,
      raw: data,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      warnFailure("timeout", `request exceeded ${settings.timeoutSeconds}s`);
    } else {
      warnFailure("network", String(error));
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                   */
/* ------------------------------------------------------------------ */

function parseBrainIntentResponse(content: string): NeuroBrainIntent | null {
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const json = JSON.parse(cleaned);
    return validateAndNormalizeBrainIntent(json);
  } catch (error) {
    warnFailure("json", `JSON.parse failed: ${String(error)}`);
    return null;
  }
}

export function validateAndNormalizeBrainIntent(value: unknown): NeuroBrainIntent | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  // Goal must be one of the allowed set
  const goal = typeof obj.goal === "string" ? obj.goal as PetGoalId : null;
  if (!goal || !ALLOWED_GOALS.has(goal)) return null;

  // Build a partial intent for normalizeBrainIntent
  const partial: NeuroBrainIntent = {
    goal,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0.5,
    motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
  };

  // Attention (optional)
  if (obj.attention && typeof obj.attention === "object") {
    const att = obj.attention as Record<string, unknown>;
    const rawTarget = typeof att.target === "string" ? att.target : "none";
    const target: TargetRef = ALLOWED_TARGETS.has(rawTarget as TargetRef) ? rawTarget as TargetRef : "none";
    const strength = typeof att.strength === "number" ? att.strength : 0;
    partial.attention = { target, strength };
  }

  // Motor tendency (optional)
  if (obj.motorTendency && typeof obj.motorTendency === "object") {
    const mt = obj.motorTendency as Record<string, unknown>;
    partial.motorTendency = {
      approach: typeof mt.approach === "number" ? mt.approach : NEUTRAL_MOTOR_TENDENCY.approach,
      avoidance: typeof mt.avoidance === "number" ? mt.avoidance : NEUTRAL_MOTOR_TENDENCY.avoidance,
      energy: typeof mt.energy === "number" ? mt.energy : NEUTRAL_MOTOR_TENDENCY.energy,
      expressiveness: typeof mt.expressiveness === "number" ? mt.expressiveness : NEUTRAL_MOTOR_TENDENCY.expressiveness,
    };
  }

  // emotionDelta (optional, partial EmotionState)
  if (obj.emotionDelta && typeof obj.emotionDelta === "object") {
    const ed = obj.emotionDelta as Record<string, unknown>;
    const delta: Partial<EmotionState> = {};
    for (const key of ["happiness", "affection", "curiosity", "annoyance", "fear", "boredom", "sleepiness"] as const) {
      if (typeof ed[key] === "number" && Number.isFinite(ed[key] as number)) {
        delta[key] = ed[key] as number;
      }
    }
    partial.emotionDelta = delta;
  }

  // socialIntent (optional)
  if (typeof obj.socialIntent === "string") {
    partial.socialIntent = obj.socialIntent as SocialIntent;
  }

  return normalizeBrainIntent(partial);
}
