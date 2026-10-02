import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { permitsExecution } = await load('../src/pet/execution-policy.ts');
const { ListenerScope } = await load('../src/pet/listener-scope.ts');
const { BubbleLayoutController } = await load('../src/bubbles/layout-controller.ts');
const { MotionAuthority } = await load('../src/motion/authority.ts');
const { MotionWriteQueue } = await load('../src/motion/write-queue.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('autonomy off rejects future background actions but preserves user and agent; hidden rejects all', () => {
  const settings = { petVisible: true, autonomousBehavior: false };
  assert.equal(permitsExecution(settings, 10), false);
  assert.equal(permitsExecution(settings, 20), true);
  assert.equal(permitsExecution(settings, 100), true);
  settings.petVisible = false;
  for (const priority of [10, 20, 100]) assert.equal(permitsExecution(settings, priority), false);
  assert.equal(permitsExecution(null, 100), false);
});

test('late listener registration is cleaned; callbacks and sibling registration failures are isolated', async () => {
  const scope = new ListenerScope(); let resolve, calls = 0, cleanups = 0;
  const callback = scope.guard(() => calls++);
  scope.add(new Promise(done => { resolve = done; }), () => {});
  scope.add(Promise.reject(new Error('registration failure')), () => {});
  callback(); scope.dispose(); callback(); resolve(() => cleanups++); await flush();
  assert.equal(calls, 1); assert.equal(cleanups, 1);
});

function layoutFixture() {
  const writes = [], placements = [], queue = new MotionWriteQueue(), authority = new MotionAuthority();
  const port = { read: async () => ({ x: 100, y: 200, width: 192, height: 208, factor: 1, workAreaTop: 0 }),
    apply: async next => { writes.push(next); } };
  const controller = new BubbleLayoutController(port, { queue, authority, dragging: () => false,
    cancelFall: () => {}, placement: p => placements.push(p), report: () => {} });
  return { controller, port, writes, placements, authority };
}

test('layout cancellation during native read prevents late placement and writes; next layout works', async () => {
  const f = layoutFixture(), read = f.port.read; let resolve;
  f.port.read = () => new Promise(done => { resolve = done; });
  const pending = f.controller.resize(true, 1); await flush();
  f.controller.cancel(); resolve(await read()); await pending;
  assert.equal(f.writes.length, 0); assert.equal(f.placements.length, 0);
  f.port.read = read; await f.controller.resize(true, 1);
  assert.equal(f.writes.length, 1); assert.equal(f.controller.busy, false);
});

test('drag owns geometry over bubble layout and failed writes do not poison next layout', async () => {
  const f = layoutFixture(), lease = f.authority.acquire('drag');
  await f.controller.resize(true, 1); assert.equal(f.writes.length, 0); lease.release();
  const apply = f.port.apply; f.port.apply = async () => { throw new Error('native failure'); };
  await f.controller.resize(true, 1); assert.equal(f.controller.busy, false);
  f.port.apply = apply; await f.controller.resize(true, 1); assert.equal(f.writes.length, 1);
});
