import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from './load-ts.mjs';
const { PetBlackboard } = await load('../src/pet-brain/Blackboard.ts');
const { PetUtilityPlanner } = await load('../src/pet-brain/Planner.ts');
const { GestureSelector } = await load('../src/pet-brain/adapters/gesture-selector.ts');
const { normalizeWanderProfile, nextDecisionDelay, pauseDuration } = await load('../src/core/wander-controller.ts');
const { wanderProfile: rawProfile } = JSON.parse(await readFile(new URL('../characters/furina/character.json', import.meta.url), 'utf8'));
const profile = normalizeWanderProfile(rawProfile);
const context = { now: 6000, autonomousMovement: true, canMove: true, canDock: false,
  userReactionActive: false, agentState: 'idle', idleForMs: 6000,
  wanderWeight: .65, dockWeight: .45, activity: profile.activity, curiosity: profile.curiosity };

test('Furina stays calm after startup regardless of the random draw, but can explore later', () => {
  for (const roll of [0, .25, .5, .75, .999]) {
    const planner = new PetUtilityPlanner(() => roll), board = new PetBlackboard();
    assert.equal(planner.plan(context, board).goal, 'idle');
    assert.equal(planner.plan({ ...context, now: 60000, idleForMs: 60000 }, board).goal, 'wander');
    board.submitIntent({ id: 'click', source: 'user', goal: 'respond-user', priority: .9,
      createdAt: 6000, expiresAt: 7000 });
    assert.equal(planner.plan(context, board).goal, 'respond-user');
  }
});

test('Furina decision and movement pauses allow 20 to 30 seconds of quiet', () => {
  for (const roll of [0, .5, .999]) {
    assert.ok(nextDecisionDelay(profile, () => roll) >= 20000);
    assert.ok(nextDecisionDelay(profile, () => roll) <= 30000);
    assert.ok(pauseDuration(profile, () => roll) >= 20000);
    assert.ok(pauseDuration(profile, () => roll) <= 30000);
  }
});

test('idle gestures do not alternate into curious poses while a blink cools down', () => {
  const selector = new GestureSelector(), action = { type: 'idle', durationMs: 1500 };
  const blink = selector.select(action, 'idle', .78, 0);
  assert.equal(blink.motion, 'double-blink'); selector.recordPerformed(blink, 0);
  for (const now of [1500, 10000, 20000, 40000, 59999]) {
    assert.equal(selector.select(action, 'idle', .78, now).motion, undefined);
  }
  assert.equal(selector.select(action, 'idle', .78, 60000).motion, 'double-blink');
});

test('nonconsecutive behavior repeats lose weight and recover after two minutes', () => {
  const board = new PetBlackboard(), planner = new PetUtilityPlanner(() => 0);
  const ctx = { ...context, now: 10000, idleForMs: 60000 };
  const score = () => planner.scoreGoals(ctx, board).find(item => item.goal === 'wander').score;
  const before = score();
  board.recordDecision({ id: 'walk', goal: 'wander', score: 1, reason: 'test', createdAt: 10000, actions: [], candidates: [] });
  board.recordDecision({ id: 'idle', goal: 'idle', score: 1, reason: 'test', createdAt: 10000, actions: [], candidates: [] });
  assert.ok(score() < before, 'an intervening idle must not erase the penalty');
  ctx.now += 120000;
  assert.equal(score(), before);
});

test('performed gestures lose selection weight after cooldown, then recover; proposals do not count', () => {
  const selector = new GestureSelector(), action = { type: 'celebrate', intensity: 'normal' };
  const select = now => selector.select(action, 'success', .78, now);
  const first = select(0);
  assert.equal(first.motion, 'proud');
  assert.equal(select(0).motion, 'proud', 'merely selecting must not consume weight');
  selector.recordPerformed(first, 0);
  assert.equal(select(30000).motion, 'greeting', 'repeat penalty lasts beyond the cooldown');
  assert.equal(select(180000).motion, 'proud', 'weight recovers without another action');
});
