// Inlined into the bookmarklet by build-bookmarklet.js: no imports, no
// top-level DOM access, exports only at line start (they are stripped).
export const PICK_MAX_HTML = 4096;
export const PICK_MAX_OWNERS = 8;
export const PICK_MAX_CLASSES = 3;
export const PICK_MAX_SHOT_BYTES = 10 * 1024 * 1024;

// Assumes React 17/18 dev builds: `__reactFiber$` keys and `_debugSource` from the
// dev JSX transform (React 19 has no `_debugSource`).
export function fiberOf(el) {
  for (let e = el; e; e = e.parentElement) {
    const key = Object.keys(e).find((k) => k.startsWith('__reactFiber$'));
    if (key) return e[key];
  }
  return null;
}

export function debugAt(fiber) {
  const s = fiber && fiber._debugSource;
  return s ? `${s.fileName}:${s.lineNumber}` : null;
}

export function componentName(fiber) {
  const t = fiber.type;
  if (!t || typeof t === 'string') return null;
  return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || 'Anonymous';
}

export function ownerChain(fiber, max) {
  const out = [];
  for (let o = fiber && fiber._debugOwner; o && out.length < max; o = o._debugOwner) {
    const name = componentName(o);
    if (name) out.push({ name, at: debugAt(o) });
  }
  return out;
}

export function describeElement(el) {
  const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: cls.split(/\s+/).filter(Boolean).slice(0, PICK_MAX_CLASSES),
    text: (el.textContent || '').slice(0, 2000).replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

export function buildPayload(el, { url, rect, dpr }) {
  const fiber = fiberOf(el);
  return {
    type: 'ui-picker:pick',
    version: 1,
    url,
    element: describeElement(el),
    html: (el.outerHTML || '').slice(0, PICK_MAX_HTML),
    jsxAt: debugAt(fiber),
    owners: ownerChain(fiber, PICK_MAX_OWNERS),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr },
  };
}

// Rects are DOMRect-like { x, y, width, height }.
const contains = (outer, r) => outer.x <= r.x && outer.y <= r.y
  && outer.x + outer.width >= r.x + r.width && outer.y + outer.height >= r.y + r.height;

// The nearest of start and its ancestors whose box contains rect, else fallback.
export function containingElement(start, rect, rectOf, fallback) {
  for (let e = start; e; e = e.parentElement) {
    if (contains(rectOf(e), rect)) return e;
  }
  return fallback;
}

export function padRect(rect, pad, viewport) {
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const right = Math.min(viewport.width, rect.x + rect.width + pad);
  const bottom = Math.min(viewport.height, rect.y + rect.height + pad);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function dragRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

const PNG_PREFIX = 'data:image/png;base64,';

// Same rule as the popup and server: a PNG data URL whose decoded size is within the cap.
export function shotFits(url) {
  return typeof url === 'string' && url.startsWith(PNG_PREFIX)
    && (url.length - PNG_PREFIX.length) * 0.75 <= PICK_MAX_SHOT_BYTES;
}
