import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { requestSettling } = await load('../src/motion/settle-request.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('gravity retries busy action/layout without autonomous movement and stops after landing', async () => {
  const timers = new Set(); let calls = 0;
  const cancel = requestSettling({ enabled: () => true, falling: () => false,
    schedule: callback => { timers.add(callback); return () => timers.delete(callback); },
    settle: async () => ++calls >= 3 });
  for (let i = 0; i < 3; i++) {
    const pending = [...timers]; timers.clear(); pending.forEach(callback => callback()); await flush();
  }
  assert.equal(calls, 3); assert.equal(timers.size, 0); cancel();
});

test('disabling gravity or disposing during a pending attempt cannot schedule a late retry', async () => {
  for (const dispose of [false, true]) {
    const timers = new Set(); let enabled = true, resolve;
    const cancel = requestSettling({ enabled: () => enabled, falling: () => false,
      schedule: callback => { timers.add(callback); return () => timers.delete(callback); },
      settle: () => new Promise(done => { resolve = done; }) });
    const pending = [...timers]; timers.clear(); pending.forEach(callback => callback());
    if (dispose) cancel(); else enabled = false;
    resolve(false); await flush(); assert.equal(timers.size, 0);
  }
});

test('an existing fall is allowed to finish instead of being restarted', async () => {
  let callback, calls = 0;
  const cancel = requestSettling({ enabled: () => true, falling: () => true,
    schedule: next => { callback = next; return () => {}; }, settle: async () => { calls++; return true; } });
  callback(); await flush(); assert.equal(calls, 0); cancel();
});
