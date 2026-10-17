import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOriginsFrom, isAcceptedPick, isOurResult, launchFrame } from '../public/launch-core.js';
import { DEFAULT_ALLOWED_ORIGINS } from '../public/defaults.js';

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
const ok = { origin: 'http://localhost:3333', source: opener, data: { type: 'ui-picker:pick', version: 1 } };

test('isAcceptedPick needs an allowed origin, the opener as source and the pick type', () => {
  const allowed = ['http://localhost:3333'];
  assert.equal(isAcceptedPick(ok, allowed, opener), true);
  assert.equal(isAcceptedPick({ ...ok, origin: 'http://evil' }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { source: 'react-devtools-content-script', hello: true } }, allowed, opener), false);
  assert.equal(isAcceptedPick({ ...ok, data: { type: 'ui-picker:pick', version: 2 } }, allowed, opener), false);
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
  const f = launchFrame({ requestId: 'r1', pick: { a: 1 }, note: 'n', action: 'fix', screenshot: null });
  assert.deepEqual(f, { type: 'ui-picker-launch', requestId: 'r1', pick: { a: 1 }, note: 'n', action: 'fix', screenshot: null });
});
