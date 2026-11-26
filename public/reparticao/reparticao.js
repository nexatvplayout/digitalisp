// NEXA Telas · página de controle da repartição (server/telas.js, docs/TELAS.md). Aberta pelo link /reparticao/<link> que a
// prefeitura gera no Painel da Prefeitura; pede o usuário e a senha (ou só a senha do link, na repartição que ainda não tem
// usuários) e só alcança ESTA repartição. A página se monta sozinha: o tipo da repartição define a família de tela e os
// módulos ligados pela prefeitura definem as abas (public/shared/telas-tipos.js, officeTabs); o atendente só vê Atendimento
// e Recepção. A sessão fica só nesta aba (sessionStorage) e cai quando a prefeitura troca a senha, o papel ou o link.
import { officeTabs, roleLabel } from '/shared/telas-tipos.js';
import { $, S, link, store, el, put, show, api, hour, err } from '/reparticao/rep-base.js';
import * as Senha from '/reparticao/rep-senha.js';
import * as Cartoes from '/reparticao/rep-cartoes.js';
import * as Alertas from '/reparticao/rep-alertas.js';
import * as Telas from '/reparticao/rep-telas.js';
import * as Secom from '/reparticao/rep-secom.js';
import * as Desap from '/reparticao/rep-desaparecidos.js';
import * as Seg from '/reparticao/rep-seguranca.js';
import * as Int from '/reparticao/rep-interna.js';
import * as Salas from '/reparticao/rep-salas.js';
import * as TvCorp from '/reparticao/rep-tvcorp.js'; // TV Corporativa: a unidade corporativa (família F11, docs/TV-CORPORATIVA.md)

let timer = null; let clock = null;
let tabs = []; // [{ key, label, card }]
let active = null;
const built = new Map(); // aba -> { node, show?, refresh? }
const badges = new Map(); // aba -> número ao lado do nome
const TAB_KEY = `nexa.reparticao.${link.slice(0, 12)}.aba`;


/* ------------------------------------------------------------------ DIGITAL ISP: o alerta que pisca até ser respondido
   Pânico de uma sala (nível 3, vermelho) e pedido de apoio aberto (nível 2 para Segurança e Enfermagem, laranja; nível 1
   para os outros, amarelo): uma janela por cima de tudo, piscando, com o bipe repetindo pelo nível, até alguém encerrar o
   pânico ou aceitar o pedido. Confere a cada 4 s. */
let alertaTimer = null; let bipeTimer = null; let bipeCtx = null; let bipeNivel = 0;
const NIVEL_APOIO = (kind) => (/segura|enferm/i.test(String(kind || '')) ? 2 : 1);
function bipeAlerta(nivel) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    bipeCtx = bipeCtx || new AC(); if (bipeCtx.state === 'suspended') bipeCtx.resume();
    const n = nivel === 3 ? 6 : nivel === 2 ? 4 : 2; const t0 = bipeCtx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const o = bipeCtx.createOscillator(); const g = bipeCtx.createGain(); const t = t0 + i * 0.3;
      o.type = 'square'; o.frequency.value = nivel === 3 ? (i % 2 ? 660 : 1040) : nivel === 2 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.linearRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g); g.connect(bipeCtx.destination); o.start(t); o.stop(t + 0.26);
    }
  } catch { /* sem som */ }
}
function pintarAlerta(itens) {
  let box = document.getElementById('rpAlerta');
  if (!box) { box = el('div', { id: 'rpAlerta', class: 'rp-alerta', role: 'alertdialog', 'aria-live': 'assertive' }); document.body.append(box); }
  box.hidden = !itens.length;
  const nivel = itens.reduce((m, x) => Math.max(m, x.nivel), 0);
  box.className = `rp-alerta n${nivel}`;
  put(box, el('div', { class: 'rp-alerta-c' },
    el('h2', { text: nivel === 3 ? 'PÂNICO: pedido de socorro' : nivel === 2 ? 'Apoio urgente' : 'Pedido de apoio' }),
    ...itens.map((x) => el('div', { class: `rp-alerta-i n${x.nivel}` },
      el('b', { text: x.titulo }), el('span', { text: x.texto }),
      el('button', { type: 'button', class: 'r-btn primary', onclick: async (e) => { e.currentTarget.disabled = true; try { await x.responder(); await vigiarAlertas(); } catch (er) { err(er.message); e.currentTarget.disabled = false; } } }, x.botao)))));
  if (nivel !== bipeNivel) {
    clearInterval(bipeTimer); bipeTimer = null; bipeNivel = nivel;
    if (nivel) { bipeAlerta(nivel); bipeTimer = setInterval(() => bipeAlerta(nivel), nivel === 3 ? 3000 : nivel === 2 ? 6000 : 12000); }
  }
}
async function vigiarAlertas() {
  if (!S.session) return;
  const [sup, pan] = await Promise.all([api('/queue/support').catch(() => null), api('/queue/panic').catch(() => null)]);
  const t = Date.now(); const itens = [];
  for (const p of (pan?.panic || [])) if (!p.closedAt && t - p.at < 2 * 3600_000) itens.push({ nivel: 3, titulo: `PÂNICO em ${p.room}`, texto: `acionado às ${hour(p.at)}: vá até lá ou chame ajuda`, botao: 'Recebido: encerrar', responder: () => api(`/queue/panic/${p.id}/close`, { method: 'POST' }) });
  for (const x of (sup?.requests || [])) if (x.status === 'open') itens.push({ nivel: NIVEL_APOIO(x.kind), titulo: `${x.kind} · ${x.room}`, texto: `pedido às ${hour(x.createdAt)}`, botao: 'Aceitar', responder: () => api(`/queue/support/${x.id}/accept`, { method: 'POST' }) });
  itens.sort((a, b) => b.nivel - a.nivel);
  pintarAlerta(itens);
}

/* ------------------------------------------------------------------ entrada e saída */
function leave(msg = '') {
  S.session = null; S.state = null; store.set(null);
  clearInterval(timer); clearInterval(clock); Senha.stop(); Seg.stop(); Int.stop(); TvCorp.stop();
  built.clear(); badges.clear(); active = null;
  put($('panels')); put($('tabs'));
  $('app').hidden = true; $('login').hidden = false; $('bar').hidden = true;
  document.body.classList.remove('in');
  show('loginErr', msg);
  $('password').value = ''; ($('username').value ? $('password') : $('username')).focus();
}
S.onLeave = leave;
$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  show('loginErr', '');
  $('loginBtn').disabled = true;
  try {
    const r = await api('/login', { method: 'POST', body: { token: link, username: $('username').value.trim(), password: $('password').value } });
    S.session = r.session; store.set(S.session);
    $('password').value = '';
    await enter();
  } catch (x) { if (x.message !== 'sessão') show('loginErr', x.message); } finally { $('loginBtn').disabled = false; }
});
$('logout').addEventListener('click', () => leave());

async function readState() { S.state = await api('/state'); S.readAt = Date.now(); return S.state; }
async function enter() {
  const st = await readState();
  $('login').hidden = true; $('app').hidden = false; $('bar').hidden = false;
  document.body.classList.add('in');
  $('officeName').textContent = st.office.name;
  $('officeType').textContent = st.office.typeLabel;
  $('who').textContent = st.user ? `${st.user.name || st.user.username} · ${roleLabel(st.role)}` : '';
  $('who').hidden = !st.user;
  document.title = `Telas · ${st.office.name}`;
  paintBar(); paintNotices();
  Seg.panicButton($('panic'), $('panicNote'));
  await Senha.start({ retab });
  retab(true);
  clearInterval(timer); timer = setInterval(refresh, 15000);
  clearInterval(alertaTimer); alertaTimer = setInterval(() => vigiarAlertas().catch(() => {}), 4000); vigiarAlertas().catch(() => {});
  clearInterval(clock); clock = setInterval(paintClock, 20000); paintClock();
}
/** A cada 15 s: a situação das telas, os alertas e os pedidos (o que a pessoa está escrevendo fica como está). */
async function refresh() {
  if (!S.session || document.hidden) return;
  try {
    const s = await api('/state');
    S.state = { ...S.state, ...Object.fromEntries(['serverTime', 'devices', 'alerts', 'approval', 'electoral', 'network'].filter((k) => k in s).map((k) => [k, s[k]])) };
    S.readAt = Date.now();
    paintBar(); paintNotices();
    built.get(active)?.refresh?.();
  } catch { /* próxima volta */ }
}
const ctx = { refresh, retab, badge, go: (key) => select(key, true) };

/* ------------------------------------------------------------------ a barra do topo e as faixas de aviso */
const paintClock = () => { $('clock').textContent = hour(Date.now()); };
function paintBar() {
  const st = S.state;
  const gestor = st.role === 'gestor';
  $('barTelas').hidden = !gestor;
  if (!gestor) return;
  // quem alcança a cidade vê a rede inteira; as outras, as próprias telas
  const total = st.network ? st.network.total : st.devices.length;
  const on = st.network ? st.network.online : st.devices.filter((d) => d.status === 'on').length;
  $('barDot').className = `r-dot ${total === 0 ? '' : on === total ? 'on' : on === 0 ? 'off' : 'warn'}`;
  $('barCount').textContent = total === 0 ? 'nenhuma tela ainda' : `${on} de ${total} ${total === 1 ? 'tela' : 'telas'} no ar${st.network ? ' na cidade' : ''}`;
}
const KIND_LABEL = { avisos: 'Avisos', card: 'Cartão', alert: 'Alerta', missing: 'Caso' };
const REQ_STATUS = { pending: 'aguardando', approved: 'aprovado', rejected: 'devolvido' };
function paintNotices() {
  const st = S.state;
  const e = st.electoral || {};
  $('electoral').hidden = !e.on;
  if (e.on) $('electoral').textContent = `Período eleitoral até ${String(e.to || '').split('-').reverse().join('/')}: o que for institucional fica guardado e não vai às telas. Não publique nome, foto ou símbolo de autoridade (Constituição, art. 37, §1º).`;
  const a = st.approval || { on: false, requests: [] };
  const list = (a.requests || []).filter((r) => r.status !== 'approved' || st.serverTime - r.decidedAt < 86400000);
  const waiting = list.filter((r) => r.status === 'pending').length;
  $('approvalBox').hidden = !list.length; // a faixa só aparece quando há pedido (esperando, devolvido ou aprovado há pouco)
  const who = st.office.external ? 'o CCO' : 'a SECOM';
  $('approvalTitle').textContent = waiting ? `Aguardando ${who}: ${waiting} ${waiting === 1 ? 'pedido enviado' : 'pedidos enviados'}` : `Aguardando ${who}`;
  $('approvalNote').textContent = st.office.external ? 'Este órgão é um emissor conveniado: o que envia só vai às telas depois de aprovado pela Segurança (CCO) da prefeitura.' : a.direct ? 'A prefeitura ligou a aprovação da SECOM: os avisos e os cartões escritos aqui esperam a aprovação. Os alertas da Defesa Civil saem na hora (ficam marcados para a SECOM).' : 'A prefeitura ligou a aprovação da SECOM: os avisos, os cartões e os alertas escritos aqui só vão às telas depois de aprovados.';
  put($('requests'), list.map((r) => el('li', {},
    el('span', { class: `r-tag${r.status === 'pending' ? ' live' : ''}`, text: REQ_STATUS[r.status] || r.status }),
    el('span', {}, el('b', { text: `${KIND_LABEL[r.kind] || r.kind}: ${r.summary}` }), el('small', { text: `pedido em ${new Date(r.requestedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${r.decidedBy ? ` · ${REQ_STATUS[r.status]} por ${r.decidedBy}` : ''}${r.note ? ` · motivo: "${r.note}"` : ''}` })))));
}

/* ------------------------------------------------------------------ abas */
const BUILD = {
  atendimento: Senha.atendimento, recepcao: Senha.recepcao, triagem: Senha.triagem,
  avisos: Alertas.avisos, alerta: Alertas.alerta, 'novo-alerta': Alertas.novoAlerta, 'no-ar': Alertas.noAr,
  aprovacoes: Secom.aprovacoes, geral: Secom.geral, telas: Telas.telas, desaparecidos: Desap.desaparecidos, ocorrencias: Seg.ocorrencias, codigos: Int.codigos, interna: Int.interna,
  salas: Salas.salas, apoio: Salas.apoio, indicadores: Salas.indicadores,
  publicar: TvCorp.publicar, comunicados: TvCorp.comunicados, aniversariantes: TvCorp.aniversariantes,
};
function badge(key, n) { badges.set(key, n); const b = document.querySelector(`[data-tab="${key}"] .r-tab-n`); if (b) { b.textContent = n ? String(n) : ''; b.hidden = !n; } }
/** Monta (ou refaz) a lista de abas: pelo tipo, pelos módulos, pelo papel e pela classificação de risco da chamada de senha. */
function retab(first = false) {
  const st = S.state;
  tabs = officeTabs({ type: st.office.type, modules: st.modules, role: st.role, risk: Senha.risk(), devices: (st.devices || []).length });
  $('noTabs').hidden = tabs.length > 0;
  put($('tabs'), tabs.map((t, i) => el('button', { type: 'button', role: 'tab', class: 'r-tab', id: `tab-${t.key}`, 'data-tab': t.key, 'aria-controls': `panel-${t.key}`, 'aria-selected': 'false', tabindex: '-1', onclick: () => select(t.key, true), onkeydown: (e) => tabKey(e, i) },
    t.label, el('span', { class: 'r-tab-n', hidden: !badges.get(t.key), text: badges.get(t.key) ? String(badges.get(t.key)) : '' }))));
  for (const [k, b] of built) if (!tabs.some((t) => t.key === k)) { b.node.remove(); built.delete(k); }
  const want = first ? store.get(TAB_KEY) : active;
  select(tabs.some((t) => t.key === want) ? want : tabs[0]?.key, false);
}
function tabKey(e, i) {
  const move = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
  if (move === undefined) return;
  e.preventDefault();
  const t = tabs[(i + move + tabs.length) % tabs.length];
  select(t.key, true); $(`tab-${t.key}`).focus();
}
function select(key, remember) {
  if (!key) return;
  const t = tabs.find((x) => x.key === key);
  if (!t) return;
  if (!built.has(key)) {
    let b;
    try { b = t.card ? Cartoes.cardTab(t.card, ctx) : BUILD[key](ctx); } catch (x) { err(x.message); return; }
    b.node.id = `panel-${key}`; b.node.setAttribute('role', 'tabpanel'); b.node.setAttribute('aria-labelledby', `tab-${key}`); b.node.tabIndex = 0;
    b.node.classList.add('r-panel');
    built.set(key, b); $('panels').append(b.node);
  }
  active = key;
  if (remember) store.set(key, TAB_KEY);
  for (const x of tabs) { const on = x.key === key; const btn = $(`tab-${x.key}`); btn.setAttribute('aria-selected', String(on)); btn.tabIndex = on ? 0 : -1; btn.classList.toggle('on', on); const p = built.get(x.key); if (p) p.node.hidden = !on; }
  built.get(key).show?.();
}

/* ------------------------------------------------------------------ início */
if (!/^[A-Za-z0-9_-]{32,64}$/.test(link)) { show('loginErr', 'Endereço incompleto. Peça o link de controle à prefeitura.'); $('loginBtn').disabled = true; }
S.session = store.get();
if (S.session) enter().catch(() => leave());
else $('username').focus();
