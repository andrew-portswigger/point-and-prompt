import { allowedOriginsFrom, isAcceptedPick, isOurResult, launchFrame } from './launch-core.js';

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };

const opener = window.opener;
let allowed = null;
let pick = null;
let screenshot = null;
let pending = null;

if (!opener) status('Open this from the UI Picker bookmarklet on an allowed page.', true);

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.addEventListener('close', () => { if (!pending?.done) status('Lost connection to the wrangler. Close this window and pick again.', true); });
ws.addEventListener('message', (m) => {
  let frame;
  try { frame = JSON.parse(m.data); } catch { return; }
  if (frame.type === 'graph' && !allowed && opener) {
    allowed = allowedOriginsFrom(frame.graph);
    status(`Waiting for a pick from ${allowed.join(', ')}…`);
    // The opener is the page that picked; it opened this popup and waits for this signal.
    opener.postMessage({ type: 'ui-picker:ready' }, '*');
  } else if (pending && frame.type === 'error') {
    fail(frame.message);
  } else if (pending && isOurResult(frame, pending.requestId)) {
    pending.done = true;
    clearTimeout(pending.timer);
    status(`Launched session ${frame.sessionId}. Closing…`);
    setTimeout(() => window.close(), 2000);
  }
});

addEventListener('message', (e) => {
  if (!allowed || pick || !isAcceptedPick(e, allowed, opener)) return;
  pick = e.data;
  $('p-url').textContent = pick.url;
  const el = pick.element;
  $('p-el').textContent = `<${el.tag}${el.id ? '#' + el.id : ''}${el.classes.map((c) => '.' + c).join('')}> ${el.text}`;
  $('p-jsx').textContent = pick.jsxAt || 'no source info (is the dev JSX transform on?)';
  for (const o of pick.owners) {
    const li = document.createElement('li');
    li.textContent = `${o.name}${o.at ? ' — ' + o.at : ''}`;
    $('p-owners').append(li);
  }
  $('pick').hidden = false;
  $('form').hidden = false;
  status('Add a note and launch.');
  $('note').focus();
  refresh();
});

function refresh() { $('launch').disabled = !pick || !$('note').value.trim() || !!pending; }
$('note').addEventListener('input', refresh);

document.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const item = items.find((i) => i.type === 'image/png');
  if (!item) {
    if (items.some((i) => i.type.startsWith('image/'))) { e.preventDefault(); $('paste').textContent = 'PNG only — copy the screenshot with ⌘⇧⌃4 and paste again.'; }
    return;
  }
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => {
    screenshot = reader.result;
    const img = document.createElement('img');
    img.src = screenshot;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove screenshot';
    remove.onclick = () => { screenshot = null; $('paste').textContent = 'Paste a screenshot (⌘V) — optional'; };
    $('paste').replaceChildren(img, remove);
  };
  reader.readAsDataURL(item.getAsFile());
});

function fail(message) {
  clearTimeout(pending?.timer);
  pending = null;
  status(`Launch failed: ${message}`, true);
  refresh();
}

$('cancel').addEventListener('click', () => window.close());
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('launch').disabled) return;
  const requestId = crypto.randomUUID();
  pending = { requestId, timer: setTimeout(() => fail('no reply within 60s. Check the board; the session may still have started.'), 60000) };
  refresh();
  status('Launching…');
  ws.send(JSON.stringify(launchFrame({
    requestId, pick, note: $('note').value.trim(), action: new FormData($('form')).get('action'), screenshot,
  })));
});
