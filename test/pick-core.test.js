import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fiberOf, debugAt, ownerChain, describeElement, capturePick, buildPayload, chooseProtocol, protocolsOf, containingElement, padRect, dragRect, shotFits, mostlyInside, descendants, componentEntry, outermostComponents, componentsInside, PAYLOAD_BUILDERS, PICK_CONTAINS_OVERLAP, PICK_MAX_CONTAINS, PICK_MAX_SHOT_BYTES, PICK_PROTOCOL, PICK_PROTOCOLS } from '../public/pick-core.js';
import { OPTIONAL_FIELDS } from '../public/defaults.js';
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
  assert.equal(p.type, 'point-and-prompt:pick');
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

function dragPick() {
  const page = component('Page', src('/a/App.js', 3), null);
  const host = { type: 'div', _debugSource: src('/a/Page.js', 20), _debugOwner: page };
  const raw = capturePick(el({ tag: 'DIV', className: 'scan-row', html: '<div></div>', fiber: host }), {
    url: 'http://h/', rect: { x: 1, y: 2, width: 3, height: 4 }, dpr: 2, build: 'abcd1234', drag: true,
  });
  raw.contains = [{ name: 'Badge', at: '/a/Page.js:30' }, { name: 'Actions', at: null }];
  raw.screenshot = 'data:image/png;base64,AAAA';
  return raw;
}

test('the v1 builder\'s drag output matches the golden v1 drag payload with contains', () => {
  const p = buildPayload(dragPick(), 1);
  const g = JSON.parse(fs.readFileSync(new URL('./fixtures/pick-v1-contains.json', import.meta.url), 'utf8'));
  assert.deepEqual(shape(p), shape(g));
  assert.equal(p.mode, 'drag');
  assert.deepEqual(p.contains, [{ name: 'Badge', at: '/a/Page.js:30' }, { name: 'Actions', at: null }]);
});

test('mode and contains are sent only for drags, and contains only when non-empty', () => {
  const click = buildPayload(rawPick(), 1);
  assert.equal('mode' in click, false);
  assert.equal('contains' in click, false);
  // A click never carries contains, even if one were captured.
  assert.equal('contains' in buildPayload({ ...rawPick(), contains: [{ name: 'X', at: null }] }, 1), false);
  const empty = buildPayload({ ...dragPick(), contains: [] }, 1);
  assert.equal(empty.mode, 'drag');
  assert.equal('contains' in empty, false);
});

test('every key the v1 builder can add beyond the golden payload is a declared optional field', () => {
  const required = Object.keys(golden(1)).filter((k) => !OPTIONAL_FIELDS[1].includes(k));
  for (const p of [buildPayload(rawPick(), 1), buildPayload(dragPick(), 1)]) {
    for (const k of required) assert.ok(k in p, k);
    for (const k of Object.keys(p)) assert.ok(required.includes(k) || OPTIONAL_FIELDS[1].includes(k), k);
  }
});

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

test('mostlyInside needs at least the overlap threshold of the box inside the rect', () => {
  assert.equal(PICK_CONTAINS_OVERLAP, 0.6);
  const rect = box(0, 0, 100, 100);
  assert.equal(mostlyInside(box(10, 10, 20, 20), rect), true);
  assert.equal(mostlyInside(box(60, 0, 100, 100), rect), false, '40% inside');
  assert.equal(mostlyInside(box(40, 0, 100, 100), rect), true, '60% inside');
  assert.equal(mostlyInside(box(41, 0, 100, 100), rect), false, '59% inside');
  assert.equal(mostlyInside(box(200, 200, 10, 10), rect), false, 'outside');
  assert.equal(mostlyInside(box(10, 10, 0, 20), rect), false, 'not rendered');
  assert.equal(mostlyInside(box(-50, -50, 200, 200), rect), false, 'a box larger than the rect is mostly outside');
});

test('descendants lists elements in document order, excluding the root, up to a cap', () => {
  const mk = (name, ...children) => ({ name, children });
  const root = mk('root', mk('a', mk('a1'), mk('a2')), mk('b', mk('b1')));
  assert.deepEqual(descendants(root, 100).map((e) => e.name), ['a', 'a1', 'a2', 'b', 'b1']);
  assert.deepEqual(descendants(root, 3).map((e) => e.name), ['a', 'a1', 'a2']);
  assert.deepEqual(descendants(mk('leaf'), 10), []);
});

// Fibers: component(name, at, owner) is a component; host(owner) a DOM element's fiber.
const host = (owner) => ({ type: 'div', _debugOwner: owner });

test('componentEntry names the component that rendered a host, where it is used, and its owners', () => {
  const page = component('Page', src('/a/App.js', 3), null);
  const row = component('Row', src('/a/Page.js', 9), page);
  assert.deepEqual(componentEntry(host(row)), { name: 'Row', at: '/a/Page.js:9', owners: ['Page\u0000/a/App.js:3'] });
  assert.equal(componentEntry(host(null)), null);
  assert.equal(componentEntry(null), null);
});

const entry = (name, at, owners = []) => ({ name, at, owners: owners.map(([n, a]) => `${n}\u0000${a}`) });

test('outermostComponents dedupes by name and source, keeping first-seen order', () => {
  const out = outermostComponents([entry('A', 'a:1'), entry('B', 'b:1'), entry('A', 'a:1'), entry('A', 'a:2')], [], 10);
  assert.deepEqual(out, [{ name: 'A', at: 'a:1' }, { name: 'B', at: 'b:1' }, { name: 'A', at: 'a:2' }]);
});

test('outermostComponents drops a component whose owner is also inside', () => {
  const out = outermostComponents([
    entry('Badge', 'r:40', [['Row', 'p:9'], ['Page', 'x:1']]),
    entry('Row', 'p:9', [['Page', 'x:1']]),
    entry('Icon', 'b:3', [['Badge', 'r:40'], ['Row', 'p:9'], ['Page', 'x:1']]),
    entry('Actions', 'r:88', [['Row2', 'p:10'], ['Page', 'x:1']]),
  ], [], 10);
  assert.deepEqual(out, [{ name: 'Row', at: 'p:9' }, { name: 'Actions', at: 'r:88' }]);
});

test('outermostComponents excludes the containing element\'s owners before keeping the outermost', () => {
  // The container is rendered by Row: Row is already in `owners`, so its children stand on their own.
  const out = outermostComponents([
    entry('Row', 'p:9', [['Page', 'x:1']]),
    entry('Badge', 'r:40', [['Row', 'p:9'], ['Page', 'x:1']]),
    entry('Icon', 'b:3', [['Badge', 'r:40'], ['Row', 'p:9'], ['Page', 'x:1']]),
    entry('Actions', 'r:88', [['Row', 'p:9'], ['Page', 'x:1']]),
  ], ['Row\u0000p:9', 'Page\u0000x:1'], 10);
  assert.deepEqual(out, [{ name: 'Badge', at: 'r:40' }, { name: 'Actions', at: 'r:88' }]);
});

test('outermostComponents caps the list', () => {
  const many = Array.from({ length: 15 }, (_, i) => entry(`C${i}`, null));
  assert.equal(PICK_MAX_CONTAINS, 10);
  assert.deepEqual(outermostComponents(many, [], PICK_MAX_CONTAINS).map((c) => c.name), many.slice(0, 10).map((c) => c.name));
});

test('componentsInside reads host fibers and leaves out the container\'s own owner chain', () => {
  const page = component('Page', src('/a/App.js', 3), null);
  const row = component('Row', src('/a/Page.js', 9), page);
  const badge = component('Badge', src('/a/Row.js', 40), row);
  const icon = component('Icon', src('/a/Badge.js', 3), badge);
  const actions = component('Actions', src('/a/Row.js', 88), row);
  const container = host(row);
  const out = componentsInside([host(row), host(badge), host(icon), host(badge), host(actions), null], container, PICK_MAX_CONTAINS);
  assert.deepEqual(out, [{ name: 'Badge', at: '/a/Row.js:40' }, { name: 'Actions', at: '/a/Row.js:88' }]);
});

test('capturePick records a drag as mode drag, and a click with no mode', () => {
  const opts = { url: 'http://h/', rect: { x: 0, y: 0, width: 1, height: 1 }, dpr: 1, build: 'b' };
  assert.equal(capturePick(el({}), { ...opts, drag: true }).mode, 'drag');
  assert.equal('mode' in capturePick(el({}), opts), false);
});
