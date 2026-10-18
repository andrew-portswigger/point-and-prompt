import { DEFAULT_ALLOWED_ORIGINS, MAX_BUILD, MAX_CLASSES, MAX_CONTAINS, MAX_HTML, MAX_OWNERS, MAX_SHOT_BYTES, SUPPORTED_PROTOCOLS } from './defaults.js';

// `settings` is api.settings(): our own values, unset keys absent.
export function allowedOriginsFrom(settings) {
  const list = settings?.allowedOrigins;
  return Array.isArray(list) && list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

const isStr = (v) => typeof v === 'string';
const isStrOrNull = (v) => v === null || isStr(v);
const PNG_PREFIX = 'data:image/png;base64,';
const isComponentList = (v, max) => Array.isArray(v) && v.length <= max && v.every((o) => !!o && isStr(o.name) && isStrOrNull(o.at));
const isShot = (v) => isStr(v) && v.startsWith(PNG_PREFIX) && (v.length - PNG_PREFIX.length) * 0.75 <= MAX_SHOT_BYTES;

// Shape and size check of a v1 payload: the pick comes from another site and
// becomes a prompt. Fields it doesn't know are ignored.
export function isWellFormedPick(d) {
  const el = d?.element;
  return !!d && isStr(d.build) && d.build.length <= MAX_BUILD && isStr(d.url) && isStr(d.html) && d.html.length <= MAX_HTML
    && !!el && typeof el === 'object' && isStr(el.tag) && isStr(el.id) && isStr(el.text)
    && Array.isArray(el.classes) && el.classes.length <= MAX_CLASSES && el.classes.every(isStr)
    && isStrOrNull(d.jsxAt)
    && isComponentList(d.owners, MAX_OWNERS)
    && (d.screenshot === undefined || isShot(d.screenshot));
}

// One normaliser per supported wire protocol, each returning the internal pick
// (the shape prompt.js and client.js use) or null when the payload is malformed.
// Supporting a new protocol: add it to SUPPORTED_PROTOCOLS, add its normaliser
// here and its golden payload as test/fixtures/pick-v<N>.json.
export const normalisePick = {
  1(d) {
    if (!isWellFormedPick(d)) return null;
    const { tag, id, classes, text } = d.element;
    const pick = {
      url: d.url,
      html: d.html,
      element: { tag, id, classes, text },
      jsxAt: d.jsxAt,
      owners: d.owners.map(({ name, at }) => ({ name, at })),
      build: d.build,
    };
    if (d.screenshot !== undefined) pick.screenshot = d.screenshot;
    // Optional fields added later (OPTIONAL_FIELDS): a malformed one is dropped,
    // so it can't make an otherwise good pick unreadable.
    if (d.mode === 'drag') pick.mode = 'drag';
    if (isComponentList(d.contains, MAX_CONTAINS)) pick.contains = d.contains.map(({ name, at }) => ({ name, at }));
    return pick;
  },
};

// Every page gets a stream of foreign messages (React DevTools alone posts ~2/s),
// so look only at our own type from an allowed origin and the exact window that
// opened us (a null expectedSource never matches). Of those, returns { pick }
// for a well-formed pick in a supported protocol, { malformed: true } for one
// that isn't well formed, and { unsupported: protocol } for a pick in any
// other protocol; null for everything else.
export function readPick(event, allowed, expectedSource) {
  const d = event.data;
  if (!expectedSource || event.source !== expectedSource || !allowed.includes(event.origin)) return null;
  if (!d || d.type !== 'point-and-prompt:pick') return null;
  if (!SUPPORTED_PROTOCOLS.includes(d.protocol)) return { unsupported: d.protocol };
  const pick = normalisePick[d.protocol](d);
  return pick ? { pick } : { malformed: true };
}

export function isAcceptedPick(event, allowed, expectedSource) {
  return !!readPick(event, allowed, expectedSource)?.pick;
}
