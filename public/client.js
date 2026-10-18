// Runs inside the wrangler board. When the board was opened by the UI Picker
// bookmarklet (`/?ui-picker=1` in its own popup), it takes one pick from the
// page that opened it and opens the board's own new-session dialog with the
// pick as the prompt and the screenshot attached. Everywhere else it does nothing.
import { DEFAULT_REPO_PATH, SUPPORTED_PROTOCOLS } from './defaults.js';
import { allowedOriginsFrom, readPick } from './pick-check.js';
import { buildIntent } from './prompt.js';
import { buildId } from './build-bookmarklet.js';
import { defaultFetchText, MAIN_URL, PICK_CORE_URL, settingsPanel } from './settings-panel.js';

const PNG_PREFIX = 'data:image/png;base64,';

export function pngBlob(dataUrl) {
  const bin = atob(dataUrl.slice(PNG_PREFIX.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

const MISMATCH = "This UI Picker bookmarklet doesn't match this wrangler. Re-drag it from Settings → Extensions → UI Picker.";

// How long ready waits for the current build id before going without it.
const BUILD_WAIT_MS = 2000;

// The id of the bookmarklet this board would hand out now, from the same
// sources the settings panel builds it from, or null if it can't be had
// within waitMs.
async function currentBuildId(fetchText, waitMs) {
  let timer;
  const giveUp = new Promise((resolve) => { timer = setTimeout(resolve, waitMs, null); });
  const id = Promise.all([fetchText(PICK_CORE_URL), fetchText(MAIN_URL)]).then(([core, main]) => buildId(core, main), () => null);
  try {
    return await Promise.race([id, giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

// `win`/`loc` are window and location and `fetchText` reads an extension file,
// injected for tests; onLaunch receives the promise of handling the one pick
// (launch, or the mismatch card).
export function startPicker({ api, win, loc, fetchText = defaultFetchText, buildWaitMs = BUILD_WAIT_MS, onLaunch = () => {} }) {
  if (!new URLSearchParams(loc.search).has('ui-picker')) return false;
  const opener = win.opener;
  if (!opener || win.top !== win) return false;
  // Client modules load only after the first graph, so our settings are here already.
  const settings = api.settings() || {};
  const allowed = allowedOriginsFrom(settings);
  const repoPath = (typeof settings.repoPath === 'string' && settings.repoPath.trim()) || DEFAULT_REPO_PATH;

  async function launch(pick) {
    let name = null;
    if (pick.screenshot) {
      try {
        ({ name } = await api.images.stage(pngBlob(pick.screenshot)));
      } catch {
        api.ui.notify({ id: 'screenshot', title: "Screenshot couldn't be attached", body: 'Starting without it. Paste one into the prompt if you need it.' });
      }
    }
    const { screenshot: _, ...rest } = pick;
    try {
      await api.openDispatch({ intent: buildIntent({ pick: rest, repoPath }), cwd: repoPath, images: name ? [name] : [] });
    } catch (err) {
      // e.g. another launch is still awaiting its ack. Staged names are
      // single-use, so a retry stages the screenshot again from the pick.
      const choice = await api.ui.notify({
        id: 'dispatch', title: "Couldn't open the new-session dialog", body: String(err?.message || err),
        actions: [{ id: 'retry', label: 'Retry', primary: true }],
      });
      if (choice === 'retry') return launch(pick);
    }
    win.close();
  }

  // A bookmarklet speaking a protocol this board doesn't: say so, then close
  // like any other end, once the card is dismissed.
  async function mismatch() {
    await api.ui.notify({ id: 'mismatch', title: 'UI Picker', body: MISMATCH });
    win.close();
  }

  const onMessage = (e) => {
    const read = readPick(e, allowed, opener);
    if (!read) return;
    win.removeEventListener('message', onMessage);
    if (!read.pick) {
      onLaunch(mismatch());
      return;
    }
    onLaunch(launch(read.pick));
  };
  win.addEventListener('message', onMessage);
  // The opener is the page that picked; it waits for this before sending the
  // pick in the highest protocol both sides speak, and compares `build` with
  // its own to suggest re-dragging on the page the user goes back to.
  // Addressed to each allowed origin, so any other opener gets nothing.
  currentBuildId(fetchText, buildWaitMs).then((build) => {
    const ready = { type: 'ui-picker:ready', protocols: SUPPORTED_PROTOCOLS, ...(build ? { build } : {}) };
    for (const origin of allowed) opener.postMessage(ready, origin);
  });
  return true;
}

export default {
  register(registrar) {
    startPicker({ api: registrar.api, win: window, loc: location });
    const { refreshAll, ...panel } = settingsPanel({ origin: location.origin });
    registrar.register('settings.panel', panel);
    // Core redraws the panel only on a remount, so follow stored values here.
    registrar.api.settings?.onChange?.(refreshAll);
  },
};
