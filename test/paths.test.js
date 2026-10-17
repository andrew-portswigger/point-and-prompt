import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { expandHome, shotsDir } from '../server/paths.js';

test('expandHome expands a leading ~ only', () => {
  assert.equal(expandHome('~/vcs/x'), path.join(os.homedir(), 'vcs/x'));
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('/abs/~/x'), '/abs/~/x');
});

test('shotsDir prefers AW_DATA_DIR, expanded', () => {
  assert.equal(shotsDir({ AW_DATA_DIR: '~/aw-dev' }), path.join(os.homedir(), 'aw-dev', 'ui-picker', 'shots'));
});

test('shotsDir falls back to ~/.agent-wrangler', () => {
  assert.equal(shotsDir({}), path.join(os.homedir(), '.agent-wrangler', 'ui-picker', 'shots'));
});

test('shotsDir is always absolute', () => {
  assert.ok(path.isAbsolute(shotsDir({ AW_DATA_DIR: 'relative/dir' })));
});
