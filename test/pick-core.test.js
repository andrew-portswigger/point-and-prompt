import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fiberOf, debugAt, ownerChain, describeElement, capturePick, buildPayload, chooseProtocol, protocolsOf, containingElement, padRect, dragRect, shotFits, PAYLOAD_BUILDERS, PICK_MAX_SHOT_BYTES, PICK_PROTOCOL, PICK_PROTOCOLS } from '../public/pick-core.js';
import { shape } from './shape.js';

const src = (fileName, lineNumber) => ({ fileName, lineNumber });

function component(name, at, owner) {
  return { type: Object.defineProperty(function () {}, 'name', { value: name }), _debugSource: at, _debugOwner: owner };
}

function el({ tag = 'DIV', id = '', className = '', text = '', html = '<div></div>', fiber, parent = null }) {
  const e = { tagName: tag, id, className, textContent: text, outerHTML: html, parentElement: parent };
  if (fiber) e['__reactFiber$abc'] = fiber;
  return e;
}

test('fiberOf finds the fiber on the element or nearest ancestor', () => {
  const f = { type: 'div' };
  const parent = el({ fiber: f });
  assert.equal(fiberOf(el({ parent })), f);
  assert.equal(fiberOf(el({})), null);
});

test('debugAt formats file:line or null', () => {
  assert.equal(debugAt({ _debugSource: src('/a/B.js', 7) }), '/a/B.js:7');
  assert.equal(debugAt({}), null);
});

test('ownerChain walks _debugOwner, nearest first, capped', () => {
  const page = component('Page', src('/a/App.js', 3), null);
  const table = component('Table', src('/a/Page.js', 9), page);
  const host = { type: 'td', _debugSource: src('/a/Table.js', 20), _debugOwner: table };
  assert.deepEqual(ownerChain(host, 8), [
    { name: 'Table', at: '/a/Page.js:9' },
    { name: 'Page', at: '/a/App.js:3' },
  ]);
  assert.equal(ownerChain(host, 1).length, 1);
});

test('ownerChain names forwardRef/memo and anonymous components', () => {
  const fwd = { type: { render: Object.defineProperty(function () {}, 'name', { value: 'Inner' }) }, _debugOwner: null };
  const anon = { type: { displayName: 'Shown' }, _debugOwner: fwd };
  const host = { type: 'span', _debugOwner: anon };
  assert.deepEqual(ownerChain(host, 8).map((o) => o.name), ['Shown', 'Inner']);
});

test('describeElement trims text and keeps three classes', () => {
  const d = describeElement(el({ tag: 'BUTTON', id: 'go', className: 'a b c d', text: '  Go\n now  ' }));
  assert.deepEqual(d, { tag: 'button', id: 'go', classes: ['a', 'b', 'c'], text: 'Go now' });
});

test('describeElement copes with SVG className objects', () => {
  assert.deepEqual(describeElement(el({ tag: 'svg', className: { baseVal: 'icon' } })).classes, ['icon']);
});

test('buildPayload assembles a pick from the captured facts, tagged with its protocol', () => {
  const host = { type: 'td', _debugSource: src('/a/Table.js', 20), _debugOwner: null };
  const raw = capturePick(el({ html: 'x'.repeat(5000), fiber: host }), {
    url: 'http://h/', rect: { x: 1, y: 2, width: 3, height: 4 }, dpr: 2, build: 'b',
  });
  const p = buildPayload(raw, 1);
  assert.equal(p.type, 'ui-picker:pick');
  assert.equal(p.protocol, PICK_PROTOCOL);
  assert.equal('version' in p, false);
  assert.equal(p.jsxAt, '/a/Table.js:20');
  assert.equal(p.html.length, 4096);
  assert.deepEqual(p.rect, { x: 1, y: 2, width: 3, height: 4, dpr: 2 });
});

test('buildPayload works on a non-React element', () => {
  const p = buildPayload(capturePick(el({}), { url: 'http://h/', rect: { x: 0, y: 0, width: 0, height: 0 }, dpr: 1, build: 'b' }), 1);
  assert.equal(p.jsxAt, null);
  assert.deepEqual(p.owners, []);
});

test('chooseProtocol picks the highest protocol both sides speak, or null', () => {
  assert.equal(chooseProtocol([1], [1]), 1);
  assert.equal(chooseProtocol([1, 2], [1, 2, 3]), 2);
  assert.equal(chooseProtocol([3, 1], [1, 3]), 3);
  assert.equal(chooseProtocol([1], [2]), null);
  assert.equal(chooseProtocol([1], []), null);
});

const box = (x, y, width, height) => ({ x, y, width, height });

function tree() {
  const root = { name: 'root', parentElement: null, r: box(0, 0, 1000, 800) };
  const parent = { name: 'parent', parentElement: root, r: box(100, 100, 400, 200) };
  const left = { name: 'left', parentElement: parent, r: box(100, 100, 200, 200) };
  const right = { name: 'right', parentElement: parent, r: box(300, 100, 200, 200) };
  return { root, parent, left, right, rectOf: (el) => el.r };
}

test('containingElement returns the start when it contains the rect', () => {
  const t = tree();
  assert.equal(containingElement(t.left, box(120, 120, 50, 50), t.rectOf, 'body'), t.left);
});

test('containingElement walks up to the parent of a rect spanning two children', () => {
  const t = tree();
  assert.equal(containingElement(t.left, box(250, 150, 100, 20), t.rectOf, 'body'), t.parent);
});

test('containingElement treats edges as contained', () => {
  const t = tree();
  assert.equal(containingElement(t.left, box(100, 100, 200, 200), t.rectOf, 'body'), t.left);
});

test('containingElement falls back when nothing contains the rect', () => {
  const t = tree();
  assert.equal(containingElement(t.left, box(900, 700, 200, 200), t.rectOf, 'body'), 'body');
  assert.equal(containingElement(null, box(0, 0, 1, 1), t.rectOf, 'body'), 'body');
});

test('padRect pads and clamps to the viewport', () => {
  const vp = { width: 800, height: 600 };
  assert.deepEqual(padRect(box(100, 100, 50, 20), 8, vp), box(92, 92, 66, 36));
  assert.deepEqual(padRect(box(2, 3, 50, 20), 8, vp), box(0, 0, 60, 31));
  assert.deepEqual(padRect(box(760, 590, 50, 20), 8, vp), box(752, 582, 48, 18));
  assert.deepEqual(padRect(box(-50, -50, 20, 20), 8, vp), box(0, 0, 0, 0));
});

test('dragRect normalises two corners in any order', () => {
  assert.deepEqual(dragRect({ x: 50, y: 10 }, { x: 20, y: 40 }), box(20, 10, 30, 30));
});

test('shotFits checks the PNG prefix and the decoded size', () => {
  const prefix = 'data:image/png;base64,';
  assert.equal(shotFits(prefix + 'AAAA'), true);
  assert.equal(shotFits('data:,'), false);
  assert.equal(shotFits('data:image/jpeg;base64,AAAA'), false);
  assert.equal(shotFits(null), false);
  const max = Math.floor(PICK_MAX_SHOT_BYTES / 3) * 4;
  assert.equal(shotFits(prefix + 'A'.repeat(max)), true);
  assert.equal(shotFits(prefix + 'A'.repeat(max + 4)), false);
});

const golden = (protocol) => JSON.parse(fs.readFileSync(new URL(`./fixtures/pick-v${protocol}.json`, import.meta.url), 'utf8'));

function rawPick() {
  const page = component('Page', src('/a/App.js', 3), null);
  const host = { type: 'td', _debugSource: src('/a/Table.js', 20), _debugOwner: page };
  const raw = capturePick(el({ tag: 'TD', className: 'cell', text: 'hi', html: '<td>hi</td>', fiber: host }), {
    url: 'http://h/', rect: { x: 1, y: 2, width: 3, height: 4 }, dpr: 2, build: 'abcd1234',
  });
  // The screenshot is added by the bookmarklet once the grab settles.
  raw.screenshot = 'data:image/png;base64,AAAA';
  return raw;
}

for (const protocol of PICK_PROTOCOLS) {
  test(`the v${protocol} builder's output matches the golden v${protocol} payload`, () => {
    const p = buildPayload(rawPick(), protocol);
    const g = golden(protocol);
    assert.deepEqual(shape(p), shape(g));
    assert.equal(p.type, g.type);
    assert.equal(p.protocol, protocol);
    assert.equal(p.build, 'abcd1234');
  });
}

test('the bookmarklet speaks exactly the protocols it has builders for', () => {
  assert.deepEqual(PICK_PROTOCOLS, protocolsOf(PAYLOAD_BUILDERS));
  assert.equal(PICK_PROTOCOL, Math.max(...PICK_PROTOCOLS));
});

test('choosing 1 from a board advertising [1, 2] builds the v1 shape', () => {
  const protocol = chooseProtocol(PICK_PROTOCOLS, [1, 2]);
  assert.equal(protocol, 1);
  assert.deepEqual(shape(buildPayload(rawPick(), protocol)), shape(golden(1)));
});

test('the payload is built by the agreed protocol\'s builder, not the newest one', () => {
  const builders = { 1: (raw) => ({ protocol: 1, url: raw.url }), 2: (raw) => ({ protocol: 2, href: raw.url }) };
  assert.deepEqual(protocolsOf(builders), [1, 2]);
  const protocol = chooseProtocol(protocolsOf(builders), [1]);
  assert.deepEqual(buildPayload(rawPick(), protocol, builders), { protocol: 1, url: 'http://h/' });
});

test('without a screenshot the payload has no screenshot key', () => {
  const { screenshot: _, ...raw } = rawPick();
  assert.equal('screenshot' in buildPayload(raw, 1), false);
});
