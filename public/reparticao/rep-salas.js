// NEXA Telas · página de controle da repartição · salas e consultórios (docs/TELAS.md §26 a §31), em três abas do gestor:
// Salas e consultórios (as salas, os grupos com o automático, as etapas do atendimento, o QR do acompanhante, a espera
// estimada, a lista do "Preciso de" e o endereço de cada sala), Apoio (os pedidos das salas) e Indicadores (porta–
// classificação, porta–médico, por cor, por sala e por hora; CSV). /api/reparticao/queue/rooms*, /support*, /indicators.
import { ROOM_KINDS, roomKindLabel, roomStateLabel, FLOW_EXAMPLE, STAGE_MODES, minText } from '/shared/telas-salas.js';
import { RISKS } from '/shared/telas-tipos.js';
import { S, el, put, api, act, ok, card, cols, field, option, check, hhmm, hour } from '/reparticao/rep-base.js';

const run = (fn, okMsg, after) => act(async (e) => { const r = await fn(e); await after?.(); return r; }, okMsg);

/* ------------------------------------------------------------------ Salas e consultórios */
export function salas() {
  let D = null; let editing = null; let filled = false;
  const roomList = el('ul', { class: 'r-list' }); const groupList = el('ul', { class: 'r-list' });
  const rName = el('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: Consultório 3' });
  const rKind = el('select', {}, ...ROOM_KINDS.map((k) => option(k.key, k.label, k.key === 'consultorio')));
  const rGroup = el('select', {});
  const gName = el('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: Clínico geral' });
  const gSvc = el('div', { class: 'r-btns' }); const gAuto = el('input', { type: 'checkbox' });
  const linkBox = el('p', { class: 'r-url', hidden: true });
  // etapas, apoio, QR e espera estimada (data.upa)
  const flowBox = el('div', { class: 'r-fs' }); let flow = [];
  const follow = el('input', { type: 'checkbox' }); const followRisk = el('input', { type: 'checkbox' });
  const estOn = el('input', { type: 'checkbox' }); const estHours = el('input', { type: 'number', min: '1', max: '12', step: '1' });
  const estText = el('input', { type: 'text', maxlength: '160', placeholder: 'Ex.: Casos leves podem procurar a UBS Centro, Rua A, 100.' });
  const kinds = el('input', { type: 'text', maxlength: '400', placeholder: 'Maqueiro, Limpeza, Segurança, Enfermagem' });
  // §31 (20/11): a confirmação de chegada e os avisos do fluxo (etapa sem sala para chamar)
  const confirmOn = el('input', { type: 'checkbox' });
  const warnBox = el('p', { class: 'r-err', hidden: true });
  const showWarn = (list) => { warnBox.hidden = !list?.length; warnBox.textContent = list?.length ? `Atenção: ${list.join(' ')}` : ''; };

  const load = async () => { D = await api('/queue/rooms'); paint(); };
  const groupSel = (sel, cur) => put(sel, option('', 'Sem grupo (chama de todas as filas)', cur == null), ...D.groups.map((g) => option(g.id, g.name, g.id === cur)));
  const svcChecks = (box, ids) => put(box, ...D.services.filter((s) => s.active).map((s) => check(s.name, el('input', { type: 'checkbox', value: String(s.id), checked: ids.includes(s.id) }))));
  const checked = (box) => [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));
  const addRoom = run(async () => { await api('/queue/rooms', { method: 'POST', body: { name: rName.value, kind: rKind.value, groupId: rGroup.value ? Number(rGroup.value) : null } }); rName.value = ''; }, 'Sala criada.', load);
  const addGroup = run(async () => { await api('/queue/room-groups', { method: 'POST', body: { name: gName.value, serviceIds: checked(gSvc), auto: gAuto.checked } }); gName.value = ''; gAuto.checked = false; }, 'Grupo criado.', load);
  const saveUpa = run(async () => {
    const r = await api('/queue/upa', { method: 'PUT', body: { follow: follow.checked, followRisk: followRisk.checked, estimate: estOn.checked, estimateHours: Number(estHours.value) || 3, estimateText: estText.value, support: kinds.value.split(',').map((x) => x.trim()).filter(Boolean), flow, confirm: confirmOn.checked } });
    showWarn(r.warnings); filled = false;
  }, 'Configuração salva.', load);
  // os atalhos: tudo pela recepção (e o automático dos grupos desligado) ou os profissionais chamam (menos a 1ª etapa)
  const preset = (key, ask, msg) => run(async () => {
    if (!confirm(ask)) return;
    const r = await api('/queue/upa', { method: 'PUT', body: { preset: key } });
    showWarn(r.warnings); filled = false; ok(msg);
  }, null, load);
  const linkFor = (r) => run(async () => {
    if (r.link.on && !confirm(`Gerar outro endereço para "${r.name}"? O celular aberto com o endereço de antes para de funcionar.`)) return;
    const x = await api(`/queue/rooms/${r.id}/link`, { method: 'POST' });
    linkBox.hidden = false; linkBox.textContent = `${r.name}: ${x.url}`;
    ok('Endereço da sala gerado. Ele aparece só agora: abra no celular ou no computador da sala.');
  }, null, load);
  const editRow = (r) => {
    const n = el('input', { type: 'text', maxlength: '40', value: r.name, 'aria-label': 'Nome da sala' });
    const k = el('select', { 'aria-label': 'Tipo' }, ...ROOM_KINDS.map((x) => option(x.key, x.label, x.key === r.kind)));
    const g = el('select', { 'aria-label': 'Grupo' }); groupSel(g, r.groupId);
    const save = run(async (e) => { e?.preventDefault?.(); await api(`/queue/rooms/${r.id}`, { method: 'PATCH', body: { name: n.value, kind: k.value, groupId: g.value ? Number(g.value) : null } }); editing = null; }, 'Sala alterada.', load);
    return el('li', {}, el('form', { class: 'r-row three', novalidate: true, onsubmit: save }, field('Nome', n), field('Tipo', k), field('Grupo', g),
      el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn small primary' }, 'Salvar'), el('button', { type: 'button', class: 'r-btn small', onclick: () => { editing = null; paint(); } }, 'Cancelar'))));
  };
  function paintFlow() {
    const svcOpts = (cur) => D.services.filter((s) => s.active).map((s) => option(s.id, s.name, s.id === cur));
    put(flowBox, el('legend', { text: 'Etapas do atendimento (a mesma senha passa por elas)' }),
      el('p', { class: 'r-dim', text: 'Quem chama cada etapa: Recepção (o painel, como sempre); Profissional da sala (só a página da sala, no celular, chama; no Atendimento a senha aparece "aguardando o profissional" e só o gestor chama por exceção, com registro); Automático (o sistema manda para a sala Disponível do grupo que atende a fila, a livre há mais tempo primeiro).' }),
      ...flow.map((st, i) => {
        const nm = el('input', { type: 'text', maxlength: '30', value: st.name, placeholder: FLOW_EXAMPLE[i] || `Etapa ${i + 1}`, 'aria-label': `Nome da etapa ${i + 1}` });
        const sv = el('select', { 'aria-label': `Fila da etapa ${i + 1}` }, ...svcOpts(st.serviceId));
        const md = el('select', { 'aria-label': `Quem chama a etapa ${i + 1}` }, ...STAGE_MODES.map((m) => option(m.key, m.label, (st.mode || 'recepcao') === m.key)));
        nm.addEventListener('change', () => { flow[i].name = nm.value; }); sv.addEventListener('change', () => { flow[i].serviceId = Number(sv.value); });
        md.addEventListener('change', () => { flow[i].mode = md.value; });
        return el('div', { class: 'r-row four' }, field(`${i + 1}. Nome`, nm), field('Fila', sv), field('Quem chama', md), el('div', { class: 'r-btns' },
          el('button', { type: 'button', class: 'r-btn small', disabled: i === 0, 'aria-label': `Subir a etapa ${i + 1}`, onclick: () => { [flow[i - 1], flow[i]] = [flow[i], flow[i - 1]]; paintFlow(); } }, '↑'),
          el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Tirar a etapa ${i + 1}`, onclick: () => { flow.splice(i, 1); paintFlow(); } }, 'Tirar')));
      }),
      el('div', { class: 'r-btns' },
        el('button', { type: 'button', class: 'r-btn small', disabled: flow.length >= 8 || !D.services.length, onclick: () => { const used = new Set(flow.map((x) => x.serviceId)); const s = D.services.find((x) => x.active && !used.has(x.id)); if (s) { flow.push({ name: FLOW_EXAMPLE[flow.length] || '', serviceId: s.id, mode: 'recepcao' }); paintFlow(); } } }, '+ Etapa'),
        el('button', { type: 'button', class: 'r-btn small', disabled: !flow.length, title: 'Todas as etapas no modo Recepção e o automático dos grupos desligado', onclick: preset('recepcao', 'Tudo pela recepção: todas as etapas passam a ser chamadas pelo painel e o automático dos grupos é desligado. Continuar?', 'Tudo pela recepção: as etapas são chamadas no painel.') }, 'Tudo pela recepção'),
        el('button', { type: 'button', class: 'r-btn small', disabled: flow.length < 2, title: 'A 1ª etapa segue com a recepção; as outras, com o profissional da sala', onclick: preset('profissionais', 'Profissionais chamam: a 1ª etapa continua com a recepção e as outras passam a ser chamadas só pela página de cada sala. Continuar?', 'Os profissionais chamam pelas páginas das salas.') }, 'Profissionais chamam')),
      warnBox);
  }
  function paint() {
    if (!D) return;
    put(roomList, D.rooms.map((r) => (editing === r.id ? editRow(r) : el('li', {},
      el('span', { class: `r-state ${r.active ? r.state : ''}`, text: r.active ? roomStateLabel(r.state) : 'Desativada' }),
      el('span', {}, el('b', { text: r.name }), el('small', { text: `${roomKindLabel(r.kind)} · ${D.groups.find((g) => g.id === r.groupId)?.name || 'sem grupo'}${r.ticket ? ` · atendendo ${r.ticket.code}` : ''}${r.link.on ? ` · endereço desde ${hhmm(r.link.at)}` : ''}` })),
      el('button', { type: 'button', class: 'r-btn small', onclick: linkFor(r) }, r.link.on ? 'Novo endereço' : 'Gerar endereço'),
      r.link.on ? el('button', { type: 'button', class: 'r-btn small', onclick: run(async () => { if (confirm(`Revogar o endereço de "${r.name}"?`)) await api(`/queue/rooms/${r.id}/link`, { method: 'DELETE' }); }, null, load) }, 'Revogar') : null,
      el('button', { type: 'button', class: 'r-btn small', onclick: () => { editing = r.id; paint(); } }, 'Editar'),
      el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/rooms/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), null, load) }, r.active ? 'Desativar' : 'Reativar'),
      el('button', { type: 'button', class: 'r-btn small danger', onclick: run(async () => { if (confirm(`Remover a sala "${r.name}"?`)) await api(`/queue/rooms/${r.id}`, { method: 'DELETE' }); }, null, load) }, 'Remover')))));
    // §31: a etapa no Automático também distribui pelo grupo que atende a fila dela
    const byStage = (g) => D.upa.flow.some((s) => s.mode === 'auto' && g.serviceIds.includes(s.serviceId));
    put(groupList, D.groups.map((g) => el('li', {},
      el('span', { class: `r-tag${g.auto || byStage(g) ? ' live' : ''}`, text: g.auto ? 'automático' : byStage(g) ? 'automático (etapa)' : 'manual' }),
      el('span', {}, el('b', { text: g.name }), el('small', { text: `filas: ${g.serviceIds.map((id) => D.services.find((s) => s.id === id)?.name || '?').join(', ')} · salas: ${D.rooms.filter((r) => r.groupId === g.id).map((r) => r.name).join(', ') || 'nenhuma'}` })),
      el('button', { type: 'button', class: 'r-btn small', title: 'No automático, quando uma sala do grupo fica Disponível e há gente esperando, o sistema chama para a sala livre há mais tempo', onclick: run(() => api(`/queue/room-groups/${g.id}`, { method: 'PATCH', body: { auto: !g.auto } }), g.auto ? 'Automático desligado.' : 'Automático ligado: as salas disponíveis recebem os pacientes na vez.', load) }, g.auto ? 'Desligar automático' : 'Ligar automático'),
      el('button', { type: 'button', class: 'r-btn small danger', onclick: run(async () => { if (confirm(`Remover o grupo "${g.name}"? As salas ficam sem grupo.`)) await api(`/queue/room-groups/${g.id}`, { method: 'DELETE' }); }, null, load) }, 'Remover'))));
    groupSel(rGroup, rGroup.value ? Number(rGroup.value) : null);
    if (!gSvc.childElementCount) svcChecks(gSvc, []);
    if (!filled) {
      const u = D.upa; flow = u.flow.map((x) => ({ ...x }));
      confirmOn.checked = u.confirm !== false;
      follow.checked = u.follow; followRisk.checked = u.followRisk; estOn.checked = u.estimate; estHours.value = u.estimateHours; estText.value = u.estimateText || ''; kinds.value = u.support.join(', ');
      paintFlow(); filled = true;
    }
  }
  const node = cols(
    [card('Salas e consultórios',
      el('p', { class: 'r-dim', text: 'Cada sala aparece na tela pelo nome (ex.: "Consultório 3"). No Atendimento, escolha a sala na lista. Cada uma pode ter um endereço próprio para o celular, sem login: ele só chama e dá andamento ao paciente daquela sala.' }),
      roomList, linkBox,
      el('form', { class: 'r-row three', novalidate: true, onsubmit: addRoom }, field('Nome', rName), field('Tipo', rKind), field('Grupo', rGroup), el('button', { type: 'submit', class: 'r-btn' }, '+ Adicionar sala'))),
    card('Grupos (round robin)',
      el('p', { class: 'r-dim', text: 'Um grupo junta salas que atendem as mesmas filas (ex.: Clínico geral = Consultórios 1, 2 e 3). "Chamar paciente" numa sala do grupo pega a próxima senha dessas filas pela ordem do Manchester. No automático, a sala que fica Disponível recebe o próximo; a livre há mais tempo primeiro.' }),
      groupList,
      el('form', { novalidate: true, onsubmit: addGroup }, field('Nome do grupo', gName), el('p', { class: 'r-dim', text: 'Filas que o grupo atende:' }), gSvc, check('Automático: distribuir sozinho entre as salas disponíveis', gAuto), el('button', { type: 'submit', class: 'r-btn' }, '+ Adicionar grupo')))],
    card('Fluxo, apoio e acompanhante',
      el('form', { novalidate: true, onsubmit: saveUpa },
        flowBox,
        el('p', { class: 'r-dim', text: 'Encaminhar para a próxima etapa mantém o código, a prioridade e a cor.' }),
        check('Exigir a confirmação de chegada: na página da sala, Finalizar e Encaminhar só depois de "Paciente chegou"', confirmOn),
        field('O que as salas podem pedir (separado por vírgula)', kinds),
        el('h3', { text: 'QR do acompanhante (no papel da senha)' }),
        check('Imprimir o QR: a pessoa vê a posição, a etapa e a sala em que foi chamada', follow),
        check('Mostrar a cor da classificação na página do QR', followRisk),
        el('p', { class: 'r-dim', text: 'A página do QR nunca mostra nome nem motivo do atendimento e vale só no dia da senha.' }),
        el('h3', { text: 'Espera estimada (casos leves)' }),
        check('Mostrar nas telas a espera estimada dos casos verdes e azuis', estOn),
        field('Média das últimas horas', estHours), field('Texto da repartição (opcional)', estText),
        el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar'))));
  load().catch((x) => put(roomList, el('li', {}, el('span', { class: 'r-err', text: x.message }))));
  return { node, show: () => load().catch(() => {}), refresh: () => load().catch(() => {}) };
}

/* ------------------------------------------------------------------ Apoio: os pedidos das salas */
const SUP_TAG = { open: ' live', accepted: '', done: '', cancelled: '' };
export function supportList(list, { onChange } = {}) {
  return list.map((x) => el('li', { class: x.status === 'open' ? 'r-late' : '' },
    el('span', { class: `r-tag${SUP_TAG[x.status] || ''}`, text: x.statusLabel }),
    el('span', {}, el('b', { text: `${x.kind} · ${x.room}` }), el('small', { text: `pedido às ${hour(x.createdAt)}${x.acceptedBy ? ` · aceito por ${x.acceptedBy}${x.waitMin != null ? ` em ${minText(x.waitMin)}` : ''}` : ''}${x.doneAt ? ` · concluído às ${hour(x.doneAt)}` : ''}` })),
    x.status === 'open' ? el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/support/${x.id}/accept`, { method: 'POST' }), 'Pedido aceito.', onChange) }, 'Aceitar') : null,
    ['open', 'accepted'].includes(x.status) ? el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/support/${x.id}/done`, { method: 'POST' }), 'Pedido concluído.', onChange) }, 'Concluir') : null,
    ['open', 'accepted'].includes(x.status) ? el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/queue/support/${x.id}/cancel`, { method: 'POST' }), 'Pedido cancelado.', onChange) }, 'Cancelar') : null));
}
export function apoio() {
  const list = el('ul', { class: 'r-list' }); const empty = el('p', { class: 'r-dim', text: 'Nenhum pedido hoje.' });
  const url = el('p', { class: 'r-url', hidden: true }); const note = el('p', { class: 'r-dim' });
  const off = el('button', { type: 'button', class: 'r-btn', hidden: true }, 'Revogar o endereço do apoio');
  let linkOn = false;
  const load = async () => {
    const [d, r] = await Promise.all([api('/queue/support'), api('/queue/rooms')]);
    empty.hidden = d.requests.length > 0; put(list, supportList(d.requests, { onChange: load }));
    linkOn = r.upa.supportLink.on; off.hidden = !linkOn; paintGen?.();
    note.textContent = linkOn ? `Endereço do apoio ligado desde ${hhmm(r.upa.supportLink.at)}. Se perdeu, gere outro (o anterior deixa de valer).` : 'Um endereço para o celular do setor de apoio (maqueiro, limpeza, segurança, enfermagem): ele vê os pedidos das salas, aceita e conclui. Sem login; não chama senhas.';
  };
  const gen = el('button', { type: 'button', class: 'r-btn', onclick: run(async () => {
    if (linkOn && !confirm('Gerar outro endereço? O celular com o endereço de antes para de funcionar.')) return;
    const x = await api('/queue/support-link', { method: 'POST' }); url.hidden = false; url.textContent = x.url;
    ok('Endereço do apoio gerado. Ele aparece só agora.');
  }, null, load) }, 'Gerar o endereço do apoio');
  const paintGen = () => { gen.textContent = linkOn ? 'Gerar outro endereço do apoio' : 'Gerar o endereço do apoio'; };
  off.addEventListener('click', run(async () => { if (confirm('Revogar o endereço do apoio?')) { await api('/queue/support-link', { method: 'DELETE' }); url.hidden = true; } }, null, load));
  const node = cols(card('Pedidos de apoio das salas', list, empty), card('Endereço do apoio', note, el('div', { class: 'r-btns' }, gen, off), url));
  load().catch(() => {});
  let t = null;
  return { node, show: () => { load().catch(() => {}); clearInterval(t); t = setInterval(() => { if (!document.hidden && node.isConnected && !node.hidden) load().catch(() => {}); }, 5000); }, refresh: () => load().catch(() => {}) };
}

/* ------------------------------------------------------------------ Indicadores */
const RISK_WORD = Object.fromEntries([...RISKS.map((r) => [r.key, r.label]), ['sem', 'Sem cor']]);
const n = (v) => (v == null ? '—' : String(v).replace('.', ','));
export function indicadores() {
  // o dia daqui (não o UTC: depois das 21h o toISOString já é amanhã)
  const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = ymd(Date.now());
  const from = el('input', { type: 'date' }); const to = el('input', { type: 'date', value: today });
  const by = el('select', {}, option('day', 'Por dia', true), option('week', 'Por semana'), option('month', 'Por mês'));
  from.value = ymd(Date.now() - 6 * 86400000);
  const out = el('div', { class: 'r-card' });
  const qs = () => `from=${encodeURIComponent(from.value)}&to=${encodeURIComponent(to.value)}&by=${by.value}`;
  const table = (head, rows) => el('table', { class: 'r-table' }, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { text: h })))), el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', { text: String(c) }))))));
  const line = (x, label) => [label, x.issued, x.served, x.noshow, n(x.doorToTriageMin), n(x.doorToDoctorMin), x.late];
  const head = ['', 'Senhas', 'Atendidas', 'Não compareceram', 'Porta–classificação (min)', 'Porta–médico (min)', 'Acima do alvo'];
  const load = act(async () => {
    const d = await api(`/queue/indicators?${qs()}`);
    const max = Math.max(1, ...d.byHour.map((h) => h.issued));
    put(out,
      el('h2', { text: `De ${d.from.split('-').reverse().join('/')} a ${d.to.split('-').reverse().join('/')}` }),
      el('p', { class: 'r-dim', text: d.doctorRooms ? 'Porta–médico: da emissão da senha à 1ª chamada num consultório.' : 'Sem consultório cadastrado: porta–médico conta até a 1ª chamada.' }),
      table(head, [line(d.totals, 'Total')]),
      el('h3', { text: 'Por cor' }), table(head, d.byRisk.filter((x) => x.issued).map((x) => line(x, RISK_WORD[x.key] || x.key))),
      el('h3', { text: d.by === 'month' ? 'Por mês' : d.by === 'week' ? 'Por semana (começa na segunda)' : 'Por dia' }), table(head, d.periods.map((x) => line(x, x.key.split('-').reverse().join('/')))),
      el('p', { class: 'r-dim', text: `Chamada–chegada (da chamada ao "Paciente chegou"): ${d.totals.callToArriveMin == null ? 'sem confirmações no período' : `${n(d.totals.callToArriveMin)} min em média, ${d.totals.arrived} confirmações`}.` }),
      el('h3', { text: 'Por sala' }), table(['Sala', 'Chamadas', 'Chegaram', 'Não compareceram', 'Chamada–chegada (min)'], d.byRoom.map((r) => [r.room, r.calls, r.arrived ?? 0, r.noshow ?? 0, n(r.callToArriveMin)])),
      el('h3', { text: 'Senhas emitidas por hora' }),
      el('div', { class: 'r-bars', role: 'img', 'aria-label': d.byHour.map((h) => `${h.hour}h: ${h.issued}`).join(', ') }, ...d.byHour.map((h) => el('span', { class: `h${Math.round((h.issued / max) * 10)}`, title: `${h.hour}h: ${h.issued} senhas, ${h.calls} chamadas` }))),
      el('p', { class: 'r-dim', text: '0h à esquerda, 23h à direita. Os dados ficam 90 dias.' }));
  });
  const csv = act(async () => {
    const res = await fetch(`/api/reparticao/queue/indicators?${qs()}&format=csv`, { cache: 'no-store', referrerPolicy: 'no-referrer', headers: { authorization: `Bearer ${S.session}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
    const a = el('a', { href: URL.createObjectURL(await res.blob()), download: `indicadores-${from.value}-a-${to.value}.csv` });
    document.body.append(a); a.click(); a.remove();
  }, 'CSV baixado.');
  const node = el('div', {},
    card('Indicadores', el('div', { class: 'r-row three' }, field('De', from), field('Até', to), field('Agrupar', by)),
      el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn primary', onclick: load }, 'Ver'), el('button', { type: 'button', class: 'r-btn', onclick: csv }, 'Exportar CSV'))),
    out);
  return { node, show: () => load() };
}
