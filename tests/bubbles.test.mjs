import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { BubbleController } = await load('../src/bubbles/controller.ts');
const { bubbleLayout } = await load('../src/bubbles/layout.ts');
function fixture() {
  let now = 0;
  const timers = new Set();
  const bubbles = new BubbleController(() => now, fn => { timers.add(fn); return () => timers.delete(fn); });
  return { bubbles, timers, time: value => { now = value; } };
}
test('notification persists independently, updates by ID, and rejects lower priority replacement', () => {
  const { bubbles } = fixture();
  bubbles.show({ id: 'agent', text: 'Working', durationMs: 0, priority: 20 });
  assert.equal(bubbles.show({ id: 'action-hint', text: 'Hello' }), false);
  bubbles.show({ id: 'agent', text: 'Done', durationMs: 0, priority: 20 });
  assert.equal(bubbles.snapshot().text, 'Done');
  bubbles.dismiss('old');
  assert.ok(bubbles.snapshot());
  bubbles.dismiss('agent');
  assert.equal(bubbles.snapshot(), null);
});
test('late expiry cannot dismiss replacement; hidden messages expire without restoring', () => {
  const { bubbles, timers, time } = fixture();
  bubbles.show({ id: 'one', text: 'First', durationMs: 100 });
  const late = [...timers][0];
  bubbles.show({ id: 'two', text: 'Second', durationMs: 200 });
  late(); assert.equal(bubbles.snapshot().id, 'two');
  bubbles.setVisible(false); assert.equal(bubbles.snapshot(), null);
  time(50); bubbles.setVisible(true); assert.equal(bubbles.snapshot().id, 'two');
  bubbles.setVisible(false); time(300); bubbles.setVisible(true);
  assert.equal(bubbles.snapshot(), null);
});
test('invalid notification leaves current content unchanged', () => {
  const { bubbles } = fixture();
  bubbles.show({ id: 'one', text: 'First' });
  for (const request of [null, {}, { id: 'x', text: '' }, { id: 'x', text: 'X', durationMs: NaN }]) {
    assert.equal(bubbles.show(request), false);
    assert.equal(bubbles.snapshot().id, 'one');
  }
});
test('expand and collapse preserve feet and center across DPI and negative coordinates', () => {
  for (const factor of [1, 1.25, 2]) {
    const initial = { x: -800, y: 300, width: 192 * factor, height: 208 * factor,
      scale: 1, factor, workAreaTop: -200, expanded: true };
    const expanded = bubbleLayout(initial);
    const collapsed = bubbleLayout({ ...initial, ...expanded, expanded: false });
    assert.equal(expanded.y + expanded.height, initial.y + initial.height);
    assert.equal(collapsed.y, initial.y);
    assert.equal(collapsed.x, initial.x);
  }
});
test('top boundary uses inside placement without moving the pet down', () => {
  const layout = bubbleLayout({ x: 10, y: 0, width: 192, height: 208, scale: 1, factor: 1,
    expanded: true, workAreaTop: 0 });
  assert.equal(layout.placement, 'inside');
  assert.equal(layout.y, 0);
  assert.equal(layout.height, 208);
});
