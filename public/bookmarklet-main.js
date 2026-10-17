const WRANGLER = __WRANGLER_ORIGIN__;
if (window.__uiPickerActive) return;
window.__uiPickerActive = true;

const box = document.createElement('div');
box.style.cssText = 'position:fixed;pointer-events:none;outline:2px solid #e5484d;background:rgba(229,72,77,.12);z-index:2147483647;transition:all 40ms';
document.documentElement.appendChild(box);

function banner(text) {
  const b = document.createElement('div');
  b.textContent = text;
  b.style.cssText = 'pointer-events:none;position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 14px;background:#111;color:#fff;font:13px system-ui;border-radius:6px;z-index:2147483647';
  document.documentElement.appendChild(b);
  setTimeout(() => b.remove(), 4000);
}

// The app must not see the press that picks an element, nor the click and
// double-click that follow it. These stay until the press is released.
function swallow(e) { e.preventDefault(); e.stopPropagation(); }
const SWALLOWED = ['pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick'];

// Stop picking (hover, pick, Esc), leaving the swallowers in place.
function stopPicking() {
  removeEventListener('mousemove', move, true);
  removeEventListener('pointerdown', pick, true);
  removeEventListener('keydown', key, true);
  box.remove();
}

function release() {
  removeEventListener('pointerup', afterPress, true);
  removeEventListener('pointercancel', afterPress, true);
  for (const t of SWALLOWED) removeEventListener(t, swallow, true);
  window.__uiPickerActive = false;
}

// The click follows pointerup in the same burst of events, so drop the
// swallowers on the next tick (after it); a disabled control gets no click.
function afterPress() { setTimeout(release, 0); }

function move(e) {
  const r = e.target.getBoundingClientRect();
  Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

function key(e) {
  if (e.key === 'Escape') { e.preventDefault(); stopPicking(); release(); }
}

function pick(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  stopPicking();
  addEventListener('pointerup', afterPress, true);
  addEventListener('pointercancel', afterPress, true);
  const payload = buildPayload(e.target, { url: location.href, rect: e.target.getBoundingClientRect(), dpr: devicePixelRatio });
  // A fresh window name per pick: a reused name would keep the first tab as opener.
  const name = 'ui-picker-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const popup = window.open(WRANGLER + '/ext/ui-picker/launch.html', name, 'width=560,height=760');
  if (!popup) { banner('UI Picker: allow pop-ups for this site and try again.'); return; }
  let done = false;
  const onReady = (m) => {
    if (m.source !== popup || !m.data || m.data.type !== 'ui-picker:ready') return;
    done = true;
    removeEventListener('message', onReady);
    popup.postMessage(payload, WRANGLER);
  };
  addEventListener('message', onReady);
  setTimeout(() => {
    if (done) return;
    removeEventListener('message', onReady);
    banner("UI Picker: the launch window didn't respond. Is the UI Picker extension enabled on the wrangler?");
  }, 10000);
}

addEventListener('mousemove', move, true);
addEventListener('pointerdown', pick, true);
addEventListener('keydown', key, true);
for (const t of SWALLOWED) addEventListener(t, swallow, true);
banner('UI Picker: click an element (Esc to cancel)');
