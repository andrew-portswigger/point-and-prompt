import { DEFAULT_ALLOWED_ORIGINS, MAX_CLASSES, MAX_HTML, MAX_OWNERS, MAX_SHOT_BYTES } from './defaults.js';

// `settings` is api.settings(): our own values, unset keys absent.
export function allowedOriginsFrom(settings) {
  const list = settings?.allowedOrigins;
  return Array.isArray(list) && list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

const isStr = (v) => typeof v === 'string';
const isStrOrNull = (v) => v === null || isStr(v);
const PNG_PREFIX = 'data:image/png;base64,';
const isShot = (v) => isStr(v) && v.startsWith(PNG_PREFIX) && (v.length - PNG_PREFIX.length) * 0.75 <= MAX_SHOT_BYTES;

// Shape and size check: the pick comes from another site and becomes a prompt.
export function isWellFormedPick(d) {
  const el = d?.element;
  return !!d && isStr(d.url) && isStr(d.html) && d.html.length <= MAX_HTML
    && !!el && typeof el === 'object' && isStr(el.tag) && isStr(el.id) && isStr(el.text)
    && Array.isArray(el.classes) && el.classes.length <= MAX_CLASSES && el.classes.every(isStr)
    && isStrOrNull(d.jsxAt)
    && Array.isArray(d.owners) && d.owners.length <= MAX_OWNERS && d.owners.every((o) => !!o && isStr(o.name) && isStrOrNull(o.at))
    && (d.screenshot === undefined || isShot(d.screenshot));
}

// Every page gets a stream of foreign messages (React DevTools alone posts ~2/s),
// so accept only our own type, version, an allowed origin and the exact window
// that opened us (a null expectedSource never matches).
export function isAcceptedPick(event, allowed, expectedSource) {
  const d = event.data;
  return !!expectedSource && event.source === expectedSource
    && allowed.includes(event.origin) && !!d && d.type === 'ui-picker:pick' && d.version === 1 && isWellFormedPick(d);
}
