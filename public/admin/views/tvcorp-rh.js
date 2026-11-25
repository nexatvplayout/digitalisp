// TV Corporativa · aba RH (docs/TV-CORPORATIVA.md §2.4 e §7.2): os aniversariantes (só nome e dia/mês, sem o ano; foto só
// com o consentimento marcado), as admissões e o tempo de casa, e os comunicados por categoria com o "Li" e quem leu.
// Rotas: /api/tvcorp/people[/:id] (+ /import CSV, /export, /:id/photo), /api/tvcorp/posts[/:id] (+ /:id/acks).
import {
  el, guard, toast, tapi, tupload, tdownload, tblob, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, listOf,
  scopePicker, scopeText, statusChip, dayText, when, isoDay,
} from './tvcorp-base.js';
import { itemPreview } from '../../shared/tvcorp-previa.js';
import { POST_CATEGORIES, postCategoryLabel, LIMITS, shortName } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';

const V = { sec: 'aniversariantes', q: '', office: '' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const officeName = (id) => (id == null ? 'Empresa toda' : D().offices.find((o) => o.id === id)?.name || '—');
const pad = (n) => String(n).padStart(2, '0');
/** Anos completos de casa na data de hoje. */
export function yearsOfHouse(hire, nowMs = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hire || '')); if (!m) return null;
  const d = new Date(nowMs); let y = d.getFullYear() - Number(m[1]);
  if (d.getMonth() + 1 < Number(m[2]) || (d.getMonth() + 1 === Number(m[2]) && d.getDate() < Number(m[3]))) y--;
  return Math.max(0, y);
}
/** O aniversário da pessoa como o servidor manda ({ day, month }) em dois campos. */
const bdOf = (p) => ({ bdayDay: p?.birthday?.day ?? p?.bdayDay ?? null, bdayMonth: p?.birthday?.month ?? p?.bdayMonth ?? null });
const withBd = (list) => list.map((p) => ({ ...p, ...bdOf(p), hasPhoto: p.hasPhoto ?? p.photo }));
/** Data local (AAAA-MM-DD) <-> epoch ms do início do dia (a validade do comunicado é guardada em ms). */
const dayMs = (iso, end = false) => (iso ? new Date(`${iso}T${end ? '23:59:00' : '00:00:00'}`).getTime() : null);
const msDay = (ms) => (ms ? isoDay(0, ms) : '');
const houseText = (hire) => { const y = yearsOfHouse(hire); return y == null ? '—' : y === 0 ? 'chegou este ano' : `${y} ${y === 1 ? 'ano' : 'anos'} de casa`; };

/* ------------------------------------------------------------------ pessoas */
function editPerson(p, reload) {
  const name = el('input', { type: 'text', maxlength: String(LIMITS.personName), value: p?.name || '' });
  const sector = el('input', { type: 'text', maxlength: String(LIMITS.personSector), value: p?.sector || '' });
  const office = el('select', {}, ...D().offices.map((o) => opt(o.id, o.name, p?.officeId === o.id)));
  const dd = el('select', { 'aria-label': 'Dia' }, opt('', 'dia', !p?.bdayDay), ...Array.from({ length: 31 }, (_, i) => opt(i + 1, String(i + 1), p?.bdayDay === i + 1)));
  const mm = el('select', { 'aria-label': 'Mês' }, opt('', 'mês', !p?.bdayMonth), ...MONTHS.map((m, i) => opt(i + 1, m, p?.bdayMonth === i + 1)));
  const hire = el('input', { type: 'date', value: p?.hireDate || '' });
  const consent = el('input', { type: 'checkbox', checked: Boolean(p?.photoConsent) });
  const photo = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', disabled: !p?.photoConsent });
  consent.addEventListener('change', () => { photo.disabled = !consent.checked; if (!consent.checked) photo.value = ''; });
  dialog(p ? `Pessoa · ${p.name}` : 'Nova pessoa', el('div', { class: 'pf-grid' },
    f('Nome', name, 'Na tela sai o primeiro nome e a inicial do sobrenome (ou o nome completo, se ligado em Configurações).'),
    el('div', { class: 'pf-grid two' }, f('Setor', sector), f('Unidade', office)),
    el('div', { class: 'pf-grid two' }, f('Aniversário: dia', dd), f('Mês', mm)), note('Não guardamos o ano de nascimento.'),
    f('Data de admissão (opcional)', hire, 'Usada para as boas-vindas e o tempo de casa.'),
    el('label', { class: 'pf-check' }, consent, el('span', { text: 'A pessoa autorizou a foto na TV' })),
    f('Foto (só com a autorização)', photo, 'Sem foto, a tela desenha as iniciais. Desmarcar a autorização apaga a foto na hora.')), {
    save: async () => {
      if (!name.value.trim()) throw new Error('Escreva o nome.');
      if (!office.value) throw new Error('Cadastre uma unidade antes (aba Unidades e grupos).');
      if (Boolean(dd.value) !== Boolean(mm.value)) throw new Error('Escolha o dia e o mês do aniversário (ou nenhum).');
      const body = { name: name.value.trim(), sector: sector.value.trim(), officeId: Number(office.value), birthday: dd.value ? { day: Number(dd.value), month: Number(mm.value) } : null, hireDate: hire.value || null, photoConsent: consent.checked };
      const r = p ? await tapi(`/api/tvcorp/people/${p.id}`, { method: 'PATCH', body }) : await tapi('/api/tvcorp/people', { method: 'POST', body });
      const file = photo.files?.[0];
      if (file && consent.checked) { if (file.size > 5 * 1024 * 1024) throw new Error('A foto passa de 5 MB.'); await tupload(`/api/tvcorp/people/${p?.id ?? r.id}/photo`, file, { method: 'PUT' }); }
      toast('Salvo.'); await reload();
    },
  });
}
function importCsv(reload) {
  const file = el('input', { type: 'file', accept: '.csv,text/csv' });
  dialog('Importar planilha (CSV)', el('div', { class: 'pf-grid' },
    note('Colunas: nome; setor; unidade; aniversário (dia/mês); admissão (dia/mês/ano, opcional). Se a planilha trouxer o ano de nascimento, ele é descartado. Pessoas com o mesmo nome e unidade são atualizadas.'),
    f('Arquivo CSV', file)), {
    saveLabel: 'Importar',
    save: async () => {
      const fl = file.files?.[0]; if (!fl) throw new Error('Escolha o arquivo.');
      const r = await tupload('/api/tvcorp/people/import', fl, { type: 'text/csv' });
      toast(`Importado: ${r.added ?? 0} nova(s), ${r.updated ?? 0} atualizada(s), ${r.errorCount ?? 0} linha(s) com erro.${r.errors?.length ? ` Primeira: ${typeof r.errors[0] === 'string' ? r.errors[0] : r.errors[0]?.error || ''}` : ''}`);
      await reload();
    },
  });
}
function paintPeople(box, people, again) {
  const d = new Date();
  const q = V.q.trim().toLowerCase();
  const shown = people.filter((p) => (!q || p.name.toLowerCase().includes(q) || (p.sector || '').toLowerCase().includes(q)) && (!V.office || String(p.officeId) === V.office));
  const month = people.filter((p) => p.active !== false && p.bdayMonth === d.getMonth() + 1).sort((a, b) => a.bdayDay - b.bdayDay);
  const full = Boolean(D().settings?.fullNames);
  const search = el('input', { type: 'search', placeholder: 'Buscar nome ou setor', value: V.q, 'aria-label': 'Buscar', onchange: (e) => { V.q = e.target.value; paintPeople(box, people, again); } });
  const ofc = el('select', { 'aria-label': 'Unidade', onchange: (e) => { V.office = e.target.value; paintPeople(box, people, again); } }, opt('', 'Todas as unidades', !V.office), ...D().offices.map((o) => opt(o.id, o.name, V.office === String(o.id))));
  // a prévia como na TV, com a foto de quem autorizou (a foto vem pela sessão, nunca por endereço público)
  const pessoasPrev = (fotos = {}) => month.map((p) => ({ name: full ? p.name : shortName(p.name), day: p.bdayDay, month: p.bdayMonth, sector: p.sector, photo: fotos[p.id] || null }));
  const prevBox = el('div', {}, itemPreview({ kind: 'birthdays', title: 'Aniversariantes do mês', people: pessoasPrev() }, { theme: themeOf() }));
  const comFoto = month.filter((p) => p.photoConsent && p.hasPhoto).slice(0, 8);
  if (comFoto.length) {
    Promise.all(comFoto.map((p) => tblob(`/api/tvcorp/people/${p.id}/photo`).then((u) => [p.id, u], () => [p.id, null]))).then((pares) => {
      const fotos = Object.fromEntries(pares.filter(([, u]) => u));
      if (Object.keys(fotos).length) put(prevBox, itemPreview({ kind: 'birthdays', title: 'Aniversariantes do mês', people: pessoasPrev(fotos) }, { theme: themeOf() }));
    });
  }
  put(box,
    el('div', { class: 'tc-two' },
      el('div', {}, label(`Aniversariantes de ${MONTHS[d.getMonth()]} (${month.length})`), month.length ? el('ul', { class: 'pf-plain' }, ...month.map((p) => el('li', { text: `${pad(p.bdayDay)}/${pad(p.bdayMonth)} · ${full ? p.name : shortName(p.name)}${p.sector ? ` · ${p.sector}` : ''}` }))) : empty('Ninguém faz aniversário este mês.')),
      prevBox),
    btns(btn('+ Pessoa', () => editPerson(null, again), 'primary'), btn('Importar planilha (CSV)', () => importCsv(again)), btn('Exportar (CSV)', guard(() => tdownload('/api/tvcorp/people/export', `pessoas-${isoDay()}.csv`))), search, ofc),
    shown.length ? table(['Nome', 'Setor', 'Unidade', 'Aniversário', 'Tempo de casa', 'Foto', ''], shown.map((p) => el('tr', { class: p.active === false ? 'pf-gone' : '' },
      el('td', {}, el('b', { text: p.name }), el('div', { class: 'dim small', text: `na tela: ${full ? p.name : shortName(p.name)}` })),
      el('td', { text: p.sector || '—' }), el('td', { text: officeName(p.officeId) }),
      el('td', { text: p.bdayDay ? `${pad(p.bdayDay)}/${pad(p.bdayMonth)}` : '—' }),
      el('td', { text: houseText(p.hireDate) }),
      el('td', { text: p.photoConsent ? (p.hasPhoto ? 'autorizada, com foto' : 'autorizada, sem foto') : 'sem autorização (iniciais)' }),
      el('td', { class: 'pf-actions' }, btn('Editar', () => editPerson(p, again), 'small'),
        btn(p.active === false ? 'Reativar' : 'Desligou', guard(async () => { await tapi(`/api/tvcorp/people/${p.id}`, { method: 'PATCH', body: { active: p.active === false } }); toast(p.active === false ? 'Reativada.' : 'Desligada: sai das telas na próxima atualização.'); await again(); }), 'small'),
        btn('Apagar', guard(async () => { if (!confirm(`Apagar "${p.name}" e a foto (se houver)?`)) return; await tapi(`/api/tvcorp/people/${p.id}`, { method: 'DELETE' }); await again(); }), 'small danger')))))
      : empty(people.length ? 'Ninguém com esse filtro.' : 'Nenhuma pessoa ainda. Cadastre ou importe uma planilha.'),
    note('Só nome, setor, dia e mês do aniversário e a data de admissão. Nada de ano de nascimento, documento ou contato.'));
}
function paintAdmissoes(box, people) {
  const t = Date.now(); const d = new Date(t);
  const recent = people.filter((p) => p.active !== false && p.hireDate && t - new Date(`${p.hireDate}T12:00:00`).getTime() <= 30 * 86400000 && t >= new Date(`${p.hireDate}T00:00:00`).getTime()).sort((a, b) => b.hireDate.localeCompare(a.hireDate));
  const anniv = people.filter((p) => p.active !== false && p.hireDate && Number(p.hireDate.slice(5, 7)) === d.getMonth() + 1 && yearsOfHouse(p.hireDate) >= 1);
  put(box,
    label(`Chegaram nos últimos 30 dias (${recent.length})`),
    recent.length ? table(['Nome', 'Setor', 'Unidade', 'Admissão'], recent.map((p) => el('tr', {}, el('td', { text: p.name }), el('td', { text: p.sector || '—' }), el('td', { text: officeName(p.officeId) }), el('td', { text: dayText(p.hireDate) })))) : empty('Ninguém chegou nos últimos 30 dias.'),
    note('Para as boas-vindas na TV: crie um slide "Boas-vindas" na aba Mídias e ponha numa playlist.'),
    label(`Fazem aniversário de casa em ${MONTHS[d.getMonth()]} (${anniv.length})`),
    anniv.length ? table(['Nome', 'Unidade', 'Tempo de casa'], anniv.map((p) => el('tr', {}, el('td', { text: p.name }), el('td', { text: officeName(p.officeId) }), el('td', { text: houseText(p.hireDate) })))) : empty('Ninguém este mês.'));
}

/* ------------------------------------------------------------------ comunicados */
function acksDialog(p) {
  const body = el('div', {}, note('Carregando…'));
  dialog(`Quem leu · ${p.title}`, body);
  guard(async () => {
    const r = await tapi(`/api/tvcorp/posts/${p.id}/acks`); const items = listOf(r, 'acks');
    put(body, note(`${r.total ?? items.length} confirmação(ões) de leitura. Cada pessoa digita o nome ou a matrícula no celular: nada mais é guardado.`),
      items.length ? table(['Quem', 'Quando'], items.map((a) => el('tr', {}, el('td', { text: a.who }), el('td', { text: when(a.at) })))) : empty('Ninguém confirmou ainda.'));
  })();
}
export function editPost(p, reload, media = []) {
  const cat = el('select', {}, ...POST_CATEGORIES.map((c) => opt(c.key, c.label, (p?.category || 'comunicado') === c.key)));
  const title = el('input', { type: 'text', maxlength: String(LIMITS.slideTitle), value: p?.title || '' });
  const body = el('textarea', { rows: '4', maxlength: String(LIMITS.slideText) }); body.value = p?.text ?? p?.body ?? '';
  const qr = el('input', { type: 'url', maxlength: '500', value: p?.qr || '', placeholder: 'https://… (opcional)' });
  const img = el('select', {}, opt('', 'Sem imagem', !p?.mediaId), ...media.filter((m) => m.kind === 'image').map((m) => opt(m.id, m.title, p?.mediaId === m.id)));
  const vf = el('input', { type: 'date', value: p ? msDay(p.validFrom) : isoDay() }); const vt = el('input', { type: 'date', value: msDay(p?.validTo) });
  const ack = el('input', { type: 'checkbox', checked: Boolean(p?.needsAck) });
  const scope = scopePicker(p?.scope && p.scope.kind !== 'all' ? { scope: p.scope.kind, scopeData: { [p.scope.kind]: p.scope.ids || [] } } : { scope: 'all' });
  const pv = el('div', {});
  const paint = () => put(pv, itemPreview({ kind: 'post', category: cat.value, title: title.value || 'Título do comunicado', body: body.value, qr: qr.value.startsWith('https://') ? qr.value : '' }, { theme: themeOf() }));
  for (const n of [cat, title, body, qr]) n.addEventListener('input', paint);
  paint();
  dialog(p ? `Comunicado · ${p.title}` : 'Novo comunicado', el('div', { class: 'tc-two' },
    el('div', { class: 'pf-grid' }, f('Categoria', cat), f('Título', title, `Até ${LIMITS.slideTitle} letras.`), f('Texto', body, `Até ${LIMITS.slideText} letras.`), f('QR code leva para', qr), f('Imagem', img),
      el('div', { class: 'pf-grid two' }, f('Começa em', vf), f('Termina em (opcional)', vt)),
      el('label', { class: 'pf-check' }, ack, el('span', { text: 'Pedir o "Li" (confirmação de leitura no celular)' })), scope.node),
    el('div', {}, el('div', { class: 'label', text: 'Como aparece na TV' }), pv, note('O comunicado entra nas playlists que têm o item "Comunicado" e na página do celular.'))), {
    wide: true,
    save: async () => {
      if (!title.value.trim()) throw new Error('Escreva o título.');
      if (qr.value.trim() && !/^https:\/\//.test(qr.value.trim())) throw new Error('O endereço do QR code precisa começar com https://');
      if (vt.value && vf.value && vt.value < vf.value) throw new Error('O fim vem antes do começo.');
      const sc = scope.read();
      const today = isoDay();
      const b = { category: cat.value, title: title.value.trim(), text: body.value.trim(), qr: qr.value.trim() || null, mediaId: img.value ? Number(img.value) : null, validFrom: vf.value && vf.value > today ? dayMs(vf.value) : (p ? p.validFrom ?? null : null), validTo: vt.value ? dayMs(vt.value, true) : null, needsAck: ack.checked,
        scope: sc.scope === 'all' ? { kind: 'all' } : { kind: sc.scope, ids: sc.scopeData[sc.scope] } };
      if (p) await tapi(`/api/tvcorp/posts/${p.id}`, { method: 'PATCH', body: b }); else await tapi('/api/tvcorp/posts', { method: 'POST', body: b });
      toast('Comunicado salvo.'); await reload();
    },
  });
}
function paintPosts(box, posts, media, again) {
  const live = (p) => p.situation ? p.situation === 'em vigor' : true;
  put(box,
    btns(btn('+ Novo comunicado', () => editPost(null, again, media), 'primary'), el('span', { class: 'dim small', text: `${posts.filter(live).length} em vigor` })),
    posts.length ? table(['Comunicado', 'Para onde', 'Validade', 'Li', 'Situação', ''], posts.map((p) => el('tr', { class: live(p) ? '' : 'pf-gone' },
      el('td', {}, chip(postCategoryLabel(p.category)), ' ', el('b', { text: p.title }), el('div', { class: 'dim small', text: (p.text || '').slice(0, 100) })),
      el('td', { text: scopeText(p.scope?.kind, { [p.scope?.kind]: p.scope?.ids }) }),
      el('td', { text: `${p.validFrom ? dayText(msDay(p.validFrom)) : 'já'} até ${p.validTo ? dayText(msDay(p.validTo)) : 'sem fim'}${p.situation ? ` · ${p.situation}` : ''}` }),
      el('td', {}, p.needsAck ? btn(`${p.acks ?? 0} leram`, () => acksDialog(p), 'small') : el('span', { class: 'dim small', text: 'não pede' })),
      el('td', {}, statusChip(p.status), p.reason ? el('div', { class: 'dim small', text: `motivo: ${p.reason}` }) : null, p.createdBy ? el('div', { class: 'dim small', text: `${p.createdBy}${p.via && p.via !== 'painel' ? ` (${p.via})` : ''}` }) : null),
      el('td', { class: 'pf-actions' },
        p.status === 'pending' ? btn('Aprovar', guard(async () => { await tapi(`/api/tvcorp/posts/${p.id}/decide`, { method: 'POST', body: { approve: true } }); toast('Aprovado.'); await again(); }), 'small primary') : null,
        p.status === 'pending' ? btn('Devolver', guard(async () => { const reason = prompt('Motivo (quem enviou vê):', ''); if (reason === null) return; await tapi(`/api/tvcorp/posts/${p.id}/decide`, { method: 'POST', body: { approve: false, reason } }); await again(); }), 'small') : null,
        btn('Editar', () => editPost(p, again, media), 'small'),
        btn('Apagar', guard(async () => { if (!confirm(`Apagar o comunicado "${p.title}"?`)) return; await tapi(`/api/tvcorp/posts/${p.id}`, { method: 'DELETE' }); await again(); }), 'small danger')))))
      : empty('Nenhum comunicado ainda.'));
}

export default async function paintRh(box, ctx) {
  const get = (p, key) => tapi(p).then((r) => listOf(r, key));
  const [people0, posts, media] = await Promise.all([get('/api/tvcorp/people?limit=500', 'people'), get('/api/tvcorp/posts', 'posts'), get('/api/tvcorp/media', 'media').catch(() => [])]);
  const people = withBd(people0);
  const again = async () => { await paintRh(box, ctx); ctx.refreshBadge(); };
  const sec = el('div', {});
  const seg = (id, text) => el('button', { class: `btn small${V.sec === id ? ' primary' : ''}`, type: 'button', 'aria-pressed': String(V.sec === id), onclick: () => { V.sec = id; paintRh(box, ctx); } }, text);
  put(box, el('div', { class: 'pf-btns left tc-seg' }, seg('aniversariantes', `Aniversariantes (${people.filter((p) => p.active !== false).length})`), seg('admissoes', 'Admissões e tempo de casa'), seg('comunicados', `Comunicados (${posts.length})`)), sec);
  if (V.sec === 'comunicados') paintPosts(sec, posts, media, again);
  else if (V.sec === 'admissoes') paintAdmissoes(sec, people);
  else paintPeople(sec, people, again);
}
