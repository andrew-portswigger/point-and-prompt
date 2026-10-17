import os from 'node:os';
import path from 'node:path';

export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// The host API exposes no data dir, so mirror core's resolution: AW_DATA_DIR
// when set, ~/.agent-wrangler otherwise. spawn's addDirs needs it absolute.
export function shotsDir(env = process.env) {
  const base = env.AW_DATA_DIR ? expandHome(env.AW_DATA_DIR) : path.join(os.homedir(), '.agent-wrangler');
  return path.resolve(base, 'ui-picker', 'shots');
}
