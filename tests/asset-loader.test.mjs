import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { loadAssets } = await load('../src/characters/asset-loader.ts');
test('failed assets remain unavailable; late character loads cannot publish after cleanup', () => {
  const images = [], updates = [];
  const stop = loadAssets(['base', 'tea', 'base'], () => {
    const image = { naturalWidth: 100, naturalHeight: 100 }; images.push(image); return image;
  }, ready => updates.push([...ready]));
  assert.equal(images.length, 2);
  images[1].onerror(); assert.deepEqual(updates, []);
  images[0].onload(); assert.deepEqual(updates, [['base']]);
  const late = images[1].onload;
  stop(); late(); assert.deepEqual(updates, [['base']]);
  assert.ok(images.every(image => image.onload === null && image.onerror === null));
});
