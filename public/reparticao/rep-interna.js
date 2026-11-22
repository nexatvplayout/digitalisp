// NEXA Telas · página de controle da repartição · comunicação interna (server/telas-interna.js, docs/TELAS.md §25).
//   Códigos de emergência (qualquer papel): um toque dispara (com o local), a lista do que está em vigor com Encerrar e o
//   log de quem disparou e encerrou. Vai SÓ às telas internas e aos celulares da equipe; as telas do público não mostram nada.
//   Comunicação interna (o gestor): os setores e os endereços do celular (leitura com "Li" e disparo), os avisos internos com
//   quem leu e quem falta, as telas internas e a lista de códigos. Nada de dado de paciente em campo nenhum.
import { qrSvg } from '/shared/telas-previa.js';
import { CODE_COLORS, codeColorKey } from '/shared/telas-tipos.js';
import { el, put, api, act, ok, card, cols, field, option, check, hhmm, hour } from '/reparticao/rep-base.js';

let codesTimer = null;
export function stop() { clearInterval(codesTimer); codesTimer = null; }

// a cor do código pela classe da paleta (cc-<chave>): nenhum estilo pelo script, a CSP da página não aceita inline
const paintColor = (node, color) => { node.classList.add(`cc-${codeColorKey(color)}`); return node; };

/* ------------------------------------------------------------------ Códigos de emergência */
export function codigos(ctx) {
  let data = null;
  const place = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: Observação, leito 4', autocomplete: 'off' });
  const grid = el('div', { class: 'r-codes' });
  const active = el('div', { class: 'r-reqs' });
  const log = el('ul', { class: 'r-list' });
  const run = (fn, msg) => act(async () => { await fn(); await load(); }, msg);
  function paint() {
    ctx.badge('codigos', data.active.length);
    put(grid, data.catalog.map((c) => paintColor(el('button', { type: 'button', class: 'r-code-btn', title: c.meaning, onclick: run(async () => {
      const where = place.value.trim();
      if (!confirm(`Disparar ${c.label}${where ? ` em ${where}` : ''}? Vai às telas internas e aos celulares da equipe.`)) return;
      await api('/codes', { method: 'POST', body: { code: c.key, place: where } });
      ok(`${c.label} disparado.`);
    }) }, el('b', { text: c.label }), el('small', { text: c.meaning })), c.color)));
    put(active, data.active.length ? data.active.map((c) => paintColor(el('article', { class: 'r-code-on' },
      el('b', { text: `${c.label.toUpperCase()}${c.place ? ` · ${c.place}` : ''}` }),
      el('small', { text: `${c.meaning ? `${c.meaning} · ` : ''}disparado às ${hour(c.firedAt)}${c.until ? ` · sai sozinho às ${hour(c.until)}` : ' · até alguém encerrar'}` }),
      el('button', { type: 'button', class: 'r-btn', onclick: run(async () => { if (!confirm(`Encerrar ${c.label}?`)) return; await api(`/codes/${c.id}/close`, { method: 'POST', body: {} }); ok('Código encerrado. Sai das telas na hora.'); }) }, 'Encerrar')), c.color))
      : el('p', { class: 'r-dim', text: 'Nenhum código em vigor.' }));
    put(log, data.log.slice(0, 40).map((c) => el('li', {}, el('span', { class: `r-tag${c.active ? ' live' : ''}`, text: c.active ? 'em vigor' : 'encerrado' }),
      el('span', {}, el('b', { text: `${c.label}${c.place ? ` · ${c.place}` : ''} · ${hhmm(c.firedAt)}` }),
        el('small', { text: `disparado por ${c.firedBy.replace(/^repartição: /, '')}${c.via === 'celular' ? '' : ' (painel)'}${c.closedAt ? ` · encerrado às ${hour(c.closedAt)} por ${(c.closedBy || '').replace(/^repartição: /, '')}` : ''}` })))));
  }
  async function load() { data = await api('/codes'); paint(); }
  const node = cols(
    [card('Disparar um código', el('p', { class: 'r-dim', text: 'Um toque e a confirmação. O código aparece em tela cheia, com som, nas telas internas (posto de enfermagem, repouso, copa) e nos celulares da equipe com a página do setor aberta. As telas do público não mostram nada. Nunca escreva o nome de paciente.' }),
      field('Local (setor, sala, leito)', place), grid),
    card('Em vigor', active)],
    card('Log (quem disparou e quem encerrou)', log));
  load().catch(() => {});
  clearInterval(codesTimer);
  codesTimer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5000);
  return { node, show: () => load().catch(() => {}), refresh: () => load().catch(() => {}) };
}

/* ------------------------------------------------------------------ Comunicação interna (o gestor) */
export function interna(ctx) {
  let data = null;
  const sectorsBox = el('div', {}); const noticesBox = el('div', { class: 'r-reqs' }); const devicesBox = el('ul', { class: 'r-list' }); const codesBox = el('div', {});
  const shown = el('div', { class: 'r-linkbox', hidden: true }); // o endereço recém-gerado (aparece uma vez)
  const run = (fn, msg) => act(async () => { await fn(); await load(); }, msg);

  function showLink(s, r) {
    const svg = qrSvg(r.url, 'r-qr');
    put(shown, el('h3', { text: `${r.kind === 'fire' ? 'Endereço de disparo' : 'Endereço de leitura'} · ${s.name}` }),
      el('p', { class: 'r-dim', text: r.kind === 'fire' ? 'Quem tem este endereço também DISPARA e ENCERRA códigos. Entregue só a quem a direção autorizar. Ele aparece agora e não aparece de novo: gerar outro derruba este.' : 'Para os funcionários do setor: imprima o QR code no mural ou mande o endereço. Ele aparece agora e não aparece de novo: gerar outro derruba este.' }),
      el('div', { class: 'r-linkrow' }, el('input', { type: 'text', readonly: true, value: r.url, class: 'r-mono' }),
        el('button', { type: 'button', class: 'r-btn', onclick: () => navigator.clipboard?.writeText(r.url).then(() => ok('Endereço copiado.'), () => {}) }, 'Copiar')),
      svg, el('button', { type: 'button', class: 'r-btn small', onclick: () => { shown.hidden = true; put(shown); } }, 'Fechar'));
    shown.hidden = false; shown.scrollIntoView({ block: 'nearest' });
  }
  function sectorItem(s) {
    const name = el('input', { type: 'text', maxlength: '60', value: s.name });
    const staff = el('textarea', { rows: '4', maxlength: '20000', placeholder: 'Um nome ou matrícula por linha (opcional)' }); staff.value = s.staff.join('\n');
    const link = (kind, label) => el('span', { class: 'r-btns' },
      el('button', { type: 'button', class: 'r-btn small', onclick: act(async () => { if (s[kind].on && !confirm('Gerar outro endereço? O de agora deixa de valer.')) return; const r = await api(`/interna/sectors/${s.id}/link/${kind}`, { method: 'POST', body: {} }); await load(); showLink(s, r); }) }, s[kind].on ? `Novo ${label}` : `Gerar ${label}`),
      s[kind].on ? el('button', { type: 'button', class: 'r-btn small', onclick: run(async () => { if (!confirm('Desligar este endereço? Quem o tem perde o acesso.')) return; await api(`/interna/sectors/${s.id}/link/${kind}`, { method: 'DELETE' }); }, 'Endereço desligado.') }, 'Desligar') : null);
    return el('details', { class: 'r-sector' }, el('summary', {}, el('b', { text: s.name }), el('small', { class: 'r-dim', text: ` · ${s.staff.length} na lista · leitura ${s.read.on ? 'ligada' : 'desligada'} · disparo ${s.fire.on ? 'ligado' : 'desligado'}` })),
      el('div', { class: 'r-row' }, field('Nome do setor', name)),
      field('Funcionários do setor (para saber quem falta ler)', staff, 'Só nome ou matrícula. Opcional: sem a lista, o painel mostra só quem leu.'),
      el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn primary', onclick: run(() => api(`/interna/sectors/${s.id}`, { method: 'PATCH', body: { name: name.value, staff: staff.value } }), 'Setor salvo.') }, 'Salvar o setor'),
        el('button', { type: 'button', class: 'r-btn', onclick: run(async () => { if (!confirm(`Apagar o setor "${s.name}"? Os endereços dele deixam de valer.`)) return; await api(`/interna/sectors/${s.id}`, { method: 'DELETE' }); }, 'Setor apagado.') }, 'Apagar')),
      el('p', { class: 'r-dim', text: 'Celular dos funcionários (sem app e sem login):' }), link('read', 'endereço de leitura'), link('fire', 'endereço de disparo'));
  }
  function paintSectors() {
    const name = el('input', { type: 'text', maxlength: '60', placeholder: 'Ex.: Posto de enfermagem' });
    put(sectorsBox, data.sectors.length ? data.sectors.map(sectorItem) : el('p', { class: 'r-dim', text: 'Nenhum setor ainda. Crie um para cada lugar com tela interna ou equipe própria.' }),
      el('form', { class: 'r-row end', onsubmit: run(async () => { await api('/interna/sectors', { method: 'POST', body: { name: name.value } }); }, 'Setor criado.') }, field('Novo setor', name), el('button', { type: 'submit', class: 'r-btn' }, 'Criar setor')));
  }
  function noticeForm() {
    const kind = el('select', {}, ...data.kinds.map((k) => option(k.key, k.label)));
    const title = el('input', { type: 'text', maxlength: '80', required: true });
    const body = el('textarea', { rows: '5', maxlength: '600', placeholder: 'O texto do aviso (até 600 letras). Na tela, as linhas aparecem como estão.' });
    const days = el('input', { type: 'number', min: '1', max: '60', value: '7' });
    const secs = el('input', { type: 'number', min: '5', max: '120', value: '15' });
    const picks = new Set();
    return el('form', { class: 'r-form', onsubmit: run(async () => {
      await api('/interna/notices', { method: 'POST', body: { kind: kind.value, title: title.value, text: body.value, days: Number(days.value), seconds: Number(secs.value), sectors: [...picks] } });
      title.value = ''; body.value = '';
    }, 'Aviso publicado. As telas internas recebem em até 30 segundos.') },
    el('div', { class: 'r-row' }, field('Tipo', kind), field('Título', title)),
    field('Texto', body),
    el('fieldset', { class: 'r-fs' }, el('legend', { text: 'Setores (nenhum marcado = todos)' }),
      el('div', { class: 'r-checks' }, data.sectors.map((s) => check(s.name, el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) picks.add(s.id); else picks.delete(s.id); } }))))),
    el('div', { class: 'r-row' }, field('Vale por (dias)', days), field('Segundos na tela', secs)),
    el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn primary' }, 'Publicar o aviso interno')));
  }
  function paintNotices() {
    put(noticesBox, data.notices.length ? data.notices.map((n) => el('article', { class: 'r-req' },
      el('div', { class: 'r-req-head' }, el('span', { class: `r-tag${n.status === 'em vigor' ? ' live' : ''}`, text: n.status }), el('b', { text: `${n.kindLabel}: ${n.title}` })),
      el('p', { class: 'r-dim', text: `${n.sectorNames.length ? n.sectorNames.join(', ') : 'todos os setores'} · até ${hhmm(n.until)} · por ${n.createdBy.replace(/^repartição: /, '')}` }),
      el('p', { class: 'r-dev-line', text: n.expected != null ? `Lido por ${n.reads.length} de ${n.expected} (faltam ${n.missing.length})` : `Lido por ${n.reads.length}` }),
      n.reads.length ? el('details', {}, el('summary', { text: 'Quem leu' }), el('ul', { class: 'r-list' }, n.reads.map((r) => el('li', {}, el('span', { text: r.reader }), el('small', { class: 'r-dim', text: ` ${r.sector ? `${r.sector} · ` : ''}${hhmm(r.at)}` }))))) : null,
      n.missing.length ? el('details', {}, el('summary', { text: 'Quem falta' }), el('p', { text: n.missing.join(', ') })) : null,
      n.status === 'em vigor' || n.status === 'agendado' ? el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn', onclick: run(async () => { if (!confirm(`Encerrar o aviso "${n.title}"?`)) return; await api(`/interna/notices/${n.id}/cancel`, { method: 'POST', body: {} }); }, 'Aviso encerrado.') }, 'Encerrar')) : null))
      : el('p', { class: 'r-dim', text: 'Nenhum aviso interno ainda.' }));
  }
  function paintDevices() {
    put(devicesBox, data.devices.length ? data.devices.map((d) => {
      const on = el('input', { type: 'checkbox', checked: d.internal });
      const sec = el('select', {}, option('', 'Sem setor (todos os avisos)', !d.sectorId), ...data.sectors.map((s) => option(s.id, s.name, s.id === d.sectorId)));
      return el('li', {}, el('span', {}, el('b', { text: d.name }), el('small', { class: 'r-dim', text: d.internal ? ' · interna (só funcionários)' : ' · pública' })),
        el('span', { class: 'r-btns' }, check('Interna', on), sec,
          el('button', { type: 'button', class: 'r-btn small', onclick: run(() => api(`/interna/devices/${d.id}`, { method: 'PATCH', body: { internal: on.checked, sectorId: on.checked && sec.value ? Number(sec.value) : null } }), 'Tela salva. Ela troca em até 30 segundos.') }, 'Salvar')));
    }) : el('li', {}, el('span', { class: 'r-dim', text: 'Nenhuma TV box nesta repartição.' })));
  }
  function paintCodes() {
    const rows = data.catalog.map((c) => ({ ...c }));
    const list = el('div', { class: 'r-code-rows' });
    const minutes = el('input', { type: 'number', min: '0', max: '720', value: String(data.minutes) });
    const draw = () => put(list, rows.map((c, i) => {
      const label = el('input', { type: 'text', maxlength: '40', value: c.label, oninput: (e) => { c.label = e.target.value; } });
      const meaning = el('input', { type: 'text', maxlength: '80', value: c.meaning, oninput: (e) => { c.meaning = e.target.value; } });
      const color = el('select', { onchange: (e) => { c.color = e.target.value; } }, ...CODE_COLORS.map((x) => option(x.hex, x.label, x.hex === c.color)));
      return el('div', { class: 'r-row three' }, field('Nome', label), field('O que significa', meaning), el('span', { class: 'r-btns' }, field('Cor', color),
        el('button', { type: 'button', class: 'r-btn small', onclick: () => { rows.splice(i, 1); draw(); } }, 'Tirar')));
    }));
    draw();
    put(codesBox, list,
      el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn small', onclick: () => { rows.push({ key: '', label: 'Código ', meaning: '', color: '#00838f' }); draw(); } }, '+ Código')),
      el('div', { class: 'r-row' }, field('Tempo na tela sem ninguém encerrar (minutos; 0 = até encerrar)', minutes)),
      el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn primary', onclick: run(() => api('/interna/codes', { method: 'PUT', body: { codes: rows, minutes: Number(minutes.value) } }), 'Lista de códigos salva.') }, 'Salvar a lista de códigos')));
  }
  const formBox = el('div', {});
  function paint() { paintSectors(); put(formBox, noticeForm()); paintNotices(); paintDevices(); paintCodes(); }
  async function load() { data = await api('/interna'); paint(); }
  const node = cols(
    [card('Novo aviso interno', el('p', { class: 'r-dim', text: 'Avisos da direção, escala do plantão, treinamentos, protocolos e aniversariantes. Vão SÓ às telas internas e ao celular dos funcionários do setor, com o botão "Li". Nunca às telas do público.' }), formBox),
      card('Avisos internos e quem leu', noticesBox)],
    [card('Setores e endereços do celular', shown, sectorsBox), card('Telas internas', el('p', { class: 'r-dim', text: 'Marque as TV box que ficam em área só de funcionários. Elas mostram os avisos internos e os códigos de emergência; as outras continuam públicas.' }), devicesBox),
      card('Lista de códigos de emergência', codesBox)]);
  load().catch(() => {});
  return { node, show: () => load().catch(() => {}) };
}
