// NEXA Telas · página de controle da repartição · aba Desaparecidos (Defesa Civil e SECOM; contrato do aparelho §8): pôr no ar
// o caso de uma pessoa desaparecida, com a foto em tela cheia e os dados, e a faixa com a miniatura. Só com a autorização da
// família ou da autoridade policial e o número do registro de ocorrência (esses campos ficam só no registro: nunca vão às
// telas). Encerrar ("Localizado" ou "Encerrar") tira das telas no próximo sinal de vida e apaga a foto. No máximo 5 casos
// no ar. /api/reparticao/missing*.
import { MISSING_KINDS, MISSING_SHOWS, MISSING_RELATIONS, MISSING_LIMITS as L, MISSING_CONTACT, MISSING_CLOSE, QR_TARGETS, QR_LABEL_DEFAULT, qrDataOf, INFO_KIND, INFO_HEADERS, INFO_CONTACT, INFO_DAYS_MAX, isExternal } from '/shared/telas-tipos.js';
import { S, el, put, api, apiImage, act, ok, card, cols, field, option, check, hhmm, left, now } from '/reparticao/rep-base.js';
import { tvPreview, qrSvg } from '/shared/telas-previa.js';
import { scopePicker, confirmDialog } from '/reparticao/rep-alertas.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Não foi possível ler a foto.')); r.readAsDataURL(file); });

export function desaparecidos(ctx) {
  let data = null; let qrLoaded = false; let editing = null; // o caso aberto para editar (null = novo)
  let photo = null; // { token (foto enviada, à espera do caso) | null, src (data: da prévia) | null }
  const thumbs = new Map(); // caso -> data: da foto (lida com a sessão)
  // a Polícia Civil também cadastra a cartela policial (pedido de informação): contrato §10
  const pc = S.state.office.type === 'policia-civil'; const external = isExternal(S.state.office.type);
  const kind = el('select', {}, ...MISSING_KINDS.map((k) => option(k.key, k.label, k.key === 'crianca')), pc ? option(INFO_KIND, 'Pedido de informação (cartela policial)') : null);
  const infoHeader = el('select', {}, ...INFO_HEADERS.map((h) => option(h.key, h.label)));
  const warrantNo = el('input', { type: 'text', maxlength: String(L.report), autocomplete: 'off' });
  const isInfo = () => kind.value === INFO_KIND;
  const headOf = () => INFO_HEADERS.find((h) => h.key === infoHeader.value);
  const name = el('input', { type: 'text', maxlength: String(L.name), autocomplete: 'off' });
  const age = el('input', { type: 'number', min: '0', max: String(L.ageMax), step: '1' });
  const since = el('input', { type: 'date', max: today() });
  const lastSeen = el('input', { type: 'text', maxlength: String(L.lastSeen), placeholder: 'Ex.: Praça da Matriz, por volta das 16h' });
  const description = el('textarea', { rows: '2', maxlength: String(L.description), placeholder: 'Ex.: Blusa amarela, short jeans, mochila rosa' });
  const contact = el('input', { type: 'text', maxlength: String(L.contact), value: MISSING_CONTACT });
  const reportNo = el('input', { type: 'text', maxlength: String(L.report), autocomplete: 'off' });
  const authName = el('input', { type: 'text', maxlength: String(L.authName), autocomplete: 'off' });
  const authRelation = el('select', {}, option('', 'Escolha…', true), ...MISSING_RELATIONS.map((r) => option(r.key, r.label)));
  const authOk = el('input', { type: 'checkbox' });
  const show = el('select', {}, ...MISSING_SHOWS.map((s) => option(s.key, s.label, s.key === 'both')));
  const everyMin = el('input', { type: 'number', min: String(L.everyMinMin), max: String(L.everyMinMax), step: '1', value: String(L.everyMin) });
  const fullSec = el('input', { type: 'number', min: String(L.fullSecMin), max: String(L.fullSecMax), step: '1', value: String(L.fullSec) });
  const bannerSec = el('input', { type: 'number', min: String(L.bannerSecMin), max: String(L.bannerSecMax), step: '1', value: String(L.bannerSec) });
  const days = el('input', { type: 'number', min: '1', max: String(L.daysMax), step: '1', value: String(L.days) });
  const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-describedby': 'photoHelp' });
  const photoNote = el('p', { class: 'r-dim', id: 'photoHelp', text: 'Rosto visível, de frente, sem óculos escuros nem boné. JPEG, PNG ou WebP até 5 MB. A localização e os outros dados escondidos na foto são apagados.' });
  // o QR code de contato imediato (contrato §11): o destino padrão desta repartição e o de cada caso
  const qrMode = el('select', {}, option('default', 'Mostrar o QR code padrão', true), option('off', 'Sem QR code neste caso'), option('custom', 'Outro destino só neste caso'));
  const qrKind = el('select', {}, ...QR_TARGETS.map((t) => option(t.key, t.label)));
  const qrValue = el('input', { type: 'text', maxlength: '300', autocomplete: 'off', inputmode: 'url' }); const qrLabel = el('input', { type: 'text', maxlength: '40', placeholder: QR_LABEL_DEFAULT });
  const qrCustom = el('div', { class: 'r-row three', hidden: true }, field('Leva para', qrKind), field('Número ou endereço', qrValue), field('Frase ao lado', qrLabel));
  const qrNote = el('p', { class: 'r-dim' });
  const defKind = el('select', {}, ...QR_TARGETS.map((t) => option(t.key, t.label)));
  const defValue = el('input', { type: 'text', maxlength: '300', autocomplete: 'off' }); const defLabel = el('input', { type: 'text', maxlength: '40', placeholder: QR_LABEL_DEFAULT });
  const defHint = el('small', { class: 'r-dim' }); const defNote = el('p', { class: 'r-dim' }); const defPv = el('div', { class: 'r-qrpv' });
  /** O QR que este caso mostraria agora: { data, label } ou null. */
  const qrNow = () => {
    if (qrMode.value === 'off') return null;
    if (qrMode.value === 'custom') { const d = qrDataOf(qrKind.value, qrValue.value); return d ? { data: d, label: qrLabel.value.trim() || QR_LABEL_DEFAULT } : null; }
    const q = data?.qr?.own || data?.qr?.inherited; return q ? { data: q.data, label: q.label } : null;
  };
  const paintQr = () => {
    qrCustom.hidden = qrMode.value !== 'custom';
    const q = data?.qr || {};
    qrNote.textContent = qrMode.value === 'default' ? (q.own ? 'Usa o destino desta repartição (bloco "Contato imediato por QR code").' : q.inherited ? 'Usa o destino padrão da prefeitura.' : 'Ainda não há destino configurado: defina um no bloco "Contato imediato por QR code" (ou escolha outro destino só neste caso).') : qrMode.value === 'custom' ? QR_TARGETS.find((t) => t.key === qrKind.value)?.hint || '' : 'Este caso vai sem QR code.';
    defHint.textContent = QR_TARGETS.find((t) => t.key === defKind.value)?.hint || '';
    const d = qrDataOf(defKind.value, defValue.value);
    put(defPv, d ? [qrSvg(d, 'r-qr'), el('span', { class: 'r-dim', text: defLabel.value.trim() || QR_LABEL_DEFAULT })] : null);
  };
  const fillDef = () => {
    const q = data?.qr || {};
    defKind.value = q.own?.kind || 'whatsapp'; defValue.value = q.own?.value || ''; defLabel.value = q.own && q.own.label !== QR_LABEL_DEFAULT ? q.own.label : '';
    defNote.textContent = q.own ? 'Este é o destino do QR code nos casos desta repartição.' : q.inherited ? 'Sem destino próprio: os casos usam o padrão da prefeitura. Defina um aqui para trocar.' : 'Sem destino configurado: os casos saem sem QR code. Defina o WhatsApp, o telefone ou a página de contato.';
    paintQr();
  };
  const saveDef = act(async () => { await api('/missing/qr', { method: 'PUT', body: { qr: defValue.value.trim() ? { kind: defKind.value, value: defValue.value, label: defLabel.value } : null } }); await load(); fillDef(); repaint(); }, 'Contato do QR code salvo. As telas trocam em até 30 segundos.');
  for (const n of [qrMode, qrKind, qrValue, qrLabel, defKind, defValue, defLabel]) n.addEventListener('input', () => { paintQr(); repaint(); });
  const pvFull = el('div', { class: 'r-pv' }); const pvBanner = el('div', { class: 'r-pv' });
  const formTitle = el('h2', { text: 'Novo caso' }); const cancel = el('button', { type: 'button', class: 'r-btn', hidden: true }, 'Cancelar a edição');
  const submit = el('button', { type: 'submit', class: 'r-btn danger big' }, 'Pôr no ar');
  const list = el('div', { class: 'r-reqs' }); const closed = el('ul', { class: 'r-list' }); const limitNote = el('p', { class: 'r-dim' });
  const waitList = el('ul', { class: 'r-list' }); const waitBox = card('Esperando a aprovação do CCO', el('p', { class: 'r-dim', text: isExternal(S.state.office.type) ? 'O que este órgão envia só vai às telas depois de aprovado pela Segurança (CCO). O motivo de uma devolução aparece na faixa do alto da página.' : 'Casos e cartelas enviados pelos órgãos conveniados, que ainda esperam a aprovação da Segurança (CCO). Ainda não estão em tela nenhuma.' }), waitList); waitBox.hidden = true;
  const scope = scopePicker({ onChange: () => repaint() });
  const values = () => (isInfo() ? { kind: INFO_KIND, header: headOf().label, name: name.value.trim() || 'Pedido de informação', age: null, since: null, lastSeen: '', description: [headOf().fixed, description.value.trim()].filter(Boolean).join(' '), contact: contact.value.trim() || INFO_CONTACT, photo: photo?.src || null, qr: qrNow() } : valuesCase());
  const valuesCase = () => ({ kind: kind.value, name: name.value.trim(), age: age.value === '' ? null : Number(age.value), since: since.value || null, lastSeen: lastSeen.value.trim(), description: description.value.trim(), contact: contact.value.trim() || MISSING_CONTACT, photo: photo?.src || null, qr: qrNow() });
  function repaint() {
    const v = values(); const lay = S.state.layout || 'ticker';
    put(pvFull, show.value === 'banner' ? el('p', { class: 'r-dim', text: 'Só a faixa: sem tela cheia.' }) : tvPreview({ layout: 'full', missing: { ...v, mode: 'full' } }));
    put(pvBanner, show.value === 'full' ? el('p', { class: 'r-dim', text: 'Só a tela cheia: sem faixa.' }) : tvPreview({ layout: ['ticker', 'lbar', 'side', 'full'].includes(lay) ? lay : 'ticker', ticker: [], side: { title: S.state.office.name, widgets: ['clock'] }, missing: { ...v, mode: 'banner' } }));
  }
  const rowInfo = el('div', { class: 'r-row' }, field('Cabeçalho da cartela', infoHeader), field('Nº do mandado de prisão (só em "Procurado pela Justiça")', warrantNo));
  const lastSeenField = field('Visto(a) por último', lastSeen); const authLegend = el('legend', {}); const reportField = el('span', {}); const authField = el('span', {});
  const relationField = field('Vínculo', authRelation); const authCheck = check('A família ou a autoridade policial autorizou a divulgação da foto e dos dados', authOk);
  const fixedNote = el('p', { class: 'r-dim' });
  /** A cartela policial troca os campos: o cabeçalho de uma lista fechada, o procedimento e a matrícula; sem idade nem data. */
  const paintKind = () => {
    const info = isInfo();
    rowInfo.hidden = !info; lastSeenField.hidden = info; relationField.hidden = info; authCheck.hidden = info;
    age.closest('label').hidden = info; since.closest('label').hidden = info;
    authLegend.textContent = info ? 'Registro do procedimento (fica só no registro, nunca vai às telas)' : 'Autorização da divulgação (fica só no registro, nunca vai às telas)';
    reportField.textContent = info ? 'Nº do procedimento (inquérito ou mandado)' : 'Nº do registro de ocorrência';
    authField.textContent = info ? 'Sua identificação funcional (matrícula)' : 'Quem autorizou (nome)';
    warrantNo.disabled = !(info && headOf().warrant);
    fixedNote.hidden = !info;
    fixedNote.textContent = info ? `${headOf().fixed ? `A tela mostra, fixo e sem edição: "${headOf().fixed}" ` : ''}A cartela policial fica no máximo ${INFO_DAYS_MAX} dias e sempre espera a aprovação do CCO.` : '';
    days.max = String(info ? INFO_DAYS_MAX : L.daysMax); if (info && Number(days.value) > INFO_DAYS_MAX) days.value = String(INFO_DAYS_MAX);
    if (info && (!contact.value.trim() || contact.value === MISSING_CONTACT)) contact.value = INFO_CONTACT;
    if (!info && contact.value === INFO_CONTACT) contact.value = MISSING_CONTACT;
    submit.textContent = editing ? 'Salvar o caso' : external && (info || !S.state.direct) ? 'Enviar para a aprovação do CCO' : 'Pôr no ar';
  };
  for (const n of [kind, infoHeader]) n.addEventListener('input', () => { paintKind(); repaint(); });
  for (const n of [kind, name, age, since, lastSeen, description, contact, show]) n.addEventListener('input', repaint);
  file.addEventListener('change', act(async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > L.uploadBytes) { file.value = ''; throw new Error('A foto passa de 5 MB. Escolha outra.'); }
    photoNote.textContent = 'Enviando a foto…';
    try {
      const [src, r] = await Promise.all([readFile(f), api('/missing/photo', { method: 'POST', file: f })]);
      photo = { token: r.photo, src };
      photoNote.textContent = `Foto pronta (${Math.round(r.bytes / 1024)} KB, sem os dados escondidos). Confira na prévia se o rosto aparece inteiro.`;
    } catch (x) { photo = editing && thumbs.get(editing.id) ? { token: null, src: thumbs.get(editing.id) } : null; file.value = ''; photoNote.textContent = 'A foto não foi aceita. Escolha outra (JPEG, PNG ou WebP até 5 MB).'; throw x; } finally { repaint(); }
  }));
  function open(m) {
    editing = m;
    formTitle.textContent = m ? `Editar o caso: ${m.name || m.header}` : 'Novo caso'; cancel.hidden = !m;
    kind.value = m?.kind || 'crianca'; kind.disabled = Boolean(m);
    infoHeader.value = INFO_HEADERS.find((h) => h.label === m?.header)?.key || INFO_HEADERS[0].key; warrantNo.value = m?.warrantNo || ''; name.value = m?.name || ''; age.value = m?.age ?? ''; since.value = m?.since || ''; lastSeen.value = m?.lastSeen || ''; description.value = m?.description || '';
    contact.value = m?.contact || MISSING_CONTACT; reportNo.value = m?.reportNo || ''; authName.value = m?.authName || ''; authRelation.value = m?.authRelation || ''; authOk.checked = Boolean(m);
    show.value = m?.show || 'both'; everyMin.value = m?.everyMin || L.everyMin; fullSec.value = m?.fullSec || L.fullSec; bannerSec.value = m?.bannerSec || L.bannerSec;
    days.value = m ? Math.max(1, Math.min(L.daysMax, Math.ceil((m.until - now()) / 86400000))) : L.days;
    qrMode.value = m?.qr?.mode || 'default'; qrValue.value = ''; qrLabel.value = m?.qr?.label && m.qr.label !== QR_LABEL_DEFAULT ? m.qr.label : '';
    if (m?.qr?.mode === 'custom' && m.qr.data) { const d = m.qr.data; qrKind.value = d.startsWith('https://wa.me/') ? 'whatsapp' : d.startsWith('tel:') ? 'tel' : d.startsWith('sms:') ? 'sms' : 'url'; qrValue.value = qrKind.value === 'url' ? d : d.replace(/^https:\/\/wa\.me\/|^(tel|sms):\+/, ''); }
    paintQr();
    file.value = ''; photo = m && thumbs.get(m.id) ? { token: null, src: thumbs.get(m.id) } : null;
    scope.reset(); paintKind(); repaint();
    if (m) formTitle.scrollIntoView({ block: 'nearest' });
  }
  cancel.addEventListener('click', () => open(null));
  const save = act(async () => {
    const v = values();
    const info = isInfo();
    if (!info && v.name.length < 2) { name.focus(); throw new Error('Escreva o nome da pessoa.'); }
    if (reportNo.value.trim().length < 3) { reportNo.focus(); throw new Error(info ? 'Informe o número do procedimento (inquérito ou mandado).' : 'Informe o número do registro de ocorrência.'); }
    if (info && authName.value.trim().length < 3) { authName.focus(); throw new Error('Informe a sua identificação funcional (matrícula).'); }
    if (info && headOf().warrant && !warrantNo.value.trim()) { warrantNo.focus(); throw new Error('"Procurado pela Justiça" exige o número do mandado de prisão.'); }
    if (!info && (authName.value.trim().length < 2 || !authRelation.value)) throw new Error('Diga quem autorizou a divulgação: o nome e se é familiar ou autoridade policial.');
    if (!info && !authOk.checked) throw new Error('Marque a confirmação: a família ou a autoridade policial autorizou a divulgação da foto e dos dados.');
    if (!scope.ready()) throw new Error('Escolha para onde o caso vai.');
    const r = scope.reach(); const n = r ? r.total : 0;
    const body = { kind: v.kind, name: info ? name.value.trim() : v.name, age: v.age, since: v.since, lastSeen: v.lastSeen, description: v.description, contact: v.contact, reportNo: reportNo.value.trim(), authName: authName.value.trim(), authRelation: info ? 'autoridade' : authRelation.value, authOk: true,
      ...(info ? { infoHeader: infoHeader.value, warrantNo: warrantNo.value.trim() } : {}),
      show: show.value, everyMin: Number(everyMin.value), fullSec: Number(fullSec.value), bannerSec: Number(bannerSec.value), days: Number(days.value), ...(photo?.token ? { photo: photo.token } : {}),
      qr: qrMode.value === 'custom' ? { mode: 'custom', kind: qrKind.value, value: qrValue.value, label: qrLabel.value } : { mode: qrMode.value } };
    if (qrMode.value === 'custom' && !qrDataOf(qrKind.value, qrValue.value)) { qrValue.focus(); throw new Error('QR code deste caso: confira o número (só dígitos, com o código do país) ou o endereço (https://).'); }
    // na edição, o alcance só muda se a pessoa mexeu nele (o guardado fica)
    if (!editing || scope.touched()) body.scope = scope.get();
    if (!editing) {
      const box = el('div', {}, show.value === 'banner' ? null : tvPreview({ layout: 'full', missing: { ...v, mode: 'full' } }), show.value === 'full' ? null : tvPreview({ layout: 'ticker', ticker: [], missing: { ...v, mode: 'banner' } }),
        el('p', { class: 'r-dlg-reach' }, el('b', { text: `Vai para ${scope.text()}.` }), ` ${r ? `${r.total} ${r.total === 1 ? 'tela recebe' : 'telas recebem'} em ${r.offices} ${r.offices === 1 ? 'repartição' : 'repartições'}.` : ''}`),
        el('p', { class: 'r-dim', text: `A cada ${everyMin.value} minutos, por ${days.value} dia(s)${photo ? '' : '. SEM FOTO: a tela mostra uma silhueta'}. Encerre assim que a pessoa for localizada.` }));
      const waits = external && (info || !S.state.direct);
      if (!(await confirmDialog({ title: waits ? 'Conferir antes de enviar ao CCO' : 'Conferir antes de pôr no ar', body: box, okLabel: waits ? 'Enviar para a aprovação' : `Pôr no ar em ${n} ${n === 1 ? 'tela' : 'telas'}` }))) return;
    }
    const saved = editing ? await api(`/missing/${editing.id}`, { method: 'PATCH', body }) : await api('/missing', { method: 'POST', body });
    if (photo?.src) thumbs.set(saved.id, photo.src);
    ok(saved.pending ? 'Enviado para a aprovação da Segurança (CCO): só vai às telas depois de aprovado.' : editing ? 'Caso salvo. As telas trocam em até 30 segundos.' : `Caso no ar: ${saved.reach?.total ?? n} tela(s). Encerre assim que a pessoa for localizada.`);
    open(null); await load();
  });
  const close = (m, reason) => act(async () => {
    const msg = reason === 'localizado' ? `"${m.name}" foi localizado(a)? O caso sai das telas agora e a foto é apagada.` : `Encerrar o caso de "${m.name}"? Ele sai das telas agora e a foto é apagada.`;
    if (!confirm(msg)) return;
    await api(`/missing/${m.id}/close`, { method: 'POST', body: { reason } });
    thumbs.delete(m.id); if (editing?.id === m.id) open(null);
    ok(reason === 'localizado' ? 'Caso encerrado: pessoa localizada. As telas tiram em até 30 segundos e a foto foi apagada.' : 'Caso encerrado. As telas tiram em até 30 segundos e a foto foi apagada.');
    await load();
  });
  function paint() {
    if (!data) return;
    ctx.badge('desaparecidos', data.active.length);
    limitNote.textContent = `${data.active.length} de ${L.active} casos no ar.${data.active.length >= L.active ? ' É o máximo: encerre um caso antes de cadastrar outro.' : ''}`;
    put(list, data.active.length ? data.active.map((m) => {
      const img = thumbs.get(m.id) ? el('img', { class: 'r-thumb', alt: `Foto de ${m.name}`, src: thumbs.get(m.id) }) : el('div', { class: 'r-thumb none', role: 'img', 'aria-label': 'Sem foto' });
      return el('article', { class: 'r-req' },
        el('div', { class: 'r-case' }, img, el('div', {},
          el('div', { class: 'r-req-head' }, el('span', { class: 'r-tag live', text: 'no ar' }), el('b', { text: `${m.header ? `${m.header}${m.name ? ': ' : ''}` : ''}${m.name}${m.age != null ? `, ${m.age} ${m.age === 1 ? 'ano' : 'anos'}` : ''}` })),
          el('p', { class: 'r-dev-line', text: `${m.reach ? `${m.reach.total} tela(s) em ${m.reach.offices} repartição(ões)` : ''} · termina em ${left(m.until - now())} · a cada ${m.everyMin} min · ${MISSING_SHOWS.find((s) => s.key === m.show)?.label || m.show}` }),
          el('p', { class: 'r-dim', text: `Registro ${m.reportNo} · autorizado por ${m.authName} (${MISSING_RELATIONS.find((r) => r.key === m.authRelation)?.label || m.authRelation}) · por ${m.createdBy} em ${hhmm(m.createdAt)}${m.hasPhoto ? '' : ' · SEM FOTO'}` }))),
        el('div', { class: 'r-btns' },
          el('button', { type: 'button', class: 'r-btn primary', onclick: close(m, 'localizado') }, 'Localizado'),
          el('button', { type: 'button', class: 'r-btn', onclick: close(m, 'encerrado') }, 'Encerrar'),
          el('button', { type: 'button', class: 'r-btn', onclick: () => open(m) }, 'Editar ou renovar')));
    }) : el('p', { class: 'r-dim', text: 'Nenhum caso no ar.' }));
    put(waitList, (data.pending || []).map((m) => el('li', {}, el('span', { class: 'r-tag live', text: 'aguardando o CCO' }),
      el('span', {}, el('b', { text: m.header ? `${m.header}${m.name ? `: ${m.name}` : ''}` : m.name }), el('small', { text: `enviado em ${hhmm(m.createdAt)} por ${m.createdBy} · procedimento ou registro ${m.reportNo}` })),
      external ? el('button', { type: 'button', class: 'r-btn small', onclick: close(m, 'encerrado') }, 'Retirar') : null)));
    waitBox.hidden = !(data.pending || []).length;
    put(closed, data.closed.slice(0, 20).map((m) => el('li', {}, el('span', { class: 'r-tag', text: m.status === 'rejected' ? 'devolvido' : MISSING_CLOSE.find((c) => c.key === m.closeReason)?.label || 'encerrado' }),
      el('span', {}, el('b', { text: m.name || m.header || 'Caso' }), el('small', { text: `registro ${m.reportNo} · encerrado em ${hhmm(m.closedAt)}${m.closedBy ? ` por ${m.closedBy}` : ''} · a foto foi apagada` })))));
  }
  async function load() {
    data = await api('/missing');
    paint(); if (!qrLoaded) { qrLoaded = true; fillDef(); } else paintQr();
    for (const m of data.active) if (m.hasPhoto && !thumbs.has(m.id)) apiImage(`/missing/${m.id}/photo`).then((src) => { thumbs.set(m.id, src); paint(); }, () => {});
  }
  const node = el('div', {},
    el('p', { class: 'r-banner', role: 'note', text: 'Só divulgue com a autorização da família ou da autoridade policial e com o registro de ocorrência feito. Encerre o caso assim que a pessoa for localizada: a foto é apagada na hora.' }),
    cols(
      [waitBox, card('Casos no ar', limitNote, list),
        el('section', { class: 'r-card', 'aria-labelledby': 'hCaso' }, Object.assign(formTitle, { id: 'hCaso' }),
          el('form', { novalidate: true, onsubmit: save },
            field('Foto', file), photoNote,
            el('div', { class: 'r-row three' }, field('Quem é', kind), field('Idade', age), field('Desaparecido(a) desde', since)),
            rowInfo, fixedNote,
            field('Nome', name), lastSeenField, field('Descrição (roupa, sinais) ou o texto da cartela', description),
            field('Contato que aparece na tela', contact),
            el('fieldset', { class: 'r-fs' }, authLegend,
              el('div', { class: 'r-row three' }, el('label', { class: 'r-field' }, reportField, reportNo), el('label', { class: 'r-field' }, authField, authName), relationField),
              authCheck),
            el('h3', { text: 'Como mostrar' }),
            el('div', { class: 'r-row' }, field('Na tela', show), field('A cada quantos minutos', everyMin)),
            el('div', { class: 'r-row three' }, field('Segundos em tela cheia', fullSec), field('Segundos da faixa', bannerSec), field(`Fica no ar por (dias, até ${L.daysMax})`, days)),
            el('h3', { text: 'QR code de contato' }), field('QR code neste caso', qrMode), qrCustom, qrNote,
            scope.controls,
            el('div', { class: 'r-btns' }, submit, cancel))),
        card('Contato imediato por QR code',
          el('p', { class: 'r-dim', text: 'O QR code aparece no card do caso, ao lado do contato: a pessoa aponta a câmera do celular e fala na hora. Vale para os casos cadastrados por esta repartição.' }),
          el('form', { novalidate: true, onsubmit: saveDef },
            el('div', { class: 'r-row' }, field('O QR code leva para', defKind), el('label', { class: 'r-field' }, el('span', { text: 'Número ou endereço' }), defValue, defHint)),
            field('Frase ao lado do QR code (até 40 letras)', defLabel), defPv, defNote,
            el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar o contato do QR code'))))],
      [scope.mapCard, card('Como aparece na TV: tela cheia', pvFull), card('Como aparece na TV: faixa', pvBanner), card('Encerrados (90 dias)', closed)]));
  paintKind(); repaint();
  load().catch(() => {});
  return { node, show: () => { scope.show(); load().catch(() => {}); }, refresh: () => { if (!editing) load().catch(() => {}); } };
}
