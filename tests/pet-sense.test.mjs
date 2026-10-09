import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = (await readFile(new URL('../src/pet/dom-bridge.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const listeners = new Map(), timers = new Map(), senses = [];
  let now = 10000, timerId = 0, pointer = { x: 10, y: 10 }, release;
  const context = {
    exports: {},
    Date: { now: () => now }, console,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    window: {
      devicePixelRatio: 1,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
      dispatchEvent: event => senses.push(event.detail),
      setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; },
      clearTimeout: id => timers.delete(id),
    },
    getCurrentWindow: () => ({ outerPosition: async () => ({ x: 0, y: 0 }) }),
    cursorPosition: async () => pointer,
    // Deliberately no plugin API: click routing must only use native drag release.
    desktop: { waitForDragRelease: () => new Promise(resolve => { release = resolve; }) },
  };
  vm.runInNewContext(outputText, context);
  const dispose = context.exports.installPetDomBridge();
  const advance = ms => {
    now += ms;
    for (const [id, job] of [...timers]) if (job.at <= now) { timers.delete(id); job.callback(); }
  };
  const tap = async (move = false) => {
    listeners.get('pointerdown')({ button: 0, screenX: 10, screenY: 10 });
    await flush(); pointer = move ? { x: 80, y: 10 } : { x: 10, y: 10 };
    release(); await flush();
  };
  return { listeners, timers, senses, dispose, advance, tap, release: () => release() };
}

test('single and double taps reach Brain directly without a plugin host', async () => {
  const f = fixture();
  await f.tap(); assert.equal(f.senses.length, 0);
  f.advance(360); assert.equal(f.senses[0].name, 'pet:clicked');
  await f.tap(); f.advance(100); await f.tap();
  assert.equal(f.senses[1].name, 'pet:doubleClicked');
  f.advance(500); assert.equal(f.senses.length, 2, 'double tap cancels pending single tap');
  f.dispose(); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('dragging and late native release after disposal cannot become clicks', async () => {
  const f = fixture();
  await f.tap(true); f.advance(500); assert.equal(f.senses.length, 0);
  f.listeners.get('pointerdown')({ button: 0, screenX: 10, screenY: 10 });
  await flush(); f.dispose(); f.release(); await flush(); f.advance(500);
  assert.equal(f.senses.length, 0); assert.equal(f.timers.size, 0);
});
