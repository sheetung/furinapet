import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { startWanderController } = await load('../src/motion/wander.ts');
const { startGazeController } = await load('../src/motion/gaze.ts');
const { MotionAuthority } = await load('../src/motion/authority.ts');
const { DEFAULT_WANDER_PROFILE } = await load('../src/core/wander-controller.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(goal = 'idle') {
  let now = 0, point = { x: 400, y: 400 }, reaction = 'idle', plans = 0;
  const jobs = new Set(), counts = { position: 0, size: 0, cursor: 0, workArea: 0, surfaces: 0 };
  const writes = [];
  const settings = { petVisible: true, autonomousBehavior: true, autonomousMovement: true,
    gravityEnabled: false, windowDocking: false, lookAtCursor: true, wanderSpeed: 1, scale: 1,
    wanderWeight: 1, dockWeight: 1 };
  const playback = { active: false, epoch: 0 };
  const runtime = {
    authority: new MotionAuthority(), settings: () => settings,
    profile: () => ({ ...DEFAULT_WANDER_PROFILE, pauseMinMs: 60000, pauseMaxMs: 60000 }),
    playback, reaction: () => reaction, changeReaction: value => { reaction = value; },
    layoutEpoch: () => 0, layoutBusy: () => false, motion: () => ({ dragging: false, falling: false }),
    now: () => now, wallNow: () => now, pixelRatio: () => 1, needsRest: () => false,
    schedule: (callback, delay) => {
      const job = { at: now + delay, callback }; jobs.add(job); return () => jobs.delete(job);
    },
    plan: () => { plans++; return goal; }, observeCursor: () => {}, setLook: () => {}, settle: async () => {},
  };
  const port = {
    position: async () => { counts.position++; return { ...point }; },
    size: async () => { counts.size++; return { width: 192, height: 208 }; },
    cursor: async () => { counts.cursor++; return { x: 650, y: 400 }; },
    workArea: async () => { counts.workArea++; return { x: 0, y: 0, width: 1200, height: 900 }; },
    surfaces: async () => { counts.surfaces++; return []; },
    move: async (next, valid) => { if (valid()) { writes.push({ at: now, from: point, to: next }); point = { ...next }; } },
  };
  const advance = async duration => {
    const target = now + duration;
    for (;;) {
      const next = Math.min(...[...jobs].map(job => job.at));
      if (next > target) break;
      now = next;
      const due = [...jobs].filter(job => job.at === next);
      for (const job of due) { jobs.delete(job); job.callback(); }
      await flush();
    }
    now = target; await flush();
  };
  return { runtime, port, counts, writes, jobs, advance, plans: () => plans,
    now: () => now, elapse: duration => { now += duration; } };
}

test('idle waiting has no wander geometry reads; independent gaze still samples every 48ms', async () => {
  const f = fixture(), stop = startWanderController(f.port, f.runtime); await flush();
  await f.advance(5999);
  assert.equal(f.plans(), 0);
  assert.equal(f.counts.position, f.counts.cursor);
  assert.equal(f.counts.size, f.counts.cursor);
  assert.equal(f.counts.workArea, 0);
  assert.equal(f.counts.cursor, 125);
  await f.advance(1);
  assert.equal(f.plans(), 1);
  assert.equal(f.counts.position, f.counts.cursor + 1);
  assert.equal(f.counts.size, f.counts.cursor + 1);
  stop(); assert.equal(f.jobs.size, 0);
});

test('stationary action playback preserves the next decision deadline', async () => {
  const f = fixture(), plan = f.runtime.plan;
  f.runtime.plan = () => {
    const goal = plan();
    f.runtime.playback.active = true;
    f.runtime.playback.epoch++;
    return goal;
  };
  const stop = startWanderController(f.port, f.runtime); await flush();
  await f.advance(6000);
  assert.equal(f.plans(), 1);
  await f.advance(3000);
  f.runtime.playback.active = false;
  await f.advance(56999);
  assert.equal(f.plans(), 1, 'finishing an action must not bring the next decision forward');
  await f.advance(251);
  assert.equal(f.plans(), 2, 'the preserved deadline still resumes decision making');
  stop();
});

test('actions, drag, fall and layout busy skip all wander geometry reads', async () => {
  for (const state of ['action', 'drag', 'fall', 'layout']) {
    const f = fixture();
    if (state === 'action') f.runtime.playback.active = true;
    if (state === 'drag' || state === 'fall') f.runtime.motion = () => ({ dragging: state === 'drag', falling: state === 'fall' });
    if (state === 'layout') f.runtime.layoutBusy = () => true;
    const stop = startWanderController(f.port, f.runtime); await flush(); await f.advance(10000);
    assert.equal(f.plans(), 0);
    assert.equal(f.counts.position, f.counts.cursor);
    assert.equal(f.counts.size, f.counts.cursor);
    assert.equal(f.counts.workArea, 0);
    assert.equal(f.writes.length, 0); stop();
  }
});

test('hidden and missing settings wait 1000ms without native queries', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) f.runtime.settings = () => null;
    else f.runtime.settings().petVisible = false;
    const stop = startWanderController(f.port, f.runtime); await flush();
    assert.ok([...f.jobs].some(job => job.at === 1000));
    await f.advance(10000);
    assert.deepEqual(f.counts, { position: 0, size: 0, cursor: 0, workArea: 0, surfaces: 0 });
    stop(); assert.equal(f.jobs.size, 0);
  }
});

test('movement retains 32ms updates and does not accumulate idle time into its first step', async () => {
  const f = fixture('wander'), stop = startWanderController(f.port, f.runtime); await flush();
  await f.advance(6000);
  assert.equal(f.writes.length, 1);
  const first = f.writes[0];
  assert.ok(Math.hypot(first.to.x - first.from.x, first.to.y - first.from.y) <= 2);
  await f.advance(96);
  assert.deepEqual(f.writes.slice(0, 4).map(write => write.at), [6000, 6032, 6064, 6096]);
  stop();
});

test('gaze accounts for native query latency without overlapping samples', async () => {
  const f = fixture(); let resolve, reads = 0;
  f.port.position = () => { reads++; return new Promise(done => { resolve = done; }); };
  const stop = startGazeController(f.port, f.runtime);
  await f.advance(30); assert.equal(reads, 1);
  resolve({ x: 400, y: 400 }); await flush();
  assert.deepEqual([...f.jobs].map(job => job.at), [48]);
  await f.advance(18); assert.equal(reads, 2);
  stop(); resolve({ x: 400, y: 400 }); await flush(); assert.equal(f.jobs.size, 0);
});
