// TV Corporativa · a página do celular do funcionário (server/tvcorp-dados.js, docs/TV-CORPORATIVA.md §2.5). Aberta pelo
// endereço /tvc/<token> que a empresa gera no painel (uma por empresa ou por unidade): sem app e sem login. Mostra os
// comunicados em vigor (com "Li" quando o comunicado pede), os aniversariantes da semana, o tempo de casa, as boas-vindas,
// os eventos, o cardápio de hoje e as datas; e envia sugestões (anônimas por padrão; a foto é opcional).
// O token vai SÓ no cabeçalho Authorization (nunca no endereço da API). O nome para o "Li" fica no localStorage deste
// aparelho. Nada de HTML em texto: tudo por textContent; nenhum estilo pelo script (a CSP da página não aceita inline).
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const KEY = `nexa.tvc.${token.slice(0, 10)}`;
let st = null;

const getWho = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const setWho = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };
const show = (id, msg) => { $(id).textContent = msg || ''; $(id).hidden = !msg; };
let okTimer = null;
const ok = (m) => { show('err', ''); show('ok', m); clearTimeout(okTimer); okTimer = setTimeout(() => show('ok', ''), 4000); };
const err = (m) => { show('ok', ''); show('err', m); };
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
const put = (node, kids) => node.replaceChildren(...kids.filter(Boolean));
const pad = (n) => String(n).padStart(2, '0');
const dm = (d, m) => `${pad(d)}/${pad(m)}`;
const dateBr = (ymd) => { const [, m, d] = String(ymd).split('-'); return `${d}/${m}`; };
const when = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function api(path, { body, method, raw, type } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  const who = getWho();
  if (who) headers['x-tvc-who'] = encodeURIComponent(who);
  if (body) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = type || 'application/octet-stream';
  const res = await fetch(`/api/tvc${path}`, { method: method || (body || raw ? 'POST' : 'GET'), cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit', headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/* ------------------------------------------------------------------ abas */
for (const b of document.querySelectorAll('.t-tab')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.t-tab')) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); $(`tab-${x.dataset.tab}`).hidden = !on; }
    window.scrollTo(0, 0);
  });
}

/* ------------------------------------------------------------------ quem é (só para o "Li") */
function paintWho() {
  const who = getWho();
  $('who').value = who;
  $('meText').textContent = who ? `Você: ${who}. Toque em Li nos comunicados que pedem.` : 'Alguns comunicados pedem que você toque em Li. Para isso, diga o seu nome ou a matrícula (fica só neste celular).';
}
$('whoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('who').value.replace(/\s+/g, ' ').trim();
  if (v && v.length < 2) return err('Escreva ao menos 2 letras.');
  setWho(v.slice(0, 60)); paintWho(); ok(v ? 'Nome salvo neste celular.' : 'Nome apagado deste celular.'); load();
});

/* ------------------------------------------------------------------ o que a página mostra */
async function load() {
  try {
    st = await api('');
    show('err', '');
    $('name').textContent = st.office || st.name || '';
    document.title = `${st.office || st.name} · Comunicação da empresa`;
    paintPosts(); paintPeople(); paintAgenda(); paintKinds();
  } catch (x) { err(x.message); }
}

function paintPosts() {
  const list = st.posts || [];
  $('noPosts').hidden = list.length > 0;
  put($('posts'), list.map((p) => {
    const li = el('li', `t-card t-post${p.ackedAt ? ' read' : ''}`);
    li.append(el('span', 't-kind', p.header), el('h3', '', p.title));
    for (const para of String(p.text || '').split('\n')) if (para.trim()) li.append(el('p', '', para));
    const foot = el('div', 't-foot');
    if (p.qr) {
      const a = el('a', 't-link', 'Abrir o link');
      a.href = p.qr; a.target = '_blank'; a.rel = 'noopener noreferrer';
      foot.append(a);
    } else foot.append(el('span', 't-dim', when(p.createdAt)));
    if (p.needsAck) {
      if (p.ackedAt) foot.append(el('span', 't-done', `Lido às ${when(p.ackedAt)}`));
      else {
        const b = el('button', 't-btn primary', 'Li');
        b.type = 'button';
        b.addEventListener('click', async () => {
          if (!getWho()) { err('Antes, diga o seu nome ou a matrícula no alto da página.'); $('who').focus(); return; }
          b.disabled = true;
          try { await api(`/ack/${p.id}`, { body: { who: getWho() } }); ok('Leitura registrada.'); await load(); } catch (x) { err(x.message); b.disabled = false; }
        });
        foot.append(b);
      }
    }
    li.append(foot);
    return li;
  }));
}

function person(name, line2, mark) {
  const li = el('li', `t-person${mark ? ' today' : ''}`);
  const ini = name.split(' ').filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  li.append(el('span', 't-ini', ini), el('span', 't-pn', name), el('span', 't-dim', line2));
  return li;
}
function paintPeople() {
  const b = st.birthdays || []; const t = st.tenure || []; const w = st.welcome || [];
  $('noBirthdays').hidden = b.length > 0; $('noTenure').hidden = t.length > 0; $('noWelcome').hidden = w.length > 0;
  put($('birthdays'), b.map((p) => person(p.name, `${p.today ? 'Hoje! ' : ''}${dm(p.day, p.month)}${p.sector ? ` · ${p.sector}` : ''}`, p.today)));
  put($('tenure'), t.map((p) => person(p.name, `${p.text} · ${dateBr(p.date)}`)));
  put($('welcome'), w.map((p) => person(p.name, p.sector || 'Seja bem-vindo(a)!')));
}

function paintAgenda() {
  put($('safety'), (st.safety || []).map((s) => {
    const c = el('div', 't-card t-safety');
    c.append(el('b', 't-big', String(s.days)), el('span', '', s.title), el('small', 't-dim', `Recorde: ${s.record} dias${s.goal ? ` · Meta: ${s.goal} dias` : ''}`));
    return c;
  }));
  const ev = st.events || [];
  $('noEvents').hidden = ev.length > 0;
  put($('events'), ev.map((e) => {
    const li = el('li', 't-card');
    const days = Math.ceil((e.at - Date.now()) / 86400000);
    li.append(el('b', '', e.title), el('span', 't-dim', `${when(e.at)}${days > 1 ? ` · faltam ${days} dias` : days === 1 ? ' · amanhã' : ''}`));
    if (e.text) li.append(el('p', '', e.text));
    return li;
  }));
  const menus = st.menu || [];
  $('noMenu').hidden = menus.length > 0;
  put($('menu'), menus.map((m) => {
    const c = el('div', 't-card');
    c.append(el('b', '', `${m.title} · ${m.weekday}`));
    const ul = el('ul', 't-menu');
    for (const i of m.items) ul.append(el('li', '', `${i.name}${i.note ? ` (${i.note})` : ''}${i.price != null ? ` · ${money(i.price)}` : ''}`));
    c.append(ul);
    return c;
  }));
  const camp = st.campaigns || [];
  show('campaigns', camp.length ? `Neste mês: ${camp.join(', ')}.` : '');
  put($('dates'), (st.dates || []).map((d) => { const li = el('li', 't-date'); li.append(el('b', '', dateBr(d.date)), el('span', '', d.name), el('small', 't-dim', d.kind)); return li; }));
}

/* ------------------------------------------------------------------ sugestão */
function paintKinds() {
  const sel = $('kind');
  if (sel.options.length) return;
  for (const [k, label] of Object.entries(st.suggest?.kinds || { sugestao: 'Sugestão' })) { const o = el('option', '', label); o.value = k; sel.append(o); }
}
$('text').addEventListener('input', () => { $('count').textContent = `${$('text').value.length} de 500`; });
$('anon').addEventListener('change', () => { $('nameBox').hidden = $('anon').checked; if (!$('anon').checked && !$('sname').value) $('sname').value = getWho(); });
$('suggestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const file = $('photo').files?.[0] || null;
    if (file && file.size > 5 * 1024 * 1024) throw new Error('A foto passa de 5 MB. Escolha outra.');
    const r = await api('/suggest', { body: { kind: $('kind').value, text: $('text').value, anonymous: $('anon').checked, who: $('sname').value } });
    if (file) await api(`/suggest/${r.id}/image`, { method: 'PUT', raw: file, type: file.type || 'application/octet-stream' });
    $('text').value = ''; $('photo').value = ''; $('count').textContent = '0 de 500';
    ok('Enviado. Obrigado! A equipe de comunicação vai ler.');
  } catch (x) { err(x.message); } finally { if (btn) btn.disabled = false; }
});

paintWho();
load();
setInterval(() => { if (!document.hidden) load(); }, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
