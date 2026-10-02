import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(source) {
  const code = await readFile(new URL(source, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { sampleMotion, frameRows, locomotionReaction, isTravelMotion } = await load('../src/core/sprite-motion.ts');

test('vertical travel stays animated beyond one jump and does not restart every tick', () => {
  for (const [dy, expected] of [[-100, 'airborne'], [100, 'falling']]) {
    const reaction = locomotionReaction(0, dy, false);
    assert.equal(reaction, expected);
    assert.ok(isTravelMotion(reaction));
    const columns = new Set();
    for (let elapsed = 0; elapsed < 30000; elapsed += 32) {
      const frame = sampleMotion(reaction, elapsed);
      assert.equal(frame.row, 4);
      assert.ok(frame.nextMs > 0);
      assert.ok([1, 2].includes(frame.column));
      columns.add(frame.column);
    }
    assert.equal(columns.size, 2);
  }
  assert.equal(locomotionReaction(-50, -100, true), 'run-left');
  assert.equal(locomotionReaction(100, -10, false), 'run-right');
  assert.equal(isTravelMotion('jumping'), false);
  assert.equal(isTravelMotion('idle'), false);
});

test('new gestures finish or loop as specified without empty frames', () => {
  for (const name of ['double-blink', 'curious']) {
    const total = frameRows[name].durations.reduce((a, b) => a + b, 0);
    assert.deepEqual(sampleMotion(name, total), { row: 0, column: 0, nextMs: null });
  }
  assert.equal(sampleMotion('doze', 3000).column, 2);
  assert.ok(sampleMotion('doze', 20000).nextMs > 0);
});
const { AttentionTracker, isDragDisplacement } = await load('../src/core/attention.ts');
const { replacementFrame, replacementStyle } = await load('../src/core/motion-art.ts');

test('replacement crops stay within their atlases and use finite anchored styles', () => {
  for (const [row, count] of [[0, 6], [3, 4], [4, 5], [8, 6]]) {
    for (let column = 0; column < count; column++) {
      const frame = replacementFrame('furina', 'built-in', row, column);
      assert.ok(frame);
      assert.ok(frame.x >= 0 && frame.x + frame.width <= frame.atlasWidth);
      assert.ok(frame.y >= 0 && frame.y + frame.height <= frame.atlasHeight);
      const style = replacementStyle(frame, 'test.png');
      for (const key of ['left', 'top', 'width', 'height']) assert.ok(Number.isFinite(style[key]));
      assert.equal(style.left + frame.anchorX * frame.scale, 96);
      assert.equal(style.top + frame.anchorY * frame.scale, 200);
    }
    assert.equal(replacementFrame('furina', 'built-in', row, count), null);
  }
});

test('art overrides never affect imported characters or unpopulated cells', () => {
  for (const [id, source] of [['other', 'built-in'], ['furina', 'local'], ['furina', undefined]]) {
    assert.equal(replacementFrame(id, source, 0, 0), null);
  }
  for (const row of [1, 2, 5, 6, 7, 9, 10]) assert.equal(replacementFrame('furina', 'built-in', row, 0), null);
  for (const column of [-1, 0.5, NaN]) assert.equal(replacementFrame('furina', 'built-in', 0, column), null);
});

test('jump frames share a scale and baseline to preserve airborne displacement', () => {
  const frames = Array.from({ length: 5 }, (_, column) => replacementFrame('furina', 'built-in', 4, column));
  assert.equal(new Set(frames.map(frame => frame.scale)).size, 1);
  assert.equal(new Set(frames.map(frame => frame.anchorY)).size, 1);
  const airborneFoot = 464;
  const standingFoot = 1006 - 512;
  assert.ok((standingFoot - airborneFoot) * frames[0].scale > 10);
});

test('wave and jump play once and return to neutral instead of looping', () => {
  for (const name of ['waving', 'jumping']) {
    const total = frameRows[name].durations.reduce((sum, ms) => sum + ms, 0);
    assert.equal(sampleMotion(name, total - 1).row, frameRows[name].row);
    assert.deepEqual(sampleMotion(name, total), { row: 0, column: 0, nextMs: null });
    assert.deepEqual(sampleMotion(name, total * 5), { row: 0, column: 0, nextMs: null });
  }
});
test('motion sampling never touches empty v2 cells, including delayed timer catch-up', () => {
  const counts = [6, 8, 8, 4, 5, 8, 6, 6, 6];
  for (const name of Object.keys(frameRows)) {
    for (let time = 0; time < 20000; time += 31) {
      const cell = sampleMotion(name, time);
      assert.ok(cell.column >= 0 && cell.column < counts[cell.row]);
      assert.ok(cell.nextMs === null || cell.nextMs > 0);
    }
  }
});
test('idle is a slow breathing/blink loop; failure holds instead of repeating collapse', () => {
  assert.equal(sampleMotion('idle', 1600).column, 0);
  assert.equal(sampleMotion('idle', 1810).column, 1);
  const length = frameRows.idle.durations.reduce((a, b) => a + b, 0);
  assert.equal(sampleMotion('idle', length).column, 0);
  assert.deepEqual(sampleMotion('failed', 10000), { row: 5, column: 7, nextMs: null });
});
test('gaze requires dwell, rejects boundary jitter, and releases after a delay', () => {
  const gaze = new AttentionTracker();
  assert.equal(gaze.update(3, 1000), null);
  assert.equal(gaze.update(3, 1200), null);
  assert.equal(gaze.update(3, 1300), 3);
  for (let i = 0; i < 8; i++) assert.equal(gaze.update(i % 2 ? 3 : 4, 1400 + i * 90), 3);
  assert.equal(gaze.update(null, 2200), 3);
  assert.equal(gaze.update(null, 2800), 3);
  assert.equal(gaze.update(null, 2900), null);
  gaze.reset(3000);
  assert.equal(gaze.update(5, 3010), null);
});
test('drag threshold scales with DPI and does not classify a stationary click as drag', () => {
  assert.equal(isDragDisplacement({ x: 0, y: 0 }, { x: 8, y: 0 }), false);
  assert.equal(isDragDisplacement({ x: 0, y: 0 }, { x: 9, y: 0 }), true);
  assert.equal(isDragDisplacement({ x: 0, y: 0 }, { x: 12, y: 0 }, 2), false);
  assert.equal(isDragDisplacement({ x: 0, y: 0 }, { x: 18, y: 0 }, 2), true);
});
