import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { load } from './load-ts.mjs';
const { standardSheetFrameCounts } = await load('../characters/furina/standard-sheets.ts');
const { furinaClips } = await load('../characters/furina/clips.ts');
const { replacementFrame } = await load('../characters/furina/art.ts');
const { sampleClip, clipDuration } = await load('../src/animation/clip.ts');
const directory = new URL('../characters/furina/animations/standard/', import.meta.url);

test('every action and gaze has exactly one transparent PNG at the standard dimensions', async () => {
  const names = (await readdir(directory)).filter(name => name.endsWith('.png')).sort();
  assert.deepEqual(names, [...Object.keys(furinaClips), 'gaze'].map(name => `${name}.png`).sort());
  for (const name of names) {
    const bytes = await readFile(new URL(name, directory));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), 768);
    assert.equal(bytes.readUInt32BE(20), 832);
    assert.equal(bytes[25], 6, 'RGBA PNGs retain transparency');
  }
});

test('all authored timelines resolve to their own sheet without changing frame order or neutral completion', () => {
  for (const [motion, clip] of Object.entries(furinaClips)) {
    let elapsed = 0;
    for (const duration of clip.durations) {
      const cell = sampleClip(clip, elapsed);
      const frame = replacementFrame('furina', 'built-in', cell.row, cell.column, cell.clipId, motion);
      assert.equal(frame.asset, motion);
      assert.equal(frame.x, (cell.column % 4) * 192);
      assert.equal(frame.y, Math.floor(cell.column / 4) * 208);
      assert.ok(cell.column < standardSheetFrameCounts[motion]);
      assert.equal(frame.scale, 1);
      elapsed += duration;
    }
    if (clip.once && clip.finish !== 'hold' && clip.clipId) {
      const cell = sampleClip(clip, clipDuration(clip));
      assert.equal(replacementFrame('furina', 'built-in', cell.row, cell.column, cell.clipId, motion).asset, 'idle');
    }
  }
});

test('idle-derived gestures retain the identical neutral pixels in their independent files', async () => {
  const idle = await readFile(new URL('idle.png', directory));
  for (const motion of ['doze', 'double-blink']) {
    assert.deepEqual(await readFile(new URL(`${motion}.png`, directory)), idle);
  }
});
