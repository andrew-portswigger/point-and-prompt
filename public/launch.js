import { allowedOriginsFrom, isAcceptedPick, isOurResult, launchFrame } from './launch-core.js';
import { MAX_SHOT_BYTES } from './defaults.js';

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };

function start() {
  const opener = window.opener;
  let allowed = null;
  let pick = null;
  let screenshot = null;
  let pending = null; // { requestId, timer, done }
  let lost = false;

  if (!opener) status('Open this from the UI Picker bookmarklet on an allowed page.', true);

  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  function refresh() {
    $('launch').disabled = ws.readyState !== WebSocket.OPEN || !pick || !$('note').value.trim() || !!pending;
  }

  function fail(message) {
    clearTimeout(pending?.timer);
    pending = null;
    status(`Launch failed: ${message}`, true);
    refresh();
  }

  ws.addEventListener('close', () => {
    clearTimeout(pending?.timer);
    lost = true;
    if (pending && !pending.done) status('Lost connection to the wrangler. The session may have started — check the board before picking again.', true);
    else if (!pending) status('Lost connection to the wrangler. Close this window and pick again.', true);
    refresh();
  });

  ws.addEventListener('message', (m) => {
    // The graph is re-sent on every board change; skip it once we have our settings.
    if (allowed && typeof m.data === 'string' && m.data.startsWith('{"type":"graph"')) return;
    let frame;
    try { frame = JSON.parse(m.data); } catch { return; }
    if (frame.type === 'graph' && !allowed && opener) {
      allowed = allowedOriginsFrom(frame.graph);
      status(`Waiting for a pick from ${allowed.join(', ')}…`);
      // The opener is the page that picked; it opened this popup and waits for this signal.
      opener.postMessage({ type: 'ui-picker:ready' }, '*');
      refresh();
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

  $('note').addEventListener('input', refresh);

  document.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const item = items.find((i) => i.type === 'image/png');
    if (!item) {
      if (items.some((i) => i.type.startsWith('image/'))) { e.preventDefault(); $('paste').textContent = 'PNG only — copy the screenshot with ⌘⇧⌃4 and paste again.'; }
      return;
    }
    e.preventDefault();
    const file = item.getAsFile();
    if (file.size > MAX_SHOT_BYTES) {
      screenshot = null;
      $('paste').textContent = `Screenshot too large (max ${MAX_SHOT_BYTES / 1024 / 1024} MB).`;
      return;
    }
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
    reader.readAsDataURL(file);
  });

  $('cancel').addEventListener('click', () => window.close());
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('launch').disabled) return;
    // getRandomValues, unlike randomUUID, also works on a non-localhost http origin.
    const requestId = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    pending = {
      requestId,
      // Keep the request after the timeout: the session may still have started, and a
      // late result must be recognised rather than inviting a duplicate launch.
      timer: setTimeout(() => {
        if (!lost) status('No reply within 60s. The session may still have started — check the board before trying again.', true);
      }, 60000),
    };
    refresh();
    status('Launching…');
    ws.send(JSON.stringify(launchFrame({
      requestId, pick, note: $('note').value.trim(), action: new FormData($('form')).get('action'), screenshot,
    })));
  });
}

if (window.top !== window) status('Open this as a pop-up from the UI Picker bookmarklet.', true);
else start();
