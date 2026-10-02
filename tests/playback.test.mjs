import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Pure modules only: compile with the project's existing TypeScript dependency.
async function load(source) {
  const text = await readFile(new URL(source, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { ActionPlayback, ACTION_PRIORITY: priority } = await load('../src/core/action-playback.ts');
const { supportsCharacter } = await load('../src/characters/compatibility.ts');
const { routines } = await load('../src/core/action-routines.ts');
function fixture() {
  const pending = new Set();
  const seen = [];
  const playback = new ActionPlayback((callback, ms) => {
    const timer = { callback, ms }; pending.add(timer);
    return () => pending.delete(timer);
  });
  playback.subscribe(step => seen.push(step));
  const tick = async () => {
    const timer = [...pending][0];
    assert.ok(timer, 'expected scheduled step');
    timer.callback();
    await Promise.resolve(); await Promise.resolve();
  };
  return { playback, pending, seen, tick };
}
const wave = [{ reaction: 'waving', durationMs: 1700 }];

test('user sequence owns pauses and rejects background/agent interruption', async () => {
  const { playback, seen, tick } = fixture();
  const running = playback.play([{ reaction: 'idle', durationMs: 500 }, ...wave], priority.user);
  assert.equal(await playback.play(wave, priority.agent), false);
  assert.equal(await playback.play(wave, priority.background), false);
  await tick(); assert.equal(seen.at(-1).reaction, 'waving');
  await tick(); assert.equal(await running, true);
  assert.equal(seen.at(-1).reaction, 'idle'); assert.equal(playback.active, false);
});
test('user replacement cancels old sequence without a late idle overwriting the new one', async () => {
  const { playback, seen, pending, tick } = fixture();
  const old = playback.play(wave, priority.background);
  const next = playback.play([{ reaction: 'review', durationMs: 4000 }], priority.user);
  assert.equal(await old, false);
  assert.equal(seen.at(-1).reaction, 'review'); assert.equal(pending.size, 1);
  await tick(); assert.equal(await next, true);
});
test('stop cancels pending timer and all remaining steps', async () => {
  const { playback, pending, seen } = fixture();
  const task = playback.play([...wave, { reaction: 'jumping', durationMs: 1000 }], priority.user);
  playback.stop(); assert.equal(await task, false);
  assert.equal(pending.size, 0); assert.equal(seen.at(-1).reaction, 'idle');
  assert.ok(!seen.some(step => step.reaction === 'jumping'));
});
test('hidden and drag blocks are independent and reject even manual playback', async () => {
  const { playback } = fixture();
  const task = playback.play(wave, priority.user);
  playback.block('hidden', true); playback.block('drag', true);
  assert.equal(await task, false);
  playback.block('drag', false);
  assert.equal(await playback.play(wave, priority.user), false);
  playback.block('hidden', false); assert.equal(playback.canStart(priority.user), true);
});
test('actual playback respects a long duration instead of a fixed 2600 ms', async () => {
  const { playback, pending, tick } = fixture();
  const task = playback.play([{ reaction: 'waiting', durationMs: 6500 }], priority.agent);
  assert.equal([...pending][0].ms, 6500); assert.equal(playback.active, true);
  await tick(); await task; assert.equal(playback.active, false);
});
test('executor cancellation receives abort and late callbacks cannot update view', async () => {
  const { playback, seen } = fixture(); let aborted = false;
  const task = playback.run(priority.agent, async session => {
    session.signal.addEventListener('abort', () => { aborted = true; });
    await session.wait(1000); session.show({ reaction: 'failed', durationMs: 1000 });
  });
  playback.stop(); await task;
  assert.equal(aborted, true); assert.ok(!seen.some(step => step.reaction === 'failed'));
});
test('all routines complete and return to idle through the shared controller', async () => {
  assert.equal(routines.length, 9);
  for (const routine of routines) {
    const { playback, tick, seen } = fixture();
    const task = playback.play(routine.steps, priority.user);
    for (const step of routine.steps) {
      assert.ok(step.durationMs > 0);
      assert.equal(seen.at(-1).motion, step.motion);
      await tick();
    }
    assert.equal(await task, true); assert.equal(seen.at(-1).reaction, 'idle');
  }
});
test('legacy and v1 character contracts remain compatible; newer versions are rejected', () => {
  assert.equal(supportsCharacter(undefined, '1.1.2', undefined), true);
  assert.equal(supportsCharacter('1.1.2', '1.1.2', 1), true);
  assert.equal(supportsCharacter('1.1.3', '1.1.2', 1), false);
  assert.equal(supportsCharacter(undefined, '1.1.2', 2), false);
  assert.equal(supportsCharacter('garbage', '1.1.2', 1), false);
});
