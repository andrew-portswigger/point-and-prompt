// Runs inside the wrangler board. When the board was opened by the UI Picker
// bookmarklet (`/?ui-picker=1` in its own popup), it takes one pick from the
// page that opened it and opens the board's own new-session dialog with the
// pick as the prompt and the screenshot attached. Everywhere else it does nothing.
import { DEFAULT_REPO_PATH } from './defaults.js';
import { allowedOriginsFrom, isAcceptedPick } from './launch-core.js';
import { buildIntent } from './prompt.js';

const PNG_PREFIX = 'data:image/png;base64,';

export function pngBlob(dataUrl) {
  const bin = atob(dataUrl.slice(PNG_PREFIX.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

// `win`/`loc` are window and location, injected for tests; onLaunch receives
// the launch's promise once a pick is accepted.
export function startPicker({ api, win, loc, onLaunch = () => {} }) {
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
      api.ui.notify({ id: 'dispatch', title: "Couldn't open the new-session dialog", body: String(err?.message || err) });
      return;
    }
    win.close();
  }

  const onMessage = (e) => {
    if (!isAcceptedPick(e, allowed, opener)) return;
    win.removeEventListener('message', onMessage);
    onLaunch(launch(e.data));
  };
  win.addEventListener('message', onMessage);
  // The opener is the page that picked; it waits for this before sending the pick.
  opener.postMessage({ type: 'ui-picker:ready' }, '*');
  return true;
}

export default {
  register(registrar) {
    startPicker({ api: registrar.api, win: window, loc: location });
  },
};
