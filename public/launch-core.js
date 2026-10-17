import { DEFAULT_ALLOWED_ORIGINS } from './defaults.js';

export function allowedOriginsFrom(graph) {
  const mine = (graph?.extensions || []).find((e) => e.id === 'ui-picker');
  const list = mine?.settingValues?.allowedOrigins;
  return Array.isArray(list) && list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

const isStr = (v) => typeof v === 'string';
const isStrOrNull = (v) => v === null || isStr(v);

// Shape check so the popup can render a pick without throwing on odd data.
export function isWellFormedPick(d) {
  const el = d?.element;
  return !!d && isStr(d.url) && isStr(d.html)
    && !!el && typeof el === 'object' && isStr(el.tag) && isStr(el.id) && isStr(el.text)
    && Array.isArray(el.classes) && el.classes.every(isStr)
    && isStrOrNull(d.jsxAt)
    && Array.isArray(d.owners) && d.owners.every((o) => !!o && isStr(o.name) && isStrOrNull(o.at));
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

export function launchFrame({ requestId, pick, note, action, screenshot }) {
  return { type: 'ui-picker-launch', requestId, pick, note, action, screenshot };
}
