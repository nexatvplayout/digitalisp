// NEXA Telas · página de controle da repartição · unidade corporativa, família F11 (server/tvcorp-dados.js,
// docs/TV-CORPORATIVA.md §5.1 e §6). Só o gestor da unidade. As abas que o coordenador registra em reparticao.js:
//   publicar         escrever um comunicado para as telas DESTA unidade (com "Li" opcional, QR e validade); com a aprovação
//                    ligada na empresa, vai para a fila e só aparece depois de aprovado
//   comunicados      os comunicados da unidade: situação, quem leu, encerrar ou apagar
//   aniversariantes  as pessoas da unidade (só dia e mês do aniversário; admissão para o tempo de casa), importar planilha
// As telas da unidade continuam na aba Telas de sempre (rep-telas.js). Nada de HTML em texto, nenhum estilo pelo script.
import { el, put, api, act, ok, card, cols, field, option, check, hhmm } from '/reparticao/rep-base.js';

let data = null;
const listeners = new Set();
async function load() { data = await api('/tvcorp'); for (const f of listeners) f(); return data; }
export function stop() { listeners.clear(); data = null; }
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

/* ------------------------------------------------------------------ Publicar */
export function publicar(ctx) {
  const category = el('select', {});
  const title = el('input', { type: 'text', maxlength: '60', required: true, autocomplete: 'off', placeholder: 'Ex.: Reunião geral na sexta' });
  const text = el('textarea', { maxlength: '280', rows: '4', placeholder: 'Até 280 letras e 8 linhas.' });
  const qr = el('input', { type: 'url', maxlength: '500', placeholder: 'https://… (opcional: vira um QR na tela)' });
  const until = el('input', { type: 'datetime-local' });
  const ack = el('input', { type: 'checkbox' });
  const note = el('p', { class: 'r-dim' });
  function paint() {
    if (!data) return;
    if (!category.options.length) put(category, Object.entries(data.categories).map(([k, v]) => option(k, v, k === 'comunicado')));
    note.textContent = data.approval
      ? 'A empresa revisa antes: o comunicado vai para a aprovação e só aparece nas telas depois de aprovado.'
      : 'O comunicado aparece nas telas desta unidade e na página do celular dela.';
  }
  listeners.add(paint);
  const form = el('form', { class: 'r-form', onsubmit: act(async () => {
    const r = await api('/tvcorp/posts', { method: 'POST', body: { category: category.value, title: title.value, text: text.value, qr: qr.value || null, needsAck: ack.checked, validTo: fromLocalInput(until.value) } });
    title.value = ''; text.value = ''; qr.value = ''; until.value = ''; ack.checked = false;
    await load(); ctx.refresh?.();
    return r;
  }, (r) => (r?.status === 'pending' ? 'Enviado para a aprovação da empresa.' : 'Publicado nas telas da unidade.')) },
  field('Categoria', category), field('Título', title), field('Texto', text), field('Endereço do QR', qr, 'Só endereços https://.'),
  field('Vale até', until, 'Vazio: até alguém encerrar.'), check('Pedir "Li" (a pessoa confirma pelo celular)', ack),
  el('button', { type: 'submit', class: 'r-btn primary' }, 'Publicar'));
  const node = cols([card('Publicar um comunicado', note, form)], card('Como funciona', el('p', { class: 'r-dim', text: 'O comunicado sai nas telas desta unidade (na playlist que a empresa montou) e na página do celular da unidade. Para avisos urgentes de evacuação, use a aba Alertas.' })));
  load().then(paint).catch(() => {});
  return { node, show: () => load().catch(() => {}), refresh: () => load().catch(() => {}) };
}

/* ------------------------------------------------------------------ Comunicados */
export function comunicados(ctx) {
  const box = el('div', { class: 'r-reqs' });
  const reads = el('div', {});
  const run = (fn, msg) => act(async () => { await fn(); await load(); }, msg);
  function paint() {
    if (!data) return;
    ctx.badge?.('comunicados', data.posts.filter((p) => p.status === 'pending').length);
    put(box, data.posts.length ? data.posts.map((p) => el('article', { class: 'r-req' },
      el('b', { text: `${p.categoryLabel} · ${p.title}` }),
      p.text ? el('p', { text: p.text }) : null,
      el('small', { class: 'r-dim', text: `${p.situation}${p.reason ? ` (motivo: ${p.reason})` : ''} · ${hhmm(p.createdAt)}${p.validTo ? ` · até ${hhmm(p.validTo)}` : ''}${p.needsAck ? ` · ${p.acks} leitura(s)` : ''}` }),
      el('div', { class: 'r-row' },
        p.needsAck ? el('button', { type: 'button', class: 'r-btn small', onclick: act(async () => {
          const r = await api(`/tvcorp/posts/${p.id}/acks`);
          put(reads, card(`Quem leu: ${p.title}`, r.acks.length ? el('ul', { class: 'r-list' }, r.acks.map((a) => el('li', {}, el('span', { text: a.who }), el('small', { class: 'r-dim', text: hhmm(a.at) })))) : el('p', { class: 'r-dim', text: 'Ninguém marcou Li ainda.' })));
        }) }, 'Quem leu') : null,
        p.status === 'ok' && (!p.validTo || p.validTo > Date.now()) ? el('button', { type: 'button', class: 'r-btn small', onclick: run(async () => { await api(`/tvcorp/posts/${p.id}`, { method: 'PATCH', body: { validTo: Date.now() + 60_000 } }); }, 'Encerrado: sai das telas em até 1 minuto.') }, 'Encerrar') : null,
        el('button', { type: 'button', class: 'r-btn small danger', onclick: run(async () => { if (!confirm(`Apagar "${p.title}"? As leituras também saem.`)) throw new Error('Cancelado.'); await api(`/tvcorp/posts/${p.id}`, { method: 'DELETE' }); }, 'Apagado.') }, 'Apagar'))))
      : el('p', { class: 'r-dim', text: 'Nenhum comunicado desta unidade.' }));
  }
  listeners.add(paint);
  const node = cols([card('Comunicados da unidade', box)], reads);
  load().then(paint).catch(() => {});
  return { node, show: () => load().catch(() => {}), refresh: () => load().catch(() => {}) };
}

/* ------------------------------------------------------------------ Aniversariantes */
export function aniversariantes() {
  const week = el('ul', { class: 'r-list' });
  const list = el('ul', { class: 'r-list' });
  const name = el('input', { type: 'text', maxlength: '60', required: true, autocomplete: 'off' });
  const birthday = el('input', { type: 'text', maxlength: '5', placeholder: 'dd/mm', inputmode: 'numeric', autocomplete: 'off' });
  const sector = el('input', { type: 'text', maxlength: '40', autocomplete: 'off' });
  const hire = el('input', { type: 'date' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv' });
  const report = el('p', { class: 'r-dim', hidden: true });
  const run = (fn, msg) => act(async () => { await fn(); await load(); }, msg);
  const dm = (b) => (b ? `${pad(b.day)}/${pad(b.month)}` : 'sem aniversário');
  function paint() {
    if (!data) return;
    put(week, data.birthdaysWeek.length ? data.birthdaysWeek.map((p) => el('li', {}, el('b', { text: p.display }), el('small', { class: 'r-dim', text: `${dm(p.birthday)}${p.sector ? ` · ${p.sector}` : ''}` })))
      : el('li', { class: 'r-dim', text: 'Ninguém da unidade faz aniversário nesta semana.' }));
    put(list, data.people.length ? data.people.map((p) => el('li', {},
      el('span', {}, el('b', { text: p.name }), el('small', { class: 'r-dim', text: ` ${dm(p.birthday)}${p.sector ? ` · ${p.sector}` : ''}${p.hireDate ? ` · admissão ${p.hireDate.split('-').reverse().join('/')}` : ''}${p.active ? '' : ' · desligada (não aparece)'}` })),
      el('span', { class: 'r-row' },
        el('button', { type: 'button', class: 'r-btn small', onclick: run(async () => { await api(`/tvcorp/people/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); }, p.active ? 'Não aparece mais nas telas.' : 'Volta às telas.') }, p.active ? 'Desligar' : 'Religar'),
        el('button', { type: 'button', class: 'r-btn small danger', onclick: run(async () => { if (!confirm(`Apagar ${p.name}?`)) throw new Error('Cancelado.'); await api(`/tvcorp/people/${p.id}`, { method: 'DELETE' }); }, 'Apagado.') }, 'Apagar'))))
      : el('li', { class: 'r-dim', text: 'Nenhuma pessoa cadastrada nesta unidade.' }));
  }
  listeners.add(paint);
  const add = el('form', { class: 'r-form', onsubmit: run(async () => {
    await api('/tvcorp/people', { method: 'POST', body: { name: name.value, birthday: birthday.value, sector: sector.value, hireDate: hire.value || null } });
    name.value = ''; birthday.value = ''; sector.value = ''; hire.value = '';
  }, 'Pessoa cadastrada.') },
  field('Nome', name), field('Aniversário (dia/mês)', birthday, 'Só o dia e o mês: o ano não é guardado.'), field('Setor', sector), field('Admissão', hire, 'Opcional: para o tempo de casa e as boas-vindas.'),
  el('button', { type: 'submit', class: 'r-btn primary' }, 'Cadastrar'));
  const imp = el('form', { class: 'r-form', onsubmit: run(async () => {
    const f = file.files?.[0];
    if (!f) throw new Error('Escolha a planilha (CSV).');
    if (f.size > 4 * 1024 * 1024) throw new Error('A planilha passa de 4 MB.');
    const r = await api('/tvcorp/people/import', { method: 'POST', body: { csv: await f.text() } });
    report.hidden = false;
    report.textContent = `${r.added} nova(s), ${r.updated} atualizada(s)${r.errorCount ? `, ${r.errorCount} linha(s) com erro: ${r.errors.slice(0, 5).map((e) => `linha ${e.line}: ${e.error}`).join('; ')}` : ''}.`;
    file.value = '';
  }, 'Planilha importada.') },
  el('p', { class: 'r-dim', text: 'Colunas: Nome; Aniversário (dia/mês); Setor; Admissão. Se a planilha tiver o ano de nascimento, ele é descartado.' }),
  field('Planilha (CSV)', file), el('button', { type: 'submit', class: 'r-btn' }, 'Importar'), report);
  const node = cols([card('Aniversariantes da semana', week), card('Pessoas da unidade', list)], [card('Cadastrar uma pessoa', add), card('Importar planilha', imp),
    card('Privacidade', el('p', { class: 'r-dim', text: 'Nas telas aparece o primeiro nome e a inicial do sobrenome (a empresa pode escolher o nome completo). Fotos só pelo painel da empresa e só com a autorização da pessoa.' }))]);
  load().then(paint).catch(() => {});
  return { node, show: () => load().catch(() => {}), refresh: () => load().catch(() => {}) };
}

/** A data local num campo datetime-local (exportada para o painel reaproveitar). */
export { toLocalInput };
