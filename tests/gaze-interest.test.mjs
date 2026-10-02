import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { GazeInterest } = await load('../src/motion/gaze-interest.ts');

test('near gaze remains reliable; farther movement has lower probability without a cutoff', () => {
  assert.equal(new GazeInterest(() => .99).allows(500, false, 0), true);
  assert.equal(new GazeInterest(() => .4).allows(1300, true, 0), true);
  assert.equal(new GazeInterest(() => .4).allows(2600, true, 0), false);
  assert.equal(new GazeInterest(() => .01).allows(20000, true, 0), true);
});

test('far acquisition is throttled and successful gaze follows without rerolling', () => {
  let calls = 0, roll = .9;
  const interest = new GazeInterest(() => { calls++; return roll; });
  assert.equal(interest.allows(1300, true, 0), false);
  assert.equal(interest.allows(1300, true, 100), false);
  assert.equal(calls, 1);
  roll = .1;
  assert.equal(interest.allows(1300, true, 600), true);
  assert.equal(interest.allows(5000, true, 1000), true);
  assert.equal(interest.allows(5000, false, 2000), true);
  assert.equal(calls, 2);
  assert.equal(interest.allows(5000, false, 3000), false);
  interest.reset();
  assert.equal(interest.allows(5000, false, 3100), false);
});
