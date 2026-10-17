import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import manifest from '../index.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));

test('manifest agrees with package.json declaration', () => {
  assert.equal(manifest.id, pkg.wranglerExtension.id);
  assert.deepEqual(manifest.requires, pkg.wranglerExtension.requires);
});

test('every declared skill has a SKILL.md', () => {
  for (const name of manifest.skills) {
    assert.ok(fs.existsSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), name);
  }
});

test('settings keys match the wrangler key pattern', () => {
  for (const s of manifest.settings) assert.match(s.key, /^[a-z][a-zA-Z0-9]*$/);
});
