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

test('both settings are hidden: the settings panel draws them', () => {
  const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  for (const key of ['repoPath', 'allowedOrigins']) {
    assert.equal(byKey[key].hidden, true, key);
    assert.ok(byKey[key].label, key);
  }
});

test('help no longer points at install.html', () => {
  assert.doesNotMatch(manifest.help, /install\.html/);
  assert.ok(!fs.existsSync(new URL('../public/install.html', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../public/install.js', import.meta.url)));
});
