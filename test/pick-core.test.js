import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiberOf, debugAt, ownerChain, describeElement, buildPayload } from '../public/pick-core.js';

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
