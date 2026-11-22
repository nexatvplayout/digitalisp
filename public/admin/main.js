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
const VIEWS = {
  tvcorp: { area: 'revenda', load: async (sub) => (await tvcorp()).load(sub), leave: () => tvcorpMod?.leave?.() },
  revendas: { area: 'plataforma', load: () => paintRevendas() },
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
  await route();
}

/* ------------------------------------------------------------------ plataforma: revendas */
const fmtStatus = { trial: 'Em teste', active: 'Ativa', past_due: 'Em atraso', suspended: 'Suspensa', canceled: 'Cancelada' };
async function paintRevendas() {
  const root = $('#rvPanel');
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const [ov, list, plans] = await Promise.all([api('/api/platform/overview'), api('/api/platform/tenants'), api('/api/platform/plans')]);
  const kpi = (n, label) => el('div', { class: 'card kpi' }, el('b', { text: String(n) }), el('span', { class: 'dim', text: label }));
  const table = el('table', { class: 'rv-table' },
    el('thead', {}, el('tr', {}, ...['Revenda', 'Identificador', 'Plano', 'Situação', 'Clientes finais', 'Telas'].map((t) => el('th', { text: t })))),
    el('tbody', {}, ...list.map((t) => el('tr', {},
      el('td', { text: t.name }), el('td', { class: 'mono', text: t.slug }), el('td', { text: t.planName || '—' }),
      el('td', { text: fmtStatus[t.status] || t.status }), el('td', { text: String(t.uso?.unidades ?? 0) }), el('td', { text: String(t.uso?.telas ?? 0) })))));
  const active = plans.filter((p) => p.active);
  const form = el('form', { class: 'card rv-form' },
    el('h3', { text: 'Nova revenda' }),
    el('label', {}, 'Nome (razão social ou nome fantasia)', el('input', { name: 'name', required: true, maxlength: 80 })),
    el('label', {}, 'CNPJ', el('input', { name: 'document', inputmode: 'numeric', placeholder: '00.000.000/0000-00' })),
    el('label', {}, 'E-mail do responsável', el('input', { name: 'contactEmail', type: 'email' })),
    el('label', {}, 'Usuário do administrador', el('input', { name: 'adminUsername', placeholder: 'vazio = o e-mail' })),
    el('label', {}, 'Plano', el('select', { name: 'planCode' }, ...active.map((p) => el('option', { value: p.code, text: p.name })))),
    active.length ? null : el('p', { class: 'hint', text: 'Nenhum plano ativo ainda: os planos por número de telas entram no próximo passo.' }),
    el('button', { class: 'primary', type: 'submit', text: 'Cadastrar revenda', disabled: !active.length }),
    el('div', { id: 'rvOut' }));
  form.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    for (const k of Object.keys(b)) if (!b[k]) delete b[k];
    const r = await api('/api/platform/tenants', { method: 'POST', body: b });
    toast(`Revenda ${r.tenant.name} cadastrada.`);
    await paintRevendas();
    if (r.admin.password) {
      $('#rvOut')?.replaceChildren(el('p', { class: 'hint', text: `Senha inicial de ${r.admin.username} (mostrada só agora; a revenda troca no primeiro acesso):` }), el('p', { class: 'rv-secret', text: r.admin.password }));
    }
  }));
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(ov.revendas, 'revendas'), kpi(ov.unidades, 'clientes finais'), kpi(ov.telas, 'telas')),
    el('div', { class: 'rv-grid', style: 'margin-top:16px' }, el('div', { class: 'card' }, list.length ? table : el('p', { class: 'dim', text: 'Nenhuma revenda ainda.' })), form));
}

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
