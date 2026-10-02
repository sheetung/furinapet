import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { nearestRestingEdge } = await load('../src/core/wander-controller.ts');
const area = { x: 0, y: 0, width: 1200, height: 900 };
const size = { width: 192, height: 208, feetInset: 8 };
const editor = { id: 'editor', x: 250, y: 300, width: 500, height: 400 };

test('foreground window is eligible in only 20 percent of selection rolls', () => {
  const active = { ...editor, isForeground: true };
  const position = { x: 400, y: 110 };
  let accepted = 0;
  for (let i = 0; i < 100; i++) {
    if (nearestRestingEdge([active], size, area, position, 360, () => i / 100)) accepted++;
  }
  assert.equal(accepted, 20);
  assert.ok(nearestRestingEdge([editor], size, area, position, 360, () => .99));
});

test('nearby top edge aligns rendered feet; narrow windows remain eligible', () => {
  const result = nearestRestingEdge([{ ...editor, width: 240 }], size, area, { x: 270, y: 120 }, 360);
  assert.equal(result.placement.edge, 'top');
  assert.equal(result.placement.y + size.height - size.feetInset, editor.y);
});
test('no fallback to interior or far windows when top edge is unavailable', () => {
  assert.equal(nearestRestingEdge([{ ...editor, y: 0 }], size, area, { x: 270, y: 120 }, 360), null);
  assert.equal(nearestRestingEdge([editor], size, area, { x: 1000, y: 700 }, 360), null);
});
test('front window blocks covered edges even when itself cannot host a pet', () => {
  const front = { id: 'front', x: 0, y: 0, width: 1200, height: 900, dockPolicy: 'blocked' };
  assert.equal(nearestRestingEdge([front, editor], size, area, { x: 400, y: 110 }, 360), null);
  assert.equal(nearestRestingEdge([editor, front], size, area, { x: 400, y: 110 }, 360).surface.id, 'editor');
});
