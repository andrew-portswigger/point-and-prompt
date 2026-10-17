// Concatenates pick-core (exports stripped) and the main script into one IIFE.
// The origin is JSON-encoded so a hostile value cannot break out of the string.
export function buildBookmarklet(coreSrc, mainSrc, origin) {
  const core = coreSrc.replace(/^export /gm, '');
  const main = mainSrc.replace('__WRANGLER_ORIGIN__', () => JSON.stringify(origin));
  return 'javascript:' + encodeURIComponent(`(() => {\n${core}\n${main}\n})();`);
}
