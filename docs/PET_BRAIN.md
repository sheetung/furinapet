# FurinaPet Pet Brain

Pet Brain is the built-in autonomous behavior core. It owns high-level behavior arbitration so user input, Agent state, plugins and future AI do not each become a separate controller.

## Boundaries

```text
User senses ─────┐
Agent lifecycle ─┤
Plugin intents ──┼──> Blackboard -> Utility Planner -> Action Plan -> Executor -> PetView / reaction API
AI suggestions ──┤
System state ─────┘
```

Pet Brain decides **what the character should do**. Existing motion/rendering code decides **how the selected action is physically displayed**.

- PetView owns sprite rendering, cursor look, gravity and movement interpolation.
- `wander-controller` owns geometry and movement target helpers.
- Pet Brain owns goals, context, memory, priorities and action sequences.
- Agent Bridge publishes lifecycle facts; it no longer chooses lifecycle animations.
- Plugins should prefer behavior intents over direct reactions when they want autonomous behavior.
- AI may only suggest semantic goals. It cannot select sprite rows, raw coordinates or animation frames.

## Core modules

- `Blackboard.ts` — short-term memory, mood, energy, recent interaction and Agent state.
- `Planner.ts` — Utility AI scoring and contextual weighted selection.
- `Executor.ts` — interruptible action-plan execution and priority arbitration.
- `runtime.ts` — pet-window bridge for senses, Agent state and external intents.
- `adapters/wander.ts` — maps existing wander settings/profile into Brain context.
- `adapters/reaction.ts` — maps semantic actions onto currently available animation assets.
- `adapters/ai.ts` — validates and caps untrusted AI suggestions.

## Goals

Current semantic goals:

- `idle`
- `wander`
- `dock`
- `respond-user`
- `observe-agent`
- `celebrate`
- `rest`

The goal set is intentionally smaller than the animation set. A goal can produce different action plans depending on Blackboard state, mood, energy and available assets.

## Priority model

Input source priority is bounded before it reaches the planner:

- System/user intent: up to `1.00`
- Agent/plugin intent: up to `0.95`
- AI suggestion: up to `0.82`

The executor also applies an interrupt margin, so a weak new plan does not constantly replace an already-running stronger plan.

Dragging and explicit/manual reaction commands remain immediate controls. MCP `furinapet_react` and `furinapet_say` are explicit user/agent actions and are intentionally distinct from lifecycle state planning.

## Randomness policy

Pet Brain removes randomness from the high-level question “should the character act?”. Utility scores choose suitable goals first. Randomness is retained only for variation among similarly suitable choices and for low-level presentation such as target position or timing.

This prevents context-free behavior such as celebrating during an error while keeping the character from becoming perfectly repetitive.

## Agent integration

Agent Bridge sends `pet-brain-agent-state` with categorical state:

`idle | thinking | editing | testing | waiting | success | error`

The Rust host records sessions and lifecycle state but Pet Brain chooses the visual response. Agent heartbeat only preserves connectivity and does not keep a work action alive.

## Plugin integration

Plugin SDK v1 gains:

```js
ctx.pet.intent("respond-user", {
  priority: 0.8,
  ttlMs: 2000,
});
```

The permission is `pet:behavior`. Existing `pet:reaction` remains for backward compatibility and explicit effects. New autonomous plugins should use `pet:behavior` whenever possible.

## AI integration contract

AI output is treated as an untrusted suggestion:

```json
{
  "goal": "observe-agent",
  "confidence": 0.8,
  "ttlMs": 5000
}
```

`adapters/ai.ts` validates the goal, clamps TTL and caps resulting priority at `0.82`. AI does not receive a direct animation/action primitive in this layer.

## Debugging

The pet window publishes `furinapet:brain-snapshot` after autonomous decisions. A snapshot contains current goal, mood, energy, click streak, recent decision history, pending intents and executor state. This event is the basis for a later Control Center debug/behavior page.

## Migration plan

1. Core Blackboard / Planner / Executor — implemented.
2. Wander high-level decision — implemented; movement physics stays unchanged.
3. Priority-aware action execution — implemented for semantic reaction plans.
4. User click senses — routed through Brain when not consumed by a legacy plugin; official click plugin migration is prepared separately.
5. Agent lifecycle — routed into Brain; explicit MCP react/say remain direct.
6. Brain snapshot contract — implemented; Control Center visualization remains follow-up work.
7. AI intent adapter — implemented; no external model is enabled by default.

The feature branch remains isolated until Windows CI and real desktop behavior are verified.
