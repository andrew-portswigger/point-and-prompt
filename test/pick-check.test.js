import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { allowedOriginsFrom, isAcceptedPick, isWellFormedPick, normalisePick, readPick } from '../public/pick-check.js';
import { DEFAULT_ALLOWED_ORIGINS, MAX_CLASSES, MAX_HTML, MAX_OWNERS, MAX_SHOT_BYTES, SUPPORTED_PROTOCOLS } from '../public/defaults.js';
import { buildIntent } from '../public/prompt.js';

const fixture = (protocol) => JSON.parse(fs.readFileSync(new URL(`./fixtures/pick-v${protocol}.json`, import.meta.url), 'utf8'));

test('allowedOriginsFrom reads our settings values', () => {
  assert.deepEqual(allowedOriginsFrom({ allowedOrigins: ['http://a:1'] }), ['http://a:1']);
});

test('allowedOriginsFrom falls back to defaults when unset or empty', () => {
  assert.deepEqual(allowedOriginsFrom({}), DEFAULT_ALLOWED_ORIGINS);
  assert.deepEqual(allowedOriginsFrom({ allowedOrigins: [] }), DEFAULT_ALLOWED_ORIGINS);
  assert.deepEqual(allowedOriginsFrom({ allowedOrigins: 'http://a:1' }), DEFAULT_ALLOWED_ORIGINS);
  assert.deepEqual(allowedOriginsFrom(undefined), DEFAULT_ALLOWED_ORIGINS);
});

const opener = { name: 'opener' };
const goodPick = {
  type: 'ui-picker:pick', protocol: 1, build: '0123abcd', url: 'http://localhost:3333/x', html: '<b>hi</b>',
  element: { tag: 'b', id: '', classes: ['c'], text: 'hi' }, jsxAt: null,
  owners: [{ name: 'Foo', at: 'a.jsx:1' }, { name: 'Bar', at: null }],
};
const ok = { origin: 'http://localhost:3333', source: opener, data: goodPick };

test('isAcceptedPick needs an allowed origin, the opener as source and the pick type', () => {
  const allowed = ['http://localhost:3333'];
  assert.equal(isAcceptedPick(ok, allowed, opener), true);
  assert.equal(isAcceptedPick({ ...ok, origin: 'http://evil' }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { source: 'react-devtools-content-script', hello: true } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { ...goodPick, protocol: 2 } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { ...goodPick, protocol: undefined, version: 1 } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: null }, allowed, opener), false);
});

test('isAcceptedPick rejects a message from any window other than the expected source', () => {
  const allowed = ['http://localhost:3333'];
  assert.equal(isAcceptedPick({ ...ok, source: { name: 'other' } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, source: null }, allowed, null), false);
});

test('isWellFormedPick accepts a good pick and rejects malformed shapes', () => {
  assert.equal(isWellFormedPick(goodPick), true);
  assert.equal(isWellFormedPick({ ...goodPick, jsxAt: 'a.jsx:2' }), true);
  const bad = (patch) => isWellFormedPick({ ...goodPick, ...patch });
  assert.equal(bad({ url: 5 }), false);
  assert.equal(bad({ html: null }), false);
  assert.equal(bad({ element: null }), false);
  assert.equal(bad({ element: { ...goodPick.element, classes: 'c' } }), false);
  assert.equal(bad({ element: { ...goodPick.element, classes: [1] } }), false);
  assert.equal(bad({ element: { ...goodPick.element, tag: undefined } }), false);
  assert.equal(bad({ jsxAt: 3 }), false);
  assert.equal(bad({ owners: 'x' }), false);
  assert.equal(bad({ owners: [{ name: 1, at: null }] }), false);
  assert.equal(bad({ owners: [{ name: 'A' }] }), false);
  assert.equal(isWellFormedPick(null), false);
});

test('isAcceptedPick rejects a malformed pick from an allowed opener', () => {
  assert.equal(isAcceptedPick({ ...ok, data: { type: 'ui-picker:pick', protocol: 1 } }, ['http://localhost:3333'], opener), false);
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('isWellFormedPick takes an optional PNG data URL screenshot within the cap', () => {
  const { screenshot, ...noShot } = { ...goodPick };
  assert.equal(screenshot, undefined);
  assert.equal(isWellFormedPick(noShot), true);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: PNG }), true);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: 'data:image/jpeg;base64,AAAA' }), false);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: 'data:image/png,raw' }), false);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: 42 }), false);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: null }), false);
  const max = Math.floor(MAX_SHOT_BYTES / 3) * 4;
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: 'data:image/png;base64,' + 'A'.repeat(max) }), true);
  assert.equal(isWellFormedPick({ ...goodPick, screenshot: 'data:image/png;base64,' + 'A'.repeat(max + 4) }), false);
});


test('isWellFormedPick caps html, owners and classes as the bookmarklet does', () => {
  const owner = { name: 'A', at: null };
  assert.equal(isWellFormedPick({ ...goodPick, html: 'x'.repeat(MAX_HTML) }), true);
  assert.equal(isWellFormedPick({ ...goodPick, html: 'x'.repeat(MAX_HTML + 1) }), false);
  assert.equal(isWellFormedPick({ ...goodPick, owners: Array(MAX_OWNERS).fill(owner) }), true);
  assert.equal(isWellFormedPick({ ...goodPick, owners: Array(MAX_OWNERS + 1).fill(owner) }), false);
  assert.equal(isWellFormedPick({ ...goodPick, element: { ...goodPick.element, classes: Array(MAX_CLASSES).fill('c') } }), true);
  assert.equal(isWellFormedPick({ ...goodPick, element: { ...goodPick.element, classes: Array(MAX_CLASSES + 1).fill('c') } }), false);
});

test('isWellFormedPick requires a short build string', () => {
  assert.equal(isWellFormedPick({ ...goodPick, build: undefined }), false);
  assert.equal(isWellFormedPick({ ...goodPick, build: 7 }), false);
  assert.equal(isWellFormedPick({ ...goodPick, build: 'x'.repeat(65) }), false);
});

test('unknown extra fields are accepted and dropped by the normaliser', () => {
  const extra = { ...goodPick, colour: 'red', element: { ...goodPick.element, role: 'button' } };
  assert.equal(isWellFormedPick(extra), true);
  const pick = normalisePick[1](extra);
  assert.equal('colour' in pick, false);
  assert.equal('role' in pick.element, false);
});

test('normalisePick[1] maps a v1 payload to the internal pick', () => {
  assert.deepEqual(normalisePick[1]({ ...goodPick, screenshot: PNG, rect: { x: 1 } }), {
    url: goodPick.url, html: goodPick.html, element: goodPick.element, jsxAt: null, owners: goodPick.owners,
    build: '0123abcd', screenshot: PNG,
  });
  assert.equal('screenshot' in normalisePick[1](goodPick), false);
  assert.equal(normalisePick[1]({ ...goodPick, url: 5 }), null);
});

test('there is a normaliser for every supported protocol and no other', () => {
  assert.deepEqual(Object.keys(normalisePick).map(Number).sort(), [...SUPPORTED_PROTOCOLS].sort());
});

for (const protocol of SUPPORTED_PROTOCOLS) {
  test(`the golden v${protocol} payload is accepted and normalised`, () => {
    const data = fixture(protocol);
    assert.equal(data.protocol, protocol);
    const read = readPick({ origin: 'http://localhost:3333', source: opener, data }, ['http://localhost:3333'], opener);
    assert.ok(read?.pick, 'accepted');
    const { pick } = read;
    assert.match(pick.screenshot, /^data:image\/png;base64,/);
    assert.equal(typeof pick.build, 'string');
    assert.match(buildIntent({ pick, repoPath: '~/vcs/enterprise' }), /JSX site: /);
  });
}

test('readPick tells an unsupported protocol from an allowed opener apart from noise', () => {
  const allowed = ['http://localhost:3333'];
  assert.deepEqual(readPick({ ...ok, data: { ...goodPick, protocol: 2 } }, allowed, opener), { unsupported: 2 });
  assert.deepEqual(readPick({ ...ok, data: { type: 'ui-picker:pick', version: 1 } }, allowed, opener), { unsupported: undefined });
  assert.equal(readPick({ ...ok, origin: 'http://evil', data: { ...goodPick, protocol: 2 } }, allowed, opener), null);
  assert.equal(readPick({ ...ok, source: {}, data: { ...goodPick, protocol: 2 } }, allowed, opener), null);
  assert.deepEqual(readPick({ ...ok, data: { ...goodPick, url: 5 } }, allowed, opener), { malformed: true });
  assert.deepEqual(readPick({ ...ok, data: { type: 'ui-picker:pick', protocol: 1 } }, allowed, opener), { malformed: true });
  assert.equal(readPick({ ...ok, origin: 'http://evil', data: { ...goodPick, url: 5 } }, allowed, opener), null);
  assert.equal(readPick({ ...ok, data: { type: 'other', protocol: 2 } }, allowed, opener), null);
});

test('the golden v1 payload is unchanged', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/pick-v1.json', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    '831e1b2b23f67b9b507468e8426d6056fc879193aac028487a00da5d458d9e3d',
    'pick-v1.json is a compatibility contract — add pick-v2.json for a new protocol instead of editing this one');
});
