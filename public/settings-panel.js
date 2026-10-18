// The extension's own block in Settings → Extensions → Point & Prompt: setup steps,
// the draggable bookmarklet and the two settings, saved by core's Save button.
// Built with DOM APIs and textContent only.
import { buildBookmarklet } from './build-bookmarklet.js';
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_REPO_PATH } from './defaults.js';

export const PICK_CORE_URL = '/ext/point-and-prompt/pick-core.js';
export const MAIN_URL = '/ext/point-and-prompt/bookmarklet-main.js';

export async function defaultFetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

// The bare origin a line names, or null. A trailing "/" and upper-case host are
// accepted (an address-bar paste), anything past the origin is not.
const originOf = (s) => {
  try {
    const u = new URL(s);
    const http = u.protocol === 'http:' || u.protocol === 'https:';
    const bare = u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && !/[?#]/.test(s);
    return http && bare ? u.origin : null;
  } catch {
    return null;
  }
};

// Trims both values; origins are one per line, stored bare, blanks and repeats dropped.
// Throws naming the first line that isn't an http(s) origin without a path.
export function cleanSettings({ repoPath, originsText }) {
  const allowedOrigins = [];
  for (const line of originsText.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const o = originOf(raw);
    if (!o) throw new Error(`"${raw}" isn't a page origin. Use the scheme, host and port only, like http://localhost:3333.`);
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }
  return { repoPath: repoPath.trim(), allowedOrigins };
}

const valuesOf = (api) => {
  const s = api.settings() || {};
  return {
    repoPath: typeof s.repoPath === 'string' ? s.repoPath : '',
    originsText: Array.isArray(s.allowedOrigins) ? s.allowedOrigins.join('\n') : '',
  };
};

export function settingsPanel({ fetchText = defaultFetchText, origin } = {}) {
  const panels = new Map();

  function mount(el, api) {
    const doc = el.ownerDocument;
    const make = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };

    const intro = make('div', 'Point at part of a React app\'s UI and start a session about it in the new-session dialog, with the component\'s source location and a screenshot attached. '
      + `The defaults target DAST (${DEFAULT_REPO_PATH}, pages on ${DEFAULT_ALLOWED_ORIGINS.join(' and ')}). `
      + 'File:line needs a React 17 or 18 development build; otherwise picks name the components only.', 'setting-help');
    intro.style.marginBottom = '12px';
    el.append(intro);

    el.append(make('div', 'Set up', 'setting-label'));
    const steps = make('ol');
    steps.style.margin = '4px 0 8px';
    steps.style.paddingLeft = '20px';
    for (const text of [
      'Drag the button below to your bookmarks bar.',
      'On your app (DAST by default), allow pop-ups for the site.',
    ]) steps.append(make('li', text, 'setting-help'));
    el.append(steps);

    const link = make('a', 'Loading…');
    Object.assign(link.style, {
      display: 'inline-block', padding: '6px 12px', borderRadius: '6px', background: '#e5484d',
      color: '#fff', textDecoration: 'none', fontWeight: '600', cursor: 'grab',
    });
    const linkNote = make('div', 'The bookmarklet holds this board\'s address: reinstall it if the wrangler moves.', 'setting-help');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      linkNote.textContent = 'Drag it to your bookmarks bar.';
    });
    const linkRow = make('div');
    linkRow.style.margin = '0 0 12px';
    linkRow.append(link, linkNote);
    el.append(linkRow);
    Promise.all([fetchText(PICK_CORE_URL), fetchText(MAIN_URL)]).then(([core, main]) => {
      link.href = buildBookmarklet(core, main, origin);
      link.textContent = '👉 Point & Prompt';
    }).catch(() => {
      link.style.display = 'none';
      linkNote.textContent = 'Couldn\'t build the bookmarklet — reopen Settings to retry.';
    });

    el.append(make('div', 'How to use', 'setting-label'));
    const howTo = make('div', 'On your app, click the bookmark. Share the tab for a screenshot (or Cancel for none), then click an element or drag around an area. Finish in the new-session dialog that opens on this board.', 'setting-help');
    howTo.style.marginBottom = '12px';
    el.append(howTo);

    el.append(make('div', 'Settings', 'setting-label'));
    const field = (label, help, input) => {
      const row = make('div', null, 'ext-setting-row');
      const copy = make('div', null, 'setting-copy');
      copy.append(make('div', label, 'setting-label'), make('div', help, 'setting-help'), input);
      input.setAttribute('aria-label', label);
      row.append(copy);
      el.append(row);
    };
    const repo = make('input', null, 'ext-setting-input');
    repo.type = 'text';
    repo.placeholder = DEFAULT_REPO_PATH;
    field('Repository path', 'Folder the new-session dialog starts in; picks\' source paths are shown relative to it.', repo);
    const origins = make('textarea', null, 'ext-setting-input ext-setting-textarea');
    origins.rows = 3;
    origins.placeholder = DEFAULT_ALLOWED_ORIGINS.join('\n');
    field('Allowed page origins', `Sites whose picks the board accepts. Empty uses ${DEFAULT_ALLOWED_ORIGINS.join(' and ')}.`, origins);
    const error = make('div', null, 'setting-error');
    error.setAttribute('role', 'alert');
    el.append(error);

    // A field the user has typed in is theirs until it is saved.
    const dirty = new Set();
    repo.addEventListener('input', () => dirty.add(repo));
    origins.addEventListener('input', () => dirty.add(origins));
    const refresh = () => {
      const v = valuesOf(api);
      if (!dirty.has(repo)) repo.value = v.repoPath;
      if (!dirty.has(origins)) origins.value = v.originsText;
    };
    refresh();
    panels.set(el, { api, repo, origins, error, dirty, refresh });
  }

  async function save(el) {
    const { api, repo, origins, error, dirty } = panels.get(el);
    const typed = { repo: repo.value, origins: origins.value };
    let values;
    try {
      values = cleanSettings({ repoPath: typed.repo, originsText: typed.origins });
      await api.settings.set('repoPath', values.repoPath);
      await api.settings.set('allowedOrigins', values.allowedOrigins);
    } catch (err) {
      error.textContent = err?.message || String(err);
      throw err;
    }
    error.textContent = '';
    // Edits made while the save was in flight stay the user's.
    if (repo.value === typed.repo) dirty.delete(repo);
    if (origins.value === typed.origins) dirty.delete(origins);
  }

  return {
    id: 'point-and-prompt',
    mount,
    update(el) { panels.get(el)?.refresh(); },
    save,
    unmount(el) { panels.delete(el); },
    // Every mounted panel, for a settings.onChange subscription.
    refreshAll() { for (const p of panels.values()) p.refresh(); },
  };
}
