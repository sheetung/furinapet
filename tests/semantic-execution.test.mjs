import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { PetBrain } = await load('../src/pet-brain/index.ts');
const { ActionCoordinator, ACTION_PRIORITY } = await load('../src/actions/coordinator.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plan = id => ({ id, goal: 'idle', score: .5, actions: [
  { type: 'idle', durationMs: 100 }, { type: 'wait', durationMs: 100 },
], candidates: [], createdAt: 0, reason: 'test' });

function fixture() {
  const brain = new PetBrain({ isolated: true });
  const timers = new Set(), signals = [], frames = [];
  const coordinator = new ActionCoordinator(callback => {
    timers.add(callback); return () => timers.delete(callback);
  });
  coordinator.subscribe(step => frames.push(step.reaction));
  const run = (id, priority, handler) => coordinator.execute(priority, session =>
    brain.execute(plan(id), handler ?? (async (action, signal) => {
      signals.push([signal, session.signal]);
      if (action.type === 'wait') await session.wait(action.durationMs);
      else await session.perform({ reaction: 'idle', durationMs: action.durationMs });
    }), session.signal), id);
  const advance = async () => {
    const pending = [...timers]; timers.clear(); pending.forEach(callback => callback()); await flush();
  };
  return { brain, coordinator, timers, signals, frames, run, advance };
}

test('semantic plans use the coordinator signal and clear progress after completion', async () => {
  const f = fixture(), task = f.run('plan', ACTION_PRIORITY.background);
  assert.equal(f.brain.snapshot().executor.actionIndex, 0);
  await f.advance();
  assert.equal(f.brain.snapshot().executor.actionIndex, 1);
  assert.ok(f.signals.every(([semantic, session]) => semantic === session));
  await f.advance();
  assert.deepEqual(await task, { status: 'completed' });
  assert.equal(f.brain.snapshot().executor.running, false);
});

test('user preemption and equal-priority replacement preserve the new semantic snapshot', async () => {
  for (const priority of [ACTION_PRIORITY.user, ACTION_PRIORITY.background]) {
    const f = fixture(), old = f.run('old', ACTION_PRIORITY.background);
    const next = f.run('new', priority);
    await flush();
    assert.deepEqual(await old, { status: 'cancelled', reason: 'replaced' });
    assert.equal(f.brain.snapshot().executor.planId, 'new');
    assert.equal(f.timers.size, 1);
    f.coordinator.stop(); await next;
  }
});

test('stop, hide and drag immediately cancel semantic waits and clear timers', async () => {
  for (const reason of ['stop', 'hidden', 'drag']) {
    const f = fixture(), task = f.run(reason, ACTION_PRIORITY.user);
    await f.advance();
    assert.equal(f.brain.snapshot().executor.actionIndex, 1);
    if (reason === 'stop') f.coordinator.stop();
    else f.coordinator.block(reason, true);
    assert.equal(f.brain.snapshot().executor.running, false);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(await task, { status: 'cancelled', reason: reason === 'stop' ? 'cancelled' : 'blocked' });
  }
});

test('late failures from cancelled semantic handlers cannot erase a replacement plan', async () => {
  const f = fixture(); let fail;
  const old = f.run('old', ACTION_PRIORITY.background, () => new Promise((_, reject) => { fail = reject; }));
  const next = f.run('new', ACTION_PRIORITY.user);
  fail(new Error('late failure')); await flush();
  assert.deepEqual(await old, { status: 'cancelled', reason: 'replaced' });
  assert.equal(f.brain.snapshot().executor.planId, 'new');
  f.coordinator.stop(); await next;
});

test('a live semantic failure is reported by the coordinator and releases progress', async () => {
  const f = fixture(), error = new Error('handler failed');
  const result = await f.run('failed', ACTION_PRIORITY.background, () => { throw error; });
  assert.deepEqual(result, { status: 'failed', error });
  assert.equal(f.brain.snapshot().executor.running, false);
  assert.equal(f.coordinator.snapshot().state, 'idle');
});
