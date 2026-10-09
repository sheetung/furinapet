import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { replacementFrame } = await load('../characters/furina/art.ts');
const { replacementStyle } = await load('../src/core/motion-art.ts');
const { lookCell } = await load('../src/core/look-direction.ts');

test('all gaze directions share the authored standing height and feet baseline', () => {
  const idle = replacementFrame('furina', 'built-in', 0, 0);
  for (let index = 0; index < 16; index++) {
    const cell = lookCell(index);
    const frame = replacementFrame('furina', 'built-in', cell.row, cell.column);
    assert.equal(frame.asset, 'gaze');
    assert.equal(frame.x, (index % 4) * 192);
    assert.equal(frame.y, Math.floor(index / 4) * 208);
    assert.equal(frame.scale, idle.scale);
    const style = replacementStyle(frame, 'fixture');
    assert.ok(Math.abs(style.top + frame.anchorY * frame.scale - 200) < 1e-9);
    assert.ok(Math.abs(style.left + frame.anchorX * frame.scale - 96) < 1e-9);
  }
});

test('gaze correction is restricted to built-in Furina and valid atlas cells', () => {
  assert.equal(replacementFrame('furina', 'imported', 9, 0), null);
  assert.equal(replacementFrame('other', 'built-in', 9, 0), null);
  for (const column of [-1, 8, .5]) {
    assert.equal(replacementFrame('furina', 'built-in', 9, column), null);
  }
  assert.equal(replacementFrame('furina', 'built-in', 0, 0).asset, 'idle');
});

test('legacy movement, waiting, failure and busy frames use the same scale as gaze', () => {
  const gaze = replacementFrame('furina', 'built-in', 9, 0);
  for (const [row, count, asset] of [[1, 8, 'run-right'], [2, 8, 'run-left'], [5, 8, 'failed'], [6, 6, 'waiting'], [7, 6, 'running']]) {
    for (let column = 0; column < count; column++) {
      const frame = replacementFrame('furina', 'built-in', row, column);
      assert.equal(frame.asset, asset);
      assert.equal(frame.scale, gaze.scale);
      assert.equal(frame.anchorY, 200);
      const style = replacementStyle(frame, 'fixture');
      assert.ok(Math.abs(style.top + frame.anchorY * frame.scale - 200) < 1e-9);
      assert.equal(replacementFrame('furina', 'imported', row, column), null);
    }
    assert.equal(replacementFrame('furina', 'built-in', row, count), null);
  }
});
