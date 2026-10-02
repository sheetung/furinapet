import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { DockPolicyMemory, awayFromCursor } = await load('../src/motion/dock-policy.ts');
const active = { id: 'editor', isForeground: true };

test('skipped foreground window stays excluded for sixty seconds even after focus changes', () => {
  const policy = new DockPolicyMemory();
  assert.equal(policy.allowWindow(active, 0, () => .9), false);
  assert.equal(policy.allowWindow({ ...active, isForeground: false }, 59999), false);
  assert.equal(policy.allowWindow(active, 60000, () => .1), true);
});
test('actual drag preserves user placement for five minutes; clicks do not', () => {
  const policy = new DockPolicyMemory();
  policy.setDock('editor'); policy.beginDrag(); policy.setDock(null);
  policy.finishDrag(false, 0);
  assert.equal(policy.prefersPlacement(1), false);
  policy.setDock('editor'); policy.beginDrag(); policy.setDock(null);
  policy.finishDrag(true, 100);
  assert.equal(policy.prefersPlacement(300099), true);
  assert.equal(policy.allowWindow(active, 300099, () => 0), false);
  assert.equal(policy.allowWindow({ id: 'other' }, 1000), false);
  assert.equal(policy.allowWindow(active, 300100, () => 0), true);
});
test('cursor exclusion uses distance to pet rectangle and scales in physical pixels', () => {
  assert.equal(awayFromCursor({ x: 0, y: 0 }, { width: 200, height: 200 }, { x: 100, y: 100 }, 180), false);
  assert.equal(awayFromCursor({ x: 0, y: 0 }, { width: 200, height: 200 }, { x: 379, y: 100 }, 180), false);
  assert.equal(awayFromCursor({ x: 0, y: 0 }, { width: 400, height: 400 }, { x: 760, y: 200 }, 360), true);
});
