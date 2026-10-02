import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { MotionAuthority } = await load('../src/motion/authority.ts');
const { startWanderController } = await load('../src/motion/wander.ts');
const { startGazeController } = await load('../src/motion/gaze.ts');
const { DockPolicyMemory } = await load('../src/motion/dock-policy.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(goal = 'wander') {
  let now = 0, reaction = 'idle', point = { x: 400, y: 400 }, plans = 0;
  let surfaces = [{ id: 'editor', x: 250, y: 300, width: 500, height: 400 }];
  const writes = [], timers = new Set(), changes = [];
  const settings = { petVisible: true, autonomousBehavior: true, autonomousMovement: true, gravityEnabled: false,
    windowDocking: true, lookAtCursor: false, wanderSpeed: 300, scale: 1, wanderWeight: 1, dockWeight: 1 };
  const playback = { epoch: 0, active: false };
  const runtime = {
    authority: new MotionAuthority(),
    settings: () => settings,
    profile: () => ({ activity: 1, curiosity: 1, preferredSpeed: 1,
      shortMoveChance: 0, pauseMinMs: 60000, pauseMaxMs: 60000 }),
    reaction: () => reaction, playback, layoutEpoch: () => 0, layoutBusy: () => false,
    motion: () => ({ dragging: false, falling: false }), now: () => now, wallNow: () => now,
    pixelRatio: () => 1,
    observeCursor: () => {},
    needsRest: () => false,
    schedule: callback => { timers.add(callback); return () => timers.delete(callback); },
    plan: () => { plans++; return goal; },
    changeReaction: next => { reaction = next; changes.push(next); }, setLook: () => {}, settle: async () => {},
  };
  const port = {
    position: async () => ({ ...point }), size: async () => ({ width: 192, height: 208 }),
    workArea: async () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    surfaces: async () => surfaces, cursor: async () => ({ x: 0, y: 0 }),
    move: async (next, valid) => { if (valid()) { point = { ...next }; writes.push(point); } },
  };
  const tick = async (elapsed = 32) => {
    now += elapsed;
    const pending = [...timers]; timers.clear(); pending.forEach(callback => callback());
    await flush();
  };
  return { runtime, port, writes, timers, changes, playback, tick,
    removeSurfaces: () => { surfaces = []; }, plans: () => plans };
}

test('user placement blocks movement even if a planner returns a movement goal', async () => {
  for (const goal of ['wander', 'dock']) {
    const f = fixture(goal); f.runtime.dockMemory = new DockPolicyMemory();
    f.runtime.dockMemory.finishDrag(true, 0);
    const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
    assert.equal(f.writes.length, 0); stop();
  }
});

test('cursor beside a proposed edge prevents docking', async () => {
  const f = fixture('dock'); f.port.cursor = async () => ({ x: 500, y: 200 });
  const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
  assert.equal(f.writes.length, 0); stop();
});

test('failed docking never falls back to unrelated wandering', async () => {
  const f = fixture('dock'); f.removeSurfaces();
  const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
  assert.equal(f.writes.length, 0); stop();
});

test('autonomy off prevents planning; stationary autonomy still plans without moving', async () => {
  for (const enabled of [false, true]) {
    const f = fixture('idle'); Object.assign(f.runtime.settings(), {
      autonomousBehavior: enabled, autonomousMovement: false, windowDocking: false,
    });
    const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
    assert.equal(f.plans(), enabled ? 1 : 0); assert.equal(f.writes.length, 0); stop();
  }
});

test('30 second wander simulation arrives, idles and stops position writes', async () => {
  const f = fixture(); const stop = startWanderController(f.port, f.runtime); await flush();
  for (let i = 0; i < 938; i++) await f.tick();
  assert.ok(f.writes.length > 0);
  assert.equal(f.runtime.reaction(), 'idle');
  const count = f.writes.length;
  for (let i = 0; i < 30; i++) await f.tick();
  assert.equal(f.writes.length, count);
  assert.equal(f.plans(), 1);
  stop(); assert.equal(f.timers.size, 0);
});

test('dispose while native position read is pending prevents writes and rescheduling', async () => {
  const f = fixture(); let resolve;
  f.port.position = () => new Promise(done => { resolve = done; });
  const stop = startWanderController(f.port, f.runtime);
  stop(); resolve({ x: 0, y: 0 }); await flush();
  assert.equal(f.writes.length, 0); assert.equal(f.timers.size, 0);
});

test('new action during dock surface query prevents stale movement', async () => {
  const f = fixture('dock'); let resolve;
  f.port.surfaces = () => new Promise(done => { resolve = done; });
  const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
  assert.equal(typeof resolve, 'function');
  f.playback.epoch++; f.playback.active = true;
  resolve([{ id: 'editor', x: 250, y: 300, width: 500, height: 400 }]); await flush();
  assert.equal(f.writes.length, 0); stop();
});

test('disappearing dock target releases dock pose and stops following', async () => {
  const f = fixture('dock'); const stop = startWanderController(f.port, f.runtime); await flush();
  for (let i = 0; i < 938 && !['review', 'waiting'].includes(f.runtime.reaction()); i++) await f.tick();
  assert.ok(['review', 'waiting'].includes(f.runtime.reaction()));
  f.removeSurfaces(); await f.tick(500);
  assert.equal(f.runtime.reaction(), 'idle');
  const count = f.writes.length; await f.tick(500);
  assert.equal(f.writes.length, count); stop();
});

test('docked pet releases pose when autonomy is disabled or window jumps away', async () => {
  for (const disable of [true, false]) {
    const f = fixture('dock'); const stop = startWanderController(f.port, f.runtime); await flush();
    for (let i = 0; i < 938 && f.runtime.reaction() !== 'waiting'; i++) await f.tick();
    assert.equal(f.runtime.reaction(), 'waiting');
    const count = f.writes.length;
    if (disable) f.runtime.settings().autonomousBehavior = false;
    else f.port.surfaces = async () => [{ id: 'editor', x: 550, y: 300, width: 500, height: 400 }];
    await f.tick(100);
    assert.equal(f.runtime.reaction(), 'idle'); assert.equal(f.writes.length, count); stop();
  }
});

test('mouse is observed during actions without overriding poses; idle sessions can gaze', async () => {
  const f = fixture(), observations = [], looks = [];
  f.runtime.settings().lookAtCursor = true;
  f.playback.active = true;
  f.runtime.changeReaction('waving');
  f.runtime.observeCursor = observation => observations.push(observation);
  f.runtime.setLook = look => looks.push(look);
  let x = 720;
  f.port.cursor = async () => ({ x: x += 15, y: 400 });
  const stop = startWanderController(f.port, f.runtime); await flush();
  for (let i = 0; i < 5; i++) await f.tick(96);
  assert.ok(observations.some(o => o.near && o.moving));
  assert.equal(looks.filter(Boolean).length, 0);
  assert.equal(f.writes.length, 0);
  f.runtime.changeReaction('idle'); f.playback.epoch++;
  for (let i = 0; i < 5; i++) await f.tick(96);
  assert.ok(looks.some(Boolean));
  assert.equal(f.writes.length, 0);
  stop();
});

test('gaze follows multiple nearby directions, restores cleared state and clears when disabled', async () => {
  const f = fixture(); f.runtime.settings().lookAtCursor = true;
  let cursor = { x: 555, y: 504 }, displayed = null;
  f.port.cursor = async () => cursor;
  f.runtime.setLook = look => { displayed = look; };
  const stop = startGazeController(f.port, f.runtime); await flush();
  for (let i = 0; i < 12; i++) await f.tick(48);
  assert.ok(displayed, 'cursor 59px from centre is eligible');
  const first = displayed.index;
  displayed = null;
  await f.tick(48); assert.equal(displayed.index, first, 'same direction restores externally cleared gaze');
  cursor = { x: 496, y: 440 };
  await f.tick(96); assert.notEqual(displayed.index, first);
  const second = displayed.index;
  cursor = { x: 420, y: 504 };
  await f.tick(96); assert.notEqual(displayed.index, second);
  cursor = { x: 2000, y: 0 };
  f.runtime.settings().lookAtCursor = false;
  for (let i = 0; i < 16; i++) await f.tick(48);
  assert.equal(displayed, null); stop();
});

test('slow docking query cannot freeze independent gaze sampling', async () => {
  const f = fixture('dock'); let resolve, samples = 0;
  f.port.surfaces = () => new Promise(done => { resolve = done; });
  f.runtime.observeCursor = () => { samples++; };
  const stop = startWanderController(f.port, f.runtime); await flush(); await f.tick(6000);
  const before = samples;
  for (let i = 0; i < 5; i++) await f.tick(48);
  assert.ok(samples >= before + 5);
  stop(); resolve([]); await flush(); assert.equal(f.timers.size, 0);
});
