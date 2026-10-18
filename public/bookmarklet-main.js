const WRANGLER = __WRANGLER_ORIGIN__;
// A hash of this code, stamped by build-bookmarklet.js; the board compares it
// with the code it serves now and suggests re-dragging when they differ.
const BUILD = __UI_PICKER_BUILD__;
if (window.__uiPickerActive) return;
window.__uiPickerActive = true;

const DRAG_PX = 4;
// The board boots (socket, graph, extension modules) before it can say ready.
const READY_MS = 30000;
const CLICK_PAD = 8;
// A board that predates protocol negotiation speaks protocol 1 only.
const LEGACY_PROTOCOLS = [1];
const STALE = 'UI Picker: a newer bookmarklet is available. Re-drag it from Settings → Extensions → UI Picker.';
const MISMATCH = "UI Picker: this bookmarklet doesn't match the UI Picker on your wrangler. Re-drag it from Settings → Extensions → UI Picker.";

// Ask to share this tab right away, synchronously: running the bookmarklet is
// the user activation getDisplayMedia needs. Transient activation is time-based
// (~5s in Chrome), so it can't be relied on once the user has answered the
// prompt; the popup instead opens synchronously in pointerup, off the
// activation the pick's pointerdown gives.
let shared;
try {
  shared = navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
} catch (err) {
  shared = Promise.reject(err);
}

let stream = null; // set while this tab is being shared
let ended = false;
let press = null; // { x, y, target, dragging } between pointerdown and pointerup

function stopTracks(s) { for (const t of s.getTracks()) t.stop(); }

function stopSharing() {
  if (!stream) return;
  stream.getVideoTracks()[0].removeEventListener('ended', sharingEnded);
  stopTracks(stream);
  stream = null;
}

// The user stopped sharing from Chrome's bar: carry on without a screenshot.
function sharingEnded() {
  stopSharing();
  if (ended) return;
  dismissBanners();
  banner('UI Picker: sharing stopped — click an element (Esc to cancel)');
}

// Everything we draw on the page, so it can all go before a frame is grabbed.
const overlays = new Set();
function overlay(cssText) {
  const el = document.createElement('div');
  el.style.cssText = cssText;
  overlays.add(el);
  return el;
}
function dismiss(el) { el.remove(); overlays.delete(el); banners.delete(el); }
function removeOverlays() { for (const el of [...overlays]) dismiss(el); }
const banners = new Set();
function dismissBanners() { for (const b of [...banners]) dismiss(b); }

const box = overlay('position:fixed;pointer-events:none;outline:2px solid #e5484d;background:rgba(229,72,77,.12);z-index:2147483647;transition:all 40ms');
const sel = overlay('position:fixed;pointer-events:none;outline:2px dashed #e5484d;background:rgba(229,72,77,.12);z-index:2147483647');

// ms = 0 keeps the banner until it is dismissed.
function banner(text, ms = 4000) {
  const b = overlay('pointer-events:none;position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 14px;background:#111;color:#fff;font:13px system-ui;border-radius:6px;z-index:2147483647');
  b.textContent = text;
  banners.add(b);
  document.documentElement.appendChild(b);
  if (ms) setTimeout(() => dismiss(b), ms);
  return b;
}

// The app must not see the press that picks an element, nor the click and
// double-click that follow it. These stay until the press is released.
// A drag must not select text or start the page's drag and drop either.
function swallow(e) { e.preventDefault(); e.stopPropagation(); }
const SWALLOWED = ['pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'selectstart', 'dragstart'];

// Stop picking (hover, press, drag, pick, Esc), leaving the swallowers in place.
function stopPicking() {
  ended = true;
  removeEventListener('mousemove', move, true);
  removeEventListener('pointerdown', down, true);
  removeEventListener('pointermove', drag, true);
  removeEventListener('pointerup', up, true);
  removeEventListener('pointercancel', cancel, true);
  removeEventListener('keydown', key, true);
  dismiss(box);
  dismiss(sel);
}

function release() {
  for (const t of SWALLOWED) removeEventListener(t, swallow, true);
  window.__uiPickerActive = false;
}

const place = (el, r) => Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });

function move(e) {
  if (press && press.dragging) return;
  place(box, e.target.getBoundingClientRect());
}

function key(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  stopPicking();
  release();
  removeOverlays();
  stopSharing();
}

function down(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  press = { x: e.clientX, y: e.clientY, target: e.target, dragging: false };
}

function drag(e) {
  if (!press) return;
  // Dragging captures an area, so it is only offered while sharing.
  if (!press.dragging && stream && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
    press.dragging = true;
    box.style.display = 'none';
    document.documentElement.appendChild(sel);
  }
  if (press.dragging) place(sel, dragRect(press, { x: e.clientX, y: e.clientY }));
}

function cancel() {
  if (!press) return;
  press = null;
  sel.remove();
  box.style.display = '';
}

// The smallest element containing the whole area, starting under its centre.
// Our overlays ignore the pointer, so elementFromPoint looks through them.
function elementAround(rect) {
  let start = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (overlays.has(start)) start = null;
  return containingElement(start, rect, (el) => el.getBoundingClientRect(), document.body);
}

const nextFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// One frame of the shared tab cropped to rect (CSS px), as a PNG data URL, or
// null. Sharing stops as soon as the frame is in hand, or on any failure.
async function grab(rect) {
  try {
    const track = stream.getVideoTracks()[0];
    removeOverlays();
    await nextFrames();
    const bitmap = await new ImageCapture(track).grabFrame();
    stopSharing();
    // A frame of another shape is not this viewport (another tab, or rescaled).
    if (Math.abs(bitmap.width / bitmap.height - innerWidth / innerHeight) > 0.02) throw new Error('frame does not match the viewport');
    // Measured now, not at load: Chrome's sharing bar shrinks the viewport.
    const scale = bitmap.width / innerWidth;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rect.width * scale));
    c.height = Math.max(1, Math.round(rect.height * scale));
    c.getContext('2d').drawImage(bitmap, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, 0, 0, c.width, c.height);
    if (bitmap.close) bitmap.close();
    const png = c.toDataURL('image/png');
    if (!shotFits(png)) throw new Error('screenshot too large');
    return png;
  } catch {
    banner('UI Picker: screenshot failed — paste one instead');
    return null;
  } finally {
    stopSharing();
  }
}

function up(e) {
  if (!press || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const { target, dragging } = press;
  const viewport = { width: innerWidth, height: innerHeight };
  const rect = dragging
    ? padRect(dragRect(press, { x: e.clientX, y: e.clientY }), 0, viewport)
    : padRect(target.getBoundingClientRect(), CLICK_PAD, viewport);
  const el = dragging ? elementAround(rect) : target;
  press = null;
  stopPicking();
  // The click follows pointerup in the same burst of events, so drop the
  // swallowers on the next tick (after it); a disabled control gets no click.
  setTimeout(release, 0);
  const payload = buildPayload(el, { url: location.href, rect, dpr: devicePixelRatio, build: BUILD });
  // Open the popup before any await, while the press still counts as activation.
  // A fresh window name per pick: a reused name would keep the first tab as opener.
  const name = 'ui-picker-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const popup = window.open(WRANGLER + '/?ui-picker=1', name, 'width=560,height=760');
  if (!popup) { stopSharing(); banner('UI Picker: allow pop-ups for this site and try again.'); return; }

  // Post once the popup is ready and the screenshot (if any) is settled.
  // Nothing to capture in an empty area (a straight-line drag, an off-screen target).
  if (rect.width < 1 || rect.height < 1) stopSharing();
  let ready = false;
  let shotDone = !stream;
  let sent = false;
  let boardBuild = null; // the build the board hands out now, if it said
  const send = () => {
    if (sent || !ready || !shotDone) return;
    sent = true;
    popup.postMessage(payload, WRANGLER);
    // After the grab, so the banner is never in the screenshot.
    if (boardBuild && boardBuild !== BUILD) banner(STALE, 8000);
  };
  if (stream) {
    grab(rect).then((png) => {
      if (shotDone || sent) return;
      if (png) payload.screenshot = png;
      shotDone = true;
      send();
    });
  }
  const onReady = (m) => {
    if (m.source !== popup || !m.data || m.data.type !== 'ui-picker:ready') return;
    ready = true;
    removeEventListener('message', onReady);
    const theirs = Array.isArray(m.data.protocols) ? m.data.protocols : LEGACY_PROTOCOLS;
    const protocol = chooseProtocol(PICK_PROTOCOLS, theirs);
    if (protocol === null) {
      // Nothing the board would accept: send nothing and close the popup we opened.
      sent = true;
      stopSharing();
      popup.close();
      dismissBanners();
      banner(MISMATCH, 10000);
      return;
    }
    payload.protocol = protocol;
    if (typeof m.data.build === 'string') boardBuild = m.data.build;
    send();
  };
  addEventListener('message', onReady);
  setTimeout(() => {
    stopSharing();
    if (!ready) {
      removeEventListener('message', onReady);
      banner("UI Picker: the wrangler board didn't respond within 30s. Is the UI Picker extension enabled there (needs host API 1.36.0+)?", 8000);
      return;
    }
    // Ready, but the grab never finished: send the pick without it.
    shotDone = true;
    send();
  }, READY_MS);
}

function arm(text) {
  document.documentElement.appendChild(box);
  addEventListener('mousemove', move, true);
  addEventListener('pointerdown', down, true);
  addEventListener('pointermove', drag, true);
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', cancel, true);
  for (const t of SWALLOWED) addEventListener(t, swallow, true);
  banner(text);
}

// Picking waits for the share prompt; Esc works throughout.
addEventListener('keydown', key, true);
const asking = banner('UI Picker: share this tab to attach a screenshot (or Cancel to pick without one)', 0);
shared.then((s) => {
  if (ended) { stopTracks(s); return; }
  dismiss(asking);
  const track = s.getVideoTracks()[0];
  // The prompt also offers other tabs, windows and screens; only this tab will do.
  if (!track || track.getSettings().displaySurface !== 'browser') {
    stopTracks(s);
    arm('UI Picker: only this tab can be captured — click an element (Esc to cancel)');
    return;
  }
  stream = s;
  track.addEventListener('ended', sharingEnded);
  arm('UI Picker: click an element, or drag to capture an area (Esc to cancel)');
}, () => {
  if (ended) return;
  dismiss(asking);
  arm('UI Picker: click an element (Esc to cancel)');
});
