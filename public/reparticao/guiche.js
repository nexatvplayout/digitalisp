// NEXA Telas · a página do guichê (server/telas-senha.js, docs/TELAS.md §10). Aberta pelo endereço /reparticao/<token>/guiche
// que o gestor da repartição (ou a prefeitura) gera, como o do totem. O token do guichê SÓ chama a próxima senha, repete,
// marca "não compareceu", finaliza e encaminha: não emite senha, não vê nomes além do da senha em atendimento, não abre a
// página de controle. Sem login: quem tem o endereço atende; gerar outro derruba o anterior.
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const KEY = `nexa.guiche.${token.slice(0, 12)}`;
let G = null; let okTimer = null;

async function api(path, body) {
  const res = await fetch(`/api/guiche${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
const show = (id, msg) => { $(id).textContent = msg || ''; $(id).hidden = !msg; };
const ok = (msg) => { show('err', ''); show('ok', msg); clearTimeout(okTimer); okTimer = setTimeout(() => show('ok', ''), 5000); };
const err = (msg) => { show('ok', ''); show('err', msg); };
const option = (v, t, sel) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; o.selected = Boolean(sel); return o; };
const desk = () => $('deskName').value.trim();
// a senha deste guichê é a chamada por último nele (as anteriores seguem em atendimento até serem finalizadas)
const mine = () => (desk() ? [...G.serving].filter((t) => t.desk === desk()).sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0))[0] || null : null);
const waited = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function paint() {
  $('office').textContent = G.office; $('title').textContent = G.title;
  $('waiting').textContent = `${G.waiting} esperando`;
  const from = $('from').value;
  $('from').replaceChildren(option('', 'Todas as filas', !from), ...G.services.map((s) => option(s.id, s.name, String(s.id) === from)));
  const t = mine();
  $('code').textContent = t ? t.code : '—';
  $('info').textContent = t ? `${t.service}${t.priority === 2 ? ' · 80 anos ou mais' : t.priority ? ' · preferencial' : ' · normal'}${t.name ? ` · ${t.name}` : ''} · chamada há ${waited(G.serverTime - t.calledAt)}` : (desk() ? 'Nenhuma senha em atendimento aqui. Toque em Chamar próxima.' : 'Escreva o nome deste guichê.');
  for (const id of ['repeat', 'requeue', 'noshow', 'finish']) $(id).disabled = !t;
  const keep = $('forwardTo').value;
  $('forwardTo').replaceChildren(...G.services.filter((s) => !t || s.id !== t.serviceId).map((s) => option(s.id, s.name, String(s.id) === keep)));
  $('forward').disabled = !t || !$('forwardTo').options.length;
  $('call').disabled = !G.services.length;
  paintQueue();
}
const RISK_WORD = { vermelho: 'Vermelho', laranja: 'Laranja', amarelo: 'Amarelo', verde: 'Verde', azul: 'Azul' };
/** Quem espera, na ordem de chamada, com o motivo de cada posição e o "Chamar esta" (sem nomes). */
function paintQueue() {
  const list = G.queue || [];
  $('queueBox').hidden = false; $('queueEmpty').hidden = list.length > 0;
  $('queue').replaceChildren(...list.map((t) => {
    const li = document.createElement('li');
    const tag = document.createElement('span'); tag.className = `r-tag${t.priority ? ' live' : ''}`; tag.textContent = t.code;
    const mid = document.createElement('span');
    const b = document.createElement('b');
    if (t.risk) { const dot = document.createElement('span'); dot.className = `r-risk rk-${t.risk}`; dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', RISK_WORD[t.risk] || t.risk); b.append(dot); }
    b.append(`${t.service}${t.priority === 2 ? ' · 80 anos ou mais' : t.priority ? ' · preferencial' : ''}`);
    const sm = document.createElement('small'); sm.textContent = `espera ${waited(G.serverTime - t.queuedAt)}`;
    const why = document.createElement('small'); why.className = 'r-why'; why.textContent = `Por quê: ${t.reason || ''}`;
    mid.append(b, sm, why);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'r-btn small'; btn.textContent = 'Chamar esta';
    btn.title = 'Chama esta senha para este guichê, fora da ordem (fica registrado no log da repartição)';
    btn.setAttribute('aria-label', `Chamar a senha ${t.code} agora`);
    btn.addEventListener('click', run(async () => {
      if (!desk()) { $('deskName').focus(); throw new Error('Escreva o nome deste guichê antes de chamar.'); }
      return api('/call', { desk: desk(), ticketId: t.id });
    }, (r) => `Chamando ${r.ticket.code} para ${r.call.desk} (fora da ordem, registrado).`));
    li.append(tag, mid, btn);
    return li;
  }));
}
async function load() { G = await api(''); $('desk').hidden = false; paint(); }
const run = (fn, msg) => async () => { try { const r = await fn(); if (msg) ok(typeof msg === 'function' ? msg(r) : msg); await load(); } catch (x) { err(x.message); } };
const onMine = (path, body, msg) => run(async () => { const t = mine(); if (!t) throw new Error('Nenhuma senha em atendimento neste guichê.'); return api(`/tickets/${t.id}/${path}`, body ? body() : {}); }, msg);

$('deskName').addEventListener('change', () => { try { sessionStorage.setItem(KEY, desk()); } catch { /* sem armazenamento */ } if (G) paint(); });
$('call').addEventListener('click', run(async () => {
  if (!desk()) { $('deskName').focus(); throw new Error('Escreva o nome deste guichê (ex.: Guichê 3).'); }
  return api('/call', { desk: desk(), serviceId: $('from').value ? Number($('from').value) : null });
}, (r) => `Chamando ${r.ticket.code} para ${r.call.desk}.`));
$('repeat').addEventListener('click', onMine('repeat', null, 'Chamada mostrada de novo na tela.'));
$('noshow').addEventListener('click', onMine('noshow', null, 'Marcada como não compareceu.'));
$('requeue').addEventListener('click', onMine('requeue', null, 'A senha voltou para a fila, no lugar de antes.'));
$('finish').addEventListener('click', onMine('finish', null, 'Atendimento finalizado.'));
$('forward').addEventListener('click', onMine('forward', () => ({ serviceId: Number($('forwardTo').value) }), 'Senha encaminhada.'));

const clock = () => { $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
clock(); setInterval(clock, 20000);
try { $('deskName').value = sessionStorage.getItem(KEY) || ''; } catch { /* sem armazenamento */ }
if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) err('Endereço incompleto. Peça o endereço do guichê ao responsável da repartição.');
else {
  load().catch((x) => err(x.message));
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 4000);
}
