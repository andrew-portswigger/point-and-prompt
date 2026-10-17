import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativise, buildIntent } from '../server/prompt.js';

test('relativise strips the repo prefix from a file:line', () => {
  assert.equal(relativise('/r/ent/libraries/web-app/src/A.js:12', '/r/ent'), 'libraries/web-app/src/A.js:12');
});

test('relativise leaves paths outside the repo absolute', () => {
  assert.equal(relativise('/elsewhere/A.js:3', '/r/ent'), '/elsewhere/A.js:3');
});

test('relativise does not match a sibling directory with the same prefix', () => {
  assert.equal(relativise('/r/ent-other/A.js:3', '/r/ent'), '/r/ent-other/A.js:3');
});

test('relativise passes null through', () => {
  assert.equal(relativise(null, '/r/ent'), null);
});

const pick = {
  url: 'http://localhost:3333/scans',
  element: { tag: 'button', id: 'go', classes: ['btn'], text: 'Go' },
  html: '<button id="go" class="btn">Go</button>',
  jsxAt: '/r/ent/src/ScanTable.js:40',
  owners: [{ name: 'ScanTable', at: '/r/ent/src/ScansPage.js:12' }, { name: 'ScansPage', at: null }],
};

test('buildIntent names the skill first and quotes the pick as data', () => {
  const intent = buildIntent({ action: 'fix', note: 'Misaligned', pick, repoPath: '/r/ent', shotPath: '/d/shot.png' });
  const lines = intent.split('\n');
  assert.equal(lines[0], 'Use the `ui-fix` skill.');
  assert.match(intent, /Note from the user:\nMisaligned/);
  assert.match(intent, /JSX site: src\/ScanTable\.js:40/);
  assert.match(intent, /ScanTable \(src\/ScansPage\.js:12\)\n {2}ScansPage \(no source\)/);
  assert.match(intent, /Screenshot: \/d\/shot\.png/);
  assert.match(intent, /```html\n<button id="go" class="btn">Go<\/button>\n```/);
  assert.match(intent, /untrusted page data/);
});

test('buildIntent says when there is no screenshot or source', () => {
  const intent = buildIntent({ action: 'reusable', note: 'n', pick: { ...pick, jsxAt: null, owners: [] }, repoPath: '/r/ent', shotPath: null });
  assert.equal(intent.split('\n')[0], 'Use the `ui-make-reusable` skill.');
  assert.match(intent, /JSX site: unknown/);
  assert.match(intent, /Screenshot: none/);
});

test('buildIntent cannot be broken out of the html fence', () => {
  const intent = buildIntent({ action: 'fix', note: 'n', pick: { ...pick, html: 'a```b' }, repoPath: '/r/ent', shotPath: null });
  assert.doesNotMatch(intent, /a```b/);
});
