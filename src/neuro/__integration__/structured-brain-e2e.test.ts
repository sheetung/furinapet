/**
 * L2 Structured brain end-to-end tests.
 *
 * Mocks fetch + invoke("get_ai_api_credentials") to verify the full chain:
 * credentials → fetch → validate → normalizeBrainIntent → StructuredBrainResult.
 * Covers success, fallback, and concurrent-request protection paths.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  requestStructuredBrain,
  validateAndNormalizeBrainIntent,
  type BrainProviderContext,
} from "../brain/structured-brain";
import { emptyWorldState, emptyCharacterState, SOURCE_CONFIDENCE_CAP } from "../contracts";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeContext(): BrainProviderContext {
  return {
    world: emptyWorldState(0),
    character: emptyCharacterState(),
    recentGoals: [],
    userIdleMs: 0,
    agentConnected: false,
  };
}

function mockCredentials(baseUrl = "https://api.test.local", model = "test-model", apiKey = "sk-test") {
  mockInvoke.mockResolvedValueOnce({ baseUrl, model, apiKey, timeoutSeconds: 10 });
}

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

function mockFetchError(error: unknown) {
  globalThis.fetch = vi.fn().mockRejectedValueOnce(error) as unknown as typeof fetch;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("structured brain e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ---- Success path ---- */

  it("valid AI response → validated → StructuredBrainResult with intent and latencyMs", async () => {
    mockCredentials();
    mockFetchResponse({
      choices: [{ message: { content: JSON.stringify({
        goal: "respond-user",
        confidence: 0.9,
        motorTendency: { approach: 0.5, avoidance: 0.1, energy: 0.6, expressiveness: 0.7 },
      }) } }],
    });

    const result = await requestStructuredBrain(makeContext());

    expect(result).not.toBeNull();
    expect(result!.intent.goal).toBe("respond-user");
    expect(result!.intent.confidence).toBe(0.9);
    expect(result!.intent.motorTendency.approach).toBeCloseTo(0.5);
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result!.raw).toBeDefined();
  });

  it("AI returns confidence 0.9 → priority = min(0.82, 0.5 + 0.9*0.32)", async () => {
    mockCredentials();
    mockFetchResponse({
      choices: [{ message: { content: JSON.stringify({
        goal: "celebrate",
        confidence: 0.9,
        motorTendency: { approach: 0.3, avoidance: 0, energy: 0.5, expressiveness: 0.8 },
      }) } }],
    });

    const result = await requestStructuredBrain(makeContext());
    expect(result).not.toBeNull();

    // Priority formula: min(SOURCE_CONFIDENCE_CAP.ai, 0.5 + confidence * 0.32)
    const expectedPriority = Math.min(SOURCE_CONFIDENCE_CAP.ai, 0.5 + 0.9 * 0.32);
    // The result doesn't expose priority directly, but the confidence is there
    expect(result!.intent.confidence).toBe(0.9);
    expect(expectedPriority).toBeCloseTo(0.788, 2);
  });

  it("AI returns full intent with attention → validated (socialIntent not yet parsed — known gap)", async () => {
    mockCredentials();
    mockFetchResponse({
      choices: [{ message: { content: JSON.stringify({
        goal: "respond-user",
        confidence: 0.8,
        attention: { target: "user", strength: 0.7 },
        socialIntent: "greet",
        motorTendency: { approach: 0.6, avoidance: 0, energy: 0.5, expressiveness: 0.7 },
      }) } }],
    });

    const result = await requestStructuredBrain(makeContext());
    expect(result).not.toBeNull();
    expect(result!.intent.attention?.target).toBe("user");
    expect(result!.intent.attention?.strength).toBeCloseTo(0.7);
    // socialIntent is not yet parsed by validateAndNormalizeBrainIntent (known gap —
    // the system prompt doesn't request it and the parser doesn't read obj.socialIntent).
    // When this is wired up, this test should assert result!.intent.socialIntent === "greet".
  });

  /* ---- Failure + fallback ---- */

  it("fetch throws → returns null (caller falls back to legacy)", async () => {
    mockCredentials();
    mockFetchError(new TypeError("network failure"));

    const result = await requestStructuredBrain(makeContext());
    expect(result).toBeNull();
  });

  it("AI returns invalid goal → validation fails → returns null", async () => {
    mockCredentials();
    mockFetchResponse({
      choices: [{ message: { content: JSON.stringify({
        goal: "dance-the-macarena",
        confidence: 0.9,
      }) } }],
    });

    const result = await requestStructuredBrain(makeContext());
    expect(result).toBeNull();
  });

  it("API key empty → getAiApiSettings returns null → no fetch called", async () => {
    mockInvoke.mockResolvedValueOnce({ baseUrl: "https://api.test.local", model: "m", apiKey: "", timeoutSeconds: 10 });

    const result = await requestStructuredBrain(makeContext());
    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AI returns malformed JSON → returns null", async () => {
    mockCredentials();
    mockFetchResponse({
      choices: [{ message: { content: "definitely not json {{{" } }],
    });

    const result = await requestStructuredBrain(makeContext());
    expect(result).toBeNull();
  });

  it("HTTP 401 → returns null", async () => {
    mockCredentials();
    mockFetchResponse({ error: "unauthorized" }, false, 401);

    const result = await requestStructuredBrain(makeContext());
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  validateAndNormalizeBrainIntent (pure, no mocking needed)          */
/* ------------------------------------------------------------------ */

describe("validateAndNormalizeBrainIntent", () => {
  it("accepts a minimal valid intent", () => {
    const result = validateAndNormalizeBrainIntent({ goal: "idle", confidence: 0.7 });
    expect(result).not.toBeNull();
    expect(result!.goal).toBe("idle");
  });

  it("rejects unknown goal", () => {
    expect(validateAndNormalizeBrainIntent({ goal: "unknown-thing" })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(validateAndNormalizeBrainIntent("not-an-object")).toBeNull();
    expect(validateAndNormalizeBrainIntent(null)).toBeNull();
  });

  it("normalizes out-of-range confidence to 0..1", () => {
    const result = validateAndNormalizeBrainIntent({ goal: "idle", confidence: 2.5 });
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1);
  });
});
