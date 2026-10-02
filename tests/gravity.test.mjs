import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { fallToGround } = await load('../src/motion/gravity.ts');
const { planWanderGoal } = await load('../src/pet-brain/adapters/wander.ts');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(y = 0) {
  const writes = [], timers = new Set(), controller = new AbortController();
  let now = 0;
  const port = {
    position: async () => ({ x: -400, y }), size: async () => ({ width: 192, height: 208 }),
    workArea: async () => ({ x: -1000, y: -100, width: 1000, height: 800 }),
    move: async point => { writes.push(point); },
  };
  const options = { signal: controller.signal, valid: () => true, now: () => now,
    schedule: callback => { timers.add(callback); return () => timers.delete(callback); }, onFalling: () => {} };
  const tick = async () => { now += 16; [...timers].forEach(cb => cb()); await flush(); };
  return { port, options, controller, timers, writes, tick };
}
test('gravity reaches exact ground without overshooting and stops scheduling', async () => {
  const f = fixture();
  const task = fallToGround(f.port, f.options); await flush();
  for (let i = 0; i < 300 && f.timers.size; i++) await f.tick();
  assert.equal(await task, 'completed');
  assert.deepEqual(f.writes.at(-1), { x: -400, y: 492 });
  assert.ok(f.writes.every(p => p.y <= 492));
  assert.equal(f.timers.size, 0);
});
test('abort during scheduled fall clears timer and stale callback cannot move', async () => {
  const f = fixture();
  const task = fallToGround(f.port, f.options); await flush();
  const late = [...f.timers][0];
  f.controller.abort();
  assert.equal(await task, 'cancelled');
  late(); await flush();
  assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0);
});
test('cancel while awaiting work area prevents first position write', async () => {
  const f = fixture(600); let complete;
  f.port.workArea = () => new Promise(resolve => { complete = resolve; });
  const task = fallToGround(f.port, f.options); await flush();
  f.controller.abort(); complete({ x: 0, y: 0, width: 1000, height: 800 });
  assert.equal(await task, 'cancelled');
  assert.equal(f.writes.length, 0);
});
test('in-flight native write may finish but cannot schedule another after cancellation', async () => {
  const f = fixture(); let complete;
  f.port.move = point => { f.writes.push(point); return new Promise(resolve => { complete = resolve; }); };
  const task = fallToGround(f.port, f.options); await flush(); await f.tick();
  f.controller.abort(); complete();
  assert.equal(await task, 'cancelled');
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 0);
});
test('stationary autonomous plan is forwarded once; movement remains in movement path', () => {
  const seen = [];
  const input = { now: 0, autonomousMovement: true, canMove: true, canDock: true,
    userReactionActive: false, idleForMs: 10000, wanderWeight: .5, dockWeight: .5,
    missedOpportunities: 0, profile: { activity: .5, curiosity: .5 } };
  for (const goal of ['rest', 'idle', 'wander', 'dock']) {
    const plan = { goal };
    const brain = { blackboard: { getAgentState: () => 'idle' }, plan: () => plan };
    assert.equal(planWanderGoal(brain, input, value => seen.push(value)), goal);
  }
  assert.deepEqual(seen.map(p => p.goal), ['rest', 'idle']);
});
