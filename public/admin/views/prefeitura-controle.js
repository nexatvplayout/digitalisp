// Painel da Prefeitura · o que veio com as telas de controle por família (docs/PREFEITURA.md):
//   - officeUsers: os usuários do painel de cada repartição (usuário + senha, papel gestor ou atendente) e o link dela;
//   - alertKind: a categoria e o tipo do catálogo de avisos, com a gravidade (Aviso, Severo, Extremo), na aba Alertas;
//   - alertTextsEditor: o texto sugerido de cada tipo de aviso, em Padrão da prefeitura (só o que a prefeitura troca fica);
//   - paintDesaparecidos: a aba Desaparecidos (pessoas desaparecidas: foto em tela cheia e faixa; contrato §8).
// A senha nunca volta do servidor; o link aparece só ao gerar.
import { el, api, guard, toast, copyText, state } from '../lib.js';
import {
  OFFICE_ROLES, roleLabel, LIMITS, ALERT_CATEGORIES, alertCategory, alertTypeText, ALERT_TYPES, SEVERITIES, severityOf, OFFICE_TYPE,
  MISSING_KINDS, MISSING_SHOWS, MISSING_RELATIONS, MISSING_LIMITS as ML, MISSING_CONTACT, MISSING_CLOSE, typeShort, QR_TARGETS, QR_LABEL_DEFAULT, qrDataOf,
} from '../../shared/telas-tipos.js';
import { tvPreview, qrSvg } from '../../shared/telas-previa.js';

const put = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));

/* ================================================================== usuários do painel da repartição */
export function officeUsers(ui, o) {
  const box = el('div', {}); const linkOut = el('div', { class: 'pf-keybox', hidden: true });
  let info = null;
  const load = async () => { info = await api(`/api/prefeitura/offices/${o.id}/users`); paint(); };
  const passFields = () => {
    const a = el('input', { type: 'password', autocomplete: 'new-password', maxlength: String(LIMITS.linkPasswordMax) });
    const b = el('input', { type: 'password', autocomplete: 'new-password', maxlength: String(LIMITS.linkPasswordMax) });
    return { a, b, read() { if (a.value !== b.value) throw new Error('A senha e a confirmação não são iguais.'); if (a.value.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.'); return a.value; } };
  };
  const roleSelect = (cur) => el('select', {}, ...OFFICE_ROLES.map((r) => ui.opt(r.key, `${r.label}: ${r.desc}`, r.key === cur)));
  function newUser() {
    const username = el('input', { type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex.: maria.recepcao' });
    const name = el('input', { type: 'text', maxlength: String(LIMITS.name), placeholder: 'Nome de quem vai usar' });
    const role = roleSelect('gestor'); const p = passFields();
    ui.dialog(`Novo usuário · ${o.name}`, el('div', { class: 'pf-grid' },
      ui.f('Usuário', username, '3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado. Único dentro desta repartição.'), ui.f('Nome', name), ui.f('Papel', role),
      ui.f('Senha', p.a, 'Pelo menos 8 caracteres. Só o resumo cifrado fica guardado: ninguém lê a senha depois.'), ui.f('Confirme a senha', p.b),
      info.users.length ? null : el('p', { class: 'pf-banner', text: info.office.legacyPassword ? 'Este é o primeiro usuário desta repartição: ao criar, a senha única do link deixa de valer e quem estava com a página aberta precisa entrar com usuário e senha.' : 'Este é o primeiro usuário desta repartição.' })), {
      saveLabel: 'Criar usuário',
      save: async () => {
        await api(`/api/prefeitura/offices/${o.id}/users`, { method: 'POST', body: { username: username.value, name: name.value, role: role.value, password: p.read() } });
        toast('Usuário criado. Passe o usuário e a senha por um caminho diferente do do link.');
        await load(); await ui.reload();
      },
    });
  }
  function newPass(u) {
    const p = passFields();
    ui.dialog(`Trocar a senha · ${u.username}`, el('div', { class: 'pf-grid' }, ui.f('Senha nova', p.a), ui.f('Confirme a senha', p.b), el('p', { class: 'dim small', text: 'Quem estava com a página aberta com este usuário precisa entrar de novo.' })), {
      saveLabel: 'Trocar a senha',
      save: async () => { await api(`/api/prefeitura/offices/${o.id}/users/${u.id}`, { method: 'PATCH', body: { password: p.read() } }); toast('Senha trocada.'); await load(); },
    });
  }
  const patch = (u, body, msg) => guard(async () => { await api(`/api/prefeitura/offices/${o.id}/users/${u.id}`, { method: 'PATCH', body }); toast(msg); await load(); });
  const genLink = guard(async () => {
    if (info.office.link.on && !confirm('Gerar outro link? O link de antes deixa de valer e quem estava com a página aberta precisa entrar de novo pelo link novo.')) return;
    const r = await api(`/api/prefeitura/offices/${o.id}/link`, { method: 'POST', body: {} });
    linkOut.hidden = false;
    put(linkOut, el('p', { class: 'dim small', text: 'O link desta repartição aparece só agora (só o resumo dele fica guardado). Copie e mande ao responsável:' }), el('div', { class: 'pf-url', text: r.url }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.url) }, 'Copiar o link'));
    await load(); await ui.reload();
  });
  /** O emissor conveniado (Polícia Civil ou Militar): "pode emitir direto" e a chave de integração (API). */
  const apiBox = el('div', { class: 'pf-keybox', hidden: true });
  function issuerBox() {
    const direct = el('input', { type: 'checkbox', checked: info.office.direct, onchange: guard(async (e) => {
      if (e.target.checked && !confirm(`Liberar "${o.name}" para emitir alertas direto, sem a aprovação do CCO? (A cartela "Procurado pela Justiça" e os pedidos de informação continuam esperando a aprovação.)`)) { e.target.checked = false; return; }
      await api(`/api/prefeitura/offices/${o.id}/issuer`, { method: 'PUT', body: { direct: e.target.checked } });
      toast(e.target.checked ? 'Liberado: os alertas deste emissor vão às telas na hora.' : 'Os envios deste emissor voltam a esperar a aprovação do CCO.'); await load();
    }) });
    const keyNote = el('p', { class: 'small', text: 'Carregando…' });
    const gen = el('button', { class: 'btn', type: 'button', onclick: guard(async () => {
      if (keyNote.dataset.on && !confirm('Gerar outra chave? A chave de antes deixa de valer na hora.')) return;
      const r = await api(`/api/prefeitura/offices/${o.id}/api-key`, { method: 'POST', body: {} });
      apiBox.hidden = false;
      put(apiBox, el('p', { class: 'dim small', text: 'A chave aparece só agora (só o resumo dela fica guardado). Entregue ao responsável técnico do órgão:' }), el('div', { class: 'pf-url', text: r.key }), el('p', { class: 'dim small', text: `Endereço: ${r.endpoint} (cabeçalho Authorization: Bearer <chave>)` }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.key) }, 'Copiar a chave'));
      await readKey();
    }) }, 'Gerar a chave de integração');
    const revoke = el('button', { class: 'btn danger', type: 'button', hidden: true, onclick: guard(async () => { if (!confirm('Revogar a chave de integração?')) return; await api(`/api/prefeitura/offices/${o.id}/api-key`, { method: 'DELETE' }); toast('Chave revogada.'); apiBox.hidden = true; await readKey(); }) }, 'Revogar a chave');
    const readKey = async () => {
      const k = await api(`/api/prefeitura/offices/${o.id}/api-key`);
      keyNote.dataset.on = k.on ? '1' : '';
      keyNote.textContent = !k.allowed ? 'O plano desta prefeitura não inclui o Acesso por API: a chave de integração fica indisponível.' : k.on ? `Chave gerada em ${ui.when(k.createdAt)} por ${k.createdBy || '—'}. Último uso: ${k.lastUsed ? ui.when(k.lastUsed) : 'nunca'}.` : 'Sem chave de integração. Com ela, o sistema do órgão cria e encerra alertas (não envia foto: desaparecido e cartela, só pela tela).';
      gen.disabled = !k.allowed; gen.textContent = k.on ? 'Gerar outra chave' : 'Gerar a chave de integração'; revoke.hidden = !k.on;
    };
    guard(readKey)();
    return el('div', {},
      el('div', { class: 'label', text: 'Emissor conveniado (órgão de fora da prefeitura)' }),
      el('p', { class: 'dim small', text: 'Este órgão não administra o painel: só emite o que o convênio permite e vê os próprios envios. O que ele envia espera a aprovação da Segurança (CCO); sem repartição de Segurança, a da SECOM ou a deste painel (aba Aprovações).' }),
      el('label', { class: 'pf-check' }, direct, el('span', { text: 'Pode emitir alertas direto, sem aprovação' })),
      el('div', { class: 'label', text: 'Chave de integração (API)' }), keyNote, el('div', { class: 'pf-btns left' }, gen, revoke), apiBox);
  }
  function paint() {
    const rows = info.users.map((u) => el('tr', { class: u.active ? '' : 'pf-gone' },
      el('td', {}, el('b', { text: u.username }), el('div', { class: 'dim small', text: u.name || '—' })),
      el('td', {}, el('select', { 'aria-label': `Papel de ${u.username}`, onchange: (e) => patch(u, { role: e.target.value }, `Papel de ${u.username}: ${roleLabel(e.target.value)}. A sessão aberta dele caiu.`)() }, ...OFFICE_ROLES.map((r) => ui.opt(r.key, r.label, r.key === u.role)))),
      el('td', { text: u.active ? 'ativo' : 'desativado' }),
      el('td', { text: u.lastLogin ? ui.when(u.lastLogin) : 'nunca entrou' }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => newPass(u) }, 'Trocar a senha'),
        el('button', { class: 'btn small', type: 'button', onclick: patch(u, { active: !u.active }, u.active ? `${u.username} desativado: não entra mais.` : `${u.username} reativado.`) }, u.active ? 'Desativar' : 'Reativar'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Apagar o usuário "${u.username}"?`)) return; await api(`/api/prefeitura/offices/${o.id}/users/${u.id}`, { method: 'DELETE' }); toast('Usuário apagado.'); await load(); await ui.reload(); }) }, 'Apagar'))));
    put(box,
      el('p', { class: 'dim small', text: `Cada repartição tem um link próprio e os usuários dela. Quem entra só alcança "${o.name}": os avisos, os cartões, os alertas, a chamada de senha e as TV box vinculadas a ela. O Gestor faz tudo da repartição; o Atendente só vê Atendimento e Recepção (a tela do guichê).` }),
      el('div', { class: 'label', text: 'Link desta repartição' }),
      el('p', { class: 'small', text: info.office.link.on ? `Link ligado desde ${ui.when(info.office.link.at)}. O endereço não fica guardado: se perdeu, gere outro (o anterior deixa de valer).` : 'Esta repartição ainda não tem link. Gere o link e passe ao responsável.' }),
      el('div', { class: 'pf-btns left' }, el('button', { class: 'btn', type: 'button', disabled: !info.users.length && !info.office.legacyPassword, title: !info.users.length && !info.office.legacyPassword ? 'Crie o primeiro usuário antes de gerar o link.' : '', onclick: genLink }, info.office.link.on ? 'Gerar outro link' : 'Gerar o link')),
      linkOut,
      info.office.external ? issuerBox() : null,
      el('div', { class: 'label', text: `Usuários do painel da repartição (${info.users.length} de ${info.max})` }),
      rows.length ? ui.table(['Usuário', 'Papel', 'Situação', 'Última entrada', ''], rows)
        : el('p', { class: 'dim small', text: info.office.legacyPassword ? 'Nenhum usuário ainda: esta repartição entra só com a senha única do link (deixe o campo Usuário em branco). Ao criar o primeiro usuário, essa senha deixa de valer.' : 'Nenhum usuário ainda. Crie o primeiro para a repartição poder entrar.' }),
      el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: newUser }, '+ Novo usuário')));
  }
  ui.dialog(`Usuários do painel · ${o.name}`, box, { wide: true });
  put(box, el('p', { class: 'dim small', text: 'Carregando…' }));
  guard(load)();
}

/* ================================================================== aba Alertas: categoria, tipo e gravidade */
/**
 * Os campos do catálogo. a: o rascunho do alerta (P.alert: category, kind, level, title, text, sound). onFill(): chamado
 * quando o tipo preenche o título e o texto. Devolve { node, body(): { category, kind } }.
 */
export function alertKind(ui, a, texts, onFill) {
  const type = el('select', {});
  const sev = el('p', { class: 'dim small' });
  const paintTypes = () => { const c = alertCategory(a.category); put(type, ui.opt('', c ? 'Escolha o tipo…' : 'Escolha a categoria antes', !a.kind), ...(c ? c.types.map((t) => ui.opt(t.id, t.name, t.id === a.kind)) : [])); type.disabled = !c; };
  const cat = el('select', { onchange: (e) => { a.category = e.target.value || null; a.kind = null; paintTypes(); } }, ui.opt('', 'Sem categoria (texto livre, como antes)', !a.category), ...ALERT_CATEGORIES.map((c) => ui.opt(c.key, c.label, c.key === a.category)));
  type.addEventListener('change', () => {
    a.kind = type.value || null;
    const t = alertTypeText(a.kind, texts);
    if (!t) return;
    if (t.id !== 'outro') { a.title = t.title; a.text = t.text; }
    a.level = t.level; a.sound = t.test ? false : severityOf(t.level).sound;
    onFill();
  });
  paintTypes();
  return { node: el('div', { class: 'pf-grid two' }, ui.f('Categoria do aviso', cat, 'Pessoa desaparecida não é um alerta: use a aba Desaparecidos.'), ui.f('Tipo', type, 'Preenche o título e o texto sugeridos; troque o que precisar.')), sev, body: () => (a.category ? { category: a.category, kind: a.kind } : {}) };
}
export const severityHint = (level) => { const s = severityOf(level); return `${s.label} (${s.color}): ${s.desc}`; };
export const alertPreview = (a, reachText = '') => tvPreview({ alert: { level: a.level, head: `${alertCategory(a.category)?.test ? 'TESTE · TESTE DO SISTEMA' : `${severityOf(a.level).word}${a.category ? ' · PREFEITURA' : ''}`}`, title: a.title || 'Título do alerta', text: a.text || '', foot: reachText } });

/* ================================================================== Padrão da prefeitura: o texto sugerido de cada tipo de aviso */
export function alertTextsEditor(ui, def) {
  const saved = { ...(def.alertTexts || {}) };
  const sel = el('select', {}, ...ALERT_CATEGORIES.filter((c) => c.key !== 'outro').map((c) => el('optgroup', { label: c.label }, ...c.types.map((t) => ui.opt(t.id, `${t.name}${saved[t.id] ? ' (alterado)' : ''}`)))));
  const title = el('input', { type: 'text', maxlength: String(LIMITS.alertTitle) }); const text = el('textarea', { rows: '3', maxlength: String(LIMITS.alertText) });
  const note = el('p', { class: 'dim small' });
  const fill = () => { const t = alertTypeText(sel.value, saved); title.value = t.title; text.value = t.text; note.textContent = saved[sel.value] ? 'Texto alterado pela prefeitura.' : 'Texto de fábrica.'; };
  const keep = () => { const t = ALERT_TYPES.find((x) => x.id === sel.dataset.cur); if (!t) return; const v = { title: title.value.trim(), text: text.value.trim() }; if (v.title && (v.title !== t.title || v.text !== t.text)) saved[t.id] = v; else delete saved[t.id]; };
  sel.dataset.cur = sel.value;
  sel.addEventListener('change', () => { keep(); sel.dataset.cur = sel.value; fill(); });
  fill();
  const node = el('div', {},
    el('div', { class: 'label', text: 'Tipos de aviso: o texto sugerido (aba Novo alerta da Defesa Civil e aba Alertas)' }),
    el('div', { class: 'pf-grid' }, ui.f('Tipo de aviso', sel), ui.f('Título sugerido', title), ui.f('Texto sugerido', text, 'O operador ainda pode trocar antes de enviar. Só o que a prefeitura muda fica guardado; o resto segue o catálogo.'), note,
      el('div', { class: 'pf-btns left' }, el('button', { class: 'btn small', type: 'button', onclick: () => { delete saved[sel.value]; fill(); } }, 'Voltar este tipo ao texto de fábrica'))));
  return { node, read() { keep(); return { alertTexts: Object.keys(saved).length ? saved : null }; } };
}

/* ================================================================== aba Desaparecidos */
const blobUrls = [];
async function photoUrl(id) {
  const res = await fetch(`/api/prefeitura/missing/${id}/photo`, { headers: { 'x-admin-token': state.token || '' }, cache: 'no-store' });
  if (!res.ok) throw new Error('foto');
  const u = URL.createObjectURL(await res.blob()); blobUrls.push(u); return u;
}
export async function paintDesaparecidos(box, ui) {
  while (blobUrls.length) URL.revokeObjectURL(blobUrls.pop());
  const d = ui.data();
  const r = await api('/api/prefeitura/missing');
  const again = () => paintDesaparecidos(box, ui);
  let photo = null; // { token, src }
  const inp = (props) => el('input', props);
  const kind = el('select', {}, ...MISSING_KINDS.map((k) => ui.opt(k.key, k.label, k.key === 'crianca')));
  const name = inp({ type: 'text', maxlength: String(ML.name) }); const age = inp({ type: 'number', min: '0', max: String(ML.ageMax) }); const since = inp({ type: 'date' });
  const lastSeen = inp({ type: 'text', maxlength: String(ML.lastSeen), placeholder: 'Ex.: Praça da Matriz, por volta das 16h' }); const description = el('textarea', { rows: '2', maxlength: String(ML.description) });
  const contact = inp({ type: 'text', maxlength: String(ML.contact), value: MISSING_CONTACT });
  const reportNo = inp({ type: 'text', maxlength: String(ML.report) }); const authName = inp({ type: 'text', maxlength: String(ML.authName) });
  const authRelation = el('select', {}, ui.opt('', 'Escolha…', true), ...MISSING_RELATIONS.map((x) => ui.opt(x.key, x.label)));
  const authOk = inp({ type: 'checkbox' });
  const show = el('select', {}, ...MISSING_SHOWS.map((s) => ui.opt(s.key, s.label, s.key === 'both')));
  const everyMin = inp({ type: 'number', min: String(ML.everyMinMin), max: String(ML.everyMinMax), value: String(ML.everyMin) });
  const fullSec = inp({ type: 'number', min: String(ML.fullSecMin), max: String(ML.fullSecMax), value: String(ML.fullSec) });
  const bannerSec = inp({ type: 'number', min: String(ML.bannerSecMin), max: String(ML.bannerSecMax), value: String(ML.bannerSec) });
  const days = inp({ type: 'number', min: '1', max: String(ML.daysMax), value: String(ML.days) });
  const file = inp({ type: 'file', accept: 'image/jpeg,image/png,image/webp' }); const photoNote = el('p', { class: 'dim small', text: 'Rosto visível, de frente. JPEG, PNG ou WebP até 5 MB. A localização e os outros dados escondidos na foto são apagados.' });
  const scopeKind = el('select', {}, ui.opt('city', 'Cidade toda', true), ui.opt('regions', 'Regiões'), ui.opt('groups', 'Grupos de telas'), ui.opt('office', 'Uma repartição'));
  const picks = el('div', { class: 'pf-scope' }); const reach = el('p', { class: 'pf-reach', 'aria-live': 'polite' });
  const chosen = new Set(); const officeSel = el('select', {}, ui.opt('', 'Escolha…', true), ...d.offices.map((o) => ui.opt(o.id, `${o.name} · ${typeShort(o.type)}`)));
  const scope = () => (scopeKind.value === 'regions' ? { kind: 'regions', regions: [...chosen] } : scopeKind.value === 'groups' ? { kind: 'groups', groups: [...chosen] } : scopeKind.value === 'office' ? { kind: 'office', office: Number(officeSel.value) || null } : { kind: 'city' });
  const ready = (s) => s.kind === 'city' || (s.regions?.length > 0) || (s.groups?.length > 0) || Boolean(s.office);
  let total = 0;
  const paintReach = guard(async () => { const s = scope(); if (!ready(s)) { reach.textContent = 'Escolha para onde o caso vai.'; return; } const p = await api('/api/prefeitura/alerts/preview', { method: 'POST', body: { scope: s } }); total = p.total; reach.textContent = `${p.total} tela(s) em ${p.offices} repartição(ões) vão mostrar · ${p.online} ligada(s) agora`; });
  const paintPicks = () => {
    chosen.clear();
    const list = scopeKind.value === 'regions' ? d.regions : scopeKind.value === 'groups' ? d.groups : null;
    put(picks, list ? el('div', { class: 'pf-checks tall' }, ...list.map((x) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) chosen.add(x.id); else chosen.delete(x.id); paintReach(); } }), el('span', { text: x.name })))) : scopeKind.value === 'office' ? ui.f('Repartição', officeSel) : null);
    paintReach();
  };
  scopeKind.addEventListener('change', paintPicks); officeSel.addEventListener('change', paintReach);
  // o QR code de contato imediato (contrato §11): aqui, o padrão da prefeitura (vale para a repartição que não definiu o dela)
  const qrMode = el('select', {}, ui.opt('default', 'Mostrar o QR code padrão da prefeitura', true), ui.opt('off', 'Sem QR code neste caso'));
  const defKind = el('select', {}, ...QR_TARGETS.map((t) => ui.opt(t.key, t.label, t.key === (r.qr?.own?.kind || 'whatsapp'))));
  const defValue = inp({ type: 'text', maxlength: '300', value: r.qr?.own?.value || '' }); const defLabel = inp({ type: 'text', maxlength: '40', placeholder: QR_LABEL_DEFAULT, value: r.qr?.own && r.qr.own.label !== QR_LABEL_DEFAULT ? r.qr.own.label : '' });
  const defPv = el('div', { class: 'pf-btns left' });
  const paintDef = () => { const d0 = qrDataOf(defKind.value, defValue.value); put(defPv, d0 ? [Object.assign(qrSvg(d0, 'pf-qr'), {}), el('span', { class: 'dim small', text: `${defLabel.value.trim() || QR_LABEL_DEFAULT} · ${d0}` })] : el('span', { class: 'dim small', text: QR_TARGETS.find((t) => t.key === defKind.value)?.hint || '' })); };
  for (const n of [defKind, defValue, defLabel]) n.addEventListener('input', paintDef);
  const saveQr = guard(async () => { await api('/api/prefeitura/missing/qr', { method: 'PUT', body: { qr: defValue.value.trim() ? { kind: defKind.value, value: defValue.value, label: defLabel.value } : null } }); toast('Contato do QR code salvo: vale para as repartições que não definiram o delas.');
    // sem redesenhar a aba: o caso que está sendo preenchido (foto, nome, autorização) continua no formulário
    const fresh = await api('/api/prefeitura/missing'); r.qr = fresh.qr; defValue.value = r.qr?.own?.value || ''; paintDef(); repaint(); });
  const pv = el('div', { class: 'pf-grid two' });
  const values = () => ({ qr: qrMode.value === 'default' && r.qr?.own ? { data: r.qr.own.data, label: r.qr.own.label } : null, kind: kind.value, name: name.value.trim(), age: age.value === '' ? null : Number(age.value), since: since.value || null, lastSeen: lastSeen.value.trim(), description: description.value.trim(), contact: contact.value.trim() || MISSING_CONTACT, photo: photo?.src || null });
  let bigFull = false; // qual das duas prévias fica grande: clicar na pequena troca, clicar de novo (na outra, agora pequena) volta
  const swapTo = (isFull) => { bigFull = isFull; repaint(); };
  const pvBox = (node, isFull) => {
    const small = isFull !== bigFull;
    return el('div', { class: `pf-pvslot${small ? ' small' : ''}`, role: small ? 'button' : null, tabindex: small ? '0' : null, title: small ? 'Clique para ver grande' : null, 'aria-label': small ? (isFull ? 'Ver a tela cheia grande' : 'Ver a faixa grande') : null,
      onclick: small ? () => swapTo(isFull) : null, onkeydown: small ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swapTo(isFull); } } : null }, node);
  };
  const repaint = () => {
    const full = show.value === 'banner' ? null : pvBox(tvPreview({ layout: 'full', missing: { ...values(), mode: 'full' } }), true);
    const banner = show.value === 'full' ? null : pvBox(tvPreview({ layout: 'ticker', ticker: [], missing: { ...values(), mode: 'banner' } }), false);
    put(pv, bigFull ? [banner, full] : [full, banner]);
  };
  for (const n of [kind, name, age, since, lastSeen, description, contact, show, qrMode]) n.addEventListener('input', repaint);
  file.addEventListener('change', guard(async () => {
    const f = file.files?.[0]; if (!f) return;
    if (f.size > ML.uploadBytes) { file.value = ''; throw new Error('A foto passa de 5 MB. Escolha outra.'); }
    const res = await fetch('/api/prefeitura/missing/photo', { method: 'POST', headers: { 'x-admin-token': state.token || '', 'content-type': f.type || 'application/octet-stream' }, body: f });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { file.value = ''; throw new Error(out.error || 'A foto não foi aceita.'); }
    const src = URL.createObjectURL(f); blobUrls.push(src);
    photo = { token: out.photo, src }; photoNote.textContent = `Foto pronta (${Math.round(out.bytes / 1024)} KB, sem os dados escondidos).`; repaint();
  }));
  const send = guard(async () => {
    const s = scope();
    if (!ready(s)) return toast('Escolha para onde o caso vai.', true);
    if (!authOk.checked) return toast('Marque a confirmação: a família ou a autoridade policial autorizou a divulgação da foto e dos dados.', true);
    if (!confirm(`Pôr no ar o caso de "${name.value.trim()}" em ${total} tela(s)?${photo ? '' : '\nSEM FOTO: a tela mostra uma silhueta.'}\nEncerre assim que a pessoa for localizada.`)) return null;
    await api('/api/prefeitura/missing', { method: 'POST', body: { ...values(), qr: { mode: qrMode.value }, photo: photo?.token || undefined, reportNo: reportNo.value, authName: authName.value, authRelation: authRelation.value, authOk: true, show: show.value, everyMin: Number(everyMin.value), fullSec: Number(fullSec.value), bannerSec: Number(bannerSec.value), days: Number(days.value), scope: s } });
    toast('Caso no ar. As telas mostram em até 10 segundos.');
    return again();
  });
  const close = (m, reason) => guard(async () => {
    if (!confirm(reason === 'localizado' ? `"${m.name}" foi localizado(a)? O caso sai das telas agora e a foto é apagada.` : `Encerrar o caso de "${m.name}"? Ele sai das telas agora e a foto é apagada.`)) return;
    await api(`/api/prefeitura/missing/${m.id}/close`, { method: 'POST', body: { reason } });
    toast('Caso encerrado. A foto foi apagada.'); await again();
  });
  const renew = (m) => guard(async () => { await api(`/api/prefeitura/missing/${m.id}`, { method: 'PATCH', body: { days: ML.days } }); toast(`Validade renovada: mais ${ML.days} dias a partir de agora.`); await again(); });
  const rows = r.active.map((m) => {
    const img = el('img', { class: 'pf-shot', alt: `Foto de ${m.name}`, hidden: true, width: '72' });
    if (m.hasPhoto) photoUrl(m.id).then((u) => { img.src = u; img.hidden = false; }, () => {});
    return el('tr', {},
      el('td', {}, img, m.hasPhoto ? null : el('span', { class: 'dim small', text: 'sem foto' })),
      el('td', {}, el('b', { text: `${m.name}${m.age != null ? `, ${m.age} anos` : ''}` }), el('div', { class: 'dim small', text: `${MISSING_KINDS.find((k) => k.key === m.kind)?.label || m.kind} · registro ${m.reportNo} · autorizado por ${m.authName}` })),
      el('td', { text: m.reach ? `${m.reach.total} tela(s) em ${m.reach.offices} repartição(ões)` : '—' }),
      el('td', { text: `até ${ui.when(m.until)} · a cada ${m.everyMin} min` }),
      el('td', { text: m.createdBy || '—' }),
      el('td', { class: 'pf-actions' }, el('button', { class: 'btn small primary', type: 'button', onclick: close(m, 'localizado') }, 'Localizado'), el('button', { class: 'btn small', type: 'button', onclick: close(m, 'encerrado') }, 'Encerrar'), el('button', { class: 'btn small', type: 'button', onclick: renew(m) }, `Renovar ${ML.days} dias`)));
  });
  put(box,
    el('p', { class: 'pf-banner', role: 'note', text: 'Só divulgue com a autorização da família ou da autoridade policial e com o registro de ocorrência feito. Encerre o caso assim que a pessoa for localizada: a foto é apagada na hora. A Defesa Civil e a SECOM também cadastram pelo link delas.' }),
    el('div', { class: 'label', text: `Casos no ar (${r.active.length} de ${ML.active})` }),
    rows.length ? ui.table(['Foto', 'Pessoa', 'Alcance', 'Validade', 'Cadastrado por', ''], rows) : el('p', { class: 'dim small', text: 'Nenhum caso no ar.' }),
    el('div', { class: 'card pf-compose' },
      el('div', { class: 'label', text: 'Novo caso' }),
      el('div', { class: 'pf-compose-grid' },
        el('div', { class: 'pf-grid' },
          ui.f('Foto', file), photoNote,
          el('div', { class: 'pf-grid two' }, ui.f('Quem é', kind), ui.f('Idade', age)),
          ui.f('Nome', name), ui.f('Desaparecido(a) desde', since), ui.f('Visto(a) por último', lastSeen), ui.f('Descrição (roupa, sinais)', description), ui.f('Contato que aparece na tela', contact),
          el('div', { class: 'label', text: 'Autorização da divulgação (fica só no registro, nunca vai às telas)' }),
          el('div', { class: 'pf-grid two' }, ui.f('Nº do registro de ocorrência', reportNo), ui.f('Quem autorizou (nome)', authName)), ui.f('Vínculo de quem autorizou', authRelation),
          el('label', { class: 'pf-check' }, authOk, el('span', { text: 'A família ou a autoridade policial autorizou a divulgação da foto e dos dados' })),
          el('div', { class: 'pf-grid two' }, ui.f('Na tela', show), ui.f('A cada quantos minutos', everyMin)),
          el('div', { class: 'pf-grid two' }, ui.f('Segundos em tela cheia', fullSec), ui.f('Segundos da faixa', bannerSec)),
          ui.f(`Fica no ar por (dias, até ${ML.daysMax})`, days), ui.f('QR code de contato', qrMode, r.qr?.own ? 'Aparece ao lado do contato, na tela cheia e na faixa.' : 'Ainda sem destino: defina o contato do QR code no bloco abaixo.'),
          ui.f('Para onde', scopeKind, 'O alcance por raio no mapa fica no link da Defesa Civil.'), picks, reach,
          el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: send }, 'Pôr no ar'))),
        el('div', {}, el('div', { class: 'label', text: 'Como aparece na TV' }), pv))),
    el('div', { class: 'card pf-compose' },
      el('div', { class: 'label', text: 'Contato imediato por QR code (padrão da prefeitura)' }),
      el('p', { class: 'dim small', text: 'O QR code aparece no card do caso, ao lado do contato: a pessoa aponta a câmera do celular e fala na hora. Este é o destino padrão; a Defesa Civil e a SECOM podem definir o delas na aba Desaparecidos do link de cada uma.' }),
      el('div', { class: 'pf-grid' }, el('div', { class: 'pf-grid two' }, ui.f('O QR code leva para', defKind), ui.f('Número ou endereço', defValue, 'WhatsApp e telefone: só dígitos, com o código do país. Endereço: só https://.')), ui.f('Frase ao lado do QR code (até 40 letras)', defLabel), defPv,
        el('div', { class: 'pf-btns left' }, el('button', { class: 'btn', type: 'button', onclick: saveQr }, 'Salvar o contato do QR code')))),
    el('div', { class: 'label', text: 'Encerrados (ficam 90 dias; a foto já foi apagada)' }),
    r.closed.length ? ui.table(['Pessoa', 'Motivo', 'Encerrado', 'Por'], r.closed.map((m) => el('tr', {}, el('td', {}, el('b', { text: m.name }), el('div', { class: 'dim small', text: `registro ${m.reportNo}` })), el('td', { text: MISSING_CLOSE.find((c) => c.key === m.closeReason)?.label || '—' }), el('td', { text: ui.when(m.closedAt) }), el('td', { text: m.closedBy || '—' }))))
      : el('p', { class: 'dim small', text: 'Nenhum caso encerrado.' }));
  paintPicks(); repaint(); paintDef();
}
export const hasOfficeLinkScope = (o) => OFFICE_TYPE[o.type]?.alertScope === 'wide';

/* ================================================================== aba Ocorrências: o botão de pânico das repartições */
let occTimer = null;
export async function paintOcorrencias(box, ui) {
  clearInterval(occTimer);
  const list = el('div', {});
  const draw = async () => {
    const r = await api('/api/prefeitura/panic');
    const act = (p, what) => guard(async () => {
      let body = {};
      if (what === 'close') { const note = prompt(`Encerrar a ocorrência de "${p.office}"? Escreva o que foi feito:`, ''); if (note == null) return; body = { note }; }
      await api(`/api/prefeitura/panic/${p.id}/${what}`, { method: 'POST', body });
      toast(what === 'ack' ? 'Marcado como recebido.' : 'Ocorrência encerrada.'); await draw();
    });
    const row = (p, open) => el('tr', { class: p.status === 'novo' ? 'pf-occ-new' : '' },
      el('td', {}, el('span', { class: `pf-level ${p.status === 'novo' ? 'critical' : ''}`, text: p.status === 'novo' ? 'PÂNICO' : p.status }), ' ', el('b', { text: p.office }), el('div', { class: 'dim small', text: `${p.officeTypeLabel}${p.address ? ` · ${p.address}` : ''}` })),
      el('td', { text: `${ui.when(p.sentAt)} · ${p.sentBy.replace(/^repartição: /, '')}` }),
      el('td', { text: p.ackAt ? `${ui.when(p.ackAt)} · ${p.ackBy}` : '—' }),
      open ? el('td', { class: 'pf-actions' }, p.status === 'novo' ? el('button', { class: 'btn small primary', type: 'button', onclick: act(p, 'ack') }, 'Recebido') : null, el('button', { class: 'btn small', type: 'button', onclick: act(p, 'close') }, 'Encerrar'))
        : el('td', {}, `${ui.when(p.closedAt)} · ${p.closedBy || '—'}`, p.note ? el('div', { class: 'dim small', text: p.note }) : null));
    put(list,
      el('div', { class: 'label', text: `Ocorrências abertas (${r.open.length})` }),
      r.open.length ? ui.table(['Repartição', 'Acionado', 'Recebido', ''], r.open.map((p) => row(p, true))) : el('p', { class: 'dim small', text: 'Nenhuma ocorrência aberta.' }),
      el('div', { class: 'label', text: 'Encerradas (90 dias)' }),
      r.closed.length ? ui.table(['Repartição', 'Acionado', 'Recebido', 'Encerrado'], r.closed.map((p) => row(p, false))) : el('p', { class: 'dim small', text: 'Nenhuma ocorrência encerrada.' }));
  };
  put(box, el('p', { class: 'pf-banner', role: 'note', text: 'O botão de pânico das repartições é um aviso silencioso: nada aparece em tela nenhuma. Ele chega aqui e ao painel da Segurança (CCO), que marca Recebido e encerra com uma nota. Liga-se por repartição, em Repartições → Editar → Módulos.' }), list);
  await draw();
  // relê a cada 5 s enquanto a aba está aberta (a lista some da página = para)
  occTimer = setInterval(() => { if (!list.isConnected) { clearInterval(occTimer); return; } if (!document.hidden && !document.querySelector('dialog[open]')) draw().catch(() => {}); }, 5000);
}
