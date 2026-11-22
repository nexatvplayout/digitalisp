// NEXA Telas · página de controle da repartição · chamada de senha, em abas: Atendimento (o guichê ou o consultório: chamar,
// repetir, não compareceu, finalizar, encaminhar; ao lado, quem espera e quem está em atendimento), Recepção (emitir a senha;
// para o gestor, também as filas, o totem e a configuração) e Triagem (só com a classificação de risco: a cor de cada senha).
// O atendente (papel "atendente") só vê Atendimento e Recepção: é a tela do guichê. /api/reparticao/queue*.
import { RISKS, PRIORITIES, layoutLabel, isQueueLayout, serviceColor } from '/shared/telas-tipos.js';
import { TRIAGE_LEVELS, TRIAGE_PROBLEMS, TRIAGE_OTHER, levelLabel, levelOf } from '/shared/triagem-catalogo.js';
import { S, KEY, el, put, api, act, ok, card, cols, field, option, check, hhmm, hour } from '/reparticao/rep-base.js';
import { tvPreview, qrSvg } from '/shared/telas-previa.js';
import { roomStateLabel, minText } from '/shared/telas-salas.js';
import { supportList } from '/reparticao/rep-salas.js';

let Q = null; // o resumo da fila (GET /queue)
let timer = null; let hooks = { retab: () => {} };
const views = new Set(); // as abas abertas, repintadas a cada leitura
const DESK_KEY = `${KEY}.guiche`; const FROM_KEY = `${KEY}.fila`;
// §26: a sala escolhida fica lembrada NESTE navegador (não é segredo: só o número da sala; a sessão continua só na aba)
const ROOM_KEY = `${KEY}.sala`;
const roomGet = () => { try { return localStorage.getItem(ROOM_KEY) || ''; } catch { return ''; } };
const roomSet = (v) => { try { if (v) localStorage.setItem(ROOM_KEY, v); else localStorage.removeItem(ROOM_KEY); } catch { /* sem armazenamento */ } };
let desk = ''; let from = '';
const svcName = (id) => Q.services.find((s) => s.id === id)?.name || 'fila removida';
const waited = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const gestor = () => S.state.role === 'gestor';
export const risk = () => Boolean(Q?.config?.risk);
export const queue = () => Q;

async function load() {
  const had = risk();
  Q = await api('/queue');
  if (had !== risk()) hooks.retab(); // a Triagem aparece e some com a classificação de risco
  for (const v of views) v();
}
const run = (fn, okMsg) => act(async (e) => { const r = await fn(e); await load(); return r; }, okMsg);
export async function start(h) {
  hooks = h; stop(); Q = null; views.clear();
  if (!S.state.modules?.senha) return;
  try { desk = sessionStorage.getItem(DESK_KEY) || ''; from = sessionStorage.getItem(FROM_KEY) || ''; } catch { /* sem armazenamento */ }
  try { Q = await api('/queue'); } catch { Q = null; }
  timer = setInterval(() => { if (S.session && !document.hidden) load().catch(() => {}); }, 4000);
}
export function stop() { clearInterval(timer); timer = null; }

const prio = (t) => (t.priority === 2 ? '80 anos ou mais' : t.priority ? 'preferencial' : 'normal');
/** "Laranja · Muito urgente · até 10 min", com o tempo-alvo desta repartição. */
const riskName = (k) => levelLabel(k, Q?.config?.targets?.[k]);
const riskDot = (k) => (k ? el('span', { class: `r-risk rk-${k}`, role: 'img', 'aria-label': riskName(k) }) : null);
/** §31: a situação da chamada (chamado, chegou, em atendimento) e a senha que espera o profissional da sala. */
const callTag = (t) => {
  if (t.status === 'called' && t.callState) return el('span', { class: `r-call-state ${t.callState}`, text: t.callState === 'called' ? 'chamado · esperando chegar' : t.callState === 'arrived' ? `chegou${t.arrivedAt ? ` às ${hour(t.arrivedAt)}` : ''}` : 'em atendimento' });
  if (t.status === 'waiting' && t.awaitPro) return el('span', { class: 'r-call-state pro', text: 'aguardando o profissional' });
  return null;
};
function ticketLine(t, actions = []) {
  const late = t.status === 'waiting' && t.overMin != null; // §28: passou do tempo-alvo (pisca)
  return el('li', { class: late ? 'r-late' : '' },
    el('span', { class: `r-tag${t.priority ? ' live' : ''}`, text: t.code }),
    el('span', {}, el('b', {}, riskDot(t.risk), `${svcName(t.serviceId)} · ${prio(t)}${t.name ? ` · ${t.name}` : ''}`, t.stage ? el('span', { class: 'r-stage', text: `etapa ${t.stage.index + 1}: ${t.stage.name}` }) : null, late ? el('span', { class: 'r-late-tag', text: t.overMin ? `passou do alvo há ${minText(t.overMin)}` : 'passou do alvo' }) : null, callTag(t)),
      el('small', { text: t.status === 'called' ? `${t.desk} · há ${waited(Q.serverTime - t.calledAt)}` : `espera ${waited(Q.serverTime - t.queuedAt)}${t.origin === 'totem' ? ' · totem' : ''}${Q.config.risk && !t.risk ? ' · sem cor' : ''}` }),
      t.reason ? el('small', { class: 'r-why', text: `Por quê: ${t.reason}` }) : null),
    ...actions);
}
/** O foco está num campo dentro de el (não repintar agora: a leitura a cada 4 s apagaria o que a pessoa escolhe). */
const busy = (box) => box.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
/**
 * A lista "Esperando" (na ordem em que será chamada, com o motivo de cada posição) e "Em atendimento": o lado direito do
 * Atendimento e da Recepção. mode 'atendimento': cada senha ganha "Chamar esta" (callThis); 'recepcao': mudar a prioridade.
 */
function waitingSide(mode = 'recepcao', { callThis } = {}) {
  const count = el('span', { class: 'r-dim' }); const list = el('ul', { class: 'r-list' }); const empty = el('p', { class: 'r-dim', text: 'Ninguém esperando.' });
  const serving = el('ul', { class: 'r-list r-serving' }); const none = el('p', { class: 'r-dim', text: 'Ninguém em atendimento.' }); const rule = el('p', { class: 'r-dim' });
  const cancelBtn = (t) => el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Cancelar a senha ${t.code}`, onclick: () => { if (confirm(`Cancelar a senha ${t.code}?`)) run(() => api(`/queue/tickets/${t.id}/cancel`, { method: 'POST' }))(); } }, 'Cancelar');
  // §31: a senha de uma etapa do profissional da sala só o gestor chama daqui, por exceção (fica no log)
  const callBtn = (t) => (t.awaitPro
    ? (gestor() ? el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Chamar a senha ${t.code} por exceção`, title: 'Esta etapa é chamada pelo profissional, na página da sala. O gestor pode chamar por exceção (fica registrado no log da repartição)', onclick: () => { if (confirm(`A etapa "${t.stage?.name || ''}" é chamada pelo profissional da sala. Chamar ${t.code} por exceção? Fica registrado no log.`)) callThis(t); } }, 'Chamar por exceção') : null)
    : el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Chamar a senha ${t.code} agora`, title: 'Chama esta senha para este guichê, fora da ordem (fica registrado no log da repartição)', onclick: () => callThis(t) }, 'Chamar esta'));
  const arriveBtn = (t) => (t.callState === 'called' || t.callState === 'serving' ? el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Confirmar que ${t.code} chegou`, title: 'Paciente chegou: confirma a chegada (conta nos indicadores)', onclick: run(() => api(`/queue/tickets/${t.id}/arrive`, { method: 'POST' }), `${t.code}: chegada confirmada.`) }, 'Chegou') : null);
  const prioSel = (t) => {
    const s = Q.services.find((x) => x.id === t.serviceId);
    if (!s?.priority) return el('span', {});
    const sel = el('select', { class: 'r-mini', 'aria-label': `Prioridade da senha ${t.code}`, title: 'Mudar a prioridade (o código impresso não muda)' },
      ...PRIORITIES.map((p) => option(p.key, p.key === 0 ? 'Normal' : p.key === 1 ? 'Preferencial / 60+' : '80 anos ou mais', p.key === t.priority)));
    sel.addEventListener('change', () => { sel.blur(); run(() => api(`/queue/tickets/${t.id}/priority`, { method: 'POST', body: { priority: Number(sel.value) } }), `Prioridade de ${t.code} alterada.`)(); });
    return sel;
  };
  // §28: Reavaliar (só o gestor, que faz a triagem): a nova cor de quem passou do tempo-alvo
  const revalSel = (t) => {
    if (!(gestor() && Q.config.risk && t.overMin != null)) return null;
    const sel = el('select', { class: 'r-mini', 'aria-label': `Reavaliar a cor da senha ${t.code}`, title: 'Reavaliar: reclassificar a cor' }, option('', 'Reavaliar…', true), ...RISKS.map((r) => option(r.key, riskName(r.key), false)));
    sel.addEventListener('change', () => { if (!sel.value) return; const v = sel.value; sel.blur(); run(() => api(`/queue/tickets/${t.id}/risk`, { method: 'POST', body: { risk: v } }), `${t.code}: ${riskName(v)}.`)(); });
    return sel;
  };
  const paint = () => {
    count.textContent = Q.waiting.length ? ` (${Q.waiting.length})` : '';
    empty.hidden = Q.waiting.length > 0;
    if (!busy(list)) put(list, Q.waiting.slice(0, 40).map((t) => ticketLine(t, mode === 'atendimento' && callThis ? [revalSel(t), callBtn(t), cancelBtn(t)] : [revalSel(t), prioSel(t), cancelBtn(t)])));
    const c = Q.config;
    rule.textContent = c.risk
      ? `Ordem: vermelho é imediato; as outras cores pelo atraso em relação ao tempo-alvo (laranja ${c.targets?.laranja ?? 10}, amarelo ${c.targets?.amarelo ?? 60}, verde ${c.targets?.verde ?? 120}, azul ${c.targets?.azul ?? 240} min)${c.escalate ? '; verde e azul atrasados sobem até o nível do amarelo' : ''}${c.ageBoost ? '; 60+ e 80+ andam mais rápido dentro da mesma cor' : ''}. Sem cor: ordem de chegada, 1 preferencial a cada ${c.ratio} normais.`
      : `Ordem: chegada, com 1 preferencial a cada ${c.ratio} normais; 80 anos ou mais passa à frente das outras preferenciais.`;
    none.hidden = Q.serving.length > 0;
    put(serving, Q.serving.map((t) => ticketLine(t, [arriveBtn(t), el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Chamar a senha ${t.code} novamente na tela`, title: 'Mostra a chamada de novo na tela, com o som', onclick: run(() => api(`/queue/tickets/${t.id}/repeat`, { method: 'POST' }), `Chamando ${t.code} novamente.`) }, 'Chamar novamente'), el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Voltar a senha ${t.code} para a fila`, onclick: run(() => api(`/queue/tickets/${t.id}/requeue`, { method: 'POST' })) }, 'Voltar à fila'), el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Finalizar a senha ${t.code}`, onclick: run(() => api(`/queue/tickets/${t.id}/finish`, { method: 'POST' })) }, 'Finalizar')])));
  };
  return { nodes: [card('Esperando', el('h3', { class: 'r-sub' }, 'Na fila', count), list, empty, rule), card('Em atendimento', serving, none)], paint };
}
const noQueue = () => ({ node: el('div', {}, card('Chamada de senha', el('p', { class: 'r-dim', text: 'Não foi possível ler a fila agora. Recarregue a página.' }))) });

/* ------------------------------------------------------------------ Atendimento: este guichê (ou consultório) */
export function atendimento() {
  if (!Q) return noQueue();
  const pronto = S.state.office.family === 'pronto';
  const deskIn = el('input', { type: 'text', maxlength: '30', placeholder: pronto ? 'Ex.: Consultório 2' : 'Ex.: Guichê 3', autocomplete: 'off', value: desk });
  const fromSel = el('select', {});
  // §26: a sala escolhida numa lista (sem digitar o guichê toda vez); "Escrever o nome" volta ao campo de sempre
  const roomSel = el('select', { 'aria-label': 'Sala' }); let roomId = roomGet();
  const rooms = () => (Q.rooms || []).filter((r) => r.active);
  const room = () => rooms().find((r) => String(r.id) === String(roomId)) || null;
  const deskField = field(pronto ? 'Este consultório' : 'Este guichê', deskIn); const fromField = field('Chamar de', fromSel); const roomField = field('Sala', roomSel);
  const stateNote = el('span', { class: 'r-state' });
  const code = el('p', { class: 'r-now-code', 'aria-live': 'polite' }); const info = el('p', { class: 'r-now-info' });
  const fwd = el('select', { 'aria-label': 'Encaminhar para a fila' });
  const callBtn = el('button', { type: 'button', class: 'r-btn primary big' }, 'Chamar próxima');
  const deskName = () => room()?.name || desk;
  // a senha deste consultório é a chamada por último nele (as anteriores seguem em atendimento até serem finalizadas)
  const mine = () => { const d = deskName(); return d ? [...Q.serving].filter((t) => t.desk === d).sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0))[0] || null : null; };
  const onMine = (path, body, msg) => run(async () => { const t = mine(); if (!t) throw new Error('Nenhuma senha em atendimento neste guichê.'); return api(`/queue/tickets/${t.id}/${path}`, { method: 'POST', body: body ? body() : undefined }); }, msg);
  const btns = {
    // §31: "Paciente chegou" (a confirmação da chegada; na UPA a sala confirma pelo celular, a recepção também pode)
    arrive: el('button', { type: 'button', class: 'r-btn primary', onclick: onMine('arrive', null, 'Chegada confirmada.') }, 'Paciente chegou'),
    repeat: el('button', { type: 'button', class: 'r-btn', onclick: onMine('repeat', null, 'Chamada mostrada de novo na tela.') }, 'Chamar novamente'),
    noshow: el('button', { type: 'button', class: 'r-btn', onclick: onMine('noshow', null, 'Marcada como não compareceu.') }, 'Não compareceu'),
    requeue: el('button', { type: 'button', class: 'r-btn', title: 'A senha volta a esperar no lugar de antes, para ser chamada de novo', onclick: onMine('requeue', null, 'A senha voltou para a fila, no lugar de antes.') }, 'Voltar à fila'),
    finish: el('button', { type: 'button', class: 'r-btn primary', onclick: onMine('finish', null, 'Atendimento finalizado.') }, 'Finalizar'),
    forward: el('button', { type: 'button', class: 'r-btn', onclick: onMine('forward', () => ({ serviceId: Number(fwd.value) }), 'Senha encaminhada (mantém a prioridade e a cor).') }, 'Encaminhar'),
  };
  // §31: a próxima etapa do fluxo (a mesma senha, com a cor e a prioridade)
  const nextBtn = el('button', { type: 'button', class: 'r-btn', hidden: true, onclick: onMine('next-stage', null, (r) => `Encaminhada para ${r.stage}.`) }, 'Próxima etapa');
  const avail = el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/rooms/${room()?.id}/state`, { method: 'POST', body: { state: 'available' } }), 'Sala disponível.') }, 'Disponível');
  const pause = el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/rooms/${room()?.id}/state`, { method: 'POST', body: { state: 'pause' } }), 'Sala em pausa.') }, 'Pausa');
  const stateRow = el('div', { class: 'r-btns' }, stateNote, avail, pause);
  deskIn.addEventListener('change', () => { desk = deskIn.value.trim(); try { sessionStorage.setItem(DESK_KEY, desk); } catch { /* sem armazenamento */ } paint(); });
  fromSel.addEventListener('change', () => { from = fromSel.value; try { sessionStorage.setItem(FROM_KEY, from); } catch { /* sem armazenamento */ } });
  roomSel.addEventListener('change', () => { roomId = roomSel.value; roomSet(roomId); paint(); });
  const where = () => (room() ? { roomId: room().id } : null);
  callBtn.addEventListener('click', run(async () => {
    if (where()) return api('/queue/call', { method: 'POST', body: where() });
    desk = deskIn.value.trim();
    if (!desk) { deskIn.focus(); throw new Error(`Escreva o nome deste ${pronto ? 'consultório' : 'guichê'} (ex.: ${pronto ? 'Consultório 2' : 'Guichê 3'}).`); }
    try { sessionStorage.setItem(DESK_KEY, desk); } catch { /* sem armazenamento */ }
    return api('/queue/call', { method: 'POST', body: { desk, serviceId: fromSel.value ? Number(fromSel.value) : null } });
  }, (r) => `Chamando ${r.ticket.code} para ${r.call.desk}.`));
  // "Chamar esta": a senha escolhida, fora da ordem, para este guichê (fica no log da repartição)
  const callThis = (t) => run(async () => {
    if (where()) return api('/queue/call', { method: 'POST', body: { ...where(), ticketId: t.id } });
    desk = deskIn.value.trim();
    if (!desk) { deskIn.focus(); throw new Error(`Escreva o nome deste ${pronto ? 'consultório' : 'guichê'} antes de chamar.`); }
    try { sessionStorage.setItem(DESK_KEY, desk); } catch { /* sem armazenamento */ }
    return api('/queue/call', { method: 'POST', body: { desk, ticketId: t.id } });
  }, (r) => `Chamando ${r.ticket.code} para ${r.call.desk} (fora da ordem, registrado).`)();
  const side = waitingSide('atendimento', { callThis });
  // §28: os pedidos de apoio abertos (o painel aceita e conclui; as salas pedem pelo endereço delas)
  const supList = el('ul', { class: 'r-list' }); const supCard = card('Pedidos de apoio', supList);
  function paint() {
    const act2 = Q.services.filter((s) => s.active);
    const rs = rooms();
    if (!busy(roomSel)) put(roomSel, option('', 'Escrever o nome', !room()), ...rs.map((r) => option(r.id, `${r.name} · ${roomStateLabel(r.state)}`, String(r.id) === String(roomId))));
    roomField.hidden = !rs.length;
    const rm = room();
    deskField.hidden = Boolean(rm); fromField.hidden = Boolean(rm);
    stateRow.hidden = !rm;
    if (rm) { stateNote.textContent = roomStateLabel(rm.state); stateNote.className = `r-state ${rm.state}`; avail.disabled = rm.state === 'available'; pause.disabled = rm.state === 'pause'; }
    const cur = fromSel.value || from;
    put(fromSel, option('', 'Todas as filas', !cur), ...act2.map((s) => option(s.id, s.name, String(s.id) === String(cur))));
    const t = mine();
    code.textContent = t ? t.code : '—';
    put(info, t ? [riskDot(t.risk), `${t.risk ? `${riskName(t.risk)} · ` : ''}${svcName(t.serviceId)} · ${prio(t)}${t.name ? ` · ${t.name}` : ''}${t.stage ? ` · etapa ${t.stage.index + 1} de ${t.stage.total}: ${t.stage.name}` : ''} · chamada há ${waited(Q.serverTime - t.calledAt)}`, callTag(t)] : (deskName() ? 'Nenhuma senha em atendimento aqui. Clique em Chamar próxima.' : 'Diga qual é o seu guichê e de qual fila chama.'));
    for (const b of Object.values(btns)) b.disabled = !t;
    btns.arrive.hidden = !(t && (t.callState === 'called' || t.callState === 'serving'));
    nextBtn.hidden = !(t && t.stage && t.stage.next);
    if (t?.stage?.next) nextBtn.textContent = `Encaminhar para ${t.stage.next.name}`;
    const keep = fwd.value;
    put(fwd, act2.filter((s) => !t || s.id !== t.serviceId).map((s) => option(s.id, s.name, String(s.id) === keep)));
    fwd.disabled = !t || fwd.options.length === 0; btns.forward.disabled = fwd.disabled;
    callBtn.disabled = !act2.length;
    callBtn.textContent = rm ? `Chamar paciente para ${rm.name}` : 'Chamar próxima';
    const sup = Q.support || [];
    supCard.hidden = !sup.length; if (!busy(supList)) put(supList, supportList(sup, { onChange: load }));
    side.paint();
  }
  const node = cols(
    [card(pronto ? 'Este consultório' : 'Este guichê',
      roomField,
      el('div', { class: 'r-row' }, deskField, fromField),
      stateRow,
      el('div', { class: 'r-now' }, code, info),
      callBtn,
      el('div', { class: 'r-btns' }, btns.arrive, btns.repeat, btns.requeue, btns.noshow, btns.finish),
      nextBtn,
      el('div', { class: 'r-row end' }, field('Encaminhar para', fwd), btns.forward),
      Q.services.some((s) => s.active) ? null : el('p', { class: 'r-dim', text: gestor() ? 'Crie a primeira fila na aba Recepção, em "Filas, totem e configuração".' : 'A repartição ainda não tem filas. Peça ao gestor para criar.' })),
    supCard],
    side.nodes);
  node.classList.add('r-cols-even'); // 14/11, do dono: "Este consultório" um pouco menor, para a lista ao lado respirar
  views.add(paint); paint();
  return { node, show: paint };
}

/* ------------------------------------------------------------------ Recepção: emitir a senha (e, para o gestor, a configuração) */
export function recepcao() {
  if (!Q) return noQueue();
  const svc = el('select', {}); const pri = el('select', {}); const name = el('input', { type: 'text', maxlength: '60', autocomplete: 'off' });
  const riskSel = el('select', {}); const riskRow = field('Classificação de risco (se já triado)', riskSel);
  const issued = el('p', { class: 'r-issued', role: 'status', 'aria-live': 'polite' });
  const btn = el('button', { type: 'submit', class: 'r-btn primary big' }, 'Emitir senha');
  // §29: o papel da senha com o QR do acompanhante (a impressão do navegador; o endereço não fica guardado em lugar nenhum)
  let last = null;
  const printBtn = el('button', { type: 'button', class: 'r-btn', hidden: true, onclick: () => { if (last) printSlip(last); } }, 'Imprimir a senha');
  const issue = run(async () => {
    const body = { serviceId: Number(svc.value), priority: Number(pri.value) || 0, name: name.value };
    if (Q.config.risk && gestor() && riskSel.value) body.risk = riskSel.value;
    const r = await api('/queue/tickets', { method: 'POST', body });
    name.value = ''; riskSel.value = '';
    issued.textContent = `Senha emitida: ${r.ticket.code}${r.ticket.name ? ` (${r.ticket.name})` : ''}`;
    last = { office: S.state.office.name, code: r.ticket.code, service: r.service.name, priority: r.ticket.priority, at: r.at, follow: r.follow || null };
    printBtn.hidden = false;
    return r;
  });
  svc.addEventListener('change', () => paint());
  const side = waitingSide();
  const setup = gestor() ? setupBox() : null;
  function paint() {
    const act2 = Q.services.filter((s) => s.active);
    const cur = svc.value;
    put(svc, act2.map((s) => option(s.id, `${s.name} (${s.prefix})`, String(s.id) === cur)));
    const s = act2.find((x) => String(x.id) === svc.value) || act2[0];
    const p = pri.value;
    put(pri, PRIORITIES.filter((x) => x.key === 0 || s?.priority).map((x) => option(x.key, x.desc ? `${x.label}: ${x.desc}` : x.label, String(x.key) === p)));
    riskRow.hidden = !(Q.config.risk && gestor());
    const rk = riskSel.value;
    put(riskSel, option('', 'Sem classificação ainda', !rk), ...RISKS.map((r) => option(r.key, riskName(r.key), r.key === rk)));
    btn.disabled = !act2.length;
    side.paint(); setup?.paint();
  }
  const node = cols(
    [card('Recepção: emitir senha',
      el('form', { novalidate: true, onsubmit: issue },
        el('div', { class: 'r-row' }, field('Fila', svc), field('Atendimento', pri)),
        field('Primeiro nome (opcional)', name),
        riskRow,
        el('p', { class: 'r-dim', text: 'Na tela aparece só o primeiro nome e a inicial do sobrenome, e só se "mostrar o nome" estiver ligado. O motivo do atendimento nunca é registrado.' }),
        btn, issued, printBtn)),
    setup?.node],
    side.nodes);
  views.add(paint); paint();
  return { node, show: paint };
}
/** O papel da senha (só na impressão): a repartição, a senha, a fila, a hora e, com o QR ligado, o QR do acompanhante. */
function printSlip(t) {
  const slip = el('div', { class: 'r-slip' },
    el('p', { text: t.office }), el('p', { class: 's-code', text: t.code }), el('p', { text: `${t.service}${t.priority ? ' · prioritário' : ''}` }),
    el('p', { text: new Date(t.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
    t.follow ? qrSvg(t.follow, 's-qr') : null, t.follow ? el('p', { text: 'Acompanhe pelo celular: aponte a câmera (vale só hoje).' }) : null,
    el('p', { text: 'Aguarde a chamada na tela.' }));
  document.body.append(slip); document.body.classList.add('r-printing');
  const done = () => { slip.remove(); document.body.classList.remove('r-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch { /* sem impressora */ } setTimeout(done, 60000); }, 100);
}
/** Filas, totem e configuração (só o gestor). */
function setupBox() {
  const list = el('ul', { class: 'r-list' });
  const sName = el('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: Atendimento geral' }); const sPrefix = el('input', { type: 'text', maxlength: '3', placeholder: 'A' }); const sPrio = el('input', { type: 'checkbox', checked: true });
  const title = el('input', { type: 'text', maxlength: '60' }); const voice = el('input', { type: 'checkbox' }); const showName = el('input', { type: 'checkbox' }); const useRisk = el('input', { type: 'checkbox' });
  const ratio = el('input', { type: 'number', min: '1', max: '5', step: '1' }); const print = el('input', { type: 'checkbox' });
  // as duas filas do painel "Duas filas lado a lado" (contrato §15); em branco = as duas primeiras filas ativas
  const pairA = el('select', { 'aria-label': 'Fila da esquerda' }); const pairB = el('select', { 'aria-label': 'Fila da direita' });
  // a ordem de chamada com a classificação de risco: o tempo-alvo de cada cor (Manchester), a idade e o atraso
  const TK = ['laranja', 'amarelo', 'verde', 'azul'];
  const target = Object.fromEntries(TK.map((k) => [k, el('input', { type: 'number', min: '1', max: '1440', step: '1', 'aria-label': `Tempo-alvo do ${k} em minutos` })]));
  const ageBoost = el('input', { type: 'checkbox' }); const escalate = el('input', { type: 'checkbox' });
  const resetTargets = el('button', { type: 'button', class: 'r-btn small', onclick: () => { for (const k of TK) target[k].value = levelOf(k).targetMin; } }, 'Voltar aos tempos do protocolo');
  const totemNote = el('p', { class: 'r-dim' }); const totemUrl = el('p', { class: 'r-url', hidden: true });
  const totemNew = el('button', { type: 'button', class: 'r-btn' }, 'Gerar o endereço do totem'); const totemOff = el('button', { type: 'button', class: 'r-btn', hidden: true }, 'Desligar o totem');
  let filled = false;
  const addSvc = run(async () => { await api('/queue/services', { method: 'POST', body: { name: sName.value, prefix: sPrefix.value, priority: sPrio.checked } }); sName.value = ''; sPrefix.value = ''; }, 'Fila criada.');
  const saveCfg = run(async () => { await api('/queue/config', { method: 'PUT', body: { title: title.value, voice: voice.checked, showName: showName.checked, risk: useRisk.checked, ratio: Number(ratio.value), print: print.checked, ageBoost: ageBoost.checked, escalate: escalate.checked, pair: [pairA.value, pairB.value].filter(Boolean).map(Number), targets: Object.fromEntries(TK.map((k) => [k, Number(target[k].value)])) } }); filled = false; }, 'Configuração salva. As telas trocam em até 30 segundos.');
  totemNew.addEventListener('click', run(async () => {
    if (Q.totem.on && !confirm('Gerar outro endereço? O totem que está aberto para de emitir senhas.')) return;
    const r = await api('/queue/totem', { method: 'POST' });
    if (r?.url) { totemUrl.hidden = false; totemUrl.textContent = r.url; ok('Endereço do totem gerado. Ele aparece só agora: abra-o no aparelho da entrada.'); }
  }));
  totemOff.addEventListener('click', run(async () => { if (!confirm('Desligar o totem?')) return; await api('/queue/totem', { method: 'DELETE' }); totemUrl.hidden = true; }, 'Totem desligado.'));
  // a fila em edição: o nome, a letra e a senha prioritária mudam ali mesmo (as senhas já emitidas não mudam)
  let editing = null;
  const editRow = (s) => {
    const n = el('input', { type: 'text', maxlength: '40', value: s.name, 'aria-label': 'Nome da fila' });
    const p = el('input', { type: 'text', maxlength: '3', value: s.prefix, 'aria-label': 'Letra' });
    const pr = el('input', { type: 'checkbox', checked: !!s.priority });
    const save = run(async (e) => { e?.preventDefault?.(); await api(`/queue/services/${s.id}`, { method: 'PATCH', body: { name: n.value, prefix: p.value, priority: pr.checked } }); editing = null; }, 'Fila alterada. As senhas já emitidas continuam como estavam.');
    return el('li', {}, el('form', { class: 'r-row three', novalidate: true, onsubmit: save },
      field('Nome da fila', n), field('Letra', p), check('Tem senha prioritária', pr),
      el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn small primary' }, 'Salvar'), el('button', { type: 'button', class: 'r-btn small', onclick: () => { editing = null; paint(); } }, 'Cancelar'))));
  };
  function paint() {
    put(list, Q.services.map((s) => (editing === s.id ? editRow(s) : el('li', {},
      el('span', { class: 'r-tag', text: s.prefix }),
      el('span', {}, el('b', { text: s.name }), el('small', { text: `${s.priority ? 'com prioritária' : 'sem prioritária'}${s.active ? '' : ' · desativada'}` })),
      el('button', { type: 'button', class: 'r-btn small', onclick: () => { editing = s.id; paint(); } }, 'Editar'),
      el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/services/${s.id}`, { method: 'PATCH', body: { active: !s.active } })) }, s.active ? 'Desativar' : 'Reativar'),
      el('button', { type: 'button', class: 'r-btn small', onclick: () => { if (confirm(`Remover a fila "${s.name}"?`)) run(() => api(`/queue/services/${s.id}`, { method: 'DELETE' }))(); } }, 'Remover')))));
    if (!filled) {
      const pv = Q.config.pair || [];
      for (const [sel, id] of [[pairA, pv[0]], [pairB, pv[1]]]) put(sel, option('', 'Automático (as primeiras filas ativas)', !id), ...Q.services.filter((x) => x.active).map((x) => option(String(x.id), x.name, x.id === id)));
    }
    if (!filled) { const c = Q.config; title.value = c.title; voice.checked = c.voice; showName.checked = c.showName; useRisk.checked = c.risk; ratio.value = c.ratio; print.checked = c.print; ageBoost.checked = c.ageBoost !== false; escalate.checked = c.escalate !== false; for (const k of TK) target[k].value = c.targets?.[k] ?? levelOf(k).targetMin; filled = true; }
    totemNote.textContent = Q.totem.on ? `Totem ligado desde ${hhmm(Q.totem.at)}. O endereço não fica guardado: se perdeu, gere outro (o anterior deixa de valer). Ele só emite senha: não abre esta página.` : 'Abra o endereço do totem num tablet ou numa tela de toque na entrada: a pessoa escolhe a fila e retira a senha. Ele só emite senha: não abre esta página.';
    totemOff.hidden = !Q.totem.on; totemNew.textContent = Q.totem.on ? 'Gerar outro endereço' : 'Gerar o endereço do totem';
    const g = Q.guiche || { on: false };
    guicheNote.textContent = g.on ? `Endereço do guichê ligado desde ${hhmm(g.at)}. O endereço não fica guardado: se perdeu, gere outro (o anterior deixa de valer).` : 'Um endereço para o computador de cada guichê, sem usuário nem senha: ele só chama a próxima senha, repete, marca "não compareceu", finaliza e encaminha. Não emite senha e não abre esta página.';
    guicheOff.hidden = !g.on; guicheNew.textContent = g.on ? 'Gerar outro endereço do guichê' : 'Gerar o endereço do guichê';
  }
  const guicheNote = el('p', { class: 'r-dim' }); const guicheUrl = el('p', { class: 'r-url', hidden: true });
  const guicheNew = el('button', { type: 'button', class: 'r-btn' }, 'Gerar o endereço do guichê'); const guicheOff = el('button', { type: 'button', class: 'r-btn', hidden: true }, 'Desligar o endereço do guichê');
  guicheNew.addEventListener('click', run(async () => {
    if (Q.guiche?.on && !confirm('Gerar outro endereço? Os guichês abertos com o endereço de antes param de chamar.')) return;
    const r = await api('/queue/guiche', { method: 'POST' });
    if (r?.url) { guicheUrl.hidden = false; guicheUrl.textContent = r.url; ok('Endereço do guichê gerado. Ele aparece só agora: abra-o no computador de cada guichê.'); }
  }));
  guicheOff.addEventListener('click', run(async () => { if (!confirm('Desligar o endereço do guichê?')) return; await api('/queue/guiche', { method: 'DELETE' }); guicheUrl.hidden = true; }, 'Endereço do guichê desligado.'));
  const node = el('details', { class: 'r-card r-details', open: !Q.services.length },
    el('summary', { text: 'Filas, totem e configuração' }),
    el('h3', { text: 'Filas' }), list,
    el('form', { class: 'r-row three', novalidate: true, onsubmit: addSvc }, field('Nome da fila', sName), field('Letra', sPrefix), check('Tem senha prioritária', sPrio), el('button', { type: 'submit', class: 'r-btn' }, '+ Adicionar fila')),
    el('h3', { text: 'Na tela' }),
    el('form', { novalidate: true, onsubmit: saveCfg }, field('Título do painel', title), check('A tela fala a senha e o guichê', voice), check('Mostrar (e falar) o primeiro nome no lugar da senha, quando houver', showName),
      check('Classificação de risco por cor (a ordem de chamada passa a ser a da cor)', useRisk), field('Senhas normais para cada preferencial (sem triagem)', ratio), check('O totem imprime a senha (pela impressão do navegador)', print),
      el('div', { class: 'r-row' }, field('Duas filas lado a lado: a da esquerda', pairA), field('A da direita', pairB)),
      el('h3', { text: 'Ordem de chamada com a classificação de risco' }),
      el('p', { class: 'r-dim', text: 'Vermelho é sempre imediato. As outras cores são chamadas pelo atraso em relação ao tempo-alvo (Protocolo de Manchester); dentro da mesma cor, quem espera há mais tempo primeiro.' }),
      el('div', { class: 'r-row four' }, ...TK.map((k) => field(`${levelOf(k).color} · ${levelOf(k).level} (min)`, target[k]))),
      el('div', { class: 'r-btns' }, resetTargets),
      check('A idade acelera dentro da mesma cor (80+ conta a espera 1,5 vez; 60+ e preferencial, 1,25 vez)', ageBoost),
      check('Verde e azul atrasados sobem de nível até o do amarelo (ninguém espera para sempre; laranja e vermelho nunca são passados)', escalate),
      el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar configuração')),
    el('h3', { text: 'Totem de retirada de senha' }), totemNote, el('div', { class: 'r-btns' }, totemNew, totemOff), totemUrl,
    el('h3', { text: 'Endereço do guichê' }), guicheNote, el('div', { class: 'r-btns' }, guicheNew, guicheOff), guicheUrl);
  return { node, paint };
}

/* ------------------------------------------------------------------ Triagem: a cor de risco de cada senha */
/**
 * O "Tipo de problema" de cada senha na Triagem: SÓ nesta tela, para sugerir a cor (Protocolo de Manchester). Não vai ao
 * servidor, não é guardado, não aparece na TV nem no log: o motivo do atendimento nunca é registrado. Fica na memória da
 * página (some ao recarregar) só para a sugestão não sumir na leitura a cada 4 s.
 */
const problemOf = new Map(); // id da senha -> texto escolhido (só nesta página)
const PROBLEM_LIST_ID = 'r-tri-problemas';
const problemByLabel = (txt) => [...TRIAGE_PROBLEMS, TRIAGE_OTHER].find((p) => p.label === String(txt || '').trim()) || null;
/** A lista pesquisável (datalist), agrupada pela cor: cada opção diz a cor e o nível ao lado. */
function problemDatalist() {
  const dl = el('datalist', { id: PROBLEM_LIST_ID });
  for (const l of TRIAGE_LEVELS) for (const p of TRIAGE_PROBLEMS.filter((x) => x.risk === l.key)) dl.append(el('option', { value: p.label, label: `${l.color} · ${l.level}` }));
  dl.append(el('option', { value: TRIAGE_OTHER.label, label: 'sem sugestão' }));
  return dl;
}
export function triagem() {
  if (!Q) return noQueue();
  const list = el('div', { class: 'r-tri' }); const empty = el('p', { class: 'r-dim', text: 'Ninguém esperando.' });
  const pv = el('div', {});
  const setRisk = (t, risk) => run(() => api(`/queue/tickets/${t.id}/risk`, { method: 'POST', body: { risk } }), risk ? `${t.code}: ${riskName(risk)}.` : null);
  function row(t) {
    const prob = problemByLabel(problemOf.get(t.id));
    const sug = prob?.risk || null;
    const pin = el('input', { type: 'text', list: PROBLEM_LIST_ID, maxlength: '60', autocomplete: 'off', placeholder: 'Pesquisar: dor no peito, febre, receita…', value: problemOf.get(t.id) || '', 'aria-label': `Tipo de problema da senha ${t.code} (só sugere a cor; não fica guardado)` });
    const hint = el('small', { class: `r-sug-note${sug ? ' on' : ''}`, 'aria-live': 'polite', text: sug ? `Sugestão: ${riskName(sug)}. Confirme ou escolha outra cor.` : prob ? 'Escolha a cor nos botões.' : 'Escolha um tipo para ver a cor sugerida, ou a cor direto.' });
    const pick = () => { const txt = pin.value.trim(); if (txt) problemOf.set(t.id, txt); else problemOf.delete(t.id); if (problemByLabel(txt) || !txt) paint(true); };
    pin.addEventListener('change', pick);
    pin.addEventListener('input', () => { if (problemByLabel(pin.value)) { pin.blur(); pick(); } });
    return el('div', { class: `r-tri-row${t.risk ? '' : ' new'}` },
      el('div', { class: 'r-tri-id' }, el('span', { class: 'r-tag', text: t.code }), el('span', {}, el('b', { text: `${svcName(t.serviceId)}${t.name ? ` · ${t.name}` : ''}` }), el('small', { text: `${t.risk ? riskName(t.risk) : 'Sem cor: aguardando triagem'} · espera ${waited(Q.serverTime - t.queuedAt)}` }))),
      el('label', { class: 'r-field r-tri-prob' }, el('span', { text: 'Tipo de problema (sugere a cor)' }), pin, hint),
      el('div', { class: 'r-tri-btns', role: 'group', 'aria-label': `Classificação de risco da senha ${t.code}` },
        RISKS.map((r) => el('button', { type: 'button', class: `r-riskbtn rk-${r.key}${t.risk === r.key ? ' on' : ''}${sug === r.key ? ' sug' : ''}`, 'aria-pressed': String(t.risk === r.key), title: riskName(r.key), onclick: setRisk(t, r.key) },
          levelOf(r.key).color, el('small', { text: levelOf(r.key).level }), sug === r.key ? el('em', { text: 'sugestão' }) : null)),
        t.risk ? el('button', { type: 'button', class: 'r-btn small', onclick: setRisk(t, null) }, 'Tirar a cor') : null));
  }
  function paint(force = false) {
    // sem cor primeiro (aguardando triagem), depois na ordem de chamada
    const rows = [...Q.waiting.filter((t) => !t.risk), ...Q.waiting.filter((t) => t.risk)];
    empty.hidden = rows.length > 0;
    for (const id of [...problemOf.keys()]) if (!rows.some((t) => t.id === id)) problemOf.delete(id); // chamada ou encerrada: esquece
    if (force === true || !busy(list)) put(list, rows.slice(0, 40).map(row));
    const count = Object.fromEntries(RISKS.map((r) => [r.key, Q.waiting.filter((t) => t.risk === r.key).length]));
    // a prévia no formato que a TV usa DE VERDADE (S.state.layout; null = o padrão da prefeitura): o painel de senha grande só
    // existe no formato "Painel de senha"; nos outros, a senha aparece no bloco da coluna lateral (ou em nenhum lugar)
    const lay = S.state.layout || null; const now = Q.calls[0] ? [Q.calls[0].ticket, Q.calls[0].desk] : ['—', ''];
    // os painéis do §15 também: as anteriores com o local e a hora, a fila da atual e a última senha de cada fila (prévia com os dados de agora)
    const hm = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
    const svcOf = (id) => Q.services.find((x) => x.id === id);
    const c0 = Q.calls[0] || null;
    const active = Q.services.filter((x) => x.active);
    const qx = {
      title: Q.config.title, now, last: Q.calls.slice(1, 6).map((c) => c.ticket), risk: Q.config.risk ? count : null, waiting: Q.waiting.length,
      nowRisk: c0?.risk || null, nowPrio: Boolean(c0?.priority), nowTime: hm(c0?.at), nowService: svcOf(c0?.serviceId)?.name || '',
      rows: Q.calls.slice(1, 7).map((c) => ({ ticket: c.ticket, desk: c.desk, time: hm(c.at), risk: c.risk || null, prio: Boolean(c.priority) })),
      services: active.map((x, i) => { const last = Q.calls.find((c) => c.serviceId === x.id); return { name: x.name, ticket: last?.ticket || '—', desk: last?.desk || '', color: serviceColor(i), hot: Boolean(last && last === c0) }; }),
    };
    if (Array.isArray(Q.config.pair) && Q.config.pair.length) qx.services = [...Q.config.pair.map((id) => qx.services[active.findIndex((x) => x.id === id)]).filter(Boolean), ...qx.services];
    const qLay = isQueueLayout(lay) ? lay : 'queue';
    const queueTv = tvPreview({ layout: qLay, program: ['Canal da prefeitura', ''], queue: qx, office: S.state.office?.name, theme: S.state.theme || undefined, side: { title: S.state.office?.name, card: null } });
    if (isQueueLayout(lay)) { put(pv, queueTv); return; }
    const withSide = lay === 'side' || lay === 'lbar';
    put(pv,
      lay ? tvPreview({ layout: lay, program: ['Canal da prefeitura', ''], ticker: [], side: { title: S.state.office?.name, widgets: ['clock', 'queue'], queue: now, queueLast: Q.calls.slice(1, 4).map((c) => c.ticket) } }) : null,
      el('p', { class: 'r-warn', text: lay
        ? `Esta TV está no formato ${layoutLabel(lay)}: ${withSide ? 'a senha aparece só no bloco da coluna lateral' : 'este formato não mostra a senha'}. O painel de senha grande (abaixo) só aparece no formato Painel de senha: troque na aba Avisos, em "Formato da tela".`
        : 'Esta TV usa o formato padrão da prefeitura. O painel de senha grande (abaixo) só aparece no formato Painel de senha: escolha-o na aba Avisos, em "Formato da tela".' }),
      el('p', { class: 'r-dim', text: 'No formato Painel de senha:' }), queueTv);
  }
  const node = cols(
    card('Triagem',
      el('p', { class: 'r-dim', text: 'Escolha a cor de cada senha (Protocolo de Manchester). O tipo de problema só sugere a cor: a decisão é sempre de quem faz a triagem.' }),
      el('p', { class: 'r-warn', text: 'O tipo de problema não fica guardado: não vai ao servidor, à TV nem ao registro. Só a cor é gravada.' }),
      problemDatalist(), list, empty),
    card('Como aparece na TV', pv, el('p', { class: 'r-dim', text: 'O painel mostra quantas pessoas esperam em cada cor, nunca o nome nem o motivo.' })));
  views.add(paint); paint();
  return { node, show: paint };
}
