const WRANGLER = __WRANGLER_ORIGIN__;
// A hash of this code, stamped by build-bookmarklet.js; the board compares it
// with the code it serves now and suggests re-dragging when they differ.
const BUILD = __POINT_AND_PROMPT_BUILD__;
if (window.__pointAndPromptActive) return;
window.__pointAndPromptActive = true;

const DRAG_PX = 4;
// The board boots (socket, graph, extension modules) before it can say ready.
const READY_MS = 30000;
const CLICK_PAD = 8;
// A live drag view slower than one frame skips the component outlines.
const LIVE_BUDGET_MS = 16;
// A board that predates protocol negotiation speaks protocol 1 only.
const LEGACY_PROTOCOLS = [1];
const STALE = 'Point & Prompt: a newer bookmarklet is available. Re-drag it from Settings → Extensions → Point & Prompt.';
const MISMATCH = "Point & Prompt: this bookmarklet doesn't match the Point & Prompt extension on your wrangler. Re-drag it from Settings → Extensions → Point & Prompt.";

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
  banner('Point & Prompt: sharing stopped — click an element (Esc to cancel)');
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

// The live drag view sits just under the selection rectangle.
const LIVE_CSS = 'position:fixed;pointer-events:none;z-index:2147483646;';
const OUTLINE_CSS = LIVE_CSS + 'outline:1px solid rgba(229,72,77,.45);background:rgba(229,72,77,.06)';
const FRAME_CSS = LIVE_CSS + 'outline:1px dashed rgba(229,72,77,.3)';
const TAG_CSS = LIVE_CSS + 'font:11px/1.4 system-ui;color:#fff;background:rgba(17,17,17,.75);padding:0 4px;border-radius:3px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

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
  removeEventListener('scroll', scrolled, true);
  dismiss(box);
  dismiss(sel);
  clearLive();
}

function release() {
  for (const t of SWALLOWED) removeEventListener(t, swallow, true);
  window.__pointAndPromptActive = false;
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
  if (press.dragging) {
    const r = dragRect(press, { x: e.clientX, y: e.clientY });
    place(sel, r);
    queueLive(r);
  }
}

function cancel() {
  if (!press) return;
  press = null;
  sel.remove();
  clearLive();
  box.style.display = '';
}

// Element boxes, measured once per drag: per frame, the live view is overlap
// maths, not thousands of layout reads. Scrolling moves everything, so it clears them.
let boxes = new Map();
function boxOf(el) {
  let b = boxes.get(el);
  if (!b) {
    const r = el.getBoundingClientRect();
    b = { x: r.x, y: r.y, width: r.width, height: r.height };
    boxes.set(el, b);
  }
  return b;
}
function scrolled() {
  boxes = new Map();
  if (press && press.dragging && liveRect) queueLive(liveRect);
}

// The live drag view: what a drag released now would list. It uses the pick's
// own scan, so the two agree. Its elements are pooled across frames.
let liveRect = null;
let liveQueued = false;
let frame = null; // the containing element's outline
const marks = []; // { outline, tag } per component, reused
function liveMark(css) {
  const el = overlay(css);
  document.documentElement.appendChild(el);
  return el;
}
const hide = (el) => { el.style.display = 'none'; };
function queueLive(r) {
  liveRect = r;
  if (liveQueued) return;
  liveQueued = true;
  requestAnimationFrame(drawLive);
}
function drawLive() {
  liveQueued = false;
  if (!press || !press.dragging || !liveRect) return;
  let drawn = 0;
  try {
    const start = performance.now();
    const viewport = { width: innerWidth, height: innerHeight };
    const container = elementAround(liveRect);
    const c = clipBox(boxOf(container), viewport);
    if (c) {
      frame = frame || liveMark(FRAME_CSS);
      place(frame, c);
      frame.style.display = '';
    } else if (frame) hide(frame);
    const { els, groups } = scanArea(container, liveRect);
    if (performance.now() - start <= LIVE_BUDGET_MS) {
      for (const { name, box: b } of highlightBoxes(groups, els.map(boxOf), viewport)) {
        const m = marks[drawn] || (marks[drawn] = { outline: liveMark(OUTLINE_CSS), tag: liveMark(TAG_CSS) });
        place(m.outline, b);
        Object.assign(m.tag.style, { left: b.x + 'px', top: Math.max(0, b.y - 16) + 'px', display: '' });
        m.tag.textContent = name;
        m.outline.style.display = '';
        drawn += 1;
      }
    }
  } catch {
    drawn = 0;
  }
  for (let i = drawn; i < marks.length; i += 1) { hide(marks[i].outline); hide(marks[i].tag); }
}
function clearLive() {
  for (const m of marks) { dismiss(m.outline); dismiss(m.tag); }
  marks.length = 0;
  if (frame) dismiss(frame);
  frame = null;
  liveRect = null;
  boxes = new Map();
}

// The smallest element containing the whole area, starting under its centre.
// Our overlays ignore the pointer, so elementFromPoint looks through them.
function elementAround(rect) {
  let start = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (overlays.has(start)) start = null;
  return containingElement(start, rect, boxOf, document.body);
}

// The components rendered inside a dragged area, outermost first, or [] when
// there are none or the page can't be read: the pick must go through regardless.
// Runs after stopPicking, before the grab; our own overlays are skipped anyway.
function componentsIn(container, rect) {
  try {
    return scanArea(container, rect).groups.map(({ name, at }) => ({ name, at }));
  } catch {
    return [];
  }
}

// The container's descendants (ours excluded) and the components inside rect,
// each with the indices of the elements folded into it.
function scanArea(container, rect) {
  const els = descendants(container, PICK_CONTAINS_SCAN).filter((e) => !overlays.has(e));
  const groups = componentGroupsInside(els.map((e) => ({ fiber: ownFiber(e), box: boxOf(e) })), fiberOf(container), rect, PICK_MAX_CONTAINS);
  return { els, groups };
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
    banner('Point & Prompt: screenshot failed — paste one instead');
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
  // With the drag's measured boxes, as the live view had them; stopPicking clears them.
  const inside = dragging ? componentsIn(el, rect) : null;
  press = null;
  stopPicking();
  // The click follows pointerup in the same burst of events, so drop the
  // swallowers on the next tick (after it); a disabled control gets no click.
  setTimeout(release, 0);
  // Read the page now; the payload is built once the board has chosen a protocol.
  const raw = capturePick(el, { url: location.href, rect, dpr: devicePixelRatio, build: BUILD, drag: dragging });
  if (inside) raw.contains = inside;
  // Open the popup before any await, while the press still counts as activation.
  // A fresh window name per pick: a reused name would keep the first tab as opener.
  const name = 'point-and-prompt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const popup = window.open(WRANGLER + '/?point-and-prompt=1', name, 'width=560,height=760');
  if (!popup) { stopSharing(); banner('Point & Prompt: allow pop-ups for this site and try again.'); return; }

  // Post once the popup is ready and the screenshot (if any) is settled.
  // Nothing to capture in an empty area (a straight-line drag, an off-screen target).
  if (rect.width < 1 || rect.height < 1) stopSharing();
  let ready = false;
  let shotDone = !stream;
  let sent = false;
  let protocol = null; // agreed with the board in its ready
  let boardBuild = null; // the build the board hands out now, if it said
  const send = () => {
    if (sent || !ready || !shotDone) return;
    sent = true;
    popup.postMessage(buildPayload(raw, protocol), WRANGLER);
    // After the grab, so the banner is never in the screenshot.
    if (boardBuild && boardBuild !== BUILD) banner(STALE, 8000);
  };
  if (stream) {
    grab(rect).then((png) => {
      if (shotDone || sent) return;
      if (png) raw.screenshot = png;
      shotDone = true;
      send();
    });
  }
  const onReady = (m) => {
    if (m.source !== popup || !m.data || m.data.type !== 'point-and-prompt:ready') return;
    ready = true;
    removeEventListener('message', onReady);
    const theirs = Array.isArray(m.data.protocols) ? m.data.protocols : LEGACY_PROTOCOLS;
    protocol = chooseProtocol(PICK_PROTOCOLS, theirs);
    if (protocol === null) {
      // Nothing the board would accept: send nothing and close the popup we opened.
      sent = true;
      stopSharing();
      popup.close();
      dismissBanners();
      banner(MISMATCH, 10000);
      return;
    }
    if (typeof m.data.build === 'string') boardBuild = m.data.build;
    send();
  };
  addEventListener('message', onReady);
  setTimeout(() => {
    stopSharing();
    if (!ready) {
      removeEventListener('message', onReady);
      banner("Point & Prompt: the wrangler board didn't respond within 30s. Is the Point & Prompt extension enabled there (needs host API 1.36.0+)?", 8000);
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
  addEventListener('scroll', scrolled, true);
  for (const t of SWALLOWED) addEventListener(t, swallow, true);
  banner(text);
}

// Picking waits for the share prompt; Esc works throughout.
addEventListener('keydown', key, true);
const asking = banner('Point & Prompt: share this tab to attach a screenshot (or Cancel to pick without one)', 0);
shared.then((s) => {
  if (ended) { stopTracks(s); return; }
  dismiss(asking);
  const track = s.getVideoTracks()[0];
  // The prompt also offers other tabs, windows and screens; only this tab will do.
  if (!track || track.getSettings().displaySurface !== 'browser') {
    stopTracks(s);
    arm('Point & Prompt: only this tab can be captured — click an element (Esc to cancel)');
    return;
  }
  stream = s;
  track.addEventListener('ended', sharingEnded);
  arm('Point & Prompt: click an element, or drag to capture an area (Esc to cancel)');
}, () => {
  if (ended) return;
  dismiss(asking);
  arm('Point & Prompt: click an element (Esc to cancel)');
});
