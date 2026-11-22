// NEXA Telas · página de controle da repartição: a base comum dos módulos da página (rep-*.js). O que é de todos: o link do
// endereço, a sessão desta aba, a chamada à API (/api/reparticao), a criação de elementos sem HTML em texto, os avisos de
// "salvo" e de erro e os formatos de hora. Nada de fora, nenhum estilo pelo script (a CSP da página não aceita inline).
export const $ = (id) => document.getElementById(id);
export const link = location.pathname.split('/').filter(Boolean)[1] || '';
export const KEY = `nexa.reparticao.${link.slice(0, 12)}`;
/** O que a página inteira compartilha: a sessão, o estado lido de /state e quem está ouvindo a saída. */
export const S = { session: null, state: null, onLeave: null };

export const store = {
  get(k = KEY) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(v, k = KEY) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* sem armazenamento */ } },
};
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.flat(3).filter((x) => x != null && x !== false));
  return n;
}
/** replaceChildren sem os vazios (um null entre os filhos sairia escrito "null" na tela). */
export const put = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));
export const show = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; };
let okTimer = null;
export const ok = (msg) => { show('appErr', ''); show('appOk', msg); clearTimeout(okTimer); okTimer = setTimeout(() => show('appOk', ''), 6000); };
export const err = (msg) => { show('appOk', ''); show('appErr', msg); $('appErr').scrollIntoView({ block: 'nearest' }); };

async function call(path, { method = 'GET', body, file = null } = {}) {
  const res = await fetch(`/api/reparticao${path}`, {
    method, cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { ...(file ? { 'content-type': file.type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}), ...(S.session ? { authorization: `Bearer ${S.session}` } : {}) },
    body: file || (body ? JSON.stringify(body) : undefined), // file: o arquivo vai cru no corpo (a foto de um caso)
  });
  if (res.status === 401 && path !== '/login') { S.onLeave?.('A sessão terminou. Entre de novo com o usuário e a senha.'); throw new Error('sessão'); }
  return res;
}
export async function api(path, opts = {}) {
  const res = await call(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  if (res.status === 202 && data && typeof data === 'object') data.pending = true; // foi para a aprovação da SECOM
  return data;
}
/** Uma imagem que só sai com a sessão (a captura da tela): vira um endereço data: desta página (a CSP aceita 'self' e data:). */
export async function apiImage(path) {
  const res = await call(path);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Não foi possível abrir a imagem.')); r.readAsDataURL(blob); });
}
/** Roda a ação de um botão ou formulário: erro vira aviso na página (menos a sessão caída, que já levou à entrada). */
export const act = (fn, okMsg) => async (e) => {
  e?.preventDefault?.();
  const btn = e?.submitter || (e?.currentTarget?.tagName === 'BUTTON' ? e.currentTarget : null);
  if (btn) btn.disabled = true;
  try { const r = await fn(e); if (okMsg) ok(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; } catch (x) { if (x.message !== 'sessão') err(x.message); return null; } finally { if (btn) btn.disabled = false; }
};

export const now = () => (S.state ? S.state.serverTime + (Date.now() - S.readAt) : Date.now());
export const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dia(s)`;
};
export const hhmm = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const hour = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const left = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} dias`; };
export const field = (label, input, hint) => el('label', { class: 'r-field' }, el('span', { text: label }), input, hint ? el('small', { class: 'r-dim', text: hint }) : null);
export const option = (value, text, selected) => el('option', { value: String(value), text, selected: Boolean(selected) });
export const check = (label, input) => el('label', { class: 'r-check' }, input, el('span', { text: label }));
/** Um bloco da página (cartão com título). */
export const card = (title, ...kids) => { const id = `h${Math.random().toString(36).slice(2, 8)}`; return el('section', { class: 'r-card', 'aria-labelledby': id }, el('h2', { id, text: title }), ...kids); };
/** As duas colunas de uma aba: a operação à esquerda, o apoio (situação, prévia, fila) à direita. No celular, uma só. */
export const cols = (main, side) => el('div', { class: 'r-cols' }, el('div', { class: 'r-col' }, main), el('div', { class: 'r-col r-side' }, side));
