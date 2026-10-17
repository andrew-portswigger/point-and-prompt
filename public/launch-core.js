import { DEFAULT_ALLOWED_ORIGINS, MAX_SHOT_BYTES } from './defaults.js';

export function allowedOriginsFrom(graph) {
  const mine = (graph?.extensions || []).find((e) => e.id === 'ui-picker');
  const list = mine?.settingValues?.allowedOrigins;
  return Array.isArray(list) && list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

const isStr = (v) => typeof v === 'string';
const isStrOrNull = (v) => v === null || isStr(v);
const PNG_PREFIX = 'data:image/png;base64,';
const isShot = (v) => isStr(v) && v.startsWith(PNG_PREFIX) && (v.length - PNG_PREFIX.length) * 0.75 <= MAX_SHOT_BYTES;

// Shape check so the popup can render a pick without throwing on odd data.
export function isWellFormedPick(d) {
  const el = d?.element;
  return !!d && isStr(d.url) && isStr(d.html)
    && !!el && typeof el === 'object' && isStr(el.tag) && isStr(el.id) && isStr(el.text)
    && Array.isArray(el.classes) && el.classes.every(isStr)
    && isStrOrNull(d.jsxAt)
    && Array.isArray(d.owners) && d.owners.every((o) => !!o && isStr(o.name) && isStrOrNull(o.at))
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

export function isOurResult(frame, requestId) {
  return frame?.type === 'ext:ui-picker' && frame.requestId === requestId;
}

// The server checks the screenshot at the top level only; keep the pick small.
export function launchFrame({ requestId, pick, note, screenshot }) {
  const { screenshot: _, ...rest } = pick;
  return { type: 'ui-picker-launch', requestId, pick: rest, note, screenshot };
}
