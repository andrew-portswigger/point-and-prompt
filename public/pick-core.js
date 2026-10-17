// Inlined into the bookmarklet by build-bookmarklet.js: no imports, no
// top-level DOM access, exports only at line start (they are stripped).
export const PICK_MAX_HTML = 4096;
export const PICK_MAX_OWNERS = 8;
export const PICK_MAX_CLASSES = 3;

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
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
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
