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

// A small square in the viewport's top-left corner, shown while picking with
// a screenshot. Removing the overlays doesn't guarantee the next captured frame
// was painted without them, so a frame still showing it is stale and retaken.
export const PICK_SENTINEL_PX = 6;
export const PICK_SENTINEL_CSS = `position:fixed;pointer-events:none;z-index:2147483647;left:0;top:0;width:${PICK_SENTINEL_PX}px;height:${PICK_SENTINEL_PX}px;background:rgb(255,0,255)`;

// The frame pixels to read: the sentinel's middle, clear of edges blended by
// a scaled capture, and at least one pixel however small the frame.
export function sentinelSample(scale) {
  const at = Math.floor(scale);
  const size = Math.max(1, Math.floor((PICK_SENTINEL_PX - 2) * scale));
  return { x: at, y: at, width: size, height: size };
}

// Whether most of the sampled RGBA pixels are the sentinel's magenta.
export function showsSentinel(rgba) {
  const n = Math.floor(rgba.length / 4);
  let hits = 0;
  for (let i = 0; i < n * 4; i += 4) {
    if (rgba[i] > 220 && rgba[i + 1] < 40 && rgba[i + 2] > 220) hits += 1;
  }
  return n > 0 && hits * 2 > n;
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

// A component is known by its name and source (`key`) when listed, but counted
// per instance (`id`): rows from one .map() share a key, yet each row is inside
// or outside the area on its own. A fiber and its `alternate` (React's two
// copies of one instance; a DOM node may hold either) get the same id.
const componentKey = (name, at) => `${name}\u0000${at}`;
const NO_STOP = new Set();

export function instanceId(fiber, ids) {
  let id = ids.get(fiber) || (fiber.alternate && ids.get(fiber.alternate));
  if (!id) {
    id = {};
    ids.set(fiber, id);
    if (fiber.alternate) ids.set(fiber.alternate, id);
  }
  return id;
}

// The components above a host fiber, nearest first, as { key, name, at, id },
// up to (not including) the first whose key is in `stop`: those are the
// containing element's owners, already described. A recursive component used
// at the same place as one of them has the same key, so it and everything
// inside it stop there too, on purpose: by name and source it is the component
// the owners already name.
export function ownerPath(hostFiber, stop = NO_STOP, ids = new WeakMap()) {
  const path = [];
  for (let o = hostFiber && hostFiber._debugOwner, n = 0; o && n < OWNER_DEPTH; o = o._debugOwner, n += 1) {
    const name = componentName(o);
    if (!name) continue;
    const at = debugAt(o);
    const key = componentKey(name, at);
    if (stop.has(key)) break;
    path.push({ key, name, at, id: instanceId(o, ids) });
  }
  return path;
}

// A full ownerPath cut at the first key in stop.
export function cutPath(path, stop) {
  const i = path.findIndex((c) => stop.has(c.key));
  return i < 0 ? path : path.slice(0, i);
}

// Plain data in, the component instances inside the area out. `items` are the
// scanned elements in document order, each { inside, path } (path from
// ownerPath). An instance is inside when every scanned element it renders,
// directly or through other components, is inside; that includes components
// that render only other components. Of those, only the outermost are kept, in
// first-seen order, each with the indices of the inside items folded into it.
export function componentGroups(items) {
  const stats = new Map();
  items.forEach((item, i) => {
    item.path.forEach((c, depth) => {
      let s = stats.get(c.id);
      if (!s) {
        s = { key: c.key, name: c.name, at: c.at, owners: item.path.slice(depth + 1).map((o) => o.id), inside: 0, outside: 0, items: [] };
        stats.set(c.id, s);
      }
      if (item.inside) { s.inside += 1; s.items.push(i); } else s.outside += 1;
    });
  });
  const isIn = (id) => { const s = stats.get(id); return !!s && s.inside > 0 && s.outside === 0; };
  const out = [];
  for (const [id, s] of stats) {
    if (isIn(id) && !s.owners.some(isIn)) out.push({ key: s.key, name: s.name, at: s.at, items: s.items });
  }
  return out;
}

// What a drag sends as `contains`: the groups' components, one per name and
// source (three selected rows list Row once), at most max.
export function distinctComponents(groups, max) {
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    if (out.length >= max) break;
    if (!seen.has(g.key)) { seen.add(g.key); out.push({ name: g.name, at: g.at }); }
  }
  return out;
}

// `elements`: the containing element's descendants in document order, each
// { box } plus either `fiber` (the element's own, or null) or `path` (its full
// ownerPath, or null, e.g. cached for a drag). Elements with no fiber or no box
// (not rendered) are ignored. Returns componentGroups' groups, items indexing
// into `elements`. Pass the same `ids` for the paths' and the container's fibers.
export function componentGroupsInside(elements, containerFiber, rect, ids = new WeakMap()) {
  const stop = new Set(ownerPath(containerFiber, NO_STOP, ids).map((c) => c.key));
  const items = [];
  const index = [];
  elements.forEach((e, i) => {
    const full = e.path !== undefined ? e.path : e.fiber ? ownerPath(e.fiber, NO_STOP, ids) : null;
    if (!full || !(e.box.width * e.box.height > 0)) return;
    items.push({ inside: mostlyInside(e.box, rect), path: cutPath(full, stop) });
    index.push(i);
  });
  return componentGroups(items).map((g) => ({ ...g, items: g.items.map((i) => index[i]) }));
}

export function componentsInside(elements, containerFiber, rect, max) {
  return distinctComponents(componentGroupsInside(elements, containerFiber, rect), max);
}

// The smallest box around all of boxes, or null for none.
export function unionBox(boxes) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

// The part of box inside the viewport, or null when none of it is.
export function clipBox(box, viewport) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(viewport.width, box.x + box.width) - x;
  const height = Math.min(viewport.height, box.y + box.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

// What the live drag view outlines: per group (componentGroups, one per
// instance), the union of the boxes of the elements folded into it, clipped to
// the viewport, at most max. Only the first instance of each component is
// tagged with its name. Groups with nothing on screen are left out. The cap
// goes to the first instance of each component before any repeat, so every
// component the pick lists gets an outline; kept outlines stay in order.
export function highlightBoxes(groups, boxes, viewport, max) {
  const visible = [];
  for (const g of groups) {
    const u = unionBox(g.items.map((i) => boxes[i]));
    const clipped = u && clipBox(u, viewport);
    if (clipped) visible.push({ key: g.key, name: g.name, box: clipped });
  }
  const seen = new Set();
  const firsts = [];
  const repeats = [];
  visible.forEach((v, i) => {
    (seen.has(v.key) ? repeats : firsts).push(i);
    seen.add(v.key);
  });
  const keep = new Set([...firsts, ...repeats].slice(0, max));
  const tagged = new Set();
  const out = [];
  visible.forEach((v, i) => {
    if (!keep.has(i)) return;
    out.push({ name: v.name, box: v.box, tag: !tagged.has(v.key) });
    tagged.add(v.key);
  });
  return out;
}
