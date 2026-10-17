import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { ACTIONS, DEFAULT_REPO_PATH, MAX_HTML, MAX_NOTE, MAX_OWNERS, MAX_SHOT_BYTES } from '../public/defaults.js';
import { expandHome, shotsDir as defaultShotsDir } from './paths.js';
import { buildIntent } from './prompt.js';

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isStr = (v) => typeof v === 'string';

// The frame comes from a same-origin page, but the pick inside it came from
// another site: check shape and size, never trust content.
export function validateLaunch(msg) {
  const bad = (what) => { throw new Error(`ui-picker: ${what}`); };
  if (!msg || typeof msg !== 'object') bad('bad frame');
  if (!isStr(msg.requestId) || !/^[A-Za-z0-9-]{1,64}$/.test(msg.requestId)) bad('bad requestId');
  if (!Object.hasOwn(ACTIONS, msg.action)) bad('unknown action');
  if (!isStr(msg.note) || !msg.note.trim() || msg.note.length > MAX_NOTE) bad(`note must be 1-${MAX_NOTE} characters`);
  const p = msg.pick;
  if (!p || typeof p !== 'object' || !p.element || typeof p.element !== 'object') bad('malformed pick');
  if (!isStr(p.url)) bad('malformed pick: url');
  if (!isStr(p.html) || p.html.length > MAX_HTML) bad('malformed pick: html');
  if (p.jsxAt != null && !isStr(p.jsxAt)) bad('malformed pick: jsxAt');
  const el = p.element;
  if (!isStr(el.tag) || !isStr(el.id) || !isStr(el.text)) bad('malformed pick: element');
  if (!Array.isArray(el.classes) || el.classes.length > 3 || !el.classes.every(isStr)) bad('malformed pick: classes');
  if (!Array.isArray(p.owners) || p.owners.length > MAX_OWNERS) bad('malformed pick: owners');
  for (const o of p.owners) {
    if (!o || typeof o !== 'object' || !isStr(o.name) || (o.at != null && !isStr(o.at))) bad('malformed pick: owner');
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
      const repoSetting = (host.settings.get('repoPath') || '').trim() || DEFAULT_REPO_PATH;
      // Build everything that can throw before touching the disk.
      const dir = msg.screenshot ? shotsDir() : null;
      const shotPath = dir ? path.join(dir, `${now()}-${msg.requestId}.png`) : null;
      const intent = buildIntent({
        action: msg.action, note: msg.note.trim(), pick: msg.pick, repoPath: expandHome(repoSetting), shotPath,
      });
      if (shotPath) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(shotPath, Buffer.from(msg.screenshot.slice(PNG_PREFIX.length), 'base64'));
      }
      const taskId = host.settings.get('taskId') || undefined;
      let sessionId;
      try {
        ({ sessionId } = await host.sessions.spawn({
          cwd: repoSetting,
          intent,
          worktree: host.settings.get('useWorktree') === false ? undefined : { auto: true },
          addDirs: shotPath ? [dir] : undefined,
          taskId,
        }));
      } catch (err) {
        if (shotPath) await fs.unlink(shotPath).catch(() => {});
        throw err;
      }
      host.broadcast({ requestId: msg.requestId, sessionId });
    },
  };
}
