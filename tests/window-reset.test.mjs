import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { MotionAuthority } = await load('../src/motion/authority.ts');
const { WindowResetController, resetTarget } = await load('../src/motion/window-reset.ts');
const area = { x: -1200, y: -100, width: 1200, height: 900 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('reset uses current expanded size and negative monitor work area', () => {
  assert.deepEqual(resetTarget(area, { width: 192, height: 300 }), { x: -224, y: 500 });
  assert.deepEqual(resetTarget(area, { width: 1500, height: 1000 }), { x: -1200, y: -100 });
});

test('reset cancels movement immediately but waits for native drag release', async () => {
  const gate = deferred(), events = [];
  const controller = new WindowResetController({ authority: new MotionAuthority(), cancelMotion: () => events.push('cancel'),
    waitForDrag: () => gate.promise, reset: async () => events.push('reset') });
  const task = controller.reset(area);
  assert.equal(controller.busy, true); assert.deepEqual(events, ['cancel']);
  gate.resolve(); assert.equal(await task, true);
  assert.deepEqual(events, ['cancel', 'reset']); assert.equal(controller.busy, false);
});

test('new reset invalidates an older asynchronous position read', async () => {
  const gate = deferred(), writes = [];
  const controller = new WindowResetController({ authority: new MotionAuthority(), cancelMotion: () => {}, waitForDrag: async () => {},
    reset: async (value, valid) => { await gate.promise; if (valid()) writes.push(value.x); } });
  const first = controller.reset(area); await Promise.resolve();
  const second = controller.reset({ ...area, x: 0 }); await Promise.resolve();
  gate.resolve();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.deepEqual(writes, [0]); assert.equal(controller.busy, false);
});

test('disposal and platform failure release ownership without late writes', async () => {
  const gate = deferred(); let writes = 0;
  const controller = new WindowResetController({ authority: new MotionAuthority(), cancelMotion: () => {}, waitForDrag: () => gate.promise,
    reset: async () => { writes++; } });
  const task = controller.reset(area); controller.cancel(); gate.resolve();
  assert.equal(await task, false); assert.equal(writes, 0);
  const failing = new WindowResetController({ authority: new MotionAuthority(), cancelMotion: () => {}, waitForDrag: async () => {},
    reset: async () => { throw new Error('native'); } });
  await assert.rejects(failing.reset(area), /native/); assert.equal(failing.busy, false);
});
