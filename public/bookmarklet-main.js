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

// The app must not see the press that picks an element.
function swallow(e) { e.preventDefault(); e.stopPropagation(); }
const SWALLOWED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];

function stop() {
  removeEventListener('mousemove', move, true);
  removeEventListener('click', pick, true);
  removeEventListener('keydown', key, true);
  for (const t of SWALLOWED) removeEventListener(t, swallow, true);
  box.remove();
  window.__uiPickerActive = false;
}

function move(e) {
  const r = e.target.getBoundingClientRect();
  Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

function key(e) {
  if (e.key === 'Escape') { e.preventDefault(); stop(); }
}

function pick(e) {
  e.preventDefault();
  e.stopPropagation();
  stop();
  const payload = buildPayload(e.target, { url: location.href, rect: e.target.getBoundingClientRect(), dpr: devicePixelRatio });
  const popup = window.open(WRANGLER + '/ext/ui-picker/launch.html', 'ui-picker', 'width=560,height=760');
  if (!popup) { banner('UI Picker: allow pop-ups for this site and try again.'); return; }
  const onReady = (m) => {
    if (m.source !== popup || !m.data || m.data.type !== 'ui-picker:ready') return;
    removeEventListener('message', onReady);
    popup.postMessage(payload, WRANGLER);
  };
  addEventListener('message', onReady);
}

addEventListener('mousemove', move, true);
addEventListener('click', pick, true);
addEventListener('keydown', key, true);
for (const t of SWALLOWED) addEventListener(t, swallow, true);
banner('UI Picker: click an element (Esc to cancel)');
