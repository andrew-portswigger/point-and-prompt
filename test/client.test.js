import { test } from 'node:test';
import assert from 'node:assert/strict';
import client, { startPicker, pngBlob } from '../public/client.js';
import fs from 'node:fs';
import { buildIntent } from '../public/prompt.js';
import { buildId } from '../public/build-bookmarklet.js';
import { PICK_CORE_URL, MAIN_URL } from '../public/settings-panel.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const SOURCES = { [PICK_CORE_URL]: read('pick-core.js'), [MAIN_URL]: read('bookmarklet-main.js') };
const CURRENT_BUILD = buildId(SOURCES[PICK_CORE_URL], SOURCES[MAIN_URL]);
const serveSources = (url) => (url in SOURCES ? Promise.resolve(SOURCES[url]) : Promise.reject(new Error('404')));

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG = 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64');
const flush = () => new Promise((r) => setImmediate(r));

const pick = {
  type: 'point-and-prompt:pick', protocol: 1, build: CURRENT_BUILD, url: 'http://localhost:3333/scans', html: '<b>hi</b>',
  element: { tag: 'b', id: '', classes: ['c'], text: 'hi' }, jsxAt: '/Users/me/vcs/enterprise/src/A.js:4',
  owners: [{ name: 'Foo', at: null }],
};

function setup({ search = '?point-and-prompt=1', opener = { posted: [] }, framed = false, settings = {}, stage, openDispatch, notify, fetchText = serveSources, buildWaitMs } = {}) {
  if (opener) opener.postMessage = (msg, target) => opener.posted.push([msg, target]);
  const listeners = new Set();
  const win = {
    opener,
    closed: 0,
    close() { this.closed += 1; },
    addEventListener: (t, f) => { if (t === 'message') listeners.add(f); },
    removeEventListener: (t, f) => { if (t === 'message') listeners.delete(f); },
  };
  win.top = framed ? {} : win;
  const calls = { stage: [], openDispatch: [], notify: [] };
  const api = {
    settings: () => (settings === undefined ? undefined : { ...settings }),
    images: { stage: (blob) => { calls.stage.push(blob); return stage ? stage(blob) : Promise.resolve({ name: 'img-1.png' }); } },
    openDispatch: (opts) => { calls.openDispatch.push(opts); return openDispatch ? openDispatch(opts) : Promise.resolve({ type: 'dispatched' }); },
    ui: { notify: (o) => { calls.notify.push(o); return notify ? notify(o) : Promise.resolve(null); } },
  };
  const launches = [];
  const started = startPicker({ api, win, loc: { search }, fetchText, buildWaitMs, onLaunch: (p) => launches.push(p) });
  const send = (data, { origin = 'http://localhost:3333', source = opener } = {}) => {
    for (const f of [...listeners]) f({ data, origin, source });
  };
  return { started, win, opener, calls, send, listeners, launches, api };
}

test('does nothing without ?point-and-prompt', () => {
  const t = setup({ search: '' });
  assert.equal(t.started, false);
  assert.deepEqual(t.opener.posted, []);
  assert.equal(t.listeners.size, 0);
});

test('does nothing without an opener', () => {
  const t = setup({ opener: null });
  assert.equal(t.started, false);
  assert.equal(t.listeners.size, 0);
});

test('does nothing inside a frame', () => {
  const t = setup({ framed: true });
  assert.equal(t.started, false);
  assert.deepEqual(t.opener.posted, []);
});

const READY = { type: 'point-and-prompt:ready', protocols: [1], build: CURRENT_BUILD };

test('posts ready with the protocols and current build to the opener once per allowed origin, never to *', async () => {
  const t = setup();
  assert.equal(t.started, true);
  await flush();
  assert.deepEqual(t.opener.posted, [
    [READY, 'http://localhost:3333'],
    [READY, 'http://localhost:1234'],
  ]);
});

test('ready goes only to the allowedOrigins setting when set', async () => {
  const t = setup({ settings: { allowedOrigins: ['http://app:9'] } });
  await flush();
  assert.deepEqual(t.opener.posted, [[READY, 'http://app:9']]);
});

test('ready omits build when the sources cannot be fetched', async () => {
  const t = setup({ fetchText: () => Promise.reject(new Error('offline')) });
  await flush();
  assert.deepEqual(t.opener.posted.map(([m]) => m), [
    { type: 'point-and-prompt:ready', protocols: [1] },
    { type: 'point-and-prompt:ready', protocols: [1] },
  ]);
});

test('a slow fetch does not hold up ready for long: it goes without build', async () => {
  const t = setup({ fetchText: () => new Promise(() => {}), buildWaitMs: 5 });
  await flush();
  assert.equal(t.opener.posted.length, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(t.opener.posted.map(([m]) => m)[0], { type: 'point-and-prompt:ready', protocols: [1] });
});

test('the board shows no stale-build notice itself: the bookmarklet does', async () => {
  const t = setup();
  t.send({ ...pick, build: 'deadbeef' });
  await Promise.all(t.launches);
  await flush();
  assert.equal(t.calls.openDispatch.length, 1);
  assert.equal(t.calls.notify.length, 0);
});

test('settings() returning undefined falls back to the defaults', async () => {
  const t = setup({ settings: undefined });
  await flush();
  assert.equal(t.opener.posted.length, 2);
  t.send(pick);
  await Promise.all(t.launches);
  assert.equal(t.calls.openDispatch[0].cwd, '~/vcs/enterprise');
});

test('a blank repoPath falls back to the default folder', async () => {
  const t = setup({ settings: { repoPath: '   ' } });
  t.send(pick);
  await Promise.all(t.launches);
  assert.equal(t.calls.openDispatch[0].cwd, '~/vcs/enterprise');
});

test('ignores picks from another source or a disallowed origin, and foreign messages', async () => {
  const t = setup();
  t.send(pick, { source: { other: true } });
  t.send(pick, { origin: 'http://evil' });
  t.send({ ...pick, screenshot: 'data:image/jpeg;base64,AAAA' }, { origin: 'http://evil' });
  t.send({ source: 'react-devtools-content-script' });
  await flush();
  assert.equal(t.calls.openDispatch.length, 0);
  assert.equal(t.listeners.size, 1);
});

const MISMATCH = "This Point & Prompt bookmarklet doesn't match this wrangler. Re-drag it from Settings → Extensions → Point & Prompt.";

test('an unsupported protocol from the opener says so, opens no dialog, and closes once the card is dismissed', async () => {
  let dismiss;
  const t = setup({ notify: () => new Promise((r) => { dismiss = r; }) });
  t.send({ ...pick, protocol: 2 });
  await flush();
  assert.equal(t.calls.openDispatch.length, 0);
  assert.equal(t.calls.notify.length, 1);
  assert.equal(t.calls.notify[0].body, MISMATCH);
  assert.equal(t.listeners.size, 0, 'one answer per popup');
  assert.equal(t.win.closed, 0, 'open while the card is up');
  dismiss(null);
  await Promise.all(t.launches);
  assert.equal(t.win.closed, 1);
});

test('a pick without a protocol is a mismatch too', async () => {
  const { protocol: _, ...old } = pick;
  const t = setup();
  t.send({ ...old, version: 1 });
  await Promise.all(t.launches);
  assert.equal(t.calls.openDispatch.length, 0);
  assert.equal(t.calls.notify[0].body, MISMATCH);
  assert.equal(t.win.closed, 1);
});

const MALFORMED = "Point & Prompt couldn't read that pick. Re-drag the bookmarklet from Settings → Extensions → Point & Prompt.";

test('a malformed pick from the opener says so, opens no dialog, and closes once the card is dismissed', async () => {
  let dismiss;
  const t = setup({ notify: () => new Promise((r) => { dismiss = r; }) });
  t.send({ ...pick, screenshot: 'data:image/jpeg;base64,AAAA' });
  await flush();
  assert.equal(t.calls.openDispatch.length, 0);
  assert.equal(t.calls.notify.length, 1);
  assert.equal(t.calls.notify[0].body, MALFORMED);
  assert.equal(t.listeners.size, 0, 'one answer per popup');
  assert.equal(t.win.closed, 0, 'open while the card is up');
  dismiss(null);
  await Promise.all(t.launches);
  assert.equal(t.win.closed, 1);
});

test('an unsupported protocol from another origin or window is ignored silently', async () => {
  const t = setup();
  t.send({ ...pick, protocol: 2 }, { origin: 'http://evil' });
  t.send({ ...pick, protocol: 2 }, { source: {} });
  await flush();
  assert.equal(t.calls.notify.length, 0);
  assert.equal(t.listeners.size, 1);
});

test('uses the allowedOrigins setting in place of the defaults', async () => {
  const t = setup({ settings: { allowedOrigins: ['http://app:9'] } });
  t.send(pick);
  t.send(pick, { origin: 'http://app:9' });
  await flush();
  assert.equal(t.calls.openDispatch.length, 1);
});

test('without a screenshot, opens the dialog with the intent and the default folder, then closes', async () => {
  const t = setup();
  t.send(pick);
  await Promise.all(t.launches);
  assert.equal(t.calls.stage.length, 0);
  assert.deepEqual(t.calls.openDispatch, [{
    intent: buildIntent({ pick, repoPath: '~/vcs/enterprise' }),
    cwd: '~/vcs/enterprise',
    images: [],
  }]);
  assert.match(t.calls.openDispatch[0].intent, /JSX site: src\/A\.js:4/);
  assert.equal(t.win.closed, 1);
});

test('accepts only one pick', async () => {
  const t = setup();
  t.send(pick);
  t.send(pick);
  await flush();
  assert.equal(t.calls.openDispatch.length, 1);
  assert.equal(t.listeners.size, 0);
});

test('the repoPath setting is the folder and the root paths are relative to', async () => {
  const t = setup({ settings: { repoPath: ' /src/ent ' } });
  t.send({ ...pick, jsxAt: '/src/ent/lib/B.js:1' });
  await Promise.all(t.launches);
  assert.equal(t.calls.openDispatch[0].cwd, '/src/ent');
  assert.match(t.calls.openDispatch[0].intent, /JSX site: lib\/B\.js:1/);
});

test('stages the screenshot as a PNG blob and attaches its name', async () => {
  const t = setup();
  t.send({ ...pick, screenshot: PNG });
  await Promise.all(t.launches);
  const [blob] = t.calls.stage;
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], PNG_BYTES);
  assert.deepEqual(t.calls.openDispatch[0].images, ['img-1.png']);
  assert.doesNotMatch(t.calls.openDispatch[0].intent, /data:image/);
  assert.equal(t.calls.notify.length, 0);
  assert.equal(t.win.closed, 1);
});

test('a failed stage launches without the screenshot and says so', async () => {
  const t = setup({ stage: () => Promise.reject(new Error('too big')) });
  t.send({ ...pick, screenshot: PNG });
  await Promise.all(t.launches);
  assert.deepEqual(t.calls.openDispatch[0].images, []);
  assert.equal(t.calls.notify.length, 1);
  assert.equal(t.calls.notify[0].title, "Screenshot couldn't be attached");
  assert.equal(t.win.closed, 1);
});

test('closes only after the dialog resolves, launched or cancelled', async () => {
  let resolve;
  const t = setup({ openDispatch: () => new Promise((r) => { resolve = r; }) });
  t.send(pick);
  await flush();
  assert.equal(t.win.closed, 0);
  resolve(null);
  await Promise.all(t.launches);
  assert.equal(t.win.closed, 1);
});

test('a rejected openDispatch offers Retry and keeps the window open while the card is up', async () => {
  let answer;
  const t = setup({ openDispatch: () => Promise.reject(new Error('busy')), notify: () => new Promise((r) => { answer = r; }) });
  t.send(pick);
  await flush();
  assert.equal(t.win.closed, 0);
  assert.equal(t.calls.notify.length, 1);
  assert.match(t.calls.notify[0].body, /busy/);
  assert.deepEqual(t.calls.notify[0].actions, [{ id: 'retry', label: 'Retry', primary: true }]);
  answer(null);
  await Promise.all(t.launches);
  assert.equal(t.calls.openDispatch.length, 1);
  assert.equal(t.win.closed, 1, 'closing the card closes the window');
});

test('Retry re-stages the screenshot and opens the dialog again', async () => {
  let attempts = 0;
  let staged = 0;
  const t = setup({
    stage: () => Promise.resolve({ name: `img-${++staged}.png` }),
    openDispatch: () => (++attempts === 1 ? Promise.reject(new Error('busy')) : Promise.resolve({ type: 'dispatched' })),
    notify: (o) => Promise.resolve(o.id === 'dispatch' ? 'retry' : null),
  });
  t.send({ ...pick, screenshot: PNG });
  await Promise.all(t.launches);
  assert.equal(t.calls.stage.length, 2);
  assert.deepEqual(t.calls.openDispatch.map((o) => o.images), [['img-1.png'], ['img-2.png']]);
  assert.equal(t.win.closed, 1);
});

test('pngBlob decodes the data URL', async () => {
  const blob = pngBlob(PNG);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], PNG_BYTES);
});

test('register runs the picker on the real window and location with registrar.api', async () => {
  const posted = [];
  const opened = [];
  const api = { settings: () => ({ allowedOrigins: ['http://a:1'] }), openDispatch: (o) => { opened.push(o); return Promise.resolve(null); }, images: {}, ui: {} };
  let onMsg;
  const win = { opener: { postMessage: (m) => posted.push(m) }, addEventListener: (t, f) => { onMsg = f; }, removeEventListener() {}, close() {} };
  win.top = win;
  globalThis.window = win;
  globalThis.location = { search: '?point-and-prompt=1' };
  const registered = [];
  try {
    client.register({ api, register: (slot, c) => registered.push([slot, c]) });
  } finally {
    delete globalThis.window;
    delete globalThis.location;
  }
  // No server here, so the sources can't be fetched: ready goes without build.
  for (let i = 0; i < 50 && !posted.length; i += 1) await flush();
  assert.deepEqual(posted, [{ type: 'point-and-prompt:ready', protocols: [1] }]);
  assert.deepEqual(registered.map(([slot, c]) => [slot, c.id]), [['settings.panel', 'point-and-prompt']]);
  assert.equal(typeof registered[0][1].mount, 'function');
  assert.equal(typeof registered[0][1].save, 'function');
  // The api used is registrar.api itself: its openDispatch receives the launch.
  onMsg({ data: pick, origin: 'http://a:1', source: win.opener });
  await flush();
  assert.equal(opened.length, 1);
});
