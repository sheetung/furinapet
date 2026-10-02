import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { AnimationClock } = await load('../src/animation/clock.ts');
const { playClip } = await load('../src/animation/player.ts');
const { motionPhase, frameRows } = await load('../src/core/sprite-motion.ts');
function fixture() {
  let now = 0, id = 0;
  const frames = new Map();
  const clock = new AnimationClock(() => now, cb => { frames.set(++id, cb); return id; }, key => frames.delete(key));
  const advance = value => { now = value; const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb(now)); };
  return { clock, frames, advance };
}
test('multiple deadlines share one frame loop and cancellation stops it', () => {
  const f = fixture(), seen = [];
  const cancel = f.clock.schedule(() => seen.push('old'), 20);
  f.clock.schedule(() => seen.push('new'), 30);
  assert.equal(f.frames.size, 1);
  cancel(); f.advance(40);
  assert.deepEqual(seen, ['new']);
  assert.equal(f.frames.size, 0);
});
test('a due action can cancel a due old-frame callback in the same tick', () => {
  const f = fixture(), seen = [];
  let cancel;
  f.clock.schedule(() => { cancel(); seen.push('action'); }, 100);
  cancel = f.clock.schedule(() => seen.push('stale frame'), 100);
  f.advance(120);
  assert.deepEqual(seen, ['action']);
});
test('player skips missed frames using shared start time and terminates once', () => {
  const f = fixture(), seen = [];
  const stop = playClip(frameRows.waving, 0, cell => seen.push(cell), f.clock);
  f.advance(600);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].column, 1);
  f.advance(1180);
  assert.deepEqual(seen.at(-1), { row: 0, column: 0, nextMs: null });
  assert.equal(f.frames.size, 0);
  stop();
});
test('player cancellation prevents later frames and authored holds remain holds', () => {
  const f = fixture(), seen = [];
  const stop = playClip(frameRows.tea, 0, cell => seen.push(cell), f.clock);
  stop(); f.advance(2000);
  assert.equal(seen.length, 1);
  assert.equal(motionPhase('tea', 1600), 'hold');
  assert.equal(motionPhase('tea', 500), 'motion');
  assert.equal(motionPhase('tea', 4150), 'complete');
});
