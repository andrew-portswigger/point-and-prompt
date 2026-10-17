import { buildBookmarklet } from './build-bookmarklet.js';

const link = document.getElementById('link');
try {
  const [core, main] = await Promise.all(['pick-core.js', 'bookmarklet-main.js'].map(async (f) => {
    const r = await fetch(f);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return r.text();
  }));
  link.href = buildBookmarklet(core, main, location.origin);
  link.textContent = 'UI Picker';
  link.addEventListener('click', (e) => e.preventDefault());
} catch {
  link.textContent = "Couldn't build the bookmarklet \u2014 reload to retry";
}
