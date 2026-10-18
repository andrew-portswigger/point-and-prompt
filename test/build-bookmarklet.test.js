import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBookmarklet, buildId } from '../public/build-bookmarklet.js';
import { PICK_MAX_HTML, PICK_MAX_OWNERS, PICK_MAX_CLASSES, PICK_MAX_SHOT_BYTES, PICK_PROTOCOL } from '../public/pick-core.js';
import { MAX_HTML, MAX_OWNERS, MAX_CLASSES, MAX_SHOT_BYTES, PROTOCOL, SUPPORTED_PROTOCOLS } from '../public/defaults.js';

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
  assert.equal(PICK_MAX_SHOT_BYTES, MAX_SHOT_BYTES);
  assert.equal(PICK_PROTOCOL, PROTOCOL);
  assert.ok(SUPPORTED_PROTOCOLS.includes(PROTOCOL), 'the board accepts what the current bookmarklet speaks');
});

test('origin is inserted literally, without $ replacement patterns', () => {
  const url = buildBookmarklet('', 'const W = __WRANGLER_ORIGIN__;', 'http://h/$&$1');
  assert.equal(decodeURIComponent(url.slice('javascript:'.length)).includes('"http://h/$&$1"'), true);
});

test('buildId is an 8-hex-digit hash of the two sources', () => {
  assert.match(buildId('a', 'b'), /^[0-9a-f]{8}$/);
  assert.equal(buildId('a', 'b'), buildId('a', 'b'));
  assert.notEqual(buildId('a', 'b'), buildId('a', 'c'));
});

test('the bookmarklet carries the build id of its sources, whatever the origin', () => {
  const core = read('pick-core.js');
  const main = read('bookmarklet-main.js');
  const id = buildId(core, main);
  for (const origin of ['http://localhost:7777', 'https://wrangler.example:8443']) {
    const src = decodeURIComponent(buildBookmarklet(core, main, origin).slice('javascript:'.length));
    assert.doesNotMatch(src, /__UI_PICKER_BUILD__/);
    assert.ok(src.includes(JSON.stringify(id)), origin);
  }
  const changed = buildBookmarklet(core, main + '\n// edited', 'http://localhost:7777');
  assert.ok(!decodeURIComponent(changed).includes(JSON.stringify(id)), 'a different source gets a different id');
});

// Smoke test of the real bookmarklet against minimal fakes. Browser globals
// (navigator, ImageCapture, requestAnimationFrame, innerWidth/innerHeight) are
// injected through the Function's parameter list.
const ORIGIN = 'http://localhost:7777';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const flush = () => new Promise((r) => setImmediate(r));

function fakeEl(tag, rect, parentElement = null) {
  return {
    tagName: tag, id: '', className: 'x', textContent: tag, outerHTML: `<${tag}></${tag}>`, parentElement,
    getBoundingClientRect: () => ({ ...rect, left: rect.x, top: rect.y }),
  };
}

// capture: 'reject' (user cancelled), 'resolve' (sharing), 'pending' (prompt still open).
async function setup({ capture = 'reject', png = PNG, grab = 'ok', surface = 'browser', frame = { width: 2000, height: 1600 } } = {}) {
  const listeners = [];
  const timers = [];
  const opened = [];
  const posted = [];
  const banners = [];
  const live = new Set();
  const drawn = [];
  const track = {
    stopped: 0,
    stop() { this.stopped++; },
    getSettings: () => ({ displaySurface: surface }),
    on: {},
    addEventListener(type, f) { this.on[type] = f; },
    removeEventListener(type, f) { if (this.on[type] === f) delete this.on[type]; },
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const gdmCalls = [];
  let settle;
  const navigator = {
    mediaDevices: {
      getDisplayMedia(opts) {
        gdmCalls.push(opts);
        if (capture === 'resolve') return Promise.resolve(stream);
        if (capture === 'pending') return new Promise((res) => { settle = () => res(stream); });
        return Promise.reject(new Error('NotAllowedError'));
      },
    },
  };
  class ImageCapture {
    constructor(t) { assert.equal(t, track); }
    grabFrame() {
      if (grab === 'throw') return Promise.reject(new Error('InvalidStateError'));
      return Promise.resolve({ ...frame, close() {} });
    }
  }
  const win = { __uiPickerActive: false, popup: {}, open(...a) { opened.push(a); return win.popup; } };
  win.popup = { postMessage: (...a) => posted.push(a) };
  const mk = (tag) => {
    if (tag === 'canvas') {
      return { getContext: () => ({ drawImage: (...a) => drawn.push(a) }), toDataURL: (type) => (type === 'image/png' ? png : '') };
    }
    const el = {
      style: { cssText: '' },
      set textContent(v) { banners.push(v); },
      remove() { live.delete(el); },
    };
    return el;
  };
  const parent = fakeEl('SECTION', { x: 0, y: 0, width: 600, height: 400 });
  const target = fakeEl('BUTTON', { x: 100, y: 100, width: 50, height: 20 }, parent);
  const other = fakeEl('SPAN', { x: 200, y: 100, width: 50, height: 20 }, parent);
  const body = fakeEl('BODY', { x: 0, y: 0, width: 1000, height: 800 });
  parent.parentElement = body;
  let underPoint = other;
  const document = {
    createElement: mk,
    body,
    documentElement: { appendChild(el) { live.add(el); }, append(...els) { els.forEach((el) => live.add(el)); } },
    elementFromPoint: (x, y) => { document.lastPoint = [x, y]; return underPoint; },
  };
  const addEventListener = (t, f) => listeners.push([t, f]);
  const removeEventListener = (t, f) => {
    const i = listeners.findIndex(([lt, lf]) => lt === t && lf === f);
    if (i >= 0) listeners.splice(i, 1);
  };
  const setTimeout = (f, ms) => timers.push([f, ms]);
  const requestAnimationFrame = (f) => queueMicrotask(f);
  const src = decodeURIComponent(buildBookmarklet(read('pick-core.js'), read('bookmarklet-main.js'), ORIGIN).slice('javascript:'.length));
  new Function('window', 'document', 'addEventListener', 'removeEventListener', 'location', 'devicePixelRatio', 'setTimeout',
    'navigator', 'ImageCapture', 'requestAnimationFrame', 'innerWidth', 'innerHeight', src)(
    win, document, addEventListener, removeEventListener, { href: 'http://app/' }, 2, setTimeout,
    navigator, ImageCapture, requestAnimationFrame, 1000, 800);
  if (capture !== 'pending') await flush();
  const fire = (type, ev) => [...listeners].filter(([t]) => t === type).forEach(([, f]) => f(ev));
  const ev = (o = {}) => ({ target, button: 0, clientX: 110, clientY: 105, preventDefault() {}, stopPropagation() {}, ...o });
  const click = (o = {}) => { fire('pointerdown', ev(o)); fire('pointerup', ev(o)); };
  win.popup.closed = 0;
  win.popup.close = () => { win.popup.closed += 1; };
  // protocols: the list the board advertises, or undefined for a ready without the field.
  const ready = (protocols = [1], build) => fire('message', { source: win.popup, data: { type: 'ui-picker:ready', ...(protocols ? { protocols } : {}), ...(build ? { build } : {}) } });
  return {
    win, listeners, timers, opened, posted, banners, live, drawn, track, gdmCalls, document, target, parent, body,
    fire, ev, click, ready, settle: async () => { settle(); await flush(); }, setUnderPoint: (el) => { underPoint = el; },
  };
}

test('asks to share the current tab as soon as it runs, before picking is armed', async () => {
  const t = await setup({ capture: 'pending' });
  assert.equal(t.gdmCalls.length, 1);
  assert.deepEqual(t.gdmCalls[0], { video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
  assert.match(t.banners.at(-1), /share this tab to attach a screenshot \(or Cancel to pick without one\)/);
  t.click();
  assert.equal(t.opened.length, 0);
  await t.settle();
  assert.match(t.banners.at(-1), /click an element, or drag to capture an area \(Esc to cancel\)/);
  t.click();
  assert.equal(t.opened.length, 1);
});

test('a cancelled share arms plain picking', async () => {
  const t = await setup();
  assert.equal(t.banners.at(-1), 'UI Picker: click an element (Esc to cancel)');
});

test('a missing getDisplayMedia arms plain picking', async () => {
  const listeners = [];
  const src = decodeURIComponent(buildBookmarklet(read('pick-core.js'), read('bookmarklet-main.js'), ORIGIN).slice('javascript:'.length));
  const banners = [];
  const document = { createElement: () => ({ style: {}, set textContent(v) { banners.push(v); }, remove() {} }), documentElement: { appendChild() {} } };
  new Function('window', 'document', 'addEventListener', 'removeEventListener', 'setTimeout', 'navigator', src)(
    {}, document, (t, f) => listeners.push([t, f]), () => {}, () => {}, {});
  await flush();
  assert.equal(banners.at(-1), 'UI Picker: click an element (Esc to cancel)');
  assert.ok(listeners.some(([t]) => t === 'pointerdown'));
});

test('pointerup opens the board in a uniquely named popup at the exact picker URL', async () => {
  const a = await setup();
  a.fire('pointerdown', a.ev());
  assert.equal(a.opened.length, 0, 'not on pointerdown: a drag may follow');
  a.fire('pointerup', a.ev());
  const b = await setup();
  b.click();
  assert.equal(a.opened[0][0], `${ORIGIN}/?ui-picker=1`);
  assert.match(a.opened[0][1], /^ui-picker-[a-z0-9]+$/);
  assert.notEqual(a.opened[0][1], b.opened[0][1]);
});

test('non-primary buttons do not pick', async () => {
  const t = await setup();
  t.click({ button: 2 });
  assert.equal(t.opened.length, 0);
});

test('ready from another source is ignored; ready from the popup posts to the origin', async () => {
  const t = await setup();
  t.click();
  t.fire('message', { source: {}, data: { type: 'ui-picker:ready' } });
  assert.equal(t.posted.length, 0);
  t.ready();
  assert.equal(t.posted.length, 1);
  assert.equal(t.posted[0][1], ORIGIN);
  assert.equal(t.posted[0][0].build, buildId(read('pick-core.js'), read('bookmarklet-main.js')));
  assert.equal(t.posted[0][0].type, 'ui-picker:pick');
  assert.equal(t.posted[0][0].element.tag, 'button');
  assert.equal('screenshot' in t.posted[0][0], false);
});

test('a board advertising [1] gets the pick as protocol 1', async () => {
  const t = await setup();
  t.click();
  t.ready([1]);
  assert.equal(t.posted.length, 1);
  assert.equal(t.posted[0][0].protocol, 1);
});

test('a ready without protocols is treated as [1]', async () => {
  const t = await setup();
  t.click();
  t.ready(null);
  assert.equal(t.posted.length, 1);
  assert.equal(t.posted[0][0].protocol, 1);
});

test('a board speaking no common protocol gets no pick: mismatch banner, sharing stops, popup closes', async () => {
  const t = await setup({ capture: 'resolve' });
  t.click();
  t.ready([2]);
  await flush();
  assert.equal(t.posted.length, 0);
  assert.equal(t.banners.at(-1), "UI Picker: this bookmarklet doesn't match the UI Picker on your wrangler. Re-drag it from Settings → Extensions → UI Picker.");
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.track.on.ended, undefined);
  assert.equal(t.win.popup.closed, 1, 'the popup the bookmarklet opened is closed');
  assert.equal(t.listeners.some(([type]) => type === 'message'), false);
  t.timers.find(([, m]) => m === 30000)[0]();
  await flush();
  assert.equal(t.posted.length, 0);
  assert.equal(t.banners.some((b) => /didn't respond/.test(b)), false);
});

const STALE = 'UI Picker: a newer bookmarklet is available. Re-drag it from Settings → Extensions → UI Picker.';
const OWN_BUILD = buildId(read('pick-core.js'), read('bookmarklet-main.js'));

test('a board on a newer build gets the pick, then the page suggests re-dragging for 8s', async () => {
  const t = await setup();
  t.click();
  t.ready([1], 'deadbeef');
  assert.equal(t.posted.length, 1);
  assert.equal(t.banners.at(-1), STALE);
  assert.ok(t.timers.some(([, ms]) => ms === 8000));
});

test('no stale banner when the board is on the same build', async () => {
  const t = await setup();
  t.click();
  t.ready([1], OWN_BUILD);
  assert.equal(t.posted.length, 1);
  assert.equal(t.banners.includes(STALE), false);
});

test('no stale banner when the board sends no build', async () => {
  const t = await setup();
  t.click();
  t.ready([1]);
  assert.equal(t.posted.length, 1);
  assert.equal(t.banners.includes(STALE), false);
});

test('with capture, the stale banner waits for the pick to be sent', async () => {
  const t = await setup({ capture: 'resolve' });
  t.click();
  t.ready([1], 'deadbeef');
  assert.equal(t.banners.includes(STALE), false, 'not before the grab: it would be in the screenshot');
  await flush();
  assert.equal(t.posted.length, 1);
  assert.equal(t.banners.at(-1), STALE);
});

test('no ready within 30s removes the listener and shows a banner', async () => {
  const t = await setup();
  t.click();
  const [fn] = t.timers.find(([, m]) => m === 30000);
  fn();
  assert.match(t.banners.at(-1), /board didn't respond within 30s/);
  t.ready();
  assert.equal(t.posted.length, 0);
});

test('a blocked popup shows the pop-up banner', async () => {
  const t = await setup();
  t.win.popup = null;
  t.click();
  assert.match(t.banners.at(-1), /allow pop-ups/);
});

test('Esc removes every listener', async () => {
  const t = await setup();
  t.fire('keydown', t.ev({ key: 'Escape' }));
  assert.equal(t.listeners.length, 0);
  assert.equal(t.win.__uiPickerActive, false);
});

test('the click after a pick is swallowed, then all listeners are released', async () => {
  const t = await setup();
  t.click();
  let stopped = 0;
  t.fire('click', t.ev({ stopPropagation: () => stopped++ }));
  assert.equal(stopped, 1);
  t.timers.filter(([, m]) => m === 0).forEach(([f]) => f());
  assert.equal(t.listeners.filter(([type]) => type !== 'message').length, 0);
  assert.equal(t.win.__uiPickerActive, false);
});

test('with capture, a click sends the padded element area as a screenshot and stops sharing', async () => {
  const t = await setup({ capture: 'resolve' });
  t.click();
  assert.equal(t.opened.length, 1, 'the popup opens before any await');
  t.ready();
  await flush();
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.live.size, 0, 'overlays and banners are gone before the grab');
  // Element 100,100 50x20 padded by 8 -> 92,92 66x36; frame is 2000 wide for 1000 CSS px.
  assert.deepEqual(t.drawn[0].slice(1), [184, 184, 132, 72, 0, 0, 132, 72]);
  assert.equal(t.posted.length, 1);
  const pick = t.posted[0][0];
  assert.equal(pick.screenshot, PNG);
  assert.equal(pick.element.tag, 'button');
  assert.deepEqual({ ...pick.rect, dpr: undefined }, { x: 92, y: 92, width: 66, height: 36, dpr: undefined });
});

test('with capture, the pick waits for the grab even when the popup is ready first', async () => {
  const t = await setup({ capture: 'resolve' });
  t.click();
  t.ready();
  assert.equal(t.posted.length, 0);
  await flush();
  assert.equal(t.posted.length, 1);
});

test('a drag past 4px picks the smallest element containing the area', async () => {
  const t = await setup({ capture: 'resolve' });
  t.fire('pointerdown', t.ev({ clientX: 90, clientY: 90 }));
  t.fire('pointermove', t.ev({ clientX: 92, clientY: 92 }));
  assert.equal(t.opened.length, 0);
  t.fire('pointermove', t.ev({ clientX: 260, clientY: 125 }));
  t.fire('pointerup', t.ev({ clientX: 260, clientY: 125 }));
  t.ready();
  await flush();
  assert.deepEqual(t.document.lastPoint, [175, 107.5]);
  const pick = t.posted[0][0];
  assert.equal(pick.element.tag, 'section', 'the span under the centre does not contain the area; its parent does');
  assert.deepEqual({ ...pick.rect, dpr: undefined }, { x: 90, y: 90, width: 170, height: 35, dpr: undefined });
  assert.deepEqual(t.drawn[0].slice(1, 5), [180, 180, 340, 70]);
  assert.equal(pick.screenshot, PNG);
});

test('a drag with nothing containing it falls back to the body', async () => {
  const t = await setup({ capture: 'resolve' });
  t.setUnderPoint(null);
  t.fire('pointerdown', t.ev({ clientX: 10, clientY: 10 }));
  t.fire('pointermove', t.ev({ clientX: 100, clientY: 100 }));
  t.fire('pointerup', t.ev({ clientX: 100, clientY: 100 }));
  t.ready();
  await flush();
  assert.equal(t.posted[0][0].element.tag, 'body');
});

test('movement of 4px or less is still a click on the pressed element', async () => {
  const t = await setup();
  t.fire('pointerdown', t.ev());
  t.fire('pointermove', t.ev({ clientX: 113, clientY: 105 }));
  t.fire('pointerup', t.ev({ clientX: 113, clientY: 105 }));
  t.ready();
  assert.equal(t.posted[0][0].element.tag, 'button');
});

test('a failed grab picks without a screenshot and says so', async () => {
  const t = await setup({ capture: 'resolve', grab: 'throw' });
  t.click();
  t.ready();
  await flush();
  assert.equal(t.posted.length, 1);
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.match(t.banners.at(-1), /screenshot failed — paste one instead/);
  assert.equal(t.track.stopped > 0, true);
});

test('an oversized screenshot is dropped', async () => {
  const t = await setup({ capture: 'resolve', png: 'data:image/png;base64,' + 'A'.repeat(15 * 1024 * 1024) });
  t.click();
  t.ready();
  await flush();
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.match(t.banners.at(-1), /screenshot failed/);
});

test('Esc stops sharing', async () => {
  const t = await setup({ capture: 'resolve' });
  t.fire('keydown', t.ev({ key: 'Escape' }));
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.listeners.length, 0);
});

test('Esc while the share prompt is open stops the stream once it arrives, without arming', async () => {
  const t = await setup({ capture: 'pending' });
  t.fire('keydown', t.ev({ key: 'Escape' }));
  assert.equal(t.live.size, 0, 'the share banner is gone');
  await t.settle();
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.listeners.length, 0);
});

test('a blocked popup stops sharing', async () => {
  const t = await setup({ capture: 'resolve' });
  t.win.popup = null;
  t.click();
  assert.equal(t.track.stopped > 0, true);
});

test('the 30s timeout stops sharing even if the grab has not finished', async () => {
  const t = await setup({ capture: 'resolve' });
  t.click();
  const [fn] = t.timers.find(([, m]) => m === 30000);
  fn();
  assert.equal(t.track.stopped > 0, true);
  await flush();
  t.ready();
  assert.equal(t.posted.length, 0);
});

test('a drag cannot select text or start the page drag and drop', async () => {
  const t = await setup();
  for (const type of ['selectstart', 'dragstart']) {
    let prevented = 0;
    t.fire(type, t.ev({ preventDefault: () => prevented++ }));
    assert.equal(prevented, 1, type);
  }
});

test('without capture there is no drag: a long move still clicks the pressed element', async () => {
  const t = await setup();
  t.fire('pointerdown', t.ev());
  t.fire('pointermove', t.ev({ clientX: 300, clientY: 300 }));
  t.fire('pointerup', t.ev({ clientX: 300, clientY: 300 }));
  t.ready();
  assert.equal(t.posted[0][0].element.tag, 'button');
});

test('sharing another surface is refused: tracks stop and picking is click-only', async () => {
  const t = await setup({ capture: 'resolve', surface: 'window' });
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.banners.at(-1), 'UI Picker: only this tab can be captured — click an element (Esc to cancel)');
  t.click();
  t.ready();
  assert.equal(t.posted.length, 1);
  assert.equal('screenshot' in t.posted[0][0], false);
});

test('a frame whose shape does not match the viewport is dropped', async () => {
  const t = await setup({ capture: 'resolve', frame: { width: 2000, height: 1000 } });
  t.click();
  t.ready();
  await flush();
  assert.equal(t.posted.length, 1);
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.match(t.banners.at(-1), /screenshot failed — paste one instead/);
});

test('sharing stopped from the browser bar: pick without a screenshot and no drag', async () => {
  const t = await setup({ capture: 'resolve' });
  t.track.on.ended();
  assert.equal(t.banners.at(-1), 'UI Picker: sharing stopped — click an element (Esc to cancel)');
  assert.equal(t.track.on.ended, undefined, 'the ended listener is removed');
  t.fire('pointerdown', t.ev());
  t.fire('pointermove', t.ev({ clientX: 300, clientY: 300 }));
  t.fire('pointerup', t.ev({ clientX: 300, clientY: 300 }));
  t.ready();
  assert.equal(t.posted.length, 1);
  assert.equal(t.posted[0][0].element.tag, 'button');
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.equal(t.drawn.length, 0);
});

for (const [label, exit] of [
  ['Esc', (t) => t.fire('keydown', t.ev({ key: 'Escape' }))],
  ['a pick', (t) => { t.click(); t.ready(); }],
  ['a blocked popup', (t) => { t.win.popup = null; t.click(); }],
]) {
  test(`the ended listener is removed after ${label}`, async () => {
    const t = await setup({ capture: 'resolve' });
    assert.equal(typeof t.track.on.ended, 'function');
    exit(t);
    await flush();
    assert.equal(t.track.on.ended, undefined);
  });
}

test('a straight-line drag picks without a screenshot or a failure banner', async () => {
  const t = await setup({ capture: 'resolve' });
  t.fire('pointerdown', t.ev({ clientX: 90, clientY: 105 }));
  t.fire('pointermove', t.ev({ clientX: 200, clientY: 105 }));
  t.fire('pointerup', t.ev({ clientX: 200, clientY: 105 }));
  t.ready();
  await flush();
  assert.equal(t.posted.length, 1);
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.equal(t.drawn.length, 0);
  assert.equal(t.track.stopped > 0, true);
  assert.equal(t.banners.some((b) => /screenshot failed/.test(b)), false);
});

test('an off-screen target picks without a screenshot', async () => {
  const t = await setup({ capture: 'resolve' });
  const off = { ...t.target, getBoundingClientRect: () => ({ x: 100, y: 2000, width: 50, height: 20, left: 100, top: 2000 }) };
  t.click({ target: off });
  t.ready();
  await flush();
  assert.equal(t.posted.length, 1);
  assert.equal('screenshot' in t.posted[0][0], false);
  assert.equal(t.banners.some((b) => /screenshot failed/.test(b)), false);
});
