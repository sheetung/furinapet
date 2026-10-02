import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { MotionAuthority } = await load('../src/motion/authority.ts');

test('drag and reset preempt movement; low priority cannot steal the owner', () => {
  const authority = new MotionAuthority();
  const wander = authority.acquire('wander');
  const fall = authority.acquire('gravity');
  assert.equal(wander.valid(), false);
  const drag = authority.acquire('drag');
  assert.equal(fall.valid(), false);
  assert.equal(authority.acquire('layout'), null);
  const reset = authority.acquire('reset');
  assert.equal(drag.valid(), false);
  assert.equal(authority.acquire('drag'), null);
  drag.release(); fall.release(); wander.release();
  assert.equal(authority.owner, 'reset');
  reset.release(); assert.equal(authority.owner, null);
});

test('action cancellation preserves independent layout and stale releases are harmless', () => {
  const authority = new MotionAuthority();
  const old = authority.acquire('layout'), current = authority.acquire('layout');
  authority.cancel('wander', 'gravity'); old.release();
  assert.equal(current.valid(), true);
  authority.cancel(); assert.equal(current.valid(), false);
  assert.ok(authority.acquire('wander'));
});
