import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { MotionAuthority } = await load('../src/motion/authority.ts');
const { InteractionController } = await load('../src/motion/interaction.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture() {
  const blocks = new Set(), reactions = [], requests = [], errors = [], writes = [];
  let position = { x: 0, y: 692 }, starts = 0;
  const settings = { petVisible: true, gravityEnabled: true };
  const playback = { epoch: 0, active: false,
    block: (key, enabled) => { if (enabled) { if (!blocks.has(key)) playback.epoch++; blocks.add(key); } else blocks.delete(key); },
    request: async request => { requests.push(request); },
  };
  const runtime = { authority: new MotionAuthority(), settings: () => settings, layoutBusy: () => false,
    prepareRelease: async () => {}, pixelRatio: () => 1, now: () => 100,
    schedule: () => () => {}, playback, reaction: value => reactions.push(value),
    dragging: () => {}, clearLook: () => {}, observeInteraction: () => {}, report: error => errors.push(error) };
  const port = { position: async () => ({ ...position }),
    startDragging: async () => { starts++; position = { x: 100, y: 692 }; },
    waitForRelease: async () => {}, drain: async () => {}, invalidate: () => {},
    gravity: valid => ({ position: async () => ({ ...position }), size: async () => ({ width: 192, height: 208 }),
      workArea: async () => ({ x: 0, y: 0, width: 1200, height: 900 }),
      move: async point => { if (valid()) writes.push(point); } }),
  };
  const controller = new InteractionController(port, runtime);
  return { controller, port, runtime, blocks, reactions, requests, errors, writes, starts: () => starts };
}

test('drag release settles before happy jump and releases its block', async () => {
  const f = fixture(); const notifications = [];
  f.runtime.dragStarted = () => notifications.push('start');
  f.runtime.dragCompleted = moved => notifications.push(moved);
  await f.controller.beginDrag(0);
  assert.deepEqual(notifications, ['start', true]);
  assert.equal(f.starts(), 1); assert.equal(f.writes.length, 1);
  assert.equal(f.requests[0].actionId, 'drag-release');
  assert.equal(f.blocks.size, 0);
  assert.deepEqual(f.controller.snapshot(), { dragging: false, falling: false });
});

test('stationary click does not fall or jump', async () => {
  const f = fixture(); f.port.startDragging = async () => {};
  await f.controller.beginDrag(0);
  assert.equal(f.writes.length, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.blocks.size, 0);
});

test('cancel during native read prevents startDragging and late pose overwrite', async () => {
  const f = fixture(), gate = deferred(); f.port.position = () => gate.promise;
  const task = f.controller.beginDrag(0); await flush();
  f.controller.cancel(); const count = f.reactions.length;
  gate.resolve({ x: 0, y: 0 }); await task;
  assert.equal(f.starts(), 0); assert.equal(f.reactions.length, count);
  assert.equal(f.blocks.size, 0); assert.equal(f.requests.length, 0);
});

test('cancelled native drag remains exclusive until release, then new drag works', async () => {
  const f = fixture(), gate = deferred(); f.port.waitForRelease = () => gate.promise;
  const task = f.controller.beginDrag(0); await flush();
  f.controller.cancel(); await f.controller.beginDrag(0);
  assert.equal(f.starts(), 1);
  gate.resolve(); await task;
  await f.controller.beginDrag(0); assert.equal(f.starts(), 2);
  assert.equal(f.blocks.size, 0);
});

test('new drag during release layout keeps its block when old layout completes', async () => {
  const f = fixture(), layout = deferred(), released = deferred();
  f.runtime.prepareRelease = () => layout.promise;
  const first = f.controller.beginDrag(0); await flush();
  f.port.waitForRelease = () => released.promise;
  const second = f.controller.beginDrag(0); await flush();
  layout.resolve(); await first;
  assert.ok(f.blocks.has('drag')); assert.equal(f.requests.length, 0);
  released.resolve(); await second;
  assert.equal(f.blocks.size, 0);
});

test('native drag failure and release layout failure clean up without jumping', async () => {
  for (const failing of ['startDragging', 'prepareRelease']) {
    const f = fixture();
    (failing === 'startDragging' ? f.port : f.runtime)[failing] = async () => { throw new Error('failure'); };
    await f.controller.beginDrag(0);
    assert.equal(f.errors.length, 1); assert.equal(f.blocks.size, 0);
    assert.equal(f.requests.length, 0); assert.equal(f.controller.snapshot().dragging, false);
  }
});

test('cancelled gravity read cannot restore idle over new action', async () => {
  const f = fixture(), gate = deferred();
  const original = f.port.gravity;
  f.port.gravity = valid => ({ ...original(valid), position: () => gate.promise });
  const task = f.controller.settle(); await flush();
  f.controller.cancelFall(); f.runtime.playback.epoch++;
  gate.resolve({ x: 0, y: 0 });
  assert.equal(await task, false);
  assert.equal(f.reactions.length, 0); assert.equal(f.writes.length, 0);
});
