import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fiberOf, debugAt, ownerChain, describeElement, capturePick, buildPayload, chooseProtocol, protocolsOf, containingElement, padRect, dragRect, shotFits, mostlyInside, descendants, ownerPath, cutPath, instanceId, componentGroups, distinctComponents, componentGroupsInside, componentsInside, unionBox, clipBox, highlightBoxes, PAYLOAD_BUILDERS, PICK_CONTAINS_OVERLAP, PICK_MAX_CONTAINS, PICK_MAX_SHOT_BYTES, PICK_PROTOCOL, PICK_PROTOCOLS } from '../public/pick-core.js';
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
const strip = (path) => path.map(({ key, name, at }) => ({ key, name, at }));

test('ownerPath lists the components above a host, nearest first, up to the stop set', () => {
  const page = component('Page', src('/a/App.js', 3), null);
  const row = component('Row', src('/a/Page.js', 9), page);
  const anon = { type: 'div', _debugOwner: row }; // not a component: skipped
  const badge = component('Badge', src('/a/Row.js', 40), anon);
  assert.deepEqual(ownerPath(host(badge)).map((c) => c.name), ['Badge', 'Row', 'Page']);
  assert.deepEqual(strip(ownerPath(host(badge), new Set(['Row\u0000/a/Page.js:9']))), [{ key: 'Badge\u0000/a/Row.js:40', name: 'Badge', at: '/a/Row.js:40' }]);
  assert.deepEqual(strip(cutPath(ownerPath(host(badge)), new Set(['Row\u0000/a/Page.js:9']))), [{ key: 'Badge\u0000/a/Row.js:40', name: 'Badge', at: '/a/Row.js:40' }]);
  assert.deepEqual(ownerPath(null), []);
});

test('instanceId gives a fiber and its alternate one id, and other instances their own', () => {
  const ids = new WeakMap();
  const a = component('Row', src('/a/List.js', 5), null);
  const b = { ...a, alternate: a };
  a.alternate = b;
  const other = component('Row', src('/a/List.js', 5), null);
  assert.equal(instanceId(b, ids), instanceId(a, ids));
  assert.notEqual(instanceId(other, ids), instanceId(a, ids));
});

// Plain-data items: path given as [name, at, instance?] nearest first; the
// instance defaults to one per name and source.
const item = (inside, ...path) => ({
  inside, path: path.map(([name, at, id = `${name}@${at}`]) => ({ key: `${name}\u0000${at}`, name, at, id })),
});
const names = (groups) => groups.map((g) => g.name);
const plain = (groups) => groups.map(({ name, at }) => ({ name, at }));

test('componentGroups gathers each instance\'s elements, in first-seen order', () => {
  const out = componentGroups([item(true, ['A', 'a:1']), item(true, ['B', 'b:1']), item(true, ['A', 'a:1']), item(true, ['A', 'a:2'])]);
  assert.deepEqual(plain(out), [{ name: 'A', at: 'a:1' }, { name: 'B', at: 'b:1' }, { name: 'A', at: 'a:2' }]);
  assert.deepEqual(out[0].items, [0, 2]);
});

test('componentGroups keeps the outermost and folds nested components into it', () => {
  const out = componentGroups([
    item(true, ['Badge', 'r:40'], ['Row', 'p:9']),
    item(true, ['Row', 'p:9']),
    item(true, ['Icon', 'b:3'], ['Badge', 'r:40'], ['Row', 'p:9']),
    item(true, ['Actions', 'r:88'], ['Row2', 'p:10']),
  ]);
  assert.deepEqual(out.map(({ name, items }) => ({ name, items })), [
    { name: 'Row', items: [0, 1, 2] },
    { name: 'Row2', items: [3] },
  ]);
});

test('componentGroups lists a component that renders only other components', () => {
  // Page returns <Layout><Card/></Layout>; only Card renders DOM.
  const out = componentGroups([item(true, ['Card', 'p:5'], ['Layout', 'p:4'], ['Page', 'a:1'])]);
  assert.deepEqual(names(out), ['Page']);
  assert.deepEqual(out[0].items, [0]);
});

test('componentGroups leaves out an instance partly outside, but lists its child wholly inside', () => {
  const out = componentGroups([
    item(true, ['Panel', 'p:1']),
    item(false, ['Panel', 'p:1']),
    item(true, ['Child', 'x:2'], ['Panel', 'p:1']),
  ]);
  assert.deepEqual(out.map(({ name, items }) => ({ name, items })), [{ name: 'Child', items: [2] }]);
});

test('componentGroups judges each instance on its own: rows from one map, some inside', () => {
  // Five Rows at List.js:12 (one per .map item), each with a Badge; rows 1-3 inside.
  const rows = [0, 1, 2, 3, 4].flatMap((n) => {
    const inside = n >= 1 && n <= 3;
    return [
      item(inside, ['Row', 'List.js:12', `row${n}`]),
      item(inside, ['Badge', 'Row.js:40', `badge${n}`], ['Row', 'List.js:12', `row${n}`]),
    ];
  });
  const out = componentGroups(rows);
  assert.deepEqual(out.map((g) => [g.name, g.items]), [['Row', [2, 3]], ['Row', [4, 5]], ['Row', [6, 7]]]);
  assert.deepEqual(distinctComponents(out, 10), [{ name: 'Row', at: 'List.js:12' }], 'listed once; Badge only via its Row');
});

test('componentGroups lists a Row inside even when another Row with the same key is outside', () => {
  const out = componentGroups([item(true, ['Row', 'L:1', 'r1']), item(false, ['Row', 'L:1', 'r2'])]);
  assert.deepEqual(distinctComponents(out, 10), [{ name: 'Row', at: 'L:1' }]);
});

test('distinctComponents dedupes by name and source and caps the list', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ key: `C${i}`, name: `C${i}`, at: null, items: [] }));
  assert.equal(PICK_MAX_CONTAINS, 10);
  assert.deepEqual(distinctComponents([...many.slice(0, 2), many[0], ...many.slice(2)], PICK_MAX_CONTAINS).map((c) => c.name),
    many.slice(0, 10).map((m) => m.name));
});

const AREA = box(0, 0, 100, 100);
const IN = box(10, 10, 20, 20);
const OUT = box(200, 200, 20, 20);

test('componentsInside reads fibers and leaves out the container\'s own owner chain', () => {
  const page = component('Page', src('/a/App.js', 3), null);
  const row = component('Row', src('/a/Page.js', 9), page);
  const badge = component('Badge', src('/a/Row.js', 40), row);
  const icon = component('Icon', src('/a/Badge.js', 3), badge);
  const actions = component('Actions', src('/a/Row.js', 88), row);
  const container = host(row);
  const els = [host(row), host(badge), host(icon), host(badge), host(actions), null].map((fiber) => ({ fiber, box: IN }));
  assert.deepEqual(componentsInside(els, container, AREA, PICK_MAX_CONTAINS),
    [{ name: 'Badge', at: '/a/Row.js:40' }, { name: 'Actions', at: '/a/Row.js:88' }]);
  // The groups say which elements were folded into each component.
  assert.deepEqual(componentGroupsInside(els, container, AREA).map((g) => g.items), [[1, 2, 3], [4]]);
});

test('componentGroupsInside takes cached full paths in place of fibers', () => {
  const ids = new WeakMap();
  const page = component('Page', src('/a/App.js', 3), null);
  const row = component('Row', src('/a/Page.js', 9), page);
  const badge = component('Badge', src('/a/Row.js', 40), row);
  const els = [{ path: ownerPath(host(badge), undefined, ids), box: IN }, { path: null, box: IN }];
  assert.deepEqual(plain(componentGroupsInside(els, host(row), AREA, ids)), [{ name: 'Badge', at: '/a/Row.js:40' }]);
});

test('componentsInside treats a fiber and its alternate as one instance', () => {
  const app = component('App', src('/a/index.js', 1), null);
  const row = component('Row', src('/a/App.js', 3), app);
  const alt = { ...row, alternate: row };
  row.alternate = alt;
  // One element holds the current copy, the other the alternate; one is outside.
  const els = [{ fiber: host(row), box: IN }, { fiber: host(alt), box: OUT }];
  assert.deepEqual(componentsInside(els, host(app), AREA, 10), []);
  assert.deepEqual(componentsInside([{ fiber: host(row), box: IN }, { fiber: host(alt), box: IN }], host(app), AREA, 10).map((c) => c.name), ['Row']);
  assert.equal(componentGroupsInside([{ fiber: host(row), box: IN }, { fiber: host(alt), box: IN }], host(app), AREA).length, 1);
});

test('componentsInside lists three selected rows of five once, as Row', () => {
  const app = component('App', src('/a/index.js', 1), null);
  const list = component('List', src('/a/App.js', 3), app);
  const els = [];
  for (let n = 0; n < 5; n += 1) {
    const row = component('Row', src('/a/List.js', 12), list);
    const badge = component('Badge', src('/a/Row.js', 40), row);
    const b = n >= 1 && n <= 3 ? IN : OUT;
    els.push({ fiber: host(row), box: b }, { fiber: host(badge), box: b });
  }
  assert.deepEqual(componentsInside(els, host(list), AREA, 10), [{ name: 'Row', at: '/a/List.js:12' }]);
  assert.equal(componentGroupsInside(els, host(list), AREA).length, 3, 'one group per selected row');
});

test('componentsInside lists a composition-only component wholly inside the area', () => {
  const app = component('App', src('/a/index.js', 1), null);
  const page = component('Page', src('/a/App.js', 3), app);
  const card = component('Card', src('/a/Page.js', 5), page);
  const cardHost = { type: 'div', _debugOwner: card };
  assert.deepEqual(componentsInside([{ fiber: cardHost, box: IN }], host(app), AREA, 10).map((c) => c.name), ['Page']);
});

test('componentsInside ignores unrendered elements and counts those outside the area', () => {
  const app = component('App', src('/a/index.js', 1), null);
  const panel = component('Panel', src('/a/App.js', 3), app);
  const child = component('Child', src('/a/Panel.js', 8), panel);
  const container = host(app);
  const els = [
    { fiber: host(panel), box: IN },
    { fiber: host(panel), box: box(10, 10, 0, 0) }, // hidden: ignored
    { fiber: host(child), box: IN },
  ];
  assert.deepEqual(componentsInside(els, container, AREA, 10).map((c) => c.name), ['Panel']);
  els.push({ fiber: host(panel), box: OUT });
  assert.deepEqual(componentsInside(els, container, AREA, 10).map((c) => c.name), ['Child']);
});

test('a recursive component used where the container\'s owner is used is left out with its inner copies, deliberately', () => {
  // The container is rendered by Tree at Tree.js:7; an inner Tree used at the same
  // place has the same name and source, so it reads as the owner already listed.
  const app = component('App', src('/a/index.js', 1), null);
  const outer = component('Tree', src('/a/Tree.js', 7), app);
  const inner = component('Tree', src('/a/Tree.js', 7), outer);
  const leaf = component('Leaf', src('/a/Tree.js', 9), inner);
  const container = host(outer);
  // The inner Tree is not listed; Leaf, a different component inside it, is.
  assert.deepEqual(componentsInside([{ fiber: host(inner), box: IN }, { fiber: host(leaf), box: IN }], container, AREA, 10),
    [{ name: 'Leaf', at: '/a/Tree.js:9' }]);
});

test('capturePick records a drag as mode drag, and a click with no mode', () => {
  const opts = { url: 'http://h/', rect: { x: 0, y: 0, width: 1, height: 1 }, dpr: 1, build: 'b' };
  assert.equal(capturePick(el({}), { ...opts, drag: true }).mode, 'drag');
  assert.equal('mode' in capturePick(el({}), opts), false);
});

test('unionBox spans every box, or is null for none', () => {
  assert.deepEqual(unionBox([box(10, 20, 30, 40), box(0, 50, 5, 5)]), box(0, 20, 40, 40));
  assert.deepEqual(unionBox([box(1, 2, 3, 4)]), box(1, 2, 3, 4));
  assert.equal(unionBox([]), null);
});

test('clipBox clips to the viewport, or is null when nothing is left', () => {
  const vp = { width: 800, height: 600 };
  assert.deepEqual(clipBox(box(-10, -20, 50, 50), vp), box(0, 0, 40, 30));
  assert.deepEqual(clipBox(box(780, 590, 50, 50), vp), box(780, 590, 20, 10));
  assert.equal(clipBox(box(900, 0, 10, 10), vp), null);
  assert.equal(clipBox(box(10, 10, 0, 10), vp), null);
});

test('highlightBoxes outlines each instance with the union of its elements\' boxes, clipped, tagging the first of each component', () => {
  const vp = { width: 800, height: 600 };
  const boxes = [box(0, 0, 10, 10), box(100, 100, 20, 20), box(150, 90, 10, 10), box(790, 10, 50, 10), box(900, 900, 5, 5), box(0, 300, 10, 10)];
  const groups = [
    { key: 'A', name: 'A', at: null, items: [1, 2] },
    { key: 'B', name: 'B', at: 'b:1', items: [3] },
    { key: 'G', name: 'Gone', at: null, items: [4] },
    { key: 'A', name: 'A', at: null, items: [5] },
  ];
  assert.deepEqual(highlightBoxes(groups, boxes, vp, 10), [
    { name: 'A', box: box(100, 90, 60, 30), tag: true },
    { name: 'B', box: box(790, 10, 10, 10), tag: true },
    { name: 'A', box: box(0, 300, 10, 10), tag: false },
  ]);
  assert.equal(highlightBoxes(groups, boxes, vp, 2).length, 2);
});

test('highlightBoxes spends its cap on each distinct component before repeat instances', () => {
  const vp = { width: 800, height: 600 };
  const boxes = Array.from({ length: 13 }, (_, i) => box(0, i * 20, 10, 10));
  const rows = Array.from({ length: 12 }, (_, i) => ({ key: 'Row', name: 'Row', at: 'r:1', items: [i] }));
  const groups = [...rows, { key: 'Footer', name: 'Footer', at: 'f:1', items: [12] }];
  const out = highlightBoxes(groups, boxes, vp, 10);
  assert.equal(out.length, 10);
  // Footer is listed in the pick, so it must be outlined even though twelve rows came first.
  assert.ok(out.some((o) => o.name === 'Footer' && o.tag));
  assert.equal(out.filter((o) => o.tag).length, 2);
  // Kept outlines stay in document order.
  assert.deepEqual(out.map((o) => o.box.y), [...out.map((o) => o.box.y)].sort((a, b) => a - b));
});
