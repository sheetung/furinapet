import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { CursorObserver } = await load('../src/motion/cursor-observer.ts');
const { AttentionTracker } = await load('../src/core/attention.ts');
const { PetBlackboard } = await load('../src/pet-brain/Blackboard.ts');
const { PetUtilityPlanner } = await load('../src/pet-brain/Planner.ts');

test('cursor sensing rejects first sample, jitter, pet motion and long sampling gaps', () => {
  const observer = new CursorObserver();
  const sample = (x, at, origin = { x: 0, y: 0 }) => observer.sample({ x, y: 0 }, origin, at, 2);
  assert.equal(sample(100, 0).moving, false);
  assert.equal(sample(104, 100).moving, false);
  assert.equal(sample(104, 200, { x: 100, y: 0 }).moving, false);
  assert.equal(sample(144, 300).speed, 200);
  assert.equal(sample(1600, 400).near, false);
  assert.equal(sample(100, 2000).moving, false);
  observer.reset();
  assert.equal(sample(300, 2100).moving, false);
});

test('continuous direction changes acquire gaze with bounded update frequency', () => {
  const attention = new AttentionTracker(); attention.reset(0);
  assert.equal(attention.update(1, 48, true), null);
  assert.equal(attention.update(1, 96, true), 1);
  assert.equal(attention.update(2, 192, true), 2);
  assert.equal(attention.update(3, 240, true), 2);
  assert.equal(attention.update(4, 384, true), 4);
  assert.equal(attention.update(null, 480), 4);
  assert.equal(attention.update(null, 1130), null);
});

test('nearby mouse activity affects utility without manufacturing click responses and expires', () => {
  const board = new PetBlackboard(), planner = new PetUtilityPlanner(() => 0);
  // Window rest is eligible only after real activity causes moderate fatigue.
  for (let sec = -60; sec <= 0; sec++) board.observeActivity('furina', 'walk', sec * 1000);
  const context = { now: 1000, autonomousMovement: true, canMove: true, canDock: true,
    userReactionActive: false, agentState: 'idle', idleForMs: 10000,
    wanderWeight: 1, dockWeight: 1, activity: 1, curiosity: 1 };
  const scores = () => Object.fromEntries(planner.scoreGoals(context, board).map(s => [s.goal, s.score]));
  const before = scores();
  board.observeCursor({ at: 1000, near: true, moving: true, speed: 200 });
  const after = scores();
  assert.ok(after.idle > before.idle);
  assert.ok(after.wander < before.wander && after.dock < before.dock);
  assert.equal(after['respond-user'], before['respond-user']);
  assert.equal(board.getClickStreak(), 0);
  assert.equal(board.getLastUserInteractionAt(), null);
  assert.equal(board.cursorAttention(1600), 0, 'stale sampling expires');
  board.observeCursor({ at: 2000, near: true, moving: false, speed: 0 });
  assert.ok(board.cursorAttention(2000) > 0 && board.cursorAttention(2000) < 1);
  board.observeCursor({ at: 2800, near: true, moving: false, speed: 0 });
  assert.equal(board.cursorAttention(2800), 0);
  board.observeCursor({ at: 3000, near: false, moving: true, speed: 1000 });
  assert.equal(board.cursorAttention(3000), 0);
});
