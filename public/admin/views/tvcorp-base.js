// TV Corporativa · o que todas as abas usam (docs/TV-CORPORATIVA.md §5 e §6): a chamada à API (ou aos dados de exemplo),
// os campos, a tabela, a janela, as datas, a situação das telas e o seletor de alcance.
// O painel fala com /api/tvcorp/* (conteúdo, pacotes A e B) e com /api/tvcorp/rede/* (unidades, grupos, telas, chaves,
// comandos, captura, alertas e aprovações: as rotas da rede de telas servidas também para a TV Corporativa).
// Modo de exemplo (T.demo): nada vai ao servidor; as leituras saem de views/tvcorp-exemplo.js e as escritas não gravam.
import { el, api, guard, toast, state, store } from '../lib.js';
import { deviceStatus, STATUS_LABEL } from '../../shared/telas-tipos.js';
import { demoApi } from './tvcorp-exemplo.js';
import { SCOPES } from './tvcorp-catalogo.js';

export const T = { demo: false, data: null, skew: 0 };
const DEMO_KEY = 'nexa.tvcorp.exemplo';
export const demoWanted = () => store.get(DEMO_KEY) === '1';
export const setDemo = (on) => { T.demo = Boolean(on); store.set(DEMO_KEY, on ? '1' : null); };

/** A API do módulo (JSON). No modo de exemplo, a resposta sai dos dados de exemplo. */
export async function tapi(path, opts = {}) {
  if (T.demo) {
    const r = demoApi(path, opts);
    if ((opts.method || 'GET') !== 'GET') toast('Exemplo: nada foi gravado.');
    return structuredClone(r);
  }
  return api(path, opts);
}
/** Lista de uma resposta: a própria lista, .items ou .<chave>. */
export const listOf = (r, key = 'items') => (Array.isArray(r) ? r : Array.isArray(r?.[key]) ? r[key] : Array.isArray(r?.items) ? r.items : []);
const authHeaders = (extra = {}) => ({ ...extra, 'x-admin-token': state.token || '' });
const apiBase = () => (globalThis.window?.NEXA?.apiBase || '');
/** Envia o arquivo cru no corpo (imagem, logomarca, CSV). Devolve o JSON da resposta. */
export async function tupload(path, file, { method = 'POST', type } = {}) {
  if (T.demo) { toast('Exemplo: o arquivo não foi enviado.'); return { ok: true, id: 0 }; }
  const res = await fetch(`${apiBase()}${path}`, { method, headers: authHeaders({ 'content-type': type || file.type || 'application/octet-stream' }), body: file });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `Erro ${res.status}`), { code: out.code });
  return out;
}
/** Um arquivo do servidor (imagem, captura) como endereço blob: só desta página (a sessão vai no cabeçalho, nunca no endereço). */
const blobs = new Set();
export async function tblob(path) {
  if (T.demo) return null;
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error('arquivo');
  const u = URL.createObjectURL(await res.blob()); blobs.add(u); return u;
}
export const dropBlobs = () => { for (const u of blobs) URL.revokeObjectURL(u); blobs.clear(); };
/** Baixa um CSV do servidor (relatórios, exportação de pessoas). */
export async function tdownload(path, filename) {
  if (T.demo) { toast('Exemplo: no painel de verdade, aqui baixa o arquivo CSV.'); return; }
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) { const out = await res.json().catch(() => ({})); throw new Error(out.error || `Erro ${res.status}`); }
  const u = URL.createObjectURL(await res.blob());
  const a = el('a', { href: u, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}

/* ------------------------------------------------------------------ peças da tela */
/** replaceChildren sem os vazios (um null entre os filhos sairia escrito "null"). */
export const put = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));
export const f = (label, input, hint) => el('label', { class: 'pf-f' }, el('span', { text: label }), input, hint ? el('small', { class: 'dim', text: hint }) : null);
export const opt = (value, text, selected) => el('option', { value: String(value), text, selected: Boolean(selected) });
export const table = (heads, rows) => el('div', { class: 'pf-table' }, el('table', {}, el('thead', {}, el('tr', {}, ...heads.map((x) => el('th', { text: x })))), el('tbody', {}, ...rows)));
export const label = (text) => el('div', { class: 'label', text });
export const note = (text, cls = 'dim small') => el('p', { class: cls, text });
export const empty = (text) => el('p', { class: 'dim tc-empty', text });
export const btn = (text, onclick, cls = '') => el('button', { class: `btn${cls ? ` ${cls}` : ''}`, type: 'button', onclick }, text);
export const btns = (...kids) => el('div', { class: 'pf-btns left' }, ...kids.filter(Boolean));
export const chip = (text, cls = '') => el('span', { class: `pf-chip${cls ? ` ${cls}` : ''}`, text });
export const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** Janela de formulário (o mesmo visual da Prefeitura). save() devolve false para ficar aberta. */
export function dialog(title, body, { save = null, saveLabel = 'Salvar', wide = false, danger = false } = {}) {
  const dlg = el('dialog', { class: `fx-dlg pf-dlg tc-dlg${wide ? ' wide' : ''}` });
  const close = () => { dlg.close(); dlg.remove(); };
  const run = guard(async () => { b.disabled = true; try { if ((await save()) !== false) close(); } finally { b.disabled = false; } });
  const b = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: run }, saveLabel);
  dlg.append(...[
    el('header', { class: 'pf-dlg-head' }, el('h3', { text: title }), el('button', { class: 'btn small', type: 'button', 'aria-label': 'Fechar', onclick: close }, 'Fechar')),
    el('div', { class: 'pf-dlg-body' }, body),
    save ? el('footer', { class: 'pf-dlg-foot' }, el('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), b) : null].filter(Boolean));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal?.();
  return { dlg, close };
}
export const closeDialogs = () => document.querySelectorAll?.('dialog.tc-dlg').forEach((d) => { d.close(); d.remove(); });

/* ------------------------------------------------------------------ datas */
export const now = () => Date.now() + T.skew;
export const when = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const dayText = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
export function ago(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 90) return 'agora há pouco';
  if (sec < 3600) return `há ${Math.round(sec / 60)} min`;
  if (sec < 172800) return `há ${Math.round(sec / 3600)} h`;
  return `há ${Math.round(sec / 86400)} dias`;
}
/** YYYY-MM-DD de hoje menos n dias (no fuso do navegador). */
export function isoDay(offset = 0, base = Date.now()) {
  const d = new Date(base - offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Data e hora local (datetime-local) <-> epoch ms. */
export const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${isoDay(0, ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);
export const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);

/* ------------------------------------------------------------------ rede */
export const D = () => T.data;
export const officeOf = (id) => T.data?.offices.find((o) => o.id === id) || null;
export const active = () => (T.data?.devices || []).filter((d) => !d.revokedAt);
export const statusOf = (d) => deviceStatus(d, now());
export const STATUS = STATUS_LABEL;
/** Os grupos de uma tela: os manuais em que está e os automáticos do tipo da unidade dela. */
export const groupsOf = (d) => (T.data?.groups || []).filter((g) => (g.officeType ? g.officeType === officeOf(d.officeId)?.type : (d.groups || []).includes(g.id)));
export const dot = (st) => el('span', { class: `pf-dot ${st}`, title: STATUS[st] || st, 'aria-label': STATUS[st] || st, role: 'img' });
export function counters(list) {
  const n = { on: 0, warn: 0, off: 0, never: 0 };
  for (const d of list) { const st = statusOf(d); if (n[st] != null) n[st]++; }
  return n;
}
export function sinceText(d) {
  const st = statusOf(d);
  if (st === 'never') return 'Nunca deu sinal';
  if (st === 'off') return `Desligada ${ago(now() - d.lastSeen)} (último sinal ${when(d.lastSeen)})`;
  return `${STATUS[st]} desde ${when(d.onlineSince || d.lastSeen)}`;
}

/**
 * O alcance (grade, comunicado): todas as telas, unidades, grupos ou telas escolhidas. value: { scope, scopeData }.
 * Devolve { node, read() -> { scope, scopeData } } (lança se faltou escolher).
 */
export function scopePicker(value = {}, { onChange = null } = {}) {
  const d = T.data;
  const picked = { offices: new Set(value.scopeData?.offices || []), groups: new Set(value.scopeData?.groups || []), devices: new Set(value.scopeData?.devices || []) };
  const kind = el('select', {}, ...SCOPES.map((x) => opt(x.key, x.label, (value.scope || 'all') === x.key)));
  const box = el('div', { class: 'pf-scope' });
  const listFor = (k) => (k === 'offices' ? d.offices.map((o) => [o.id, o.name]) : k === 'groups' ? d.groups.map((g) => [g.id, g.name]) : k === 'devices' ? active().map((x) => [x.id, `${x.name} · ${officeOf(x.officeId)?.name || ''}`]) : []);
  const paint = () => {
    const k = kind.value; const list = listFor(k);
    if (k === 'all') put(box, note('Todas as telas da empresa, nas unidades que existirem agora e nas que vierem depois.'));
    else put(box, list.length ? el('div', { class: 'pf-checks tall' }, ...list.map(([id, name]) => el('label', { class: 'pf-check' },
      el('input', { type: 'checkbox', checked: picked[k].has(id), onchange: (e) => { if (e.target.checked) picked[k].add(id); else picked[k].delete(id); onChange?.(); } }), el('span', { text: name }))))
      : note(k === 'offices' ? 'Nenhuma unidade ainda (aba Unidades e grupos).' : k === 'groups' ? 'Nenhum grupo ainda (aba Unidades e grupos).' : 'Nenhuma tela ainda (aba Telas).'));
    onChange?.();
  };
  kind.addEventListener('change', paint); paint();
  return {
    node: el('div', {}, f('Para onde', kind), box),
    read() {
      const k = kind.value;
      if (k === 'all') return { scope: 'all', scopeData: {} };
      const ids = [...picked[k]];
      if (!ids.length) throw new Error('Escolha para onde vai (pelo menos um item da lista).');
      return { scope: k, scopeData: { [k]: ids } };
    },
  };
}
/** O alcance em texto curto. */
export function scopeText(scope, data = {}) {
  const d = T.data; const names = (ids, list) => (ids || []).map((id) => list.find((x) => x.id === id)?.name || `#${id}`).join(', ');
  if (!scope || scope === 'all' || scope === 'city') return 'Todas as telas';
  if (scope === 'offices') return `Unidades: ${names(data.offices, d.offices)}`;
  if (scope === 'groups') return `Grupos: ${names(data.groups, d.groups)}`;
  if (scope === 'devices') return `Telas: ${names(data.devices, d.devices)}`;
  if (scope === 'regions') return `Regiões: ${names(data.regions, d.regions)}`;
  return scope;
}
/** Situação de aprovação em texto. */
export const STATUS_ITEM = { ok: 'Publicado', pending: 'Aguardando aprovação', rejected: 'Devolvido', processing: 'Preparando o vídeo…', error: 'Não converteu' };
export const statusChip = (st) => chip(STATUS_ITEM[st] || st || 'Publicado', st === 'pending' ? 'tc-pending' : st === 'rejected' ? 'tc-rejected' : 'tc-ok');
export { el, guard, toast };
