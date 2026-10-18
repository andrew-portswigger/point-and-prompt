// A payload's keys and value types (arrays by their first item), so an
// accidental change to the wire format fails a test rather than a user's bookmarks bar.
export const shape = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return [v.length ? shape(v[0]) : 'empty'];
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
};
