// NEXA Telas · a página da sala ou do consultório (server/telas-salas.js, docs/TELAS.md §27). Aberta pelo endereço
// /reparticao/<token>/sala que o gestor gera para cada sala; feita para o celular. O token da sala SÓ chama o próximo
// paciente das filas do grupo dela (na ordem do Manchester), repete, marca "não compareceu", finaliza, encaminha, muda
// Disponível/Pausa, reavalia a cor de quem passou do tempo-alvo e pede apoio. Não emite senha, não lê a fila com nomes.
// §31 (20/11): o passo a passo com a chegada confirmada (Chamar paciente → Paciente chegou | Chamar de novo | Não
// compareceu → Encaminhar | Finalizar); com a confirmação exigida, o servidor só finaliza/encaminha depois do "chegou".
import { levelLabel } from '/shared/triagem-catalogo.js';
import { RISKS } from '/shared/telas-tipos.js';
import { roomStateLabel, minText } from '/shared/telas-salas.js';
import { mostrarPanicos } from '/reparticao/alerta-panico.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
let D = null; let okTimer = null; let reval = null; // reval: a senha com o seletor de cor aberto

async function api(path, body) {
  const res = await fetch(`/api/sala${path}`, {
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
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (text, cls, onclick, label) => { const b = el('button', `r-btn ${cls || ''}`.trim(), text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', onclick); return b; };
const option = (v, t) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; return o; };
const hm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const prio = (p) => (p === 2 ? '80 anos ou mais' : p ? 'preferencial' : 'normal');
const riskName = (k) => levelLabel(k, D?.targets?.[k]);
const dot = (k) => { const s = el('span', `r-risk rk-${k}`); s.setAttribute('role', 'img'); s.setAttribute('aria-label', riskName(k)); return s; };
const run = (fn, msg) => async () => { try { const r = await fn(); if (msg) ok(typeof msg === 'function' ? msg(r) : msg); await load(); } catch (x) { err(x.message); } };

function paint() {
  document.title = `${D.room.name} · ${D.office}`;
  // o pânico aberto (desta sala ou de outra): a faixa piscando com o bipe, até alguém encerrar
  mostrarPanicos(D.panic, { minhaSala: D.room.name, fechar: async (id) => { await api(`/panic/${id}/close`, {}); await load(); } });
  $('room').textContent = D.room.name; $('office').textContent = `${D.room.kindLabel} · ${D.office}`;
  $('state').textContent = roomStateLabel(D.room.state); $('state').className = `r-state ${D.room.state}`;
  const t = D.current;
  $('code').textContent = t ? t.code : '—';
  $('info').replaceChildren(...(t ? [t.risk ? dot(t.risk) : '', `${t.risk ? `${riskName(t.risk)} · ` : ''}${t.service} · ${prio(t.priority)}${t.name ? ` · ${t.name}` : ''}${t.stage ? ` · etapa ${t.stage.index + 1} de ${t.stage.total}: ${t.stage.name}` : ''}`] : [D.waiting ? `${D.waiting} esperando. Toque em Chamar paciente.` : 'Ninguém esperando agora.']));
  // §31: o passo a passo. Sem paciente: Chamar paciente. Chamado: Paciente chegou | Chamar de novo | Não compareceu.
  // Chegou (ou sem a confirmação exigida): Encaminhar para a próxima etapa | Finalizar.
  const st = t ? t.callState : null;
  $('call').hidden = Boolean(t);
  $('stepCalled').hidden = !(st === 'called' || st === 'serving');
  $('stepServing').hidden = !(st === 'arrived' || st === 'serving');
  $('more').hidden = !t;
  $('stateRow').hidden = Boolean(t); // Disponível/Pausa só com a sala livre (a sala volta a Disponível sozinha ao terminar)
  $('arrive').classList.toggle('primary', st === 'called');
  const note = $('callNote');
  note.hidden = !t;
  if (t) {
    const ago = minText((D.serverTime - (t.calledAt || D.serverTime)) / 60000);
    const again = t.repeats ? ` · chamado de novo ${t.repeats === 1 ? '1 vez' : `${t.repeats} vezes`}` : '';
    note.textContent = st === 'arrived'
      ? `Chegou às ${hm(t.arrivedAt)} (${minText((t.arrivedAt - t.calledAt) / 60000)} depois da chamada). Em atendimento.`
      : st === 'called' ? `Chamado há ${ago}${again}. Esperando o paciente chegar.` : `Chamado há ${ago}${again}. Em atendimento.`;
    note.className = `s-step ${st === 'called' ? 'wait' : 'in'}`;
  }
  const nx = t?.stage?.next || null;
  $('next').hidden = !nx;
  if (nx) $('next').textContent = `Encaminhar para ${nx.name}`;
  $('next').classList.toggle('primary', Boolean(nx));
  $('finish').classList.toggle('primary', !nx);
  const keep = $('forwardTo').value;
  $('forwardTo').replaceChildren(...D.forward.map((s) => option(s.id, s.name)));
  if (keep) $('forwardTo').value = keep;
  $('forward').disabled = !t || !D.forward.length;
  $('call').disabled = false;
  $('available').disabled = D.room.state === 'available'; $('pause').disabled = D.room.state === 'pause';
  $('available').classList.toggle('primary', D.room.state === 'pause');
  $('now').hidden = false;
  paintSupport(); paintQueue();
}
function paintSupport() {
  $('supportBox').hidden = !D.support.kinds.length;
  $('kinds').replaceChildren(...D.support.kinds.map((k) => btn(k, '', run(() => api('/support', { kind: k }), `Pedido de ${k.toLowerCase()} enviado.`), `Pedir ${k}`)));
  $('mine').replaceChildren(...D.support.mine.map((x) => {
    const li = el('li');
    const tag = el('span', `r-tag${x.status === 'open' ? ' live' : ''}`, x.statusLabel);
    const mid = el('span'); mid.append(el('b', '', x.kind), el('small', '', `${new Date(x.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${x.acceptedBy ? ` · ${x.acceptedBy}${x.waitMin != null ? ` em ${minText(x.waitMin)}` : ''}` : ''}`));
    li.append(tag, mid);
    if (x.status === 'open' || x.status === 'accepted') li.append(btn('Cancelar', 'small', run(() => api(`/support/${x.id}/cancel`, {}), 'Pedido cancelado.'), `Cancelar o pedido de ${x.kind}`));
    return li;
  }));
}
/** Quem espera nas filas desta sala (sem nomes), com quem passou do tempo-alvo piscando e o Reavaliar. */
function paintQueue() {
  $('queueBox').hidden = false; $('queueEmpty').hidden = D.queue.length > 0;
  $('queue').replaceChildren(...D.queue.map((t) => {
    const li = el('li', t.overMin != null ? 'r-late' : '');
    li.append(el('span', `r-tag${t.priority ? ' live' : ''}`, t.code));
    const mid = el('span'); const b = el('b');
    if (t.risk) b.append(dot(t.risk));
    b.append(`${t.service}${t.priority ? ` · ${prio(t.priority)}` : ''}`);
    if (t.overMin != null) b.append(el('span', 'r-late-tag', t.overMin ? `passou do alvo há ${minText(t.overMin)}` : 'passou do alvo'));
    mid.append(b, el('small', '', `espera ${minText((D.serverTime - t.issuedAt) / 60000)}`), el('small', 'r-why', `Por quê: ${t.reason || ''}`));
    li.append(mid);
    if (t.overMin != null && D.risk) {
      if (reval === t.id) {
        const pick = el('div', 's-pick'); pick.setAttribute('role', 'group'); pick.setAttribute('aria-label', `Nova cor da senha ${t.code}`);
        for (const r of RISKS) { const x = btn(r.label || r.key, `r-riskbtn rk-${r.key}`, run(async () => { const out = await api(`/tickets/${t.id}/risk`, { risk: r.key }); reval = null; return out; }, `${t.code}: ${riskName(r.key)}.`), riskName(r.key)); pick.append(x); }
        pick.append(btn('Fechar', 'small', () => { reval = null; paintQueue(); }));
        li.append(pick);
      } else li.append(btn('Reavaliar', 'small', () => { reval = t.id; paintQueue(); }, `Reavaliar a cor da senha ${t.code}`));
    }
    return li;
  }));
}
async function load() { D = await api(''); paint(); }

$('call').addEventListener('click', run(() => api('/call', {}), (r) => `Chamando ${r.ticket.code}.`));
$('arrive').addEventListener('click', run(() => api('/arrive', {}), 'Chegada confirmada. Em atendimento.'));
$('repeat').addEventListener('click', run(() => api('/repeat', {}), 'Chamada mostrada de novo na tela.'));
const noshow = run(() => api('/noshow', {}), 'Marcada como não compareceu. A sala está disponível.');
$('noshow').addEventListener('click', () => { if (confirm(`Marcar ${D?.current?.code || 'a senha'} como não compareceu?`)) noshow(); });
$('finish').addEventListener('click', run(() => api('/finish', {}), 'Atendimento finalizado. A sala está disponível.'));
// ao terminar: o próximo paciente (se houver alguém esperando) ou uma pausa
$('finishNext').addEventListener('click', run(async () => {
  await api('/finish', {});
  try { return await api('/call', {}); } catch (x) { return { semFila: x.message }; }
}, (r) => (r.semFila ? `Atendimento finalizado. ${r.semFila}` : `Atendimento finalizado. Chamando ${r.ticket.code}.`)));
$('finishPause').addEventListener('click', run(async () => { await api('/finish', {}); return api('/state', { state: 'pause' }); }, 'Atendimento finalizado. Sala em pausa: toque em Disponível para voltar.'));

// o pânico: avisa na hora e grava o som da sala por 2 minutos (o navegador pede o microfone na primeira vez)
let gravando = false;
async function gravar(id) {
  if (gravando || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
  gravando = true;
  const nota = $('panicNote');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const partes = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(partes, { type: rec.mimeType || 'audio/webm' });
      try {
        const res = await fetch(`/api/sala/panic/${id}/audio`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body: blob });
        nota.textContent = res.ok ? 'Gravação de 2 minutos enviada ao painel da unidade.' : 'Não foi possível enviar a gravação.';
      } catch { nota.textContent = 'Não foi possível enviar a gravação (sem rede).'; }
      gravando = false;
    };
    rec.start(5000);
    let resta = 120;
    nota.textContent = 'Gravando o som da sala: 2:00';
    const t = setInterval(() => { resta -= 1; nota.textContent = `Gravando o som da sala: ${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, '0')}`; if (resta <= 0) { clearInterval(t); rec.stop(); } }, 1000);
  } catch { nota.textContent = 'O alerta foi enviado. Sem permissão do microfone, a gravação não foi feita.'; gravando = false; }
}
$('panic').addEventListener('click', async () => {
  if (!confirm('Acionar o PÂNICO? As outras salas, o guichê e a recepção recebem o alerta agora.')) return;
  try { const r = await api('/panic', {}); ok('Pânico acionado: a equipe foi avisada.'); await load(); gravar(r.id); } catch (x) { err(x.message); }
});
$('requeue').addEventListener('click', run(() => api('/requeue', {}), 'A senha voltou para a fila, no lugar de antes.'));
$('next').addEventListener('click', run(() => api('/forward', { next: true }), (r) => `Encaminhada para ${r.stage}. A sala está disponível.`));
$('forward').addEventListener('click', run(() => api('/forward', { serviceId: Number($('forwardTo').value) }), 'Senha encaminhada (mantém a prioridade e a cor).'));
$('available').addEventListener('click', run(() => api('/state', { state: 'available' }), 'Sala disponível.'));
$('pause').addEventListener('click', run(() => api('/state', { state: 'pause' }), 'Sala em pausa: o automático não manda pacientes.'));

const clock = () => { $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
clock(); setInterval(clock, 20000);
if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) err('Endereço incompleto. Peça o endereço da sala ao responsável da repartição.');
else {
  load().catch((x) => err(x.message));
  setInterval(() => { if (!document.hidden && reval == null) load().catch(() => {}); }, 4000);
}
