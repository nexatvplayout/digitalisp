// NEXA TV · painel de playout: base compartilhada pelos módulos de tela.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const KIND = { program: 'Programa', ad: 'Comercial', bumper: 'Vinheta', live: 'Ao vivo' };
/** Nome antigo de tela -> o de agora (endereço #tela e abas salvas): a mesa AO VIVO era #plantao; a Agenda virou a aba
 *  Semana da Grade (#agenda -> #grade). */
export const VIEW_ALIAS = { plantao: 'aovivo', agenda: 'grade' };
/** Lugar dentro de uma tela que mudou de tela ("#tela/aba" antigo -> o de agora; endereço, favoritos e abas salvas): a aba
 *  Saídas e ajustes do Gerador de caracteres virou Configurações → Gerador de caracteres (14/10). */
export const PLACE_ALIAS = { 'cg/saidas': 'config/cg' };

export const state = {
  token: null,
  slug: null,          // canal selecionado
  channels: [],        // lista de canais (para o seletor)
  skew: 0,             // serverTime - Date.now()
  fps: 30,
  stats: null,         // /api/c/<canal>/stats
  media: [],
  me: null,            // usuário logado: { username, name, permissions, channels, groups, mustChange, catalog }
};

/** Barramento simples entre módulos (eventos do WebSocket, troca de canal, novas estatísticas). */
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

/** Cria elementos sem innerHTML (texto vem sempre como textContent). `icon: 'play'` põe o ícone de icons.js antes do texto. */
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'icon') continue;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  if (props.icon) n.prepend(icon(props.icon));
  n.append(...kids.flat().filter((x) => x != null));
  return n;
}

export const pad = (n) => String(n).padStart(2, '0');
export const mss = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
export const hms = (ms) => new Date(ms).toTimeString().slice(0, 8);
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
export const serverNow = () => Date.now() + state.skew;

/**
 * Parar com a tela de fora do ar (engine.stopping do /stats, server/engine.js #slateStop): "Parando em N s… (tela de fora do
 * ar no ar)". A contagem parte do leftMs da leitura (o prazo fica guardado na própria leitura: cada leitura nova recomeça
 * dela), sem depender do relógio do servidor. Sem parada em andamento: ''.
 */
export function stoppingText(stopping) {
  if (!stopping) return '';
  stopping.due ??= Date.now() + (Number(stopping.leftMs) || 0);
  const n = Math.ceil((stopping.due - Date.now()) / 1000);
  return `${n > 0 ? `Parando em ${n} s…` : 'Parando…'} (tela de fora do ar no ar)`;
}

/** Timecode HH:MM:SS:FF na taxa de quadros do canal. */
export const tc = (sec, floor = false) => {
  const total = Math.max(0, (floor ? Math.floor : Math.round)(sec * state.fps));
  const f = total % state.fps; const s = Math.floor(total / state.fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}:${pad(f)}`;
};
/** Hora do dia em timecode (os quadros vêm dos milissegundos). */
export const tcClock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(Math.min(state.fps - 1, Math.floor((d.getMilliseconds() / 1000) * state.fps)))}`;
};

/** O usuário logado tem esta permissão? (as implícitas já vêm expandidas do servidor) */
export const can = (perm) => Boolean(state.me?.permissions.includes(perm));
/* Ao vivo (mesa e plantão; docs/ACESSO.md, "Só ao vivo"): a permissão fina OU a antiga, como no servidor (server/live-perms.js) */
/** Vê a tela AO VIVO (o estado da mesa e do plantão). */
export const seesLive = () => can('playout.view') || can('live.mesa') || can('live.plantao');
/** Opera a mesa de corte. */
export const canMesa = () => can('playout.control') || can('live.mesa');
/** Entra no ar (plantão e Live) e encerra. */
export const canAir = () => can('playout.control') || can('live.plantao');

export const base = () => `/api/c/${state.slug}`;

export function toast(msg, err = false) {
  // a janela aberta (dialog modal) fica numa camada acima da página: o aviso vai para dentro dela, senão some atrás
  // ("não está aceitando criar grupos": o erro aparecia por baixo da janela); some com a janela e é refeito na página
  let box = $('#toasts');
  if (!box) { box = el('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (box.parentElement !== host) host.append(box);
  const ms = err ? 6000 : 3200;
  // o mesmo aviso ainda na tela (17/10: "Escolha um item que ainda não foi ao ar." saiu 4 vezes seguidas, um por tentativa,
  // cada um 6 s na tela): renova o que já está lá, em vez de empilhar cópias
  const same = [...(box?.children || [])].find((n) => n.textContent === msg && n.classList.contains('err') === Boolean(err));
  if (same) { clearTimeout(same.toastTimer); same.toastTimer = setTimeout(() => same.remove(), ms); return; }
  const t = el('div', { class: `toast${err ? ' err' : ''}`, text: msg });
  box.append(t);
  t.toastTimer = setTimeout(() => t.remove(), ms);
}

const PLAN_CODES = new Set(['limit_reached', 'feature_unavailable', 'tenant_suspended']);

/**
 * fetch autenticado. Caminhos que começam com "/api/" são usados como estão. signal (AbortController): quem pergunta pode
 * desistir de uma leitura que não volta (o guia do NO AR em tempo real, feed.js).
 */
export async function api(path, { method = 'GET', body, form, headers = {}, signal } = {}) {
  if (method !== 'GET') recent.clear(); // escrita: as leituras recentes (apiRecent) ficam velhas
  const res = await fetch(path, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}), 'x-admin-token': state.token || '' },
    body: form || (body ? JSON.stringify(body) : undefined),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 401 && path !== '/api/admin/login') { emit('logout'); throw new Error('Sessão expirada. Entre novamente.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === 'must_change') emit('must-change');
  // plano: limite atingido, recurso fora do plano ou conta suspensa -> aviso com atalho para Plano e uso (main.js)
  if (PLAN_CODES.has(data.code)) emit('plan-error', data);
  if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { code: data.code, data, planHandled: PLAN_CODES.has(data.code) });
  return data;
}
/** API do canal selecionado: capi('/playlist') -> /api/c/<slug>/playlist */
export const capi = (path, opts) => api(`${base()}${path}`, opts);

/*
 * Leituras recentes entre as telas (relato de 10/10: "lentidão quando clica nas abas"): Grade, Playout e Mídia pediam de
 * novo a biblioteca inteira, as marcações, a grade e as coleções a cada troca. Um GET feito há menos de RECENT_MS (ou ainda
 * a caminho) serve a quem abre a outra tela; qualquer escrita pelo painel (api com POST/PUT/PATCH/DELETE), a troca de canal
 * e a saída esquecem tudo. Cada tela recebe a sua cópia (structuredClone): uma que mexe no que recebeu não muda a da outra.
 * Só para leituras ao abrir a tela; as consultas periódicas e as de depois de salvar seguem pelo api() de sempre.
 */
export const RECENT_MS = 8000;
const recent = new Map(); // caminho -> { at, p }
export function apiRecent(path, ttl = RECENT_MS) {
  const t = Date.now();
  let r = recent.get(path);
  if (!r || t - r.at > ttl) {
    const p = api(path);
    const entry = { at: t, p };
    r = entry;
    recent.set(path, entry);
    p.catch(() => { if (recent.get(path) === entry) recent.delete(path); }); // falhou: o próximo pede de novo
  }
  return r.p.then((d) => structuredClone(d));
}
/** apiRecent do canal selecionado: capiRecent('/agenda') -> /api/c/<slug>/agenda */
export const capiRecent = (path, ttl) => apiRecent(`${base()}${path}`, ttl);
/** Esquece as leituras recentes (troca de canal, saída do painel). */
export const forgetRecent = () => recent.clear();
on('channel', forgetRecent);
on('logout', forgetRecent);

export const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (!e.planHandled) toast(e.message, true); } };

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch {
    const t = el('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); toast('Copiado.'); } catch { toast('Copie manualmente.', true); }
    t.remove();
  }
}

export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * dropEffect compatível com o effectAllowed de quem começou o arrasto. O Sortable (biblioteca) marca todo arrasto como
 * 'move'; responder 'copy' a um 'move' faz o navegador recusar a soltura (cursor 🚫, sem evento drop). Era o que impedia
 * soltar vídeos da biblioteca na linha do tempo da Grade no Chrome (os testes com DragEvent sintético não pegam: lá não há
 * essa regra). Mora aqui porque toda tela que recebe arrasto HTML5 precisa dela (Grade hoje; a Agenda, docs/AGENDA.md).
 */
export function dropEffectFor(dt, want) {
  const a = String(dt?.effectAllowed || 'all').toLowerCase();
  if (a === 'all' || a === 'uninitialized' || a.includes(want)) return want;
  return a.includes('move') ? 'move' : a.includes('copy') ? 'copy' : a.includes('link') ? 'link' : want;
}

/* Conversão no upload (docs/CONVERSAO.md): só a mídia "pronta" vai ao ar; o resto é pulado até terminar. */
export const pendingMedia = (m) => Boolean(m) && m.status && m.status !== 'ready';
export const convLabel = (m) => ({ queued: 'Na fila', converting: `Convertendo ${m.progress || 0}%`, analyzing: 'Medindo áudio', error: 'Erro na conversão' }[m?.status] || '');
/** Selo curto para listas (grade, intervalos); null quando a mídia está pronta. */
export const convTag = (m) => (pendingMedia(m)
  ? el('span', { class: `ctag${m.status === 'error' ? ' bad' : ''}`, title: m.status === 'error' ? m.convertError : m.status === 'analyzing' ? 'Não vai ao ar até medir e normalizar o áudio' : 'Não vai ao ar até a conversão terminar', text: convLabel(m) })
  : null);
