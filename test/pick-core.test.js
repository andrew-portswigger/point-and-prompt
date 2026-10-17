import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiberOf, debugAt, ownerChain, describeElement, buildPayload, containingElement, padRect, dragRect, shotFits, PICK_MAX_SHOT_BYTES } from '../public/pick-core.js';

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

test('buildPayload assembles a versioned pick', () => {
  const host = { type: 'td', _debugSource: src('/a/Table.js', 20), _debugOwner: null };
  const p = buildPayload(el({ html: 'x'.repeat(5000), fiber: host }), {
    url: 'http://h/', rect: { x: 1, y: 2, width: 3, height: 4 }, dpr: 2,
  });
  assert.equal(p.type, 'ui-picker:pick');
  assert.equal(p.version, 1);
  assert.equal(p.jsxAt, '/a/Table.js:20');
  assert.equal(p.html.length, 4096);
  assert.deepEqual(p.rect, { x: 1, y: 2, width: 3, height: 4, dpr: 2 });
});

test('buildPayload works on a non-React element', () => {
  const p = buildPayload(el({}), { url: 'http://h/', rect: { x: 0, y: 0, width: 0, height: 0 }, dpr: 1 });
  assert.equal(p.jsxAt, null);
  assert.deepEqual(p.owners, []);
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
