import {
  NEURO_SCHEMA_VERSION,
  type BrainGoal, type BrainIntent, type CharacterState, type MotorTendency,
  type SocialIntent, type TargetRef, type WorldState,
} from "../contracts";

export interface BrainDecision {
  intent: BrainIntent;
  /** Which branch fired. Recorded in the trace, never part of the contract. */
  reason: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

interface Branch {
  goal: BrainGoal;
  reason: string;
  target?: TargetRef;
  strength?: number;
  social?: SocialIntent;
  tendency: Partial<MotorTendency>;
  confidence: number;
}

/**
 * The rule brain.
 *
 * Its job is not to be clever — it is to make the pipeline complete so the contracts,
 * the cerebellum, the reflexes and the motion layer can all be exercised before any
 * model exists. It is also the control arm: once a language model produces
 * `BrainIntent`, this is what its output gets compared against, and what it falls back
 * to when the model is slow, offline or wrong.
 *
 * Ordered first-match, most urgent first. A scoring planner already exists for the
 * sprite path; duplicating it here would only make two things to keep in sync.
 */
export class RuleBrain {
  decide(world: WorldState, character: CharacterState): BrainDecision {
    const branch = this.select(world, character);
    const expressiveness = clamp01(
      (branch.tendency.expressiveness ?? 0.5) * (0.5 + character.personality.expressiveness * 0.7),
    );

    return {
      reason: branch.reason,
      intent: {
        schemaVersion: NEURO_SCHEMA_VERSION,
        goal: branch.goal,
        attention: branch.target
          ? { target: branch.target, strength: clamp01(branch.strength ?? 0.6) }
          : undefined,
        socialIntent: branch.social,
        motorTendency: {
          approach: clamp01(branch.tendency.approach ?? 0),
          avoidance: clamp01(branch.tendency.avoidance ?? 0),
          energy: clamp01((branch.tendency.energy ?? 0.4) * (0.3 + character.energy * 0.9)),
          expressiveness,
        },
        confidence: branch.confidence,
        source: "rule",
        ttlMs: 4000,
      },
    };
  }

  private select(world: WorldState, character: CharacterState): Branch {
    const { emotion, personality } = character;
    const { interaction, pointer, agent, environment } = world;

    if (interaction.type === "drag") {
      // Being picked up is the one thing that overrides everything else.
      return emotion.fear > 0.35
        ? {
          goal: "avoid", reason: "dragged-and-frightened", target: "pointer", strength: 0.9,
          social: "plead",
          tendency: { avoidance: clamp01(0.5 + emotion.fear * 0.5), energy: 0.7, expressiveness: 1 },
          confidence: 0.95,
        }
        : {
          goal: "interact", reason: "dragged-and-playful", target: "pointer", strength: 0.85,
          social: "tease",
          tendency: { approach: 0.3, energy: 0.6, expressiveness: 0.9 },
          confidence: 0.85,
        };
    }

    const pestered = interaction.clickStreak >= 3
      && (interaction.region === "head" || interaction.region === "face");
    if (pestered && emotion.annoyance > 0.35) {
      return {
        goal: "avoid",
        reason: "pestered-on-the-head",
        target: "pointer",
        strength: 0.8,
        social: "complain",
        tendency: {
          // Dramatism inflates the display without inflating the actual retreat.
          avoidance: clamp01(0.35 + emotion.annoyance * 0.5),
          approach: 0,
          energy: clamp01(0.4 + emotion.annoyance * 0.4),
          expressiveness: clamp01(0.6 + personality.dramatism * 0.4),
        },
        confidence: 0.9,
      };
    }

    if (agent.state === "error") {
      return {
        goal: "observe", reason: "agent-failed", target: "screen", strength: 0.8, social: "comfort",
        tendency: { avoidance: 0.1, energy: 0.25, expressiveness: 0.6 },
        confidence: 0.85,
      };
    }
    if (agent.state === "success") {
      return {
        goal: "celebrate", reason: "agent-succeeded", target: "user", strength: 0.7, social: "brag",
        tendency: { approach: 0.4, energy: 0.9, expressiveness: 1 },
        confidence: 0.9,
      };
    }

    if (emotion.sleepiness > 0.7 || character.energy < 0.2) {
      return {
        goal: "rest", reason: "out-of-energy", target: "none",
        tendency: { energy: 0.1, expressiveness: 0.3 },
        confidence: 0.8,
      };
    }

    if (interaction.clickStreak >= 1 && interaction.type !== "none") {
      return {
        goal: "interact", reason: "just-touched", target: "pointer", strength: 0.9,
        social: emotion.annoyance > 0.5 ? "complain" : "greet",
        tendency: {
          approach: clamp01(0.2 + emotion.affection * 0.4),
          avoidance: clamp01(emotion.annoyance * 0.4),
          energy: 0.6,
          expressiveness: 0.8,
        },
        confidence: 0.85,
      };
    }

    if (pointer.direction === "approaching" && emotion.curiosity > 0.25) {
      return {
        goal: "interact", reason: "pointer-approaching", target: "pointer",
        strength: clamp01(0.4 + emotion.curiosity * 0.5),
        social: "greet",
        tendency: {
          approach: clamp01(emotion.curiosity * 0.6),
          avoidance: clamp01(emotion.annoyance * 0.3),
          energy: 0.5,
          expressiveness: 0.6,
        },
        confidence: 0.75,
      };
    }

    if (emotion.boredom > 0.55 && environment.userIdleMs > 120_000 && environment.canMove) {
      return {
        goal: "approach", reason: "bored-and-ignored", target: "user",
        strength: 0.6, social: "plead",
        tendency: { approach: clamp01(0.4 + emotion.boredom * 0.5), energy: 0.55, expressiveness: 0.7 },
        confidence: 0.7,
      };
    }

    if (agent.connected && agent.state !== "idle") {
      return {
        goal: "observe", reason: "agent-working", target: "screen", strength: 0.55,
        tendency: { energy: 0.3, expressiveness: 0.35 },
        confidence: 0.7,
      };
    }

    if (pointer.onCharacter) {
      return {
        goal: "interact", reason: "pointer-resting-on-body", target: "pointer", strength: 0.5,
        tendency: { approach: 0.15, energy: 0.35, expressiveness: 0.4 },
        confidence: 0.6,
      };
    }

    return {
      goal: "idle", reason: "nothing-happening",
      target: character.attention.target !== "none" ? character.attention.target : undefined,
      strength: character.attention.strength,
      tendency: { energy: 0.25, expressiveness: 0.3 },
      confidence: 0.6,
    };
  }
}
