import { buildBookmarklet } from './build-bookmarklet.js';

const [core, main] = await Promise.all(['pick-core.js', 'bookmarklet-main.js'].map((f) => fetch(f).then((r) => r.text())));
const link = document.getElementById('link');
link.href = buildBookmarklet(core, main, location.origin);
link.textContent = 'UI Picker';
link.addEventListener('click', (e) => e.preventDefault());
