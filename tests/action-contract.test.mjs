import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { ActionCoordinator, ACTION_PRIORITY } = await load('../src/actions/coordinator.ts');
const { routines, motionCatalog, quickActions, getCharacterActions } = await load('../src/actions/catalog.ts');
const { frameRows, motionDuration } = await load('../src/core/sprite-motion.ts');

function fixture() {
  const timers = new Set();
  const runtime = new ActionCoordinator(callback => {
    timers.add(callback);
    return () => timers.delete(callback);
  });
  const request = (steps, source = 'user') => runtime.request({ actionId: 'test', source, steps });
  return { runtime, timers, request };
}
const idle = [{ reaction: 'idle', durationMs: 500 }];

test('catalog IDs are unique and all actions have normalized finite durations', () => {
  assert.equal(new Set(routines.map(item => item.id)).size, routines.length);
  for (const item of routines) {
    assert.ok(item.steps.length);
    for (const step of item.steps) assert.ok(Number.isFinite(step.durationMs) && step.durationMs > 0);
  }
});

test('shared catalog covers every clip and retains public manual controls', () => {
  assert.deepEqual(motionCatalog.map(item => item.id).sort(), Object.keys(frameRows).sort());
  assert.equal(new Set(motionCatalog.map(item => item.id)).size, motionCatalog.length);
  assert.deepEqual(quickActions.map(item => item.reaction).sort(), ['failed', 'jumping', 'review', 'waiting', 'waving']);
  for (const routine of routines.filter(item => item.steps.length === 1)) {
    const step = routine.steps[0];
    assert.equal(step.durationMs, motionDuration(step.motion ?? step.reaction));
    assert.equal(motionCatalog.find(item => item.id === step.motion)?.label, routine.label);
  }
});

test('authored Furina routines are available only to the built-in Furina character', () => {
  assert.equal(getCharacterActions({ id: 'furina', source: 'built-in' }).routines.length, 15);
  for (const character of [{ id: 'other', source: 'built-in' }, { id: 'furina', source: 'local' }]) {
    const actions = getCharacterActions(character);
    assert.equal(actions.routines.length, 0);
    assert.equal(actions.quickActions.length, 5);
  }
});

test('FSM transitions performing -> blocked -> idle, preserving independent blockers', async () => {
  const { runtime, request, timers } = fixture();
  assert.equal(runtime.snapshot().state, 'idle');
  const result = request(idle);
  assert.equal(runtime.snapshot().state, 'performing');
  assert.equal(runtime.snapshot().actionId, 'test');
  runtime.block('drag', true);
  runtime.block('hidden', true);
  assert.deepEqual(await result, { status: 'cancelled', reason: 'blocked' });
  assert.equal(timers.size, 0);
  runtime.block('drag', false);
  assert.equal(runtime.snapshot().state, 'blocked');
  assert.deepEqual(await request(idle), { status: 'rejected', reason: 'blocked' });
  runtime.block('hidden', false);
  assert.equal(runtime.snapshot().state, 'idle');
});

test('invalid input is rejected before interrupting a valid session', async () => {
  const { runtime, request } = fixture();
  const valid = request(idle);
  const id = runtime.snapshot().sessionId;
  for (const steps of [[], [{ reaction: 'dragged', durationMs: 1 }], [{ reaction: 'idle', durationMs: NaN }],
    [{ reaction: 'idle', durationMs: 100, motion: 'falling' }]]) {
    assert.deepEqual(await request(steps), { status: 'rejected', reason: 'invalid' });
    assert.equal(runtime.snapshot().sessionId, id);
  }
  runtime.stop();
  assert.deepEqual(await valid, { status: 'cancelled', reason: 'cancelled' });
});

test('structured results distinguish preemption, priority rejection and completion', async () => {
  const { runtime, request, timers } = fixture();
  const old = request(idle, 'background');
  const next = request(idle);
  assert.deepEqual(await old, { status: 'cancelled', reason: 'replaced' });
  assert.deepEqual(await request(idle, 'agent'), { status: 'rejected', reason: 'lower-priority' });
  [...timers][0]();
  assert.deepEqual(await next, { status: 'completed' });
  assert.equal(runtime.snapshot().state, 'idle');
});

test('request snapshots isolate queued steps from caller mutation', async () => {
  const { runtime, request, timers } = fixture();
  const steps = [{ reaction: 'idle', durationMs: 100 }, { reaction: 'waiting', durationMs: 100 }];
  const result = request(steps);
  steps[1].reaction = 'failed';
  [...timers][0]();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(runtime.snapshot().step.reaction, 'waiting');
  runtime.stop();
  await result;
});

test('late failure from cancelled owner cannot end the replacement session', async () => {
  const { runtime, request } = fixture();
  let fail;
  const old = runtime.execute(ACTION_PRIORITY.background, () => new Promise((_, reject) => { fail = reject; }));
  const next = request(idle);
  const id = runtime.snapshot().sessionId;
  fail(new Error('late failure'));
  assert.deepEqual(await old, { status: 'cancelled', reason: 'replaced' });
  assert.equal(runtime.snapshot().sessionId, id);
  runtime.stop();
  await next;
  const error = new Error('current failure');
  assert.deepEqual(await runtime.execute(100, async () => { throw error; }), { status: 'failed', error });
  assert.equal(runtime.snapshot().state, 'idle');
});
