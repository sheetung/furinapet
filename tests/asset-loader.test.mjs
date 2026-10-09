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

test('assets become renderable only after decoding; late and failed decodes stay unavailable', async () => {
  const images = [], updates = [], finishes = [];
  const stop = loadAssets(['base', 'tea', 'cake'], () => {
    const image = { naturalWidth: 100, naturalHeight: 100,
      decode: () => new Promise((resolve, reject) => finishes.push({ resolve, reject })) };
    images.push(image); return image;
  }, ready => updates.push([...ready]));
  images.forEach(image => image.onload());
  assert.deepEqual(updates, []);
  finishes[0].resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, [['base']]);
  finishes[1].reject(new Error('decode failed')); await new Promise(resolve => setImmediate(resolve));
  stop(); finishes[2].resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, [['base']]);
});
