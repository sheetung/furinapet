import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { GestureSelector } = await load('../src/pet-brain/adapters/gesture-selector.ts');
const { resolveCharacterStep } = await load('../src/characters/action-resolver.ts');
const { ActionCoordinator } = await load('../src/actions/coordinator.ts');

test('low energy keeps appropriate rest instead of cycling through food and drinks', () => {
  const selector = new GestureSelector();
  const action = { type: 'rest', durationMs: 5000 };
  const motions = Array.from({ length: 5 }, () => selector.select(action, 'idle', .2, 1000).motion);
  assert.equal(motions[0], 'doze');
  assert.ok(motions.every(motion => motion === 'doze'));
  assert.equal(selector.select(action, 'idle', .2, 100000).motion, 'doze');
});
test('click response, short rest and agent error keep established semantics', () => {
  const selector = new GestureSelector();
  assert.equal(selector.select({ type: 'respond', intensity: 'soft' }, 'idle', .8, 0).reaction, 'waving');
  assert.equal(selector.select({ type: 'rest', durationMs: 1400 }, 'idle', .2, 0).motion, undefined);
  assert.equal(selector.select({ type: 'rest', durationMs: 5000 }, 'testing', .2, 0).motion, undefined);
  assert.equal(selector.select({ type: 'observe', durationMs: 2000 }, 'error', .2, 0).reaction, 'failed');
  assert.equal(selector.select({ type: 'wander' }, 'idle', .8, 0), null);
});
test('resting and celebrating variants remain separate; cake is not unsolicited', () => {
  const selector = new GestureSelector();
  assert.equal(selector.select({ type: 'celebrate', intensity: 'normal' }, 'success', .8, 0).motion, 'proud');
  assert.equal(selector.select({ type: 'celebrate', intensity: 'normal' }, 'success', .8, 0).motion, 'greeting');
  assert.equal(selector.select({ type: 'celebrate', intensity: 'normal' }, 'success', .8, 0).motion, undefined);
});
test('resolve fallback before duration: imported character does not wait for absent tea clip', () => {
  const step = { reaction: 'waiting', motion: 'tea', durationMs: 500 };
  assert.equal(resolveCharacterStep(step, { id: 'furina', source: 'built-in' }).durationMs, 4150);
  const fallback = resolveCharacterStep(step, { id: 'furina', source: 'local' });
  assert.equal(fallback.motion, undefined);
  assert.equal(fallback.durationMs, 500);
});
test('coordinator resolves the accepted request before timing its actual clip', async () => {
  let duration;
  const runtime = new ActionCoordinator((callback, ms) => { duration = ms; callback(); return () => {}; });
  runtime.setResolver(step => resolveCharacterStep(step, { id: 'other', source: 'local' }));
  const result = await runtime.request({ actionId: 'tea', source: 'user', steps: [
    { reaction: 'waiting', motion: 'tea', durationMs: 500 },
  ] });
  assert.equal(result.status, 'completed');
  assert.equal(duration, 500);
});
