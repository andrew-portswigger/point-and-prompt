// Inlined into the bookmarklet by build-bookmarklet.js: no imports, no
// top-level DOM access, exports only at line start (they are stripped).
// Mirrors defaults.js PROTOCOL: the newest protocol this bookmarklet speaks.
export const PICK_PROTOCOL = 1;
export const PICK_MAX_HTML = 4096;
export const PICK_MAX_OWNERS = 8;
export const PICK_MAX_CLASSES = 3;
export const PICK_MAX_SHOT_BYTES = 10 * 1024 * 1024;
export const PICK_MAX_CONTAINS = 10;
// A drag lists the components whose elements lie mostly inside it: at least this
// share of an element's box must be within the dragged area.
export const PICK_CONTAINS_OVERLAP = 0.6;
// Elements under the containing element looked at, to stay fast on big pages.
export const PICK_CONTAINS_SCAN = 3000;
// How far up _debugOwner to walk when comparing components (deeper than owners).
const OWNER_DEPTH = 100;

// Assumes React 17/18 dev builds: `__reactFiber$` keys and `_debugSource` from the
// dev JSX transform (React 19 has no `_debugSource`). A DOM element's own fiber,
// not an ancestor's.
export function ownFiber(el) {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  return key ? el[key] : null;
}

// The fiber of el or its nearest ancestor that has one.
export function fiberOf(el) {
  for (let e = el; e; e = e.parentElement) {
    const f = ownFiber(e);
    if (f) return f;
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

// The highest protocol in both lists, or null when they share none.
export function chooseProtocol(ours, theirs) {
  const common = ours.filter((p) => theirs.includes(p));
  return common.length ? Math.max(...common) : null;
}

// The facts about a pick, captured at pointerup in no particular wire format.
// `build` identifies the bookmarklet's own code (see build-bookmarklet.js); the
// bookmarklet adds `contains` for a drag, and `screenshot` once the grab settles.
export function capturePick(el, { url, rect, dpr, build, drag = false }) {
  const fiber = fiberOf(el);
  const raw = {
    build,
    url,
    element: describeElement(el),
    html: (el.outerHTML || '').slice(0, PICK_MAX_HTML),
    jsxAt: debugAt(fiber),
    owners: ownerChain(fiber, PICK_MAX_OWNERS),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr },
  };
  if (drag) raw.mode = 'drag';
  return raw;
}

// One payload builder per wire protocol this bookmarklet can send. The payload
// is built only once the board has said which protocol it wants. Supporting a
// new protocol: add its builder here and its golden payload under test/fixtures.
export const PAYLOAD_BUILDERS = {
  1(raw) {
    const p = {
      type: 'point-and-prompt:pick',
      protocol: 1,
      build: raw.build,
      url: raw.url,
      element: raw.element,
      html: raw.html,
      jsxAt: raw.jsxAt,
      owners: raw.owners,
      rect: raw.rect,
    };
    // Optional fields (OPTIONAL_FIELDS in defaults.js): present only when they say something.
    if (raw.mode === 'drag') {
      p.mode = 'drag';
      if (raw.contains && raw.contains.length) p.contains = raw.contains;
    }
    if (raw.screenshot) p.screenshot = raw.screenshot;
    return p;
  },
};

export function protocolsOf(builders) {
  return Object.keys(builders).map(Number);
}

// Every protocol this bookmarklet can send.
export const PICK_PROTOCOLS = protocolsOf(PAYLOAD_BUILDERS);

export function buildPayload(raw, protocol, builders = PAYLOAD_BUILDERS) {
  return builders[protocol](raw);
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

// Whether at least PICK_CONTAINS_OVERLAP of box's area lies inside rect. An
// unrendered (zero-area) box never does.
export function mostlyInside(box, rect, threshold = PICK_CONTAINS_OVERLAP) {
  const area = box.width * box.height;
  if (!(area > 0)) return false;
  const w = Math.min(box.x + box.width, rect.x + rect.width) - Math.max(box.x, rect.x);
  const h = Math.min(box.y + box.height, rect.y + rect.height) - Math.max(box.y, rect.y);
  return w > 0 && h > 0 && (w * h) / area >= threshold;
}

// root's descendant elements in document order, at most max of them.
export function descendants(root, max) {
  const out = [];
  const stack = [...(root.children || [])].reverse();
  while (stack.length && out.length < max) {
    const e = stack.pop();
    out.push(e);
    const kids = e.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return out;
}

// Components are compared by name and source rather than by fiber: a DOM node
// may hold either of a fiber's two copies (current or alternate).
const componentKey = (name, at) => `${name}\u0000${at}`;

function ownerKeys(fiber) {
  const keys = [];
  for (let o = fiber && fiber._debugOwner, n = 0; o && n < OWNER_DEPTH; o = o._debugOwner, n += 1) {
    const name = componentName(o);
    if (name) keys.push(componentKey(name, debugAt(o)));
  }
  return keys;
}

// The component that rendered a host fiber (its nearest owner), where that
// component is used, and the keys of the components above it; null for none.
export function componentEntry(hostFiber) {
  let o = hostFiber && hostFiber._debugOwner;
  for (let n = 0; o && !componentName(o) && n < OWNER_DEPTH; n += 1) o = o._debugOwner;
  if (!o || !componentName(o)) return null;
  return { name: componentName(o), at: debugAt(o), owners: ownerKeys(o) };
}

// Plain-data entries ({ name, at, owners: keys }) in document order to the
// outermost distinct components, first-seen order, at most max. `exclude` are
// the keys already described as the containing element's owners; they go first,
// so their children can stand as the outermost.
export function outermostComponents(entries, exclude, max) {
  const skip = new Set(exclude);
  const seen = new Map();
  for (const e of entries) {
    const key = componentKey(e.name, e.at);
    if (!skip.has(key) && !seen.has(key)) seen.set(key, e);
  }
  const out = [];
  for (const [key, e] of seen) {
    if (out.length >= max) break;
    // A recursive component used at the same place is not its own outer component.
    if (!e.owners.some((k) => k !== key && seen.has(k))) out.push({ name: e.name, at: e.at });
  }
  return out;
}

// The outermost components rendering the given host fibers (document order),
// leaving out the containing element's own owner chain.
export function componentsInside(hostFibers, containerFiber, max) {
  const entries = hostFibers.map(componentEntry).filter(Boolean);
  return outermostComponents(entries, ownerKeys(containerFiber), max);
}
