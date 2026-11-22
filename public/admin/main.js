// Casca do painel do DIGITAL ISP: a entrada, o menu e as telas. Duas portas, o mesmo painel:
//   /admin/       revendas (o gestor de telas) — o "Entrar" do site
//   /superadmin/  equipe da plataforma DIGITAL ISP (www.digitalisp.com.br/superadmin leva para cá)
// A revenda vê "Telas e conteúdo" (views/tvcorp.js, herdada da TV Corporativa do NEXA); a equipe da plataforma vê as revendas.
import { $, $$, el, state, api, toast, guard, on, store } from './lib.js';
// as telas e o conteúdo (uns 40 arquivos) só carregam depois da entrada: a tela de login abre na hora
let tvcorpMod = null;
const tvcorp = async () => (tvcorpMod ||= (await import('./views/tvcorp.js')).default);

// a porta decide quem entra; cada uma guarda a própria sessão (dá para ter as duas abertas em abas diferentes)
const KIND = location.pathname === '/superadmin' || location.pathname.startsWith('/superadmin/') ? 'plataforma' : 'revenda';
const TOKEN_KEY = KIND === 'plataforma' ? 'disp.token.plataforma' : 'disp.token.revenda';
// area: quem entrou — plataforma, revenda (o provedor) ou cliente (o cliente final da revenda)
const S = { kind: KIND, area: KIND === 'plataforma' ? 'plataforma' : 'revenda', view: null, conta: null };
// a porta do cliente final: /c/<revenda> (a entrada com a marca da revenda)
const PORTA_CLIENTE = /^\/c\/([a-z0-9-]+)/.exec(location.pathname)?.[1] || null;
// a sessão desta aba (sessionStorage: o painel do cliente aberto pela revenda) vence a guardada no navegador
const lerToken = () => sessionStorage.getItem(TOKEN_KEY) || store.get(TOKEN_KEY);
const gravarToken = (t) => { if (sessionStorage.getItem(TOKEN_KEY)) { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } else store.set(TOKEN_KEY, t); };
document.title = KIND === 'plataforma' ? 'DIGITAL ISP · Plataforma' : 'DIGITAL ISP · Painel';

/* ------------------------------------------------------------------ entrada */
function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#loginErr');
  err.hidden = !msg; err.textContent = msg;
  const f = $('#loginForm');
  $('#loginKind').textContent = KIND === 'plataforma' ? 'Equipe da plataforma' : PORTA_CLIENTE ? 'Painel das suas telas' : 'Painel da revenda';
  if (PORTA_CLIENTE) marcaDaRevenda();
  $('#fldUser').firstChild.textContent = KIND === 'plataforma' ? 'Usuário' : 'E-mail';
  (f.username.value ? f.password : f.username).focus();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const kind = KIND;
  const body = { username: f.username.value.trim(), password: f.password.value };
  try {
    const r = await api(kind === 'plataforma' ? '/api/platform/login' : '/api/admin/login', { method: 'POST', body });
    state.token = r.token; S.kind = kind;
    gravarToken(r.token);
    f.password.value = '';
    await start();
  } catch (err) {
    $('#loginErr').hidden = false; $('#loginErr').textContent = err.message;
  }
});

async function logout() {
  const path = S.kind === 'plataforma' ? '/api/platform/logout' : '/api/me/logout';
  try { if (state.token) await api(path, { method: 'POST' }); } catch { /* já saiu */ }
  state.token = null; state.me = null; gravarToken(null);
  showLogin();
}
$('#logout').addEventListener('click', logout);
on('logout', () => { state.token = null; gravarToken(null); showLogin('Sessão expirada. Entre novamente.'); });

/* ------------------------------------------------------------------ telas do painel */
const guiaMod = () => import('./views/guia.js');
const rev = () => import('./views/revenda.js');
const VIEWS = {
  'rv-resumo': { area: 'revenda', load: async () => (await rev()).paintResumo($('#rrPanel')) },
  'rv-clientes': { area: 'revenda', load: async () => (await rev()).paintClientes($('#rcPanel')) },
  'rv-planos': { area: 'revenda', load: async () => (await rev()).paintPlanos($('#rpPanel')) },
  'rv-cobrancas': { area: 'revenda', load: async () => (await rev()).paintCobrancas($('#rbPanel')) },
  'rv-telas': { area: 'revenda', load: async () => (await rev()).paintTelas($('#rtPanel')), leave: async () => (await rev()).leaveMapa() },
  guia: { area: null, load: async () => (await guiaMod()).paintGuia($('#gdPanel'), S.kind, { onChange: faixaGuia }) },
  tvcorp: { area: ['revenda', 'cliente'], load: async (sub) => (await tvcorp()).load(sub), leave: () => tvcorpMod?.leave?.() },
  revendas: { area: 'plataforma', load: async () => (await plat()).paintRevendas($('#rvPanel')) },
  planos: { area: 'plataforma', load: async () => (await plat()).paintPlanos($('#plPanel')) },
  cobrancas: { area: 'plataforma', load: async () => (await plat()).paintCobrancas($('#cbPanel')) },
  mapa: { area: 'plataforma', load: async () => (await plat()).paintMapa($('#mpPanel')), leave: async () => (await plat()).leaveMapa() },
  conta: { area: null, load: () => paintConta() },
};
const firstView = () => ({ plataforma: 'revendas', revenda: 'rv-resumo', cliente: 'tvcorp' }[S.area]);
const pode = (v) => v && (v.area === null || [].concat(v.area).includes(S.area));

async function route() {
  if (!state.me) return;
  const [id, sub] = (location.hash.slice(1) || firstView()).split('/');
  const v = pode(VIEWS[id]) ? id : firstView();
  if (S.view && S.view !== v) VIEWS[S.view].leave?.();
  S.view = v;
  for (const k of Object.keys(VIEWS)) $(`#view-${k}`).hidden = k !== v;
  for (const a of $$('.side a[data-view]')) a.classList.toggle('on', a.dataset.view === v && (!a.dataset.sub || a.dataset.sub === (sub || 'resumo')));
  abrirAba(v, sub);
  await guard(VIEWS[v].load)(sub);
  faixaGuia();
}

/* as janelas abertas viram abas no topo (como num navegador): clicar volta para ela, o × fecha. Guardadas na aba do navegador */
const ABAS_KEY = `disp.abas.${KIND}`;
let abas = (() => { try { return JSON.parse(sessionStorage.getItem(ABAS_KEY) || '[]'); } catch { return []; } })();
const salvarAbas = () => sessionStorage.setItem(ABAS_KEY, JSON.stringify(abas.slice(-12)));
function rotulo(hash) {
  const a = [...$$('.side a[href]')].find((x) => x.getAttribute('href') === hash && !x.hidden);
  return (a?.textContent || '').replace(/\d+\/\d+$/, '').trim() || hash.slice(1);
}
function abrirAba(v, sub) {
  const hash = `#${v}${v === 'tvcorp' ? `/${sub || 'resumo'}` : ''}`;
  if (!abas.includes(hash)) abas.push(hash);
  if (abas.length > 12) abas = abas.slice(-12);
  salvarAbas();
  desenharAbas(hash);
  if (v === 'tvcorp') { const t = document.querySelector('#view-tvcorp .head h2'); if (t) t.textContent = rotulo(hash); }
}
function desenharAbas(ativa) {
  const bar = $('#abas');
  bar.replaceChildren(...abas.map((h) => el('span', { class: `aba${h === ativa ? ' on' : ''}` },
    el('a', { href: h, text: rotulo(h), 'aria-current': h === ativa ? 'page' : null }),
    el('button', { type: 'button', class: 'aba-x', 'aria-label': `Fechar ${rotulo(h)}`, text: '×', onclick: () => {
      const i = abas.indexOf(h); abas.splice(i, 1); salvarAbas();
      if (h === ativa) location.hash = abas[Math.max(0, i - 1)] || `#${firstView()}`; else desenharAbas(ativa);
    } }))));
  bar.hidden = !abas.length;
}

/* a faixa do topo enquanto a configuração obrigatória não terminou: o próximo passo, a um clique */
let guiaUlt = null;
async function faixaGuia() {
  const bar = $('#guiaBar');
  try { guiaUlt = await api(S.kind === 'plataforma' ? '/api/platform/guia' : '/api/guia'); } catch { bar.hidden = true; return; }
  const prox = guiaUlt.steps.find((s) => s.obrigatorio && !s.feito);
  $('#guiaBadge').textContent = guiaUlt.completo ? '' : `${guiaUlt.feitos}/${guiaUlt.total}`;
  $('#guiaBadge').hidden = guiaUlt.completo;
  if (!prox || S.view === 'guia') { bar.hidden = true; return; }
  bar.replaceChildren(
    el('span', {}, el('b', { text: `Configuração: ${guiaUlt.feitos} de ${guiaUlt.total}. ` }), `Próximo passo: ${prox.titulo}.`),
    el('a', { class: 'btn small primary', href: prox.ir && prox.id !== 'dados' && S.view !== prox.ir.slice(1).split('/')[0] ? prox.ir : '#guia', text: 'Continuar' }),
    el('a', { class: 'btn small', href: '#guia', text: 'Ver todos os passos' }));
  bar.hidden = false;
}
// alterações não salvas (formulário marcado .dirty): avisa antes de trocar de tela ou fechar a aba
let voltando = false;
window.addEventListener('hashchange', (e) => {
  if (voltando) { voltando = false; return; }
  if (document.querySelector('form.dirty') && !confirm('Há alterações não salvas. Sair desta tela e perder o que foi digitado?')) {
    voltando = true; location.hash = new URL(e.oldURL).hash; return;
  }
  route();
});
window.addEventListener('beforeunload', (e) => { if (document.querySelector('form.dirty')) { e.preventDefault(); e.returnValue = ''; } });

async function start() {
  try {
    state.me = await api(S.kind === 'plataforma' ? '/api/platform/me' : '/api/me');
  } catch (e) {
    state.token = null; gravarToken(null);
    return showLogin(e.message === 'Sessão expirada. Entre novamente.' ? '' : e.message);
  }
  if (KIND === 'revenda') {
    S.conta = await api('/api/conta').catch(() => ({ tipo: 'revenda' }));
    S.area = S.conta.tipo === 'cliente' ? 'cliente' : 'revenda';
  }
  for (const n of $$('[data-area]')) n.hidden = !n.dataset.area.split(' ').includes(S.area);
  const aviso = $('#entrouComo');
  aviso.hidden = !S.conta?.impersonador;
  if (S.conta?.impersonador) aviso.textContent = `Você está no painel do cliente ${state.me.tenant?.name || ''}, aberto pela revenda. Feche esta aba para voltar.`;
  $('#who').textContent = S.kind === 'plataforma'
    ? `${state.me.name || state.me.username} · equipe DIGITAL ISP`
    : `${state.me.name || state.me.username} · ${state.me.tenant?.name || ''}`;
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (state.me.mustChange) { location.hash = '#conta'; toast('Troque a senha inicial antes de continuar.'); }
  else if (!location.hash) {
    const g = await api(S.kind === 'plataforma' ? '/api/platform/guia' : '/api/guia').catch(() => null);
    if (g && !g.completo) location.hash = '#guia';
  }
  await route();
}

/* a marca da revenda na entrada do cliente final (/c/<revenda>) */
async function marcaDaRevenda() {
  try {
    const m = await api(`/api/marca/${PORTA_CLIENTE}`);
    const logo = $('#login .login-logo');
    if (m.logo) { logo.src = m.logo; logo.alt = m.nome; } else if (logo) logo.replaceWith(el('h2', { class: 'login-nome', text: m.nome }));
    document.title = m.nome;
  } catch { /* revenda inexistente: fica a entrada neutra */ }
}

/* ------------------------------------------------------------------ plataforma (views/plataforma.js, carregado só no superadmin) */
const plat = () => import('./views/plataforma.js');

/* ------------------------------------------------------------------ minha conta */
function paintConta() {
  const root = $('#ctPanel');
  const form = el('form', { class: 'card rv-form', style: 'max-width:420px' },
    el('h3', { text: 'Trocar a senha' }),
    el('label', {}, 'Senha atual', el('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    el('label', {}, 'Senha nova (12 caracteres ou mais)', el('input', { name: 'next', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 })),
    el('button', { class: 'primary', type: 'submit', text: 'Trocar a senha' }));
  form.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    const r = await api(S.kind === 'plataforma' ? '/api/platform/me/password' : '/api/me/password', { method: 'POST', body: b });
    if (r?.token) { state.token = r.token; gravarToken(r.token); }
    form.reset();
    toast('Senha trocada.');
    if (state.me?.mustChange) { state.me.mustChange = false; location.hash = `#${firstView()}`; }
  }));
  root.replaceChildren(el('div', { class: 'card', style: 'max-width:420px;margin-bottom:16px' },
    el('p', {}, el('b', { text: state.me.name || state.me.username })), el('p', { class: 'dim', text: `Usuário: ${state.me.username}` })), form);
}

/* ------------------------------------------------------------------ início */
// o painel do cliente aberto pela revenda (outra aba): a sessão chega uma vez e fica só nesta aba
if (location.hash === '#entrar') {
  const t = localStorage.getItem('disp.token.entrar');
  localStorage.removeItem('disp.token.entrar');
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  history.replaceState(null, '', location.pathname);
}
state.token = lerToken();
if (state.token) start(); else showLogin();
