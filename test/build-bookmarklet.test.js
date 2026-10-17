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

test('origin is inserted literally, without $ replacement patterns', () => {
  const url = buildBookmarklet('', 'const W = __WRANGLER_ORIGIN__;', 'http://h/$&$1');
  assert.equal(decodeURIComponent(url.slice('javascript:'.length)).includes('"http://h/$&$1"'), true);
});

// Smoke test of the real bookmarklet against minimal fakes.
const ORIGIN = 'http://localhost:7777';

function setup() {
  const listeners = [];
  const timers = [];
  const opened = [];
  const posted = [];
  const banners = [];
  const win = { __uiPickerActive: false, popup: {}, open(...a) { opened.push(a); return win.popup; } };
  win.popup = { postMessage: (...a) => posted.push(a) };
  const mk = () => ({
    style: { cssText: '' },
    set textContent(v) { banners.push(v); },
    remove() {},
  });
  const document = { createElement: mk, documentElement: { appendChild() {} } };
  const addEventListener = (t, f) => listeners.push([t, f]);
  const removeEventListener = (t, f) => {
    const i = listeners.findIndex(([lt, lf]) => lt === t && lf === f);
    if (i >= 0) listeners.splice(i, 1);
  };
  const setTimeout = (f, ms) => timers.push([f, ms]);
  const src = decodeURIComponent(buildBookmarklet(read('pick-core.js'), read('bookmarklet-main.js'), ORIGIN).slice('javascript:'.length));
  new Function('window', 'document', 'addEventListener', 'removeEventListener', 'location', 'devicePixelRatio', 'setTimeout', src)(
    win, document, addEventListener, removeEventListener, { href: 'http://app/' }, 2, setTimeout);
  const fire = (type, ev) => [...listeners].filter(([t]) => t === type).forEach(([, f]) => f(ev));
  const target = {
    tagName: 'BUTTON', id: '', className: 'x', textContent: 'Go', outerHTML: '<button>Go</button>', parentElement: null,
    getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4, left: 1, top: 2 }),
  };
  const ev = (o = {}) => ({ target, button: 0, preventDefault() {}, stopPropagation() {}, ...o });
  return { win, listeners, timers, opened, posted, banners, fire, ev };
}

test('pointerdown opens a uniquely named popup at the exact launch URL', () => {
  const a = setup();
  a.fire('pointerdown', a.ev());
  const b = setup();
  b.fire('pointerdown', b.ev());
  assert.equal(a.opened[0][0], `${ORIGIN}/ext/ui-picker/launch.html`);
  assert.match(a.opened[0][1], /^ui-picker-[a-z0-9]+$/);
  assert.notEqual(a.opened[0][1], b.opened[0][1]);
});

test('non-primary buttons do not pick', () => {
  const t = setup();
  t.fire('pointerdown', t.ev({ button: 2 }));
  assert.equal(t.opened.length, 0);
});

test('ready from another source is ignored; ready from the popup posts to the origin', () => {
  const t = setup();
  t.fire('pointerdown', t.ev());
  t.fire('message', { source: {}, data: { type: 'ui-picker:ready' } });
  assert.equal(t.posted.length, 0);
  t.fire('message', { source: t.win.popup, data: { type: 'ui-picker:ready' } });
  assert.equal(t.posted.length, 1);
  assert.equal(t.posted[0][1], ORIGIN);
  assert.equal(t.posted[0][0].type, 'ui-picker:pick');
  assert.equal(t.posted[0][0].element.tag, 'button');
});

test('no ready within 10s removes the listener and shows a banner', () => {
  const t = setup();
  t.fire('pointerdown', t.ev());
  const [fn] = t.timers.find(([, m]) => m === 10000);
  fn();
  assert.match(t.banners.at(-1), /launch window didn't respond/);
  t.fire('message', { source: t.win.popup, data: { type: 'ui-picker:ready' } });
  assert.equal(t.posted.length, 0);
});

test('a blocked popup shows the pop-up banner', () => {
  const t = setup();
  t.win.popup = null;
  t.fire('pointerdown', t.ev());
  assert.match(t.banners.at(-1), /allow pop-ups/);
});

test('Esc removes every listener', () => {
  const t = setup();
  t.fire('keydown', t.ev({ key: 'Escape' }));
  assert.equal(t.listeners.length, 0);
  assert.equal(t.win.__uiPickerActive, false);
});

test('the click after a pick is swallowed, then all listeners are released', () => {
  const t = setup();
  t.fire('pointerdown', t.ev());
  let stopped = 0;
  t.fire('click', t.ev({ stopPropagation: () => stopped++ }));
  assert.equal(stopped, 1);
  t.fire('pointerup', t.ev());
  t.timers.filter(([, m]) => m === 0).forEach(([f]) => f());
  assert.equal(t.listeners.filter(([type]) => type !== 'message').length, 0);
});
