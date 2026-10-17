import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOriginsFrom, isAcceptedPick, isWellFormedPick, isOurResult, launchFrame } from '../public/launch-core.js';
import { DEFAULT_ALLOWED_ORIGINS, MAX_SHOT_BYTES } from '../public/defaults.js';

const graph = (values) => ({ extensions: [{ id: 'other', settingValues: { allowedOrigins: ['http://evil'] } }, { id: 'ui-picker', settingValues: values }] });

test('allowedOriginsFrom reads our own settings', () => {
  assert.deepEqual(allowedOriginsFrom(graph({ allowedOrigins: ['http://a:1'] })), ['http://a:1']);
});

test('allowedOriginsFrom falls back to defaults when unset or empty', () => {
  assert.deepEqual(allowedOriginsFrom(graph({})), DEFAULT_ALLOWED_ORIGINS);
  assert.deepEqual(allowedOriginsFrom(graph({ allowedOrigins: [] })), DEFAULT_ALLOWED_ORIGINS);
  assert.deepEqual(allowedOriginsFrom({}), DEFAULT_ALLOWED_ORIGINS);
});

const opener = { name: 'opener' };
const goodPick = {
  type: 'ui-picker:pick', version: 1, url: 'http://localhost:3333/x', html: '<b>hi</b>',
  element: { tag: 'b', id: '', classes: ['c'], text: 'hi' }, jsxAt: null,
  owners: [{ name: 'Foo', at: 'a.jsx:1' }, { name: 'Bar', at: null }],
};
const ok = { origin: 'http://localhost:3333', source: opener, data: goodPick };

test('isAcceptedPick needs an allowed origin, the opener as source and the pick type', () => {
  const allowed = ['http://localhost:3333'];
  assert.equal(isAcceptedPick(ok, allowed, opener), true);
  assert.equal(isAcceptedPick({ ...ok, origin: 'http://evil' }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { source: 'react-devtools-content-script', hello: true } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { ...goodPick, version: 2 } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: null }, allowed, opener), false);
});

test('isAcceptedPick rejects a message from any window other than the expected source', () => {
  const allowed = ['http://localhost:3333'];
  assert.equal(isAcceptedPick({ ...ok, source: { name: 'other' } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, source: null }, allowed, null), false);
});

test('isOurResult matches the broadcast for this request only', () => {
  assert.equal(isOurResult({ type: 'ext:ui-picker', requestId: 'r1', sessionId: 's' }, 'r1'), true);
  assert.equal(isOurResult({ type: 'ext:ui-picker', requestId: 'r2' }, 'r1'), false);
  assert.equal(isOurResult({ type: 'graph' }, 'r1'), false);
});

test('launchFrame shapes the control frame', () => {
  const f = launchFrame({ requestId: 'r1', pick: { a: 1 }, note: 'n', screenshot: null });
  assert.deepEqual(f, { type: 'ui-picker-launch', requestId: 'r1', pick: { a: 1 }, note: 'n', screenshot: null });
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
  assert.equal(isAcceptedPick({ ...ok, data: { type: 'ui-picker:pick', version: 1 } }, ['http://localhost:3333'], opener), false);
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

test('launchFrame keeps the screenshot out of the pick', () => {
  const f = launchFrame({ requestId: 'r1', pick: { a: 1, screenshot: PNG }, note: 'n', screenshot: PNG });
  assert.deepEqual(f, { type: 'ui-picker-launch', requestId: 'r1', pick: { a: 1 }, note: 'n', screenshot: PNG });
});
