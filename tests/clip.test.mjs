import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { sampleClip, clipPhase, clipDuration } = await load('../src/animation/clip.ts');
const { furinaClips } = await load('../characters/furina/clips.ts');
const { replacementFrame } = await load('../characters/furina/art.ts');
const { replacementStyle } = await load('../src/core/motion-art.ts');

test('window seat loops without standing and pins hips inside the sprite stage', () => {
  const clip = furinaClips['dock-sitting'];
  assert.equal(sampleClip(clip, clipDuration(clip) * 3).clipId, 'dock-sitting');
  for (let column = 0; column < 6; column++) {
    const frame = replacementFrame('furina', 'built-in', 0, column, 'dock-sitting');
    const style = replacementStyle(frame, 'seat.png');
    assert.equal(style.top + frame.anchorY * frame.scale, 158);
    assert.ok(style.top >= 0 && style.top + style.height <= 208);
  }
});

test('generic clips hold their authored last column and asset without named-action special cases', () => {
  const clip = { row: 2, clipId: 'custom', columns: [4, 1], durations: [100, 200], once: true, finish: 'hold' };
  assert.equal(clipDuration(clip), 300);
  assert.deepEqual(sampleClip(clip, 300), { row: 2, clipId: 'custom', column: 1, nextMs: null });
  assert.equal(clipPhase(clip, 1000), 'hold');
  assert.deepEqual(sampleClip({ ...clip, finish: 'neutral' }, 300), { row: 0, column: 0, nextMs: null });
});

test('character timelines have positive frames and valid authored column/hold sequences', () => {
  for (const clip of Object.values(furinaClips)) {
    assert.ok(clip.durations.length > 0 && clip.durations.every(ms => Number.isFinite(ms) && ms > 0));
    if (clip.columns) assert.equal(clip.columns.length, clip.durations.length);
    for (const index of clip.holds ?? []) assert.ok(index >= 0 && index < clip.durations.length);
  }
  assert.equal(clipDuration(furinaClips.waving), 1180);
  assert.equal(clipDuration(furinaClips.jumping), 840);
  assert.equal(clipDuration(furinaClips.tea), 4150);
});
