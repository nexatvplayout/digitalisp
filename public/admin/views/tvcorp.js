// Painel "TV Corporativa" (#tvcorp/<aba>, docs/TV-CORPORATIVA.md §6): o modo corporativo do NEXA Telas. A casca e as abas;
// cada aba mora no seu arquivo (views/tvcorp-<aba>.js) e recebe a caixa onde se desenha e o contexto (ctx).
// Só aparece com a funcionalidade tvcorp no plano e a permissão tvcorp.manage (main.js e index.html, pelo coordenador).
// Conteúdo pelas rotas /api/tvcorp/* (pacotes A e B); a rede (unidades, grupos, telas, chaves, comandos, alertas e
// aprovações) pelas rotas /api/tvcorp/rede/*. Sem o módulo no servidor, a tela diz isso e oferece os dados de exemplo.
import { $, el, guard, can } from '../lib.js';
import { T, tapi, put, note, btn, btns, closeDialogs, dropBlobs, demoWanted, setDemo } from './tvcorp-base.js';
import paintResumo from './tvcorp-resumo.js';
import paintTelas from './tvcorp-telas.js';
import paintUnidades from './tvcorp-unidades.js';
import paintMidias from './tvcorp-midias.js';
import paintTemplates from './tvcorp-templates.js';
import paintAoVivo, { leaveAoVivo } from './tvcorp-aovivo.js';
import paintPlaylists from './tvcorp-playlists.js';
import paintLayouts from './tvcorp-layouts.js';
import paintGrade from './tvcorp-grade.js';
import paintDados from './tvcorp-dados.js';
import paintIndicadores from './tvcorp-indicadores.js';
import paintRh from './tvcorp-rh.js';
import paintBarras from './tvcorp-barras.js';
import { paintAlertas, paintAprovacoes } from './tvcorp-rede.js';
import paintCelular from './tvcorp-celular.js';
import paintRelatorios from './tvcorp-relatorios.js';
import paintComandos from './tvcorp-comandos.js';
import paintInstalar from './tvcorp-instalar.js';
import paintConfig from './tvcorp-config.js';

/** As abas, na ordem do menu. perm: a permissão que a aba pede (hoje todas: tvcorp.manage); live: redesenha com a volta de 10 s. */
export const TABS = [
  { id: 'resumo', label: 'Resumo', perm: 'tvcorp.manage', paint: paintResumo, live: true },
  { id: 'telas', label: 'Telas', perm: 'tvcorp.manage', paint: paintTelas, live: true },
  { id: 'unidades', label: 'Unidades e grupos', perm: 'tvcorp.manage', paint: paintUnidades },
  { id: 'midias', label: 'Mídias', perm: 'tvcorp.manage', paint: paintMidias },
  { id: 'templates', label: 'Templates', perm: 'tvcorp.manage', paint: paintTemplates },
  { id: 'aovivo', label: 'Ao vivo (HLS)', perm: 'tvcorp.manage', paint: paintAoVivo },
  { id: 'playlists', label: 'Playlists', perm: 'tvcorp.manage', paint: paintPlaylists },
  { id: 'layouts', label: 'Layouts', perm: 'tvcorp.manage', paint: paintLayouts },
  { id: 'grade', label: 'Grade', perm: 'tvcorp.manage', paint: paintGrade },
  { id: 'dados', label: 'Notícias e dados', perm: 'tvcorp.manage', paint: paintDados },
  { id: 'indicadores', label: 'Indicadores', perm: 'tvcorp.manage', paint: paintIndicadores },
  { id: 'rh', label: 'RH', perm: 'tvcorp.manage', paint: paintRh },
  { id: 'barras', label: 'Barras e blocos', perm: 'tvcorp.manage', paint: paintBarras },
  { id: 'alertas', label: 'Alertas', perm: 'tvcorp.manage', paint: paintAlertas },
  { id: 'aprovacoes', label: 'Aprovações', perm: 'tvcorp.manage', paint: paintAprovacoes },
  { id: 'celular', label: 'Celular', perm: 'tvcorp.manage', paint: paintCelular },
  { id: 'relatorios', label: 'Relatórios', perm: 'tvcorp.manage', paint: paintRelatorios },
  { id: 'comandos', label: 'Comandos', perm: 'tvcorp.manage', paint: paintComandos },
  { id: 'instalar', label: 'Instalar o aplicativo', perm: 'tvcorp.manage', paint: paintInstalar },
  { id: 'config', label: 'Configurações', perm: 'tvcorp.manage', paint: paintConfig },
];
/** As abas que quem está logado vê (pela permissão de cada uma). */
export const tabsFor = (has) => TABS.filter((t) => has(t.perm));

const P = { tab: 'resumo', timer: null, seq: 0, error: null };
const POLL_MS = 10000;

/** Junta o conteúdo (GET /api/tvcorp) e a rede (GET /api/tvcorp/rede) num objeto só, com listas vazias no que faltar. */
export function normalize(main = {}, rede = null) {
  // a rede (GET /api/tvcorp/rede, o mesmo do Painel da Prefeitura) traz as unidades, telas e chaves completas; aqui ficam só
  // as unidades corporativas e o que é delas (o cliente com os dois modos vê as repartições no Painel da Prefeitura)
  const corp = Array.isArray(main?.offices) ? new Set(main.offices.map((o) => o.id)) : null;
  const mine = (list) => (rede && corp ? (list || []).filter((x) => corp.has(x.officeId ?? x.id)) : list || []);
  const pick = (k, fb = []) => rede?.[k] ?? main?.[k] ?? fb;
  return {
    serverTime: rede?.serverTime ?? main?.serverTime ?? Date.now(),
    settings: main?.settings || {},
    offices: rede ? mine(rede.offices) : pick('offices'), groups: pick('groups'), devices: rede ? mine(rede.devices) : pick('devices'),
    keys: rede ? mine(rede.keys) : pick('keys'), regions: pick('regions'), channels: pick('channels'),
    defaults: pick('defaults', { config: {} }),
    layouts: main?.layouts || [], playlists: main?.playlists || [], schedules: main?.schedules || [],
    appLatest: pick('appLatest', null),
    rede: Boolean(rede),
  };
}
async function load() {
  const main = await tapi('/api/tvcorp');
  let rede = null;
  try { rede = await tapi('/api/tvcorp/rede'); } catch { /* sem a rede montada: as abas da rede avisam */ }
  T.data = normalize(main, rede);
  T.skew = T.data.serverTime - Date.now();
}
const reload = async () => { await load(); await paint(); };
/** O que as abas recebem da casca. */
const ctx = {
  reload, repaint: () => paint(), go: (tab) => { location.hash = `#tvcorp/${tab}`; },
  refreshBadge: () => window.dispatchEvent(new Event('nexa:tvcorp-badge')),
};

/** Sem o módulo no servidor (ainda não integrado, ou fora do plano): explica e oferece os dados de exemplo. */
function paintUnavailable(root, e) {
  const off = e?.code === 'feature_unavailable';
  put(root, el('div', { class: 'card pf-empty tc-off' },
    el('h3', { text: off ? 'A TV Corporativa não está no plano desta organização' : 'A TV Corporativa ainda não está disponível neste servidor' }),
    note(off ? 'Quem liga o modo TV Corporativa é a equipe da plataforma. Com ele ligado, este menu mostra as telas, as mídias, as playlists, a grade e os relatórios.'
      : 'O painel já está pronto, mas o servidor ainda não responde pelas rotas da TV Corporativa. Assim que a atualização entrar, esta tela abre sozinha.', 'dim'),
    e?.message && !off ? note(`Resposta do servidor: ${e.message}`) : null,
    btns(btn('Ver com dados de exemplo', guard(async () => { setDemo(true); await reload(); }), 'primary'),
      el('span', { class: 'dim small', text: 'Uma empresa inventada, só para conhecer as telas. Nada é gravado.' }))));
}
function demoBanner() {
  return el('div', { class: 'pf-banner tc-demo', role: 'status' },
    el('b', { text: 'Dados de exemplo. ' }), el('span', { text: 'Uma empresa inventada para conhecer as telas: nada do que você fizer aqui é gravado.' }), ' ',
    btn('Sair do exemplo', guard(async () => { setDemo(false); try { await reload(); } catch (e) { P.error = e; await paint(); } }), 'small'));
}
async function paint() {
  const root = $('#tcPanel');
  if (!root) return;
  if (!T.data) { paintUnavailable(root, P.error); return; }
  const tabs = tabsFor(can);
  if (!tabs.length) { put(root, note('Sua conta não tem a permissão da TV Corporativa.', 'pf-banner')); return; }
  if (!tabs.some((t) => t.id === P.tab)) P.tab = tabs[0].id;
  const bar = el('div', { class: 'cg-tabs tc-tabs', role: 'tablist', 'aria-label': 'Abas da TV Corporativa' }, ...tabs.map((t) => el('button', {
    class: `cg-tab${P.tab === t.id ? ' on' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(P.tab === t.id), text: t.label, onclick: () => { location.hash = `#tvcorp/${t.id}`; },
  })));
  const box = el('div', { class: 'pf-box tc-box', id: 'tcBox' });
  // as abas ficam no menu lateral do painel (main.js); aqui só o conteúdo da aba
  bar.hidden = true;
  put(root, T.demo ? demoBanner() : null, bar, box);
  const seq = ++P.seq;
  put(box, note('Carregando…'));
  try {
    const tab = TABS.find((t) => t.id === P.tab);
    const out = el('div', {});
    await tab.paint(out, ctx);
    if (seq === P.seq) put(box, out);
  } catch (e) {
    if (seq === P.seq) put(box, el('div', { class: 'pf-banner', role: 'alert' }, el('b', { text: 'Não deu para abrir esta aba. ' }), el('span', { text: e.message || String(e) })));
  }
}
/** A cada 10 s, nas abas Resumo e Telas: a situação das telas (sem redesenhar com janela aberta ou campo em uso). */
async function tick() {
  const view = $('#view-tvcorp');
  if (!T.data || document.hidden || !view || view.hidden || document.querySelector('dialog[open]')) return;
  if (!TABS.find((t) => t.id === P.tab)?.live || document.activeElement?.closest?.('#tcBox input, #tcBox select, #tcBox textarea')) return;
  try {
    const s = await tapi('/api/tvcorp/rede/status');
    T.skew = (s.serverTime || Date.now()) - Date.now();
    const byId = new Map((s.devices || []).map((x) => [x.id, x]));
    for (const d of T.data.devices) Object.assign(d, byId.get(d.id) || {});
    await paint();
  } catch { /* próxima volta */ }
}
async function show(sub) {
  closeDialogs(); dropBlobs();
  P.tab = TABS.some((t) => t.id === sub) ? sub : 'resumo';
  await paint();
}

export default {
  id: 'tvcorp',
  async load(sub) {
    T.demo = demoWanted();
    P.error = null;
    try { await load(); } catch (e) { T.data = null; P.error = e; }
    await show(sub);
    clearInterval(P.timer); P.timer = setInterval(tick, POLL_MS);
  },
  async sub(s) { await show(s); },
  leave() { leaveAoVivo(); closeDialogs(); dropBlobs(); clearInterval(P.timer); P.timer = null; },
};
