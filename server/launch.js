import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { ACTIONS, DEFAULT_REPO_PATH, MAX_NOTE, MAX_SHOT_BYTES } from '../public/defaults.js';
import { expandHome, shotsDir as defaultShotsDir } from './paths.js';
import { buildIntent } from './prompt.js';

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isStr = (v) => typeof v === 'string';

// The frame comes from a same-origin page, but the pick inside it came from
// another site: check shape and size, never trust content.
export function validateLaunch(msg) {
  if (!isStr(msg.requestId) || !/^[A-Za-z0-9-]{1,64}$/.test(msg.requestId)) throw new Error('ui-picker: bad requestId');
  if (!Object.hasOwn(ACTIONS, msg.action)) throw new Error('ui-picker: unknown action');
  if (!isStr(msg.note) || !msg.note.trim() || msg.note.length > MAX_NOTE) throw new Error('ui-picker: note must be 1-4096 characters');
  const p = msg.pick;
  if (!p || !isStr(p.url) || !isStr(p.html) || !Array.isArray(p.owners) || !p.element || !isStr(p.element.tag)) {
    throw new Error('ui-picker: malformed pick');
  }
  if (msg.screenshot != null) {
    if (!isStr(msg.screenshot) || !msg.screenshot.startsWith(PNG_PREFIX)) throw new Error('ui-picker: screenshot must be a PNG');
    if ((msg.screenshot.length - PNG_PREFIX.length) * 0.75 > MAX_SHOT_BYTES) throw new Error('ui-picker: screenshot too large');
    // Same rule as core's paste-image.js: check the bytes, not just the label.
    const head = Buffer.from(msg.screenshot.slice(PNG_PREFIX.length, PNG_PREFIX.length + 12), 'base64');
    if (!head.subarray(0, 8).equals(PNG_SIG)) throw new Error('ui-picker: screenshot is not a PNG');
  }
}

export function createLaunchHandler({ fs = nodeFs, shotsDir = defaultShotsDir, now = Date.now } = {}) {
  return {
    type: 'ui-picker-launch',
    async handler(msg, host) {
      validateLaunch(msg);
      const repoSetting = host.settings.get('repoPath') || DEFAULT_REPO_PATH;
      let shotPath = null;
      if (msg.screenshot) {
        const dir = shotsDir();
        await fs.mkdir(dir, { recursive: true });
        shotPath = path.join(dir, `${now()}-${msg.requestId}.png`);
        await fs.writeFile(shotPath, Buffer.from(msg.screenshot.slice(PNG_PREFIX.length), 'base64'));
      }
      const intent = buildIntent({
        action: msg.action, note: msg.note.trim(), pick: msg.pick, repoPath: expandHome(repoSetting), shotPath,
      });
      const taskId = host.settings.get('taskId') || undefined;
      const { sessionId } = await host.sessions.spawn({
        cwd: repoSetting,
        intent,
        worktree: host.settings.get('useWorktree') === false ? undefined : { auto: true },
        addDirs: shotPath ? [path.dirname(shotPath)] : undefined,
        taskId,
      });
      host.broadcast({ requestId: msg.requestId, sessionId });
    },
  };
}
