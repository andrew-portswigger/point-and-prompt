import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDocument } from './fake-dom.js';
import { settingsPanel, cleanSettings, PICK_CORE_URL, MAIN_URL } from '../public/settings-panel.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const SOURCES = { [PICK_CORE_URL]: read('pick-core.js'), [MAIN_URL]: read('bookmarklet-main.js') };
const ORIGIN = 'http://localhost:7777';

function setup({ settings = {}, fetchText, set } = {}) {
  const writes = [];
  const api = {
    settings: Object.assign(() => ({ ...settings }), {
      set: (key, value) => { writes.push([key, value]); return set ? set(key, value) : Promise.resolve(); },
    }),
  };
  const fetched = [];
  const contribution = settingsPanel({
    fetchText: fetchText || ((url) => { fetched.push(url); return url in SOURCES ? Promise.resolve(SOURCES[url]) : Promise.reject(new Error('404')); }),
    origin: ORIGIN,
  });
  const el = fakeDocument().createElement('div');
  contribution.mount(el, api);
  const repo = el.find((n) => n.tagName === 'INPUT');
  const origins = el.find((n) => n.tagName === 'TEXTAREA');
  const link = el.find((n) => n.tagName === 'A');
  const errorEl = el.find((n) => n.getAttribute('role') === 'alert');
  return { contribution, el, api, writes, fetched, repo, origins, link, errorEl };
}
const flush = () => new Promise((r) => setImmediate(r));

test('renders the setup steps, how-to and both settings', () => {
  const { el, repo, origins, contribution } = setup();
  assert.equal(contribution.id, 'ui-picker');
  const steps = el.byTag('ol')[0].byTag('li').map((li) => li.textContent);
  assert.equal(steps.length, 3);
  assert.match(steps[0], /Drag the button below to your bookmarks bar/);
  assert.match(steps[1], /allow pop-ups/i);
  assert.match(steps[2], /@babel\/preset-react/);
  assert.match(el.textContent, /How to use/);
  assert.match(el.textContent, /Share the tab/);
  assert.match(el.textContent, /Repository path/);
  assert.match(el.textContent, /Allowed page origins/);
  assert.equal(repo.placeholder, '~/vcs/enterprise');
  assert.ok(origins);
});

test('the link is the bookmarklet built from the extension sources with this origin', async () => {
  const { link, fetched } = setup();
  await flush();
  assert.deepEqual(fetched.sort(), [MAIN_URL, PICK_CORE_URL].sort());
  assert.equal(link.textContent, 'UI Picker');
  assert.ok(link.href.startsWith('javascript:'));
  assert.match(decodeURIComponent(link.href), /"http:\/\/localhost:7777"/);
});

test('fetches the sources from the extension path', () => {
  assert.equal(PICK_CORE_URL, '/ext/ui-picker/pick-core.js');
  assert.equal(MAIN_URL, '/ext/ui-picker/bookmarklet-main.js');
});

test('clicking the link does nothing and says to drag it', async () => {
  const { link, el } = setup();
  await flush();
  const event = link.dispatch('click');
  assert.equal(event.defaultPrevented, true);
  assert.match(el.textContent, /Drag it to your bookmarks bar/);
});

test('a failed fetch says how to retry', async () => {
  const { link, el } = setup({ fetchText: () => Promise.reject(new Error('down')) });
  await flush();
  assert.match(el.textContent, /Couldn't build the bookmarklet — reopen Settings to retry\./);
  assert.ok(!link.href || !link.href.startsWith('javascript:'));
});

test('prefills from api.settings()', () => {
  const { repo, origins } = setup({ settings: { repoPath: '/src/ent', allowedOrigins: ['http://a:1', 'https://b.example'] } });
  assert.equal(repo.value, '/src/ent');
  assert.equal(origins.value, 'http://a:1\nhttps://b.example');
});

test('prefills empty when nothing is set', () => {
  const { repo, origins } = setup({ settings: {} });
  assert.equal(repo.value, '');
  assert.equal(origins.value, '');
});

test('save writes both settings with cleaned values', async () => {
  const { contribution, el, repo, origins, writes } = setup();
  repo.value = '  /src/ent  ';
  origins.value = ' http://a:1 \n\nhttps://b.example\nhttp://a:1\n  ';
  await contribution.save(el);
  assert.deepEqual(writes, [['repoPath', '/src/ent'], ['allowedOrigins', ['http://a:1', 'https://b.example']]]);
});

test('save writes empty values when the fields are blank', async () => {
  const { contribution, el, repo, origins, writes } = setup({ settings: { repoPath: 'x', allowedOrigins: ['http://a:1'] } });
  repo.value = '   ';
  origins.value = '\n  \n';
  await contribution.save(el);
  assert.deepEqual(writes, [['repoPath', ''], ['allowedOrigins', []]]);
});

test('an invalid origin rejects with an inline error naming it and writes nothing', async () => {
  const { contribution, el, origins, writes, errorEl } = setup();
  origins.value = 'http://a:1\nhttp://b:2/path';
  await assert.rejects(contribution.save(el), /http:\/\/b:2\/path/);
  assert.deepEqual(writes, []);
  assert.match(errorEl.textContent, /http:\/\/b:2\/path/);
});

test('a later valid save clears the inline error', async () => {
  const { contribution, el, origins, errorEl } = setup();
  origins.value = 'nope';
  await assert.rejects(contribution.save(el));
  origins.value = 'http://a:1';
  await contribution.save(el);
  assert.equal(errorEl.textContent, '');
});

test('a rejected write shows its message and rejects', async () => {
  const { contribution, el, errorEl } = setup({ set: () => Promise.reject(new Error('too long')) });
  await assert.rejects(contribution.save(el), /too long/);
  assert.match(errorEl.textContent, /too long/);
});

test('update refreshes fields the user has not edited and keeps edited ones', () => {
  const settings = { repoPath: 'old', allowedOrigins: ['http://a:1'] };
  const { contribution, el, repo, origins, api } = setup({ settings });
  repo.value = 'typing';
  repo.dispatch('input');
  api.settings = Object.assign(() => ({ repoPath: 'new', allowedOrigins: ['http://z:9'] }), { set: api.settings.set });
  contribution.update(el);
  assert.equal(repo.value, 'typing');
  assert.equal(origins.value, 'http://z:9');
});

test('after a save, fields follow the stored values again', async () => {
  const { contribution, el, repo, api } = setup();
  repo.value = 'mine';
  repo.dispatch('input');
  await contribution.save(el);
  api.settings = Object.assign(() => ({ repoPath: 'server' }), { set: api.settings.set });
  contribution.update(el);
  assert.equal(repo.value, 'server');
});

test('cleanSettings validates origins', () => {
  assert.deepEqual(cleanSettings({ repoPath: ' a ', originsText: 'https://x.example:8443\r\nhttp://y' }), {
    repoPath: 'a', allowedOrigins: ['https://x.example:8443', 'http://y'],
  });
  for (const bad of ['ftp://x', 'http://x/', 'localhost:3333', 'http://x?q', 'http://X.example', 'javascript:alert(1)']) {
    assert.throws(() => cleanSettings({ repoPath: '', originsText: bad }), (err) => err.message.includes(bad), bad);
  }
});
