import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLaunch, createLaunchHandler } from '../server/launch.js';

const PNG = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nxx', 'binary').toString('base64');
const pick = { url: 'http://localhost:3333/', element: { tag: 'div', id: '', classes: [], text: '' }, html: '<div></div>', jsxAt: null, owners: [] };
const good = { type: 'ui-picker-launch', requestId: 'r1', action: 'fix', note: 'broken', pick, screenshot: PNG };

test('validateLaunch accepts a well-formed frame', () => {
  assert.doesNotThrow(() => validateLaunch(good));
  assert.doesNotThrow(() => validateLaunch({ ...good, screenshot: null }));
});

for (const [label, patch] of [
  ['unknown action', { action: 'delete' }],
  ['empty note', { note: '  ' }],
  ['huge note', { note: 'x'.repeat(5000) }],
  ['bad requestId', { requestId: '../x' }],
  ['missing pick', { pick: null }],
  ['pick without element', { pick: { ...pick, element: null } }],
  ['non-png screenshot', { screenshot: 'data:image/jpeg;base64,AAAA' }],
  ['non-string pick url', { pick: { ...pick, url: 1 } }],
  ['non-string pick html', { pick: { ...pick, html: null } }],
  ['oversize pick html', { pick: { ...pick, html: 'x'.repeat(4097) } }],
  ['non-string jsxAt', { pick: { ...pick, jsxAt: 5 } }],
  ['non-string element tag', { pick: { ...pick, element: { ...pick.element, tag: 1 } } }],
  ['non-string element id', { pick: { ...pick, element: { ...pick.element, id: 1 } } }],
  ['non-string element text', { pick: { ...pick, element: { ...pick.element, text: null } } }],
  ['non-array classes', { pick: { ...pick, element: { ...pick.element, classes: 'a' } } }],
  ['non-string class', { pick: { ...pick, element: { ...pick.element, classes: [1] } } }],
  ['too many classes', { pick: { ...pick, element: { ...pick.element, classes: ['a', 'b', 'c', 'd'] } } }],
  ['too many owners', { pick: { ...pick, owners: Array.from({ length: 9 }, () => ({ name: 'A', at: null })) } }],
  ['non-object owner', { pick: { ...pick, owners: ['A'] } }],
  ['null owner', { pick: { ...pick, owners: [null] } }],
  ['non-string owner name', { pick: { ...pick, owners: [{ name: 1, at: null }] } }],
  ['non-string owner at', { pick: { ...pick, owners: [{ name: 'A', at: 1 }] } }],
  ['png label on non-png bytes', { screenshot: 'data:image/png;base64,' + Buffer.from('GIF89a-not-png').toString('base64') }],
]) {
  test(`validateLaunch rejects ${label}`, () => {
    assert.throws(() => validateLaunch({ ...good, ...patch }));
  });
}

for (const bad of [null, undefined, 'str', 5]) {
  test(`validateLaunch rejects frame ${String(bad)}`, () => {
    assert.throws(() => validateLaunch(bad), /bad frame/);
  });
}

test('validateLaunch accepts owners with source and classes', () => {
  assert.doesNotThrow(() => validateLaunch({ ...good, pick: { ...pick, jsxAt: '/a.js:1', element: { ...pick.element, classes: ['a', 'b', 'c'] }, owners: [{ name: 'A', at: '/a.js:2' }] } }));
});

function fakeHost(settings = {}) {
  const calls = { spawn: [], broadcast: [] };
  return {
    calls,
    settings: { get: (k) => settings[k] },
    sessions: { spawn: async (opts) => { calls.spawn.push(opts); return { sessionId: 's-1' }; } },
    broadcast: (p) => calls.broadcast.push(p),
  };
}

function fakeFs() {
  const written = [];
  const unlinked = [];
  return { written, unlinked, mkdir: async () => {}, writeFile: async (p, buf) => written.push([p, buf]), unlink: async (p) => { unlinked.push(p); } };
}

test('handler saves the shot, spawns with defaults and broadcasts', async () => {
  const host = fakeHost();
  const fs = fakeFs();
  const { handler } = createLaunchHandler({ fs, shotsDir: () => '/data/shots', now: () => 1000 });
  await handler(good, host);
  assert.equal(fs.written.length, 1);
  assert.equal(fs.written[0][0], '/data/shots/1000-r1.png');
  const opts = host.calls.spawn[0];
  assert.equal(opts.cwd, '~/vcs/enterprise');
  assert.deepEqual(opts.worktree, { auto: true });
  assert.deepEqual(opts.addDirs, ['/data/shots']);
  assert.equal(opts.taskId, undefined);
  assert.match(opts.intent, /Screenshot: \/data\/shots\/1000-r1\.png/);
  assert.deepEqual(host.calls.broadcast, [{ requestId: 'r1', sessionId: 's-1' }]);
});

test('handler honours settings', async () => {
  const host = fakeHost({ repoPath: '/repo', useWorktree: false, taskId: 't-9' });
  const { handler } = createLaunchHandler({ fs: fakeFs(), shotsDir: () => '/data/shots', now: () => 1 });
  await handler({ ...good, screenshot: null }, host);
  const opts = host.calls.spawn[0];
  assert.equal(opts.cwd, '/repo');
  assert.equal(opts.worktree, undefined);
  assert.equal(opts.addDirs, undefined);
  assert.equal(opts.taskId, 't-9');
  assert.match(opts.intent, /Screenshot: none/);
});

test('handler does not spawn when validation fails', async () => {
  const host = fakeHost();
  const { handler } = createLaunchHandler({ fs: fakeFs(), shotsDir: () => '/d', now: () => 1 });
  await assert.rejects(handler({ ...good, action: 'nope' }, host));
  assert.equal(host.calls.spawn.length, 0);
});

test('handler unlinks the shot and rethrows when spawn rejects', async () => {
  const host = fakeHost();
  host.sessions.spawn = async () => { throw new Error('boom'); };
  const fs = fakeFs();
  const { handler } = createLaunchHandler({ fs, shotsDir: () => '/data/shots', now: () => 1000 });
  await assert.rejects(handler(good, host), /boom/);
  assert.deepEqual(fs.unlinked, ['/data/shots/1000-r1.png']);
});

test('handler ignores unlink errors when spawn rejects', async () => {
  const host = fakeHost();
  host.sessions.spawn = async () => { throw new Error('boom'); };
  const fs = fakeFs();
  fs.unlink = async () => { throw new Error('nope'); };
  const { handler } = createLaunchHandler({ fs, shotsDir: () => '/data/shots', now: () => 1000 });
  await assert.rejects(handler(good, host), /boom/);
});

test('handler writes no file when buildIntent fails', async () => {
  const host = fakeHost();
  const fs = fakeFs();
  const { handler } = createLaunchHandler({ fs, shotsDir: () => '/d', now: () => 1 });
  const badPick = { ...pick };
  Object.defineProperty(badPick, 'html', { get() { throw new Error('x'); }, enumerable: true });
  await assert.rejects(handler({ ...good, pick: badPick }, host));
  assert.equal(fs.written.length, 0);
});

test('handler trims repoPath and treats blank as unset', async () => {
  let host = fakeHost({ repoPath: '  /repo  ' });
  let h = createLaunchHandler({ fs: fakeFs(), shotsDir: () => '/d', now: () => 1 });
  await h.handler({ ...good, screenshot: null }, host);
  assert.equal(host.calls.spawn[0].cwd, '/repo');
  host = fakeHost({ repoPath: '   ' });
  h = createLaunchHandler({ fs: fakeFs(), shotsDir: () => '/d', now: () => 1 });
  await h.handler({ ...good, screenshot: null }, host);
  assert.equal(host.calls.spawn[0].cwd, '~/vcs/enterprise');
});
