// Painel da Prefeitura, fases 3 e 4 (docs/PREFEITURA.md §10 a §16): as abas Senhas (as filas de cada repartição, o totem e o
// relatório com CSV), Cartões (merenda, escala, vagas, agenda, pauta, avisos da unidade), Vídeos guardados (o que as telas
// tocam sem internet) e Aprovações (a fila da SECOM), mais os campos novos do Padrão da prefeitura (cidade do clima, modo
// eleitoral, aprovação, alerta de emergência do canal e aviso de tela desligada). A casca (abas, janela, tabela) é a de
// views/prefeitura.js, que passa os ajudantes dela em `ui`.
import { el, api, guard, toast, copyText, state, bytes } from '../lib.js';
import { UFS } from '../../shared/br-docs.js';
import { ROOM_KINDS, roomKindLabel, roomStateLabel } from '../../shared/telas-salas.js';
import {
  OFFICE_TYPE, typeShort, LIMITS, CARD_KINDS, CARD_KIND, officeCardKinds, WEEKDAYS, CONTENT_CLASSES, classLabel, RISKS,
} from '../../shared/telas-tipos.js';

const F = { office: '', cardOffice: '', scope: 'default', scopeId: '', report: null, from: '', to: '', reportOffice: '' };
/** replaceChildren sem os vazios (um null entre os filhos sairia escrito "null" na tela). */
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const classSelect = (sel = 'utilidade') => el('select', { 'aria-label': 'Classificação' }, ...CONTENT_CLASSES.map((c) => el('option', { value: c.key, text: c.label, selected: c.key === sel })));
const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const brDay = (d) => String(d || '').split('-').reverse().join('/');
const minutes = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} min`);
export const ART37 = 'Lembrete (Constituição, art. 37, §1º): a publicidade dos atos e das campanhas dos órgãos públicos é educativa, informativa ou de orientação social, sem nomes, símbolos ou imagens que caracterizem promoção pessoal de autoridades ou servidores.';

/** O aviso do período eleitoral no alto do painel. */
export function electoralBanner(d) {
  const e = d.defaults.electoral;
  if (!d.defaults.electoralOn || !e) return null;
  return el('p', { class: 'pf-banner', role: 'note', text: `Modo eleitoral em vigor (de ${brDay(e.from)} a ${brDay(e.to)}): o conteúdo classificado como institucional (avisos, cartões, alertas e vídeos guardados) está retido e não vai às telas. Nada foi apagado: volta sozinho depois do período. Utilidade pública e emergência seguem normalmente.` });
}

/* ================================================================== Senhas */
async function paintQueueOffice(box, ui, o) {
  const q = await api(`/api/prefeitura/offices/${o.id}/queue`);
  const base = `/api/prefeitura/offices/${o.id}/queue`;
  const again = () => paintQueueOffice(box, ui, o);
  const c = q.config;
  const title = el('input', { type: 'text', maxlength: String(LIMITS.queueTitle), value: c.title });
  const chk = (v) => el('input', { type: 'checkbox', checked: v });
  const voice = chk(c.voice); const showName = chk(c.showName); const risk = chk(c.risk); const print = chk(c.print);
  const ratio = el('input', { type: 'number', min: String(LIMITS.queueRatioMin), max: String(LIMITS.queueRatioMax), step: '1', value: String(c.ratio) });
  const sName = el('input', { type: 'text', maxlength: String(LIMITS.queueServiceName), placeholder: 'Ex.: Atendimento geral', 'aria-label': 'Nome da fila' });
  const sPrefix = el('input', { type: 'text', maxlength: String(LIMITS.queuePrefix), placeholder: 'A', 'aria-label': 'Letra da senha', class: 'pf-short' });
  const sPrio = chk(true);
  const urlBox = el('div', { class: 'pf-keybox', hidden: true });
  const roomsBox = el('div', {});
  const rows = q.services.map((s) => el('tr', { class: s.active ? '' : 'pf-gone' },
    el('td', {}, el('b', { text: s.prefix })), el('td', { text: s.name }), el('td', { text: s.priority ? `${s.prefix}P: com prioritária` : 'sem prioritária' }), el('td', { text: s.active ? 'ativa' : 'desativada' }),
    el('td', { class: 'pf-actions' },
      el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`${base}/services/${s.id}`, { method: 'PATCH', body: { active: !s.active } }); await again(); }) }, s.active ? 'Desativar' : 'Reativar'),
      el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Remover a fila "${s.name}"? Com histórico, ela fica desativada (o relatório ainda a mostra).`)) return; await api(`${base}/services/${s.id}`, { method: 'DELETE' }); await again(); }) }, 'Remover'))));
  put(box, 
    q.enabled ? null : el('p', { class: 'pf-banner', text: 'A chamada de senha está desligada nesta repartição. Ligue o módulo "Chamada de senha" em Repartições → Editar.' }),
    el('div', { class: 'pf-counters' },
      el('div', { class: 'pf-count' }, el('b', { text: String(q.waiting.length) }), el('span', { text: 'esperando agora' })),
      el('div', { class: 'pf-count on' }, el('b', { text: String(q.serving.length) }), el('span', { text: 'em atendimento' })),
      el('div', { class: 'pf-count' }, el('b', { text: q.calls[0]?.ticket || '—' }), el('span', { text: q.calls[0] ? `última chamada · ${q.calls[0].desk}` : 'nenhuma chamada hoje' })),
      q.config.risk ? el('div', { class: `pf-count${q.overdue ? ' off' : ''}` }, el('b', { text: String(q.overdue || 0) }), el('span', { text: 'passaram do tempo-alvo' })) : null,
      (q.support || []).length ? el('div', { class: 'pf-count off' }, el('b', { text: String(q.support.length) }), el('span', { text: 'pedidos de apoio abertos' })) : null),
    el('div', { class: 'label', text: 'Filas (a letra é o começo da senha: A001; a prioritária leva um P: AP001)' }),
    rows.length ? ui.table(['Letra', 'Fila', 'Prioridade', 'Situação', ''], rows) : el('p', { class: 'dim small', text: 'Nenhuma fila ainda. Crie ao menos uma para emitir senhas.' }),
    el('div', { class: 'pf-bar' }, sName, sPrefix, el('label', { class: 'pf-check' }, sPrio, el('span', { text: 'Tem senha prioritária' })),
      el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await api(`${base}/services`, { method: 'POST', body: { name: sName.value, prefix: sPrefix.value, priority: sPrio.checked } }); toast('Fila criada.'); await again(); }) }, '+ Adicionar fila')),
    el('div', { class: 'label', text: 'Na tela e na ordem de chamada' }),
    el('div', { class: 'pf-grid' },
      ui.f('Título do painel de senha', title),
      ui.f('Senhas normais para cada prioritária', ratio, 'A prioridade legal (60+, gestantes, pessoas com deficiência, lactantes, criança de colo) é intercalada: depois de N normais, a vez é de uma prioritária. Quem tem 80 anos ou mais passa à frente das outras prioridades.'),
      el('label', { class: 'pf-check' }, voice, el('span', { text: 'A tela fala a senha e o guichê' })),
      el('label', { class: 'pf-check' }, showName, el('span', { text: 'Mostrar (e falar) o primeiro nome e a inicial do sobrenome no lugar da senha, quando o nome foi informado' })),
      el('label', { class: 'pf-check' }, risk, el('span', { text: `Classificação de risco por cor (${RISKS.map((r) => r.key).join(', ')}): a ordem de chamada passa a ser a da cor e, depois, a chegada` })),
      el('label', { class: 'pf-check' }, print, el('span', { text: 'O totem imprime a senha (pela impressão do navegador do aparelho)' })),
      el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await api(`${base}/config`, { method: 'PUT', body: { title: title.value, ratio: Number(ratio.value), voice: voice.checked, showName: showName.checked, risk: risk.checked, print: print.checked } }); toast('Configuração da senha salva. As telas trocam em até 30 segundos.'); await again(); }) }, 'Salvar configuração'))),
    el('div', { class: 'label', text: 'Totem de retirada de senha (tablet ou tela de toque na entrada)' }),
    el('p', { class: 'dim small', text: q.totem.on ? `Totem ligado desde ${ui.when(q.totem.at)}. O endereço não fica guardado: se perdeu, gere outro (o anterior deixa de valer). O endereço do totem só emite senha: não abre o link de controle nem vê a fila.` : 'O totem tem um endereço próprio, que só emite senha (não é o link de controle e não precisa da senha da repartição). A emissão tem freio contra abuso.' }),
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn', type: 'button', disabled: !q.enabled, onclick: guard(async () => {
        if (q.totem.on && !confirm('Gerar outro endereço? O totem que está aberto para de emitir senhas.')) return;
        const r = await api(`${base}/totem`, { method: 'POST', body: {} });
        await again();
        const b = box.querySelector('.pf-keybox'); b.hidden = false;
        put(b, el('p', { class: 'dim small', text: 'O endereço aparece só agora. Abra-o no aparelho da entrada:' }), el('div', { class: 'pf-url', text: r.url }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.url) }, 'Copiar o endereço'));
      }) }, q.totem.on ? 'Gerar outro endereço' : 'Gerar o endereço do totem'),
      q.totem.on ? el('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { if (!confirm('Desligar o totem?')) return; await api(`${base}/totem`, { method: 'DELETE' }); toast('Totem desligado.'); await again(); }) }, 'Desligar o totem') : null),
    urlBox,
    // o endereço do guichê: só chama e dá andamento à senha (sem usuário nem senha; não emite e não abre o painel da repartição)
    el('div', { class: 'label', text: 'Endereço do guichê (o computador de cada atendente)' }),
    el('p', { class: 'dim small', text: q.guiche?.on ? `Endereço do guichê ligado desde ${ui.when(q.guiche.at)}. Ele não fica guardado: se perdeu, gere outro (o anterior deixa de valer).` : 'Um endereço próprio, sem usuário nem senha, que só chama a próxima senha, repete, marca "não compareceu", finaliza e encaminha. Não emite senha, não escreve avisos nem alertas.' }),
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn', type: 'button', disabled: !q.enabled, onclick: guard(async () => {
        if (q.guiche?.on && !confirm('Gerar outro endereço? Os guichês abertos com o endereço de antes param de chamar.')) return;
        const r = await api(`${base}/guiche`, { method: 'POST', body: {} });
        await again();
        const b = box.querySelector('.pf-keybox'); b.hidden = false;
        put(b, el('p', { class: 'dim small', text: 'O endereço do guichê aparece só agora. Abra-o no computador de cada guichê:' }), el('div', { class: 'pf-url', text: r.url }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.url) }, 'Copiar o endereço'));
      }) }, q.guiche?.on ? 'Gerar outro endereço do guichê' : 'Gerar o endereço do guichê'),
      q.guiche?.on ? el('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { if (!confirm('Desligar o endereço do guichê?')) return; await api(`${base}/guiche`, { method: 'DELETE' }); toast('Endereço do guichê desligado.'); await again(); }) }, 'Desligar') : null),
    el('p', { class: 'dim small', text: 'Emitir pela recepção, chamar, repetir, encaminhar e finalizar são feitos na página de controle da repartição (o link de controle, em Repartições).' }),
    roomsBox);
  await paintRooms(roomsBox, ui, o, base);
}
/** §26 a §31: as salas e consultórios da repartição, os grupos (com o automático) e o endereço de cada sala; os indicadores em CSV. */
async function paintRooms(box, ui, o, base) {
  const r = await api(`${base}/rooms`);
  const again = () => paintRooms(box, ui, o, base);
  const keyBox = el('div', { class: 'pf-keybox', hidden: true });
  const groupSel = (cur) => el('select', { 'aria-label': 'Grupo' }, ui.opt('', 'Sem grupo', cur == null), ...r.groups.map((g) => ui.opt(g.id, g.name, g.id === cur)));
  const rName = el('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: Consultório 3', 'aria-label': 'Nome da sala' });
  const rKind = el('select', { 'aria-label': 'Tipo da sala' }, ...ROOM_KINDS.map((k) => ui.opt(k.key, k.label, k.key === 'consultorio')));
  const rGroup = groupSel(null);
  const gName = el('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: Clínico geral', 'aria-label': 'Nome do grupo' });
  const gChecks = r.services.filter((x) => x.active).map((x) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', value: String(x.id) }), el('span', { text: x.name })));
  const gAuto = el('input', { type: 'checkbox' });
  const showUrl = (text, url) => { keyBox.hidden = false; put(keyBox, el('p', { class: 'dim small', text }), el('div', { class: 'pf-url', text: url }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(url) }, 'Copiar o endereço')); };
  const csv = guard(async () => {
    const res = await fetch(`${base}/indicators?format=csv&by=day`, { headers: { 'x-admin-token': state.token || '' }, cache: 'no-store' });
    if (!res.ok) throw new Error('Não foi possível gerar o CSV.');
    const a = el('a', { href: URL.createObjectURL(await res.blob()), download: `indicadores-${o.name}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  put(box,
    el('div', { class: 'label', text: 'Salas e consultórios (o nome da sala vai à tela: "Consultório 3")' }),
    r.rooms.length ? ui.table(['Sala', 'Tipo', 'Grupo', 'Situação', ''], r.rooms.map((x) => el('tr', { class: x.active ? '' : 'pf-gone' },
      el('td', { text: x.name }), el('td', { text: roomKindLabel(x.kind) }), el('td', { text: r.groups.find((g) => g.id === x.groupId)?.name || '—' }),
      el('td', { text: x.active ? `${roomStateLabel(x.state)}${x.ticket ? ` · ${x.ticket.code}` : ''}` : 'desativada' }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { if (x.link.on && !confirm(`Gerar outro endereço para "${x.name}"? O de antes deixa de valer.`)) return; const u = await api(`${base}/rooms/${x.id}/link`, { method: 'POST', body: {} }); await again(); showUrl(`O endereço de "${x.name}" aparece só agora. Abra no celular da sala:`, u.url); }) }, x.link.on ? 'Novo endereço' : 'Endereço da sala'),
        x.link.on ? el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { if (!confirm(`Revogar o endereço de "${x.name}"?`)) return; await api(`${base}/rooms/${x.id}/link`, { method: 'DELETE' }); await again(); }) }, 'Revogar') : null,
        el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`${base}/rooms/${x.id}`, { method: 'PATCH', body: { active: !x.active } }); await again(); }) }, x.active ? 'Desativar' : 'Reativar'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Remover a sala "${x.name}"?`)) return; await api(`${base}/rooms/${x.id}`, { method: 'DELETE' }); await again(); }) }, 'Remover'))))) : el('p', { class: 'dim small', text: 'Nenhuma sala ainda.' }),
    el('div', { class: 'pf-bar' }, rName, rKind, rGroup, el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await api(`${base}/rooms`, { method: 'POST', body: { name: rName.value, kind: rKind.value, groupId: rGroup.value ? Number(rGroup.value) : null } }); toast('Sala criada.'); await again(); }) }, '+ Adicionar sala')),
    keyBox,
    el('div', { class: 'label', text: 'Grupos de salas (round robin pela ordem do Manchester)' }),
    r.groups.length ? ui.table(['Grupo', 'Filas', 'Modo', ''], r.groups.map((g) => el('tr', {},
      el('td', { text: g.name }), el('td', { text: g.serviceIds.map((id) => r.services.find((x) => x.id === id)?.name || '?').join(', ') }), el('td', { text: g.auto ? 'automático' : 'manual' }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`${base}/room-groups/${g.id}`, { method: 'PATCH', body: { auto: !g.auto } }); await again(); }) }, g.auto ? 'Desligar automático' : 'Ligar automático'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Remover o grupo "${g.name}"?`)) return; await api(`${base}/room-groups/${g.id}`, { method: 'DELETE' }); await again(); }) }, 'Remover'))))) : el('p', { class: 'dim small', text: 'Nenhum grupo ainda. Um grupo junta as salas que atendem as mesmas filas (ex.: Clínico geral = Consultórios 1, 2 e 3).' }),
    el('div', { class: 'pf-bar' }, gName, ...gChecks, el('label', { class: 'pf-check' }, gAuto, el('span', { text: 'automático' })),
      el('button', { class: 'btn', type: 'button', onclick: guard(async () => { await api(`${base}/room-groups`, { method: 'POST', body: { name: gName.value, serviceIds: gChecks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value)), auto: gAuto.checked } }); toast('Grupo criado.'); await again(); }) }, '+ Adicionar grupo')),
    el('p', { class: 'dim small', text: `Etapas do atendimento: ${r.upa.flow.length ? r.upa.flow.map((x) => x.name || r.services.find((y) => y.id === x.serviceId)?.name).join(' → ') : 'não configuradas'}. QR do acompanhante: ${r.upa.follow ? 'ligado' : 'desligado'}. As etapas, o QR, a espera estimada e os pedidos de apoio se configuram na página da repartição, aba Salas e consultórios.` }),
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn', type: 'button', onclick: csv }, 'Indicadores dos últimos 7 dias (CSV)')));
}

async function paintReport(box, ui) {
  const d = ui.data();
  const today = day(Date.now());
  if (!F.to) { F.to = today; F.from = day(Date.now() - 6 * 86400000); }
  const from = el('input', { type: 'date', value: F.from, max: today, 'aria-label': 'Primeiro dia' });
  const to = el('input', { type: 'date', value: F.to, max: today, 'aria-label': 'Último dia' });
  const office = el('select', { 'aria-label': 'Repartição' }, ui.opt('', 'Todas as repartições', !F.reportOffice), ...d.offices.map((o) => ui.opt(o.id, o.name, String(o.id) === F.reportOffice)));
  const out = el('div', {});
  const query = () => `from=${F.from}&to=${F.to}${F.reportOffice ? `&officeId=${F.reportOffice}` : ''}`;
  const load = guard(async () => {
    F.from = from.value; F.to = to.value; F.reportOffice = office.value;
    const r = await api(`/api/prefeitura/queue/report?${query()}`);
    put(out, 
      el('p', { class: 'dim small', text: `De ${brDay(r.from)} a ${brDay(r.to)}: ${r.totals.issued} senha(s) emitida(s), ${r.totals.served} atendida(s), ${r.totals.noshow} não compareceram. O histórico fica ${r.keepDays} dias.` }),
      r.rows.length ? ui.table(['Dia', 'Repartição', 'Fila', 'Emitidas', 'Prioritárias', 'Atendidas', 'Não compareceram', 'Espera média', 'Atendimento médio'], r.rows.map((x) => el('tr', {},
        el('td', { text: brDay(x.day) }), el('td', { text: x.office }), el('td', { text: `${x.service}${x.prefix ? ` (${x.prefix})` : ''}` }), el('td', { text: String(x.issued) }), el('td', { text: String(x.priority) }),
        el('td', { text: String(x.served) }), el('td', { text: String(x.noshow) }), el('td', { text: minutes(x.avgWaitMin) }), el('td', { text: minutes(x.avgServiceMin) }))))
        : el('p', { class: 'dim small', text: 'Nenhuma senha no período.' }));
  });
  // o CSV vem com a sessão do painel (vira um arquivo baixado por esta página)
  const csv = guard(async () => {
    F.from = from.value; F.to = to.value; F.reportOffice = office.value;
    const res = await fetch(`/api/prefeitura/queue/report?${query()}&format=csv`, { headers: { 'x-admin-token': state.token || '' }, cache: 'no-store' });
    if (!res.ok) throw new Error('Não foi possível gerar o CSV.');
    const a = el('a', { href: URL.createObjectURL(await res.blob()), download: `senhas-${F.from}-a-${F.to}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  put(box, el('div', { class: 'pf-bar' }, from, to, office, el('button', { class: 'btn', type: 'button', onclick: load }, 'Ver'), el('button', { class: 'btn', type: 'button', onclick: csv }, 'Exportar CSV')), out);
  await load();
}
export async function paintSenhas(box, ui) {
  const d = ui.data();
  const list = d.offices.filter((o) => o.modules.senha);
  if (!list.some((o) => String(o.id) === F.office)) F.office = list[0] ? String(list[0].id) : '';
  const officeBox = el('div', { class: 'pf-sub' }); const reportBox = el('div', { class: 'pf-sub' });
  const pick = el('select', { 'aria-label': 'Repartição', onchange: guard(async (e) => { F.office = e.target.value; await paintQueueOffice(officeBox, ui, d.offices.find((o) => String(o.id) === F.office)); }) },
    ...list.map((o) => ui.opt(o.id, `${o.name} · ${typeShort(o.type)}`, String(o.id) === F.office)));
  put(box, 
    el('p', { class: 'dim small', text: 'A chamada de senha de cada repartição: as filas, a ordem de chamada, o totem de retirada e o que a tela mostra (layout "Chamada de senha" ou o bloco "Senha atual" na lateral). A chamada chega à tela em menos de 2 segundos.' }),
    list.length ? el('div', { class: 'pf-bar' }, el('span', { class: 'label', text: 'Repartição' }), pick) : el('p', { class: 'dim', text: 'Nenhuma repartição com a chamada de senha ligada. Ligue o módulo em Repartições → Editar (UBS, UPA, hospital, CRAS, Central do Cidadão e SINE já nascem com ele).' }),
    officeBox,
    el('div', { class: 'label', text: 'Relatório: senhas emitidas, espera e atendimento por repartição, fila e dia' }), reportBox);
  if (F.office) await paintQueueOffice(officeBox, ui, d.offices.find((o) => String(o.id) === F.office));
  await paintReport(reportBox, ui);
}

/* ================================================================== Cartões */
function editCard(ui, o, kinds, c, done) {
  const kind = el('select', {}, ...CARD_KINDS.filter((k) => kinds.includes(k.key)).map((k) => ui.opt(k.key, k.label, c?.kind === k.key)));
  const title = el('input', { type: 'text', maxlength: String(LIMITS.cardTitle), value: c?.title || '' });
  const lines = el('textarea', { rows: '6' }); lines.value = (c?.lines || []).join('\n');
  const weekday = el('select', {}, ui.opt('', 'Todos os dias', c?.weekday == null), ...WEEKDAYS.map((w, i) => ui.opt(i, w, c?.weekday === i)));
  const from = el('input', { type: 'date', value: c?.dateFrom || '' }); const to = el('input', { type: 'date', value: c?.dateTo || '' });
  const seconds = el('input', { type: 'number', min: String(LIMITS.cardSecondsMin), max: String(LIMITS.cardSecondsMax), step: '1', value: String(c?.seconds ?? LIMITS.cardSeconds) });
  const sort = el('input', { type: 'number', min: '-999', max: '999', step: '1', value: String(c?.sort ?? 0) });
  const cls = classSelect(c?.class);
  const hint = el('small', { class: 'dim' });
  const sync = () => { const k = CARD_KIND[kind.value]; title.placeholder = k.title; hint.textContent = `${k.hint} Até ${LIMITS.cardLines} linhas de ${LIMITS.cardLine} letras.`; };
  kind.addEventListener('change', sync); sync();
  ui.dialog(c ? `Cartão · ${c.title}` : `Novo cartão · ${o.name}`, el('div', { class: 'pf-grid' },
    ui.f('Tipo', kind), ui.f('Título', title, 'Vazio: o título do modelo.'), el('label', { class: 'pf-f' }, el('span', { text: 'Linhas' }), lines, hint),
    ui.f('Dia da semana', weekday, 'Com o dia marcado, o cartão só vai à tela naquele dia (o cardápio de cada dia).'),
    el('div', { class: 'pf-grid two' }, ui.f('Vale de (opcional)', from), ui.f('até (opcional)', to)),
    el('div', { class: 'pf-grid two' }, ui.f('Segundos na tela', seconds), ui.f('Ordem', sort)),
    ui.f('Classificação', cls, 'Institucional: fica retido no período eleitoral.')), {
    save: async () => {
      const body = { kind: kind.value, title: title.value, lines: lines.value.split('\n').map((s) => s.trim()).filter(Boolean), weekday: weekday.value === '' ? null : Number(weekday.value), dateFrom: from.value || null, dateTo: to.value || null, seconds: Number(seconds.value), sort: Number(sort.value) || 0, class: cls.value };
      if (c) await api(`/api/prefeitura/offices/${o.id}/cards/${c.id}`, { method: 'PATCH', body }); else await api(`/api/prefeitura/offices/${o.id}/cards`, { method: 'POST', body });
      toast('Cartão salvo. As telas trocam em até 30 segundos.');
      await done();
    },
  });
}
export async function paintCartoes(box, ui) {
  const d = ui.data();
  if (!d.offices.some((o) => String(o.id) === F.cardOffice)) F.cardOffice = d.offices[0] ? String(d.offices[0].id) : '';
  const listBox = el('div', { class: 'pf-sub' });
  const paintList = async () => {
    const o = d.offices.find((x) => String(x.id) === F.cardOffice);
    if (!o) { put(listBox); return; }
    const r = await api(`/api/prefeitura/offices/${o.id}/cards`);
    const kinds = officeCardKinds(o.modules);
    const today = new Date().getDay();
    const rows = r.cards.map((c) => el('tr', {},
      el('td', {}, el('span', { class: 'pf-chip', text: CARD_KIND[c.kind]?.label || c.kind }), !kinds.includes(c.kind) ? el('div', { class: 'dim small', text: 'módulo desligado: não vai à tela' }) : null),
      el('td', {}, el('b', { text: c.title }), el('div', { class: 'dim small', text: c.lines.join(' · ').slice(0, 160) })),
      el('td', { text: c.weekday == null ? 'todos os dias' : `${WEEKDAYS[c.weekday]}${c.weekday === today ? ' (hoje)' : ''}` }),
      el('td', { text: c.dateFrom || c.dateTo ? `${brDay(c.dateFrom) || '…'} a ${brDay(c.dateTo) || '…'}` : '—' }),
      el('td', { text: classLabel(c.class) }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => editCard(ui, o, kinds, c, paintList) }, 'Editar'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Excluir o cartão "${c.title}"?`)) return; await api(`/api/prefeitura/offices/${o.id}/cards/${c.id}`, { method: 'DELETE' }); await paintList(); }) }, 'Excluir'))));
    put(listBox, 
      el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: () => editCard(ui, o, kinds, null, paintList) }, '+ Novo cartão'),
        el('span', { class: 'dim small', text: `Tipos desta repartição (${OFFICE_TYPE[o.type]?.short || o.type}): ${kinds.map((k) => CARD_KIND[k].label).join(', ')}. Os outros ligam pelos módulos, em Repartições → Editar.` })),
      rows.length ? ui.table(['Tipo', 'Cartão', 'Dia', 'Período', 'Classificação', ''], rows) : el('p', { class: 'dim', text: 'Nenhum cartão nesta repartição.' }));
  };
  put(box, 
    el('p', { class: 'dim small', text: `Os cartões de informação se revezam na coluna lateral da tela (layouts com lateral) e abaixo das senhas (layout de senha). Cada tela recebe até ${LIMITS.cardsSent} cartões da repartição dela; a própria repartição também os edita pelo link de controle.` }),
    d.offices.length ? el('div', { class: 'pf-bar' }, el('span', { class: 'label', text: 'Repartição' }), el('select', { 'aria-label': 'Repartição', onchange: guard(async (e) => { F.cardOffice = e.target.value; await paintList(); }) }, ...d.offices.map((o) => ui.opt(o.id, `${o.name} · ${typeShort(o.type)}`, String(o.id) === F.cardOffice))))
      : el('p', { class: 'dim', text: 'Cadastre uma repartição primeiro.' }),
    listBox);
  await paintList();
}

/* ================================================================== Sem internet: vídeos guardados e a imagem de reserva */
export async function paintVideos(box, ui) {
  const d = ui.data();
  const r = await api('/api/prefeitura/offline');
  const scopeId = () => (F.scope === 'default' ? 0 : Number(F.scopeId) || 0);
  const mine = () => r.items.filter((x) => x.scope === F.scope && x.scopeId === scopeId());
  const HASH = { ok: 'pronto para as telas', pending: 'calculando a conferência (SHA-256)…', error: 'falhou a leitura do arquivo' };
  const listBox = el('div', { class: 'pf-sub' });
  const imgBox = el('div', { class: 'pf-sub pf-offimg' });
  /* a imagem sem internet do nível escolhido (server/telas-imagem-offline.js): miniatura, Enviar imagem e Remover */
  const paintImage = () => {
    while (thumbUrls.length) URL.revokeObjectURL(thumbUrls.pop());
    if (F.scope !== 'default' && !scopeId()) return put(imgBox);
    const cur = (r.images || []).find((x) => x.scope === F.scope && x.scopeId === scopeId());
    const url = `/api/prefeitura/offline-image/${F.scope}/${scopeId()}`;
    const thumb = el('img', { class: 'pf-offimg-pic', alt: 'Imagem que as telas mostram sem internet', hidden: true });
    const note = el('p', { class: 'dim small', text: cur ? `Imagem de ${new Date(cur.createdAt).toLocaleString('pt-BR')}${cur.createdBy ? ` · enviada por ${cur.createdBy}` : ''} · ${bytes(cur.bytes)}` : F.scope === 'default' ? 'Sem imagem: sem vídeo guardado, a tela fica preta quando a internet cai.' : 'Sem imagem neste nível: vale a do grupo ou a do padrão da prefeitura, se houver.' });
    if (cur) {
      fetch(url, { headers: { 'x-admin-token': state.token || '' }, cache: 'no-store' }).then((res) => (res.ok ? res.blob() : null)).then((b) => {
        if (!b) return; const u = URL.createObjectURL(b); thumbUrls.push(u); thumb.src = u; thumb.hidden = false;
      }).catch(() => {});
    }
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Escolher a imagem' });
    file.addEventListener('change', guard(async () => {
      const f = file.files?.[0]; if (!f) return;
      if (f.size > 15 * 1024 * 1024) { file.value = ''; throw new Error('A imagem passa de 15 MB. Escolha outra.'); }
      await api(url, { method: 'PUT', form: f, headers: { 'content-type': f.type || 'application/octet-stream' } });
      toast('Imagem enviada. As telas baixam e guardam em até 1 minuto.');
      await paintVideos(box, ui);
    }));
    put(imgBox,
      el('h3', { text: 'Imagem sem internet' }),
      el('p', { class: 'dim small', text: 'Quando a internet cai e não há vídeo guardado, a tela mostra esta imagem em vez de ficar preta. JPEG, PNG ou WebP até 15 MB: o servidor ajusta para 1920×1080, cobrindo a tela sem distorcer (corta as sobras). A tela usa a do nível mais específico: a da repartição, depois a do grupo, depois a do padrão da prefeitura.' }),
      thumb, note, file,
      el('div', { class: 'pf-btns left' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => file.click() }, cur ? 'Trocar a imagem' : 'Enviar imagem'),
        cur ? el('button', { class: 'btn danger', type: 'button', onclick: guard(async () => {
          if (!confirm('Remover a imagem sem internet deste nível?')) return;
          await api(url, { method: 'DELETE' });
          toast('Imagem removida.');
          await paintVideos(box, ui);
        }) }, 'Remover') : null));
  };
  const paintList = () => {
    paintImage();
    const picked = new Map(mine().map((x) => [x.mediaId, x]));
    const sel = new Map([...picked].map(([id, x]) => [id, x.class]));
    const need = F.scope !== 'default' && !scopeId();
    const rows = r.media.map((m) => {
      const on = el('input', { type: 'checkbox', checked: sel.has(m.id), 'aria-label': `Guardar ${m.title}` });
      const cls = classSelect(sel.get(m.id)); cls.disabled = !sel.has(m.id);
      on.addEventListener('change', () => { if (on.checked) sel.set(m.id, cls.value); else sel.delete(m.id); cls.disabled = !on.checked; });
      cls.addEventListener('change', () => { if (sel.has(m.id)) sel.set(m.id, cls.value); });
      const st = picked.get(m.id);
      return el('tr', {}, el('td', {}, on), el('td', {}, el('b', { text: m.title })), el('td', { text: bytes(m.bytes) }), el('td', {}, cls),
        el('td', { class: st?.hash === 'error' ? 'pf-err' : '', text: st ? `${HASH[st.hash]}${st.error ? `: ${st.error}` : ''}` : '—' }));
    });
    put(listBox, 
      need ? el('p', { class: 'dim', text: 'Escolha o grupo ou a repartição.' }) : null,
      !need && rows.length ? ui.table(['Guardar', 'Vídeo da biblioteca', 'Tamanho', 'Classificação', 'Situação'], rows) : null,
      !r.media.length ? el('p', { class: 'dim', text: 'Nenhum vídeo pronto na biblioteca (Mídia).' }) : null,
      need ? null : el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
        if (sel.size > r.limits.perScope) return toast(`No máximo ${r.limits.perScope} vídeos por nível.`, true);
        await api('/api/prefeitura/offline', { method: 'PUT', body: { scope: F.scope, scopeId: scopeId(), items: [...sel].map(([mediaId, c]) => ({ mediaId, class: c })) } });
        toast('Vídeos guardados salvos. Cada vídeo vai às telas depois da conferência (SHA-256), calculada em segundo plano.');
        await paintVideos(box, ui);
      }) }, 'Salvar a lista'), el('button', { class: 'btn', type: 'button', onclick: guard(() => paintVideos(box, ui)) }, 'Atualizar a situação')));
  };
  const which = el('select', { 'aria-label': 'Grupo ou repartição', hidden: F.scope === 'default', onchange: (e) => { F.scopeId = e.target.value; paintList(); } });
  const fill = () => {
    const list = F.scope === 'group' ? d.groups : d.offices;
    which.hidden = F.scope === 'default';
    put(which, ui.opt('', 'Escolha…', !F.scopeId), ...list.map((x) => ui.opt(x.id, x.name, String(x.id) === String(F.scopeId))));
    if (!list.some((x) => String(x.id) === String(F.scopeId))) F.scopeId = '';
  };
  const scope = el('select', { 'aria-label': 'Nível', onchange: (e) => { F.scope = e.target.value; F.scopeId = ''; fill(); paintList(); } },
    ui.opt('default', 'Padrão da prefeitura (todas as telas)', F.scope === 'default'), ui.opt('group', 'Um grupo de telas', F.scope === 'group'), ui.opt('office', 'Uma repartição', F.scope === 'office'));
  fill();
  const n = (s) => r.items.filter((x) => x.scope === s).length;
  put(box,
    el('h3', { text: 'Sem internet: vídeos e imagem' }),
    el('p', { class: 'dim small', text: `Vídeos da biblioteca que cada TV box baixa e guarda para tocar quando a internet cai. Cada tela recebe os do padrão da prefeitura, os dos grupos dela e os da repartição dela (até ${r.limits.sent} no total, ${r.limits.perScope} por nível). O vídeo só vai às telas depois de o servidor calcular a conferência dele (SHA-256), uma vez, em segundo plano e sem atrapalhar o canal no ar.` }),
    el('p', { class: 'dim small', text: `Hoje: ${n('default')} no padrão, ${n('group')} em grupos, ${n('office')} em repartições.` }),
    el('div', { class: 'pf-bar' }, el('span', { class: 'label', text: 'Nível' }), scope, which),
    imgBox,
    el('h3', { text: 'Vídeos guardados' }),
    listBox);
  paintList();
}
const thumbUrls = []; // as miniaturas da imagem sem internet (blob:), soltas a cada pintura

/* ================================================================== Aprovações */
const KIND = { avisos: 'Avisos', card: 'Cartão', alert: 'Alerta' };
const STATUS = { pending: 'aguardando', approved: 'aprovado', rejected: 'recusado', auto: 'saiu sem aprovação (Defesa Civil)' };
function payloadNode(a) {
  const p = a.payload || {};
  if (a.kind === 'avisos') return el('ul', { class: 'pf-plain' }, ...(p.items || []).map((x) => el('li', { text: x })));
  if (a.kind === 'card') return el('div', {}, el('b', { text: `${CARD_KIND[p.kind]?.label || p.kind}: ${p.title}` }), el('ul', { class: 'pf-plain' }, ...(p.lines || []).map((x) => el('li', { text: x }))),
    el('div', { class: 'dim small', text: `${p.weekday != null ? WEEKDAYS[p.weekday] : 'todos os dias'}${a.refId ? ' · alteração de um cartão que já existe' : ' · cartão novo'}` }));
  if (a.kind === 'alert') return el('div', {}, el('b', { text: p.title }), el('div', { class: 'pf-pre', text: p.body || '' }), el('div', { class: 'dim small', text: `nível ${p.level}${p.sound ? ' · com som' : ''} · ${Math.round((p.until - p.startsAt) / 60000)} min a partir da aprovação` }));
  return el('span', { text: a.summary });
}
export async function paintAprovacoes(box, ui) {
  const r = await api('/api/prefeitura/approvals');
  const again = () => paintAprovacoes(box, ui);
  const decide = (a, what) => guard(async () => {
    let note = '';
    if (what === 'reject') { note = prompt(`Recusar o pedido de "${a.office || 'repartição'}"? Escreva o motivo (a repartição vê):`, ''); if (note === null) return; }
    await api(`/api/prefeitura/approvals/${a.id}/${what}`, { method: 'POST', body: { note } });
    toast(what === 'approve' ? 'Aprovado: vai às telas em até 30 segundos.' : 'Recusado.');
    await ui.refreshBadge?.();
    await again();
  });
  const row = (a, live) => el('tr', {},
    el('td', {}, el('b', { text: a.office || `repartição #${a.officeId}` }), el('div', { class: 'dim small', text: `${a.requestedBy} · ${ui.when(a.requestedAt)}` })),
    el('td', {}, el('span', { class: 'pf-chip', text: KIND[a.kind] || a.kind })),
    el('td', {}, payloadNode(a)),
    el('td', {}, el('span', { class: `pf-level${a.class === 'institucional' ? ' warn' : ''}`, text: classLabel(a.class) }), a.class === 'institucional' && r.electoral.on ? el('div', { class: 'pf-err small', text: 'retido no período eleitoral' }) : null),
    live ? el('td', { class: 'pf-actions' }, el('button', { class: 'btn small primary', type: 'button', onclick: decide(a, 'approve') }, 'Aprovar'), el('button', { class: 'btn small danger', type: 'button', onclick: decide(a, 'reject') }, 'Recusar'))
      : el('td', {}, STATUS[a.status] || a.status, a.decidedBy ? el('div', { class: 'dim small', text: `${a.decidedBy} · ${ui.when(a.decidedAt)}${a.note ? ` · "${a.note}"` : ''}` }) : null));
  put(box, 
    el('p', { class: r.enabled ? 'dim small' : 'pf-banner', text: r.enabled
      ? 'Aprovação da SECOM ligada: os avisos, os cartões e os alertas que as repartições escrevem pelo link de controle esperam aqui. O que é escrito neste painel vale na hora. Os alertas da Defesa Civil saem na hora e ficam marcados no histórico.'
      : 'A aprovação da SECOM está desligada: o que as repartições escrevem pelo link de controle vai direto às telas. Para ligar: Repartições → Padrão da prefeitura.' }),
    el('p', { class: 'pf-note', role: 'note', text: ART37 }),
    el('div', { class: 'label', text: `Aguardando aprovação (${r.pending.length})` }),
    r.pending.length ? ui.table(['Repartição', 'Tipo', 'Conteúdo', 'Classificação', ''], r.pending.map((a) => row(a, true))) : el('p', { class: 'dim small', text: 'Nada esperando.' }),
    el('div', { class: 'label', text: 'Histórico (quem pediu, quem decidiu e quando)' }),
    r.history.length ? ui.table(['Repartição', 'Tipo', 'Conteúdo', 'Classificação', 'Decisão'], r.history.map((a) => row(a, false))) : el('p', { class: 'dim small', text: 'Nenhum pedido ainda.' }));
}

/* ================================================================== Padrão da prefeitura: os campos das fases 3 e 4 */
/** Devolve { node, read() }: o que entra no PUT /api/prefeitura/defaults junto com o resto. */
export function settingsFields(ui, def) {
  const uf = el('select', {}, ui.opt('', 'Sem clima', !def.cidade), ...Object.entries(UFS).map(([k, v]) => ui.opt(k, `${k} · ${v}`, def.cidade?.uf === k)));
  const city = el('input', { type: 'text', maxlength: '80', placeholder: 'Nome do município', value: def.cidade?.city || '' });
  const from = el('input', { type: 'date', value: def.electoral?.from || '' }); const to = el('input', { type: 'date', value: def.electoral?.to || '' });
  const chk = (v) => el('input', { type: 'checkbox', checked: v });
  const approval = chk(def.approval); const eas = chk(def.eas); const off = chk(def.notify?.offline);
  const after = el('input', { type: 'number', min: '5', max: '1440', step: '1', value: String(def.notify?.afterMin ?? 10) });
  const node = el('div', {},
    el('div', { class: 'label', text: 'Clima nas telas (bloco "Clima" da lateral)' }),
    el('div', { class: 'pf-grid two' }, ui.f('Estado', uf), ui.f('Município', city, def.weatherReady === false ? 'Este servidor não tem fonte de clima configurada.' : 'A fonte é a do servidor (a mesma dos aplicativos de TV). A tela renova o clima no máximo a cada 30 minutos.')),
    el('div', { class: 'label', text: 'Modo eleitoral' }),
    el('div', { class: 'pf-grid two' }, ui.f('Primeiro dia do período', from), ui.f('Último dia', to)),
    el('p', { class: 'dim small', text: 'No período, o conteúdo classificado como institucional (avisos, cartões, alertas e vídeos guardados) fica retido e não vai às telas; nada é apagado. Utilidade pública e emergência seguem. Vazio = desligado. Os dias valem inteiros, no horário de Brasília.' }),
    el('div', { class: 'label', text: 'Aprovação, emergência e avisos' }),
    el('div', { class: 'pf-grid' },
      el('label', { class: 'pf-check' }, approval, el('span', { text: 'Aprovação da SECOM: os avisos, os cartões e os alertas escritos pelo link de controle das repartições esperam a aprovação (aba Aprovações). Os alertas da Defesa Civil saem na hora, marcados.' })),
      // DIGITAL ISP: sem canal no ar (o alerta de emergência do canal) e sem envio de e-mail (o aviso de tela desligada):
      // os dois campos ficam fora; o que já estava guardado segue como está
    ));
  return {
    node,
    read() {
      if (uf.value && !city.value.trim()) throw new Error('Clima: escreva o município.');
      if ((from.value && !to.value) || (!from.value && to.value)) throw new Error('Modo eleitoral: informe o primeiro e o último dia.');
      return {
        cidade: uf.value ? { uf: uf.value, city: city.value.trim() } : null, electoral: from.value ? { from: from.value, to: to.value } : null,
        approval: approval.checked, eas: eas.checked, notify: { offline: off.checked, afterMin: Number(after.value) || 10 },
      };
    },
  };
}
