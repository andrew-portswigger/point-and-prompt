import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBookmarklet } from '../public/build-bookmarklet.js';
import { PICK_MAX_HTML, PICK_MAX_OWNERS, PICK_MAX_CLASSES } from '../public/pick-core.js';
import { MAX_HTML, MAX_OWNERS, MAX_CLASSES } from '../public/defaults.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('builds a javascript: URL that parses and bakes in the origin', () => {
  const url = buildBookmarklet(read('pick-core.js'), read('bookmarklet-main.js'), 'http://localhost:7777');
  assert.ok(url.startsWith('javascript:'));
  const src = decodeURIComponent(url.slice('javascript:'.length));
  assert.doesNotMatch(src, /^export /m);
  assert.doesNotMatch(src, /__WRANGLER_ORIGIN__/);
  assert.match(src, /"http:\/\/localhost:7777"/);
  assert.doesNotThrow(() => new Function(src));
});

test('pick-core limits match defaults', () => {
  assert.equal(PICK_MAX_HTML, MAX_HTML);
  assert.equal(PICK_MAX_OWNERS, MAX_OWNERS);
  assert.equal(PICK_MAX_CLASSES, MAX_CLASSES);
});
