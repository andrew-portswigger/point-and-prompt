// A minimal DOM: just enough of Document/Element for the settings panel.
class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.value = '';
    this._text = '';
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? Object.assign(new FakeElement(this.ownerDocument, '#text'), { _text: n }) : n;
      node.parentElement = this;
      this.children.push(node);
    }
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  find(pred) { return this.all().find(pred); }
  byTag(tag) { return this.all().filter((c) => c.tagName === tag.toUpperCase()); }
  byClass(cls) { return this.all().filter((c) => c.className.split(/\s+/).includes(cls)); }
}

export function fakeDocument() {
  const doc = { createElement: (tag) => new FakeElement(doc, tag) };
  return doc;
}
