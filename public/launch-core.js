import { DEFAULT_ALLOWED_ORIGINS } from './defaults.js';

export function allowedOriginsFrom(graph) {
  const mine = (graph?.extensions || []).find((e) => e.id === 'ui-picker');
  const list = mine?.settingValues?.allowedOrigins;
  return Array.isArray(list) && list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

// Every page gets a stream of foreign messages (React DevTools alone posts ~2/s),
// so accept only our own type, version, an allowed origin and the exact window
// that opened us (a null expectedSource never matches).
export function isAcceptedPick(event, allowed, expectedSource) {
  const d = event.data;
  return !!expectedSource && event.source === expectedSource
    && allowed.includes(event.origin) && !!d && d.type === 'ui-picker:pick' && d.version === 1;
}

export function isOurResult(frame, requestId) {
  return frame?.type === 'ext:ui-picker' && frame.requestId === requestId;
}

export function launchFrame({ requestId, pick, note, action, screenshot }) {
  return { type: 'ui-picker-launch', requestId, pick, note, action, screenshot };
}
