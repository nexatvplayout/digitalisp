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
const S = { kind: KIND, view: null };
document.title = KIND === 'plataforma' ? 'DIGITAL ISP · Plataforma' : 'DIGITAL ISP · Painel';

/* ------------------------------------------------------------------ entrada */
function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#loginErr');
  err.hidden = !msg; err.textContent = msg;
  const f = $('#loginForm');
  $('#loginKind').textContent = KIND === 'plataforma' ? 'Equipe da plataforma' : 'Painel da revenda';
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
    store.set(TOKEN_KEY, r.token);
    f.password.value = '';
    await start();
  } catch (err) {
    $('#loginErr').hidden = false; $('#loginErr').textContent = err.message;
  }
});

async function logout() {
  const path = S.kind === 'plataforma' ? '/api/platform/logout' : '/api/me/logout';
  try { if (state.token) await api(path, { method: 'POST' }); } catch { /* já saiu */ }
  state.token = null; state.me = null; store.set(TOKEN_KEY, null);
  showLogin();
}
$('#logout').addEventListener('click', logout);
on('logout', () => { state.token = null; store.set(TOKEN_KEY, null); showLogin('Sessão expirada. Entre novamente.'); });

/* ------------------------------------------------------------------ telas do painel */
const guiaMod = () => import('./views/guia.js');
const VIEWS = {
  guia: { area: null, load: async () => (await guiaMod()).paintGuia($('#gdPanel'), S.kind, { onChange: faixaGuia }) },
  tvcorp: { area: 'revenda', load: async (sub) => (await tvcorp()).load(sub), leave: () => tvcorpMod?.leave?.() },
  revendas: { area: 'plataforma', load: async () => (await plat()).paintRevendas($('#rvPanel')) },
  planos: { area: 'plataforma', load: async () => (await plat()).paintPlanos($('#plPanel')) },
  cobrancas: { area: 'plataforma', load: async () => (await plat()).paintCobrancas($('#cbPanel')) },
  mapa: { area: 'plataforma', load: async () => (await plat()).paintMapa($('#mpPanel')), leave: async () => (await plat()).leaveMapa() },
  conta: { area: null, load: () => paintConta() },
};
const firstView = () => (S.kind === 'plataforma' ? 'revendas' : 'tvcorp');

async function route() {
  if (!state.me) return;
  const [id, sub] = (location.hash.slice(1) || firstView()).split('/');
  const v = VIEWS[id] && (VIEWS[id].area === null || VIEWS[id].area === S.kind) ? id : firstView();
  if (S.view && S.view !== v) VIEWS[S.view].leave?.();
  S.view = v;
  for (const k of Object.keys(VIEWS)) $(`#view-${k}`).hidden = k !== v;
  for (const a of $$('.side a[data-view]')) a.classList.toggle('on', a.dataset.view === v);
  await guard(VIEWS[v].load)(sub);
  faixaGuia();
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
window.addEventListener('hashchange', route);

async function start() {
  try {
    state.me = await api(S.kind === 'plataforma' ? '/api/platform/me' : '/api/me');
  } catch (e) {
    state.token = null; store.set(TOKEN_KEY, null);
    return showLogin(e.message === 'Sessão expirada. Entre novamente.' ? '' : e.message);
  }
  for (const n of $$('.side [data-area]')) n.hidden = n.dataset.area !== S.kind;
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
    if (r?.token) { state.token = r.token; store.set(TOKEN_KEY, r.token); }
    form.reset();
    toast('Senha trocada.');
    if (state.me?.mustChange) { state.me.mustChange = false; location.hash = `#${firstView()}`; }
  }));
  root.replaceChildren(el('div', { class: 'card', style: 'max-width:420px;margin-bottom:16px' },
    el('p', {}, el('b', { text: state.me.name || state.me.username })), el('p', { class: 'dim', text: `Usuário: ${state.me.username}` })), form);
}

/* ------------------------------------------------------------------ início */
state.token = store.get(TOKEN_KEY);
if (state.token) start(); else showLogin();
