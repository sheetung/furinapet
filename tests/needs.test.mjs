import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { PetNeeds } = await load('../src/pet-brain/needs.ts');
const { PetBlackboard } = await load('../src/pet-brain/Blackboard.ts');
const { PetUtilityPlanner } = await load('../src/pet-brain/Planner.ts');
const { GestureSelector } = await load('../src/pet-brain/adapters/gesture-selector.ts');

test('actual walking triggers rest and recovery persists to a separate exit threshold', () => {
  const needs = new PetNeeds(); needs.observe('walk', 0);
  for (let sec = 1; sec <= 100; sec++) needs.observe('walk', sec * 1000);
  assert.equal(needs.snapshot().reason, 'tired');
  needs.observe('rest', 100000);
  for (let sec = 101; sec <= 110; sec++) needs.observe('rest', sec * 1000);
  assert.ok(needs.snapshot().energy > .35);
  assert.equal(needs.snapshot().recovering, true);
  for (let sec = 111; sec <= 135; sec++) needs.observe('rest', sec * 1000);
  assert.equal(needs.snapshot().recovering, false);
});

test('play consumes more than walking; paused and long suspension do not simulate offline neglect', () => {
  const walk = new PetNeeds(), play = new PetNeeds();
  walk.observe('walk', 0); play.observe('play', 0);
  for (let sec = 1; sec <= 10; sec++) { walk.observe('walk', sec * 1000); play.observe('play', sec * 1000); }
  assert.ok(play.snapshot().energy < walk.snapshot().energy);
  play.observe('paused', 10000); const energy = play.snapshot().energy;
  play.observe('paused', 1000000); play.observe('idle', 1000001);
  assert.equal(play.snapshot().energy, energy);
});

test('thirst and hunger require their own actions and only elapsed consumption reduces them', () => {
  const needs = new PetNeeds(); needs.observe('idle', 0);
  for (let sec = 1; sec <= 1600; sec++) needs.observe('idle', sec * 1000);
  const before = needs.snapshot(); assert.equal(before.reason, 'thirsty'); assert.ok(before.hunger >= .65);
  needs.observe('tea', 1600000);
  assert.equal(needs.snapshot().thirst, before.thirst);
  for (let sec = 1601; sec <= 1604; sec++) needs.observe('tea', sec * 1000);
  assert.equal(needs.snapshot().reason, 'thirsty', 'drinking continues to the satisfaction threshold');
  needs.observe('tea', 1605000);
  assert.equal(needs.snapshot().reason, 'hungry');
  needs.observe('cake', 1605000);
  for (let sec = 1606; sec <= 1610; sec++) needs.observe('cake', sec * 1000);
  assert.equal(needs.snapshot().reason, null);
});

test('rest decision does not restore energy; tired plans suppress movement', () => {
  const board = new PetBlackboard(), planner = new PetUtilityPlanner(() => 0);
  for (let sec = 0; sec <= 100; sec++) board.observeActivity('furina', 'walk', sec * 1000);
  const context = { now: 100000, autonomousMovement: true, canMove: true, canDock: true, userReactionActive: false,
    agentState: 'idle', idleForMs: 100000, wanderWeight: 1, dockWeight: 1, activity: 1, curiosity: 1 };
  const before = board.getEnergy(), plan = planner.plan(context, board);
  assert.equal(plan.goal, 'rest'); board.recordDecision(plan); assert.equal(board.getEnergy(), before);
  assert.equal(plan.candidates.find(item => item.goal === 'wander').score, 0);
  board.observeActivity('other', 'paused', 100000); assert.equal(board.getEnergy(), .78);
  board.observeActivity('furina', 'paused', 100001); assert.equal(board.getEnergy(), before);
});

test('window rest requires moderate fatigue and an enabled docking preference', () => {
  const board = new PetBlackboard(), planner = new PetUtilityPlanner(() => 0);
  const context = { now: 60000, autonomousMovement: true, canMove: true, canDock: true,
    userReactionActive: false, agentState: 'idle', idleForMs: 60000,
    wanderWeight: 0, dockWeight: 1, activity: 1, curiosity: 1 };
  const dockScore = () => planner.scoreGoals(context, board).find(s => s.goal === 'dock').score;
  assert.equal(dockScore(), 0);
  for (let sec = 0; sec <= 60; sec++) board.observeActivity('furina', 'walk', sec * 1000);
  assert.ok(dockScore() > 0);
  context.dockWeight = 0; assert.equal(dockScore(), 0);
});

test('rest chooses tea and cake only for the corresponding unmet need', () => {
  const selector = new GestureSelector(), action = { type: 'rest', durationMs: 5000 };
  const needs = { energy: .8, thirst: 0, hunger: 0, recovering: false, activity: 'idle', reason: null };
  assert.equal(selector.select(action, 'idle', .8, 0, needs).motion, undefined);
  assert.equal(selector.select(action, 'idle', .8, 0, { ...needs, reason: 'thirsty' }).motion, 'tea');
  assert.equal(selector.select(action, 'idle', .8, 0, { ...needs, reason: 'hungry' }).motion, 'cake');
});
