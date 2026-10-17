import { test } from 'node:test';
import assert from 'node:assert/strict';
import client, { startPicker, pngBlob } from '../public/client.js';
import { buildIntent } from '../public/prompt.js';

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG = 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64');
const flush = () => new Promise((r) => setImmediate(r));

const pick = {
  type: 'ui-picker:pick', version: 1, url: 'http://localhost:3333/scans', html: '<b>hi</b>',
  element: { tag: 'b', id: '', classes: ['c'], text: 'hi' }, jsxAt: '/Users/me/vcs/enterprise/src/A.js:4',
  owners: [{ name: 'Foo', at: null }],
};

function setup({ search = '?ui-picker=1', opener = { posted: [] }, framed = false, settings = {}, stage, openDispatch } = {}) {
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
    settings: () => ({ ...settings }),
    images: { stage: (blob) => { calls.stage.push(blob); return stage ? stage(blob) : Promise.resolve({ name: 'img-1.png' }); } },
    openDispatch: (opts) => { calls.openDispatch.push(opts); return openDispatch ? openDispatch(opts) : Promise.resolve({ type: 'dispatched' }); },
    ui: { notify: (o) => { calls.notify.push(o); return Promise.resolve(null); } },
  };
  const launches = [];
  const started = startPicker({ api, win, loc: { search }, onLaunch: (p) => launches.push(p) });
  const send = (data, { origin = 'http://localhost:3333', source = opener } = {}) => {
    for (const f of [...listeners]) f({ data, origin, source });
  };
  return { started, win, opener, calls, send, listeners, launches };
}

test('does nothing without ?ui-picker', () => {
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

test('posts ready to the opener', () => {
  const t = setup();
  assert.equal(t.started, true);
  assert.deepEqual(t.opener.posted, [[{ type: 'ui-picker:ready' }, '*']]);
});

test('ignores picks from another source, a disallowed origin or of the wrong shape', async () => {
  const t = setup();
  t.send(pick, { source: { other: true } });
  t.send(pick, { origin: 'http://evil' });
  t.send({ ...pick, version: 2 });
  t.send({ ...pick, screenshot: 'data:image/jpeg;base64,AAAA' });
  t.send({ source: 'react-devtools-content-script' });
  await flush();
  assert.equal(t.calls.openDispatch.length, 0);
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

test('a rejected openDispatch says so and leaves the window open', async () => {
  const t = setup({ openDispatch: () => Promise.reject(new Error('busy')) });
  t.send(pick);
  await Promise.all(t.launches);
  assert.equal(t.win.closed, 0);
  assert.equal(t.calls.notify.length, 1);
  assert.match(t.calls.notify[0].body, /busy/);
});

test('pngBlob decodes the data URL', async () => {
  const blob = pngBlob(PNG);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], PNG_BYTES);
});

test('register runs the picker on the real window and location with registrar.api', () => {
  const posted = [];
  const win = { opener: { postMessage: (m) => posted.push(m) }, addEventListener() {} };
  win.top = win;
  globalThis.window = win;
  globalThis.location = { search: '?ui-picker=1' };
  try {
    client.register({ api: { settings: () => ({}) } });
  } finally {
    delete globalThis.window;
    delete globalThis.location;
  }
  assert.deepEqual(posted, [{ type: 'ui-picker:ready' }]);
});
