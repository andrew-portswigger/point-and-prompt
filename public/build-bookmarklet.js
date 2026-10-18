// 32-bit FNV-1a over UTF-16 code units, as 8 hex digits.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// The id of a bookmarklet built from these sources. Taken before the origin is
// baked in, so the same code has the same id on any wrangler; the board
// computes it from the sources it serves to spot an out-of-date bookmarklet.
export function buildId(coreSrc, mainSrc) {
  return fnv1a(coreSrc + mainSrc);
}

// Concatenates pick-core (exports stripped) and the main script into one IIFE.
// The origin is JSON-encoded so a hostile value cannot break out of the string.
export function buildBookmarklet(coreSrc, mainSrc, origin) {
  const core = coreSrc.replace(/^export /gm, '');
  const main = mainSrc
    .replace('__UI_PICKER_BUILD__', () => JSON.stringify(buildId(coreSrc, mainSrc)))
    .replace('__WRANGLER_ORIGIN__', () => JSON.stringify(origin));
  return 'javascript:' + encodeURIComponent(`(() => {\n${core}\n${main}\n})();`);
}
