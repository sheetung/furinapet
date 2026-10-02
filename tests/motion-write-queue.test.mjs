import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { MotionWriteQueue } = await load('../src/motion/write-queue.ts');
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('native transactions serialize and drain waits for in-flight work', async () => {
  const queue = new MotionWriteQueue(), gate = deferred(), events = [];
  const first = queue.enqueue(async () => {
    events.push('size'); await gate.promise; events.push('position');
  });
  const second = queue.enqueue(async () => { events.push('move'); });
  let drained = false;
  const drain = queue.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.deepEqual(events, ['size']);
  assert.equal(drained, false);
  gate.resolve();
  assert.equal(await first, true);
  assert.equal(await second, true);
  await drain;
  assert.deepEqual(events, ['size', 'position', 'move']);
  assert.equal(drained, true);
});

test('action change drops pending movement but preserves independent bubble layout', async () => {
  const queue = new MotionWriteQueue(), events = [];
  const stale = queue.enqueue(async () => { events.push('stale'); });
  const layout = queue.enqueue(async () => { events.push('bubble'); }, () => true, 'layout');
  queue.invalidate();
  const next = queue.enqueue(async () => { events.push('next'); });
  assert.equal(await stale, false);
  assert.equal(await layout, true);
  assert.equal(await next, true);
  assert.deepEqual(events, ['bubble', 'next']);
});

test('drag validity is checked at execution for pending bubble layout', async () => {
  const queue = new MotionWriteQueue(), gate = deferred();
  const first = queue.enqueue(() => gate.promise);
  await Promise.resolve();
  let dragging = false, calls = 0;
  const layout = queue.enqueue(async () => { calls++; }, () => !dragging, 'layout');
  dragging = true;
  queue.invalidate();
  gate.resolve();
  assert.equal(await first, true);
  assert.equal(await layout, false);
  assert.equal(calls, 0);
});

test('failed native operation reports failure without poisoning later writes', async () => {
  const queue = new MotionWriteQueue();
  const failed = queue.enqueue(async () => { throw new Error('native failure'); });
  const rejection = assert.rejects(failed, /native failure/);
  let moved = false;
  const next = queue.enqueue(async () => { moved = true; });
  await rejection;
  assert.equal(await next, true);
  await queue.drain();
  assert.equal(moved, true);
});
