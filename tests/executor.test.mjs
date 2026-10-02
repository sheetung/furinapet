import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { createExecutor } = await load('../src/actions/executor.ts');
const { ActionCoordinator } = await load('../src/actions/coordinator.ts');
const idle = { reaction: 'idle', durationMs: 200 };

function fixture(scheduleOverride) {
  const controller = new AbortController();
  const timers = new Set();
  const frames = [];
  const phases = [];
  const session = createExecutor({
    signal: controller.signal, owns: () => true,
    schedule: scheduleOverride ?? ((callback) => { timers.add(callback); return () => timers.delete(callback); }),
    display: step => frames.push(step), phase: (...args) => phases.push(args),
  });
  return { controller, timers, frames, phases, session };
}

test('abort clears the timeline and stale timer callbacks cannot publish or change phase', async () => {
  const f = fixture();
  const task = f.session.perform(idle);
  const late = [...f.timers][0];
  f.controller.abort();
  await task;
  assert.equal(f.timers.size, 0);
  const count = f.phases.length;
  late();
  await f.session.perform({ reaction: 'waving', durationMs: 0 });
  assert.equal(f.frames.length, 1);
  assert.equal(f.phases.length, count);
});

test('one session cannot run overlapping steps or waits', async () => {
  const f = fixture();
  const task = f.session.perform(idle);
  await assert.rejects(f.session.perform(idle), /Concurrent/);
  await assert.rejects(f.session.wait(20), /Concurrent/);
  assert.equal(f.frames.length, 1);
  assert.equal(f.timers.size, 1);
  f.controller.abort();
  await task;
});

test('synchronous completion cancels the returned timer handle', async () => {
  let cancelled = 0;
  const f = fixture(callback => { callback(); return () => { cancelled++; }; });
  await f.session.perform(idle);
  assert.equal(cancelled, 1);
  assert.deepEqual(f.phases.at(-1), ['displaying', null]);
});

test('scheduler failure releases ownership and allows a subsequent request', async () => {
  let fail = true;
  const coordinator = new ActionCoordinator(callback => {
    if (fail) throw new Error('scheduler failed');
    callback(); return () => {};
  });
  const request = { actionId: 'test', source: 'user', steps: [idle] };
  assert.equal((await coordinator.request(request)).status, 'failed');
  assert.equal(coordinator.snapshot().state, 'idle');
  fail = false;
  assert.equal((await coordinator.request(request)).status, 'completed');
});

test('blocking from a display subscriber does not leave a newly scheduled timer', async () => {
  let scheduled = 0;
  const coordinator = new ActionCoordinator(() => { scheduled++; return () => {}; });
  coordinator.subscribe(step => { if (step.reaction === 'waving') coordinator.block('drag', true); });
  const result = await coordinator.request({ actionId: 'wave', source: 'user', steps: [{ reaction: 'waving', durationMs: 0 }] });
  assert.deepEqual(result, { status: 'cancelled', reason: 'blocked' });
  assert.equal(scheduled, 0);
});

test('executor uses full one-shot duration and clears wait deadline after completion', async () => {
  let duration;
  const f = fixture((callback, ms) => { duration = ms; callback(); return () => {}; });
  await f.session.perform({ reaction: 'waving', durationMs: 1 });
  assert.equal(duration, 1180);
  assert.deepEqual(f.phases.at(-1), ['displaying', null]);
});
