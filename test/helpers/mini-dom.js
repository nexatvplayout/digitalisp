// DOM mínimo para os testes das janelas da classificação indicativa (public/viewer/classind-ui.js e tv/web/parental.js):
// elementos com filhos, classes, atributos, estilo, eventos, innerHTML = '' e um querySelector/All que entende o que essas
// janelas usam (tag, .classe, tag.classe, [atributo] e listas com vírgula). Não é um navegador: só o bastante para clicar,
// digitar e ler os textos.
class ClassList {
  constructor(el) { this.el = el; }
  #all() { return String(this.el.className || '').split(/\s+/).filter(Boolean); }
  contains(c) { return this.#all().includes(c); }
  add(...cs) { const s = new Set(this.#all()); cs.forEach((c) => s.add(c)); this.el.className = [...s].join(' '); }
  remove(...cs) { this.el.className = this.#all().filter((c) => !cs.includes(c)).join(' '); }
  toggle(c, on) { const want = on === undefined ? !this.contains(c) : Boolean(on); if (want) this.add(c); else this.remove(c); return want; }
}

export class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.parentNode = null; this.attrs = {}; this.style = {}; this.listeners = {};
    this.className = ''; this._text = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.classList = new ClassList(this);
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get firstChild() { return this.children[0] || null; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v || '').replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this.textContent; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'hidden') this.hidden = true; }
  getAttribute(k) { return k === 'class' ? this.className : (this.attrs[k] ?? null); }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
  // como no navegador, append(null) não é ignorado (lá vira o texto "null"): aqui é erro, para o teste pegar
  append(...kids) { for (const k of kids.flat()) { if (k == null) throw new TypeError('append(null): o navegador escreveria "null"'); } for (const k of kids.flat()) this.appendChild(typeof k === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: k }) : k); }
  appendChild(k) { if (k.parentNode) k.parentNode.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  prepend(k) { if (k.parentNode) k.parentNode.removeChild(k); k.parentNode = this; this.children.unshift(k); }
  insertBefore(k, ref) { if (k.parentNode) k.parentNode.removeChild(k); k.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, k); return k; }
  after(k) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); if (k.parentNode) k.parentNode.removeChild(k); k.parentNode = p; p.children.splice(i + 1, 0, k); }
  removeChild(k) { this.children = this.children.filter((c) => c !== k); k.parentNode = null; return k; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...kids) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; this.append(...kids); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatch(type, props = {}) {
    const e = { type, target: this, currentTarget: this, key: props.key, shiftKey: Boolean(props.shiftKey), preventDefault() {}, stopPropagation() {}, ...props };
    for (const fn of [...(this.listeners[type] || [])]) { e.currentTarget = this; fn(e); }
    return e;
  }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  closest(sel) { for (let x = this; x; x = x.parentNode) if (x.matches?.(sel)) return x; return null; }
  matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => matchOne(this, s)); }
  all() { const out = []; const walk = (n) => { for (const c of n.children) { if (c.tagName !== '#TEXT') { out.push(c); walk(c); } } }; walk(this); return out; }
  querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  /** O texto visível (sem os elementos escondidos). */
  visibleText() { if (this.hidden) return ''; return this._text + this.children.map((c) => (c.visibleText ? c.visibleText() : c._text)).join(' '); }
}

function matchOne(el, s) {
  if (el.tagName === '#TEXT') return false;
  const attr = /\[([\w-]+)\]$/.exec(s);
  if (attr) { if (el.attrs[attr[1]] == null) return false; s = s.slice(0, attr.index); }
  const m = /^([a-zA-Z]*)((?:\.[\w-]+)*)$/.exec(s);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const cls = m[2].split('.').filter(Boolean);
  return cls.every((c) => el.classList.contains(c));
}

export function miniDocument() {
  const doc = { activeElement: null, listeners: {} };
  doc.createElement = (t) => new El(t, doc);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = (id) => doc.documentElement.all().find((n) => n.id === id) || null;
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.addEventListener = (t, fn) => { (doc.listeners[t] ||= []).push(fn); };
  doc.removeEventListener = (t, fn) => { doc.listeners[t] = (doc.listeners[t] || []).filter((f) => f !== fn); };
  doc.key = (key, extra = {}) => { const e = { type: 'keydown', key, preventDefault() {}, stopPropagation() {}, ...extra }; for (const fn of [...(doc.listeners.keydown || [])]) fn(e); return e; };
  /** O botão (ou outro elemento) com este texto. */
  doc.byText = (text, root = doc.documentElement) => root.all().find((n) => n.textContent === text && n.children.length === 0) || root.all().find((n) => n.textContent === text) || null;
  return doc;
}

/** Armazenamento em memória com a API do localStorage. */
export function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
