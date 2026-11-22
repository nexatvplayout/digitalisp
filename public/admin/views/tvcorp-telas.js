// TV Corporativa · aba Telas (docs/TV-CORPORATIVA.md §6): a lista e o mapa das unidades; cada tela com a situação, a
// captura, "o que está passando agora", os comandos, o horário liga/desliga, o volume e o layout de reserva. "+ TV box" gera
// a chave de acesso (uso único, 24 h). A rede pelas rotas /api/tvcorp/rede/*; o "agora" por /api/tvcorp/devices/:id/now.
import {
  el, guard, toast, tapi, tblob, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, T,
  active, officeOf, groupsOf, statusOf, sinceText, counters, dot, when, ago, now, pct, STATUS,
} from './tvcorp-base.js';
import { copyText } from '../lib.js';
import { createMap } from '../telas-mapa.js';
import { officeStatus, OFFICE_STATUS_LABEL } from '../../shared/telas-geo.js';
import { LAYOUTS, LAYOUT_KEYS, COMMANDS, typeLabel } from '../../shared/telas-tipos.js';
import { WEEK_SHORT } from './tvcorp-catalogo.js';
import { TVC_PLAYLIST_ZONES } from '../../shared/tvcorp-tipos.js';

/**
 * "O que passa nesta tela": o layout e a playlist de cada zona SÓ desta tela (a grade de alcance "Telas escolhidas", com
 * esta tela só, o dia todo, todos os dias). A grade com tela escolhida vence as de unidade, grupo e empresa.
 */
function programacaoDaTela(d, reload) {
  const data = D();
  const nomeGrade = `Tela ${d.name}`;
  const minha = (data.schedules || []).find((g) => g.scope?.kind === 'devices' && (g.scope.devices || []).length === 1 && Number(g.scope.devices[0]) === d.id && g.name === nomeGrade);
  const layout = el('select', {}, opt('', 'Escolha o layout', !minha), ...(data.layouts || []).map((l) => opt(l.id, l.name, minha?.layoutId === l.id)));
  const zonasBox = el('div', { class: 'pf-grid' });
  const escolhas = { ...(minha?.zonePlaylists || {}) };
  const desenhar = () => {
    const l = (data.layouts || []).find((x) => x.id === Number(layout.value));
    const zonas = (l?.zones || []).filter((z) => TVC_PLAYLIST_ZONES.includes(z.kind));
    put(zonasBox, ...(l ? (zonas.length ? zonas.map((z) => {
      const sel = el('select', { onchange: (e) => { escolhas[z.id] = e.target.value ? Number(e.target.value) : null; } },
        opt('', 'Nenhuma', !escolhas[z.id]), ...(data.playlists || []).map((p) => opt(p.id, p.name, Number(escolhas[z.id]) === p.id)));
      return f(`Playlist da zona "${z.name || z.id}"`, sel);
    }) : [note('Este layout não tem zona de playlist (ex.: só o ao vivo). Pode salvar assim.')]) : []));
  };
  layout.addEventListener('change', desenhar); desenhar();
  const salvar = guard(async () => {
    if (!layout.value) { toast('Escolha o layout.', true); return; }
    const l = (data.layouts || []).find((x) => x.id === Number(layout.value));
    const zp = Object.fromEntries((l?.zones || []).filter((z) => TVC_PLAYLIST_ZONES.includes(z.kind) && escolhas[z.id]).map((z) => [z.id, escolhas[z.id]]));
    const body = { name: nomeGrade, layoutId: Number(layout.value), zonePlaylists: zp, scope: { kind: 'devices', devices: [d.id] }, days: [], timeFrom: 0, timeTo: 1440, priority: 0 };
    if (minha) await tapi(`/api/tvcorp/schedules/${minha.id}`, { method: 'PATCH', body });
    else await tapi('/api/tvcorp/schedules', { method: 'POST', body });
    toast(`Programação da tela "${d.name}" salva: ela troca em até 30 s.`);
    await reload?.();
  });
  return el('div', { class: 'tc-prog' },
    label('O que passa nesta tela'),
    note(minha ? 'Esta tela tem a programação própria abaixo (vale o dia todo, todos os dias, por cima da grade geral).' : 'Escolha o layout e a playlist de cada zona só para esta tela. Para horários e dias diferentes, use a aba Grade.'),
    el('div', { class: 'pf-grid' }, f('Layout', layout)), zonasBox,
    btns(btn(minha ? 'Salvar a programação da tela' : 'Pôr esta programação na tela', salvar, 'primary'),
      minha ? btn('Tirar a programação própria', guard(async () => { await tapi(`/api/tvcorp/schedules/${minha.id}`, { method: 'DELETE' }); toast('A tela volta a seguir a grade geral.'); await reload?.(); }), 'small') : null));
}

const V = { mode: 'lista', avail: new Map(), map: null };
const counterRow = (n, total) => el('div', { class: 'pf-counters' },
  el('div', { class: 'pf-count on' }, el('b', { text: String(n.on) }), el('span', { text: 'no ar' })),
  el('div', { class: 'pf-count warn' }, el('b', { text: String(n.warn) }), el('span', { text: 'ligadas sem imagem' })),
  el('div', { class: 'pf-count off' }, el('b', { text: String(n.off + n.never) }), el('span', { text: n.never ? `desligadas (${n.never} nunca ligaram)` : 'desligadas' })),
  el('div', { class: 'pf-count' }, el('b', { text: String(total) }), el('span', { text: 'telas' })));

/** A chave de uma TV box nova, já ligada à unidade. */
export function newKey(reload, officeId = null) {
  const d = D();
  if (!d.offices.length) { toast('Cadastre a unidade antes (aba Unidades e grupos).', true); return; }
  const office = el('select', {}, ...d.offices.map((o) => opt(o.id, `${o.name} · ${typeLabel(o.type)}`, o.id === officeId)));
  const name = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: Recepção, hall do 2º andar' });
  const out = el('div', { class: 'pf-keybox', hidden: true });
  dialog('+ TV box: gerar a chave de acesso', el('div', { class: 'pf-grid' }, f('Unidade', office), f('Nome da tela (opcional)', name, 'Sem nome, a tela leva o nome da unidade.'), out), {
    saveLabel: 'Gerar chave',
    save: async () => {
      const k = await tapi('/api/tvcorp/rede/keys', { method: 'POST', body: { officeId: Number(office.value), name: name.value } });
      out.hidden = false;
      put(out, note('Digite esta chave na TV box, no aplicativo NEXA Telas. Ela aparece só agora, vale para UMA tela e vence em 24 horas.'),
        el('div', { class: 'pf-key', text: k.key }), note(`Vence em ${when(k.expiresAt)}.`), btn('Copiar a chave', () => copyText(k.key), 'small'));
      await reload();
      return false;
    },
  });
}
async function sendCommand(d, type) {
  if (type === 'reboot' && !confirm(`Reiniciar o aparelho "${d.name}"? A tela fica sem imagem por 1 a 2 minutos.`)) return;
  await tapi(`/api/tvcorp/rede/devices/${d.id}/commands`, { method: 'POST', body: { type } });
  toast(`${COMMANDS.find((c) => c.key === type)?.label || type}: a tela "${d.name}" recebe no próximo sinal de vida (até 30 s).`);
}
/** "O que está passando agora": a grade, o layout e o item de cada zona, pelo último sinal de vida. */
async function nowText(d) {
  // GET /api/tvcorp/devices/:id/now: { block: { name, fallback }, zones: { zona: [itens] }, lastPlays: { at, items: [{ name }] } }
  const r = await tapi(`/api/tvcorp/devices/${d.id}/now`);
  if (!r?.block) return 'O layout de sempre (nenhuma grade vale agora).';
  const lay = D().layouts.find((l) => l.id === r.block.layoutId);
  const parts = [r.block.fallback ? `Grade padrão "${r.block.name}"` : `Grade "${r.block.name}"`, lay ? `layout "${lay.name}"` : ''].filter(Boolean);
  const zones = Object.entries(r.zones || {}).map(([z, items]) => `${z}: ${items.length} item(ns)`);
  const shown = (r.lastPlays?.items || []).slice(0, 4).map((x) => x.name);
  return `${parts.join(' · ')}${zones.length ? ` · ${zones.join(', ')}` : ''}${shown.length ? ` · mostrou há pouco: ${shown.join(', ')}${r.lastPlays.at ? ` (${when(r.lastPlays.at)})` : ''}` : ''}`;
}
/** Captura, agora e comandos de uma tela. */
function deviceDialog(d, ctx = null) {
  const st = statusOf(d);
  const img = el('img', { class: 'pf-shot tc-shot', alt: `Captura da tela ${d.name}`, hidden: true });
  const shotNote = note(d.shotAt ? 'Carregando a captura…' : 'Sem captura ainda. Peça uma em "Captura da tela".');
  if (d.shotAt) tblob(`/api/tvcorp/rede/devices/${d.id}/screenshot`).then((u) => { if (u) { img.src = u; img.hidden = false; shotNote.textContent = `Captura de ${when(d.shotAt)}`; } else shotNote.textContent = 'Captura indisponível no exemplo.'; }, () => { shotNote.textContent = 'Não foi possível abrir a captura.'; });
  const nowBox = note('Carregando o que está passando…');
  nowText(d).then((t) => { nowBox.textContent = t; }, () => { nowBox.textContent = 'Ainda sem a informação do que está passando.'; });
  const dead = st === 'off' || st === 'never';
  dialog(`Tela · ${d.name}`, el('div', {},
    el('dl', { class: 'pf-dl' },
      el('dt', { text: 'Unidade' }), el('dd', { text: officeOf(d.officeId)?.name || '—' }),
      el('dt', { text: 'Situação' }), el('dd', { text: sinceText(d) }),
      el('dt', { text: 'Passando agora' }), el('dd', {}, nowBox),
      el('dt', { text: 'App' }), el('dd', { text: [d.appVersion || '—', d.model, d.android ? `Android ${d.android}` : '', d.net ? `rede ${d.net}` : ''].filter(Boolean).join(' · ') }),
      d.lastError ? el('dt', { text: 'Último erro' }) : null, d.lastError ? el('dd', { class: 'pf-err', text: d.lastError }) : null),
    programacaoDaTela(d, () => ctx?.reload?.()),
    img, shotNote,
    label('Comandos'),
    dead ? note('A tela está desligada: o comando só chega quando ela ligar.') : null,
    btns(...COMMANDS.map((c) => btn(c.label, guard(() => sendCommand(d, c.key)), 'small')))), { wide: true });
}
function editDevice(d, reload) {
  const data = D(); const cfg = d.config || {};
  const name = el('input', { type: 'text', maxlength: '80', value: d.name });
  const office = el('select', {}, ...data.offices.map((o) => opt(o.id, o.name, o.id === d.officeId)));
  const picks = new Set(d.groups || []);
  const manual = data.groups.filter((g) => !g.officeType);
  const vol = el('input', { type: 'number', min: '0', max: '100', step: '5', value: cfg.volume ?? '', placeholder: 'o do aparelho' });
  const muted = el('input', { type: 'checkbox', checked: Boolean(cfg.muted) });
  const sch = cfg.schedule;
  const on = el('input', { type: 'time', value: sch?.tvOn || '' }); const offT = el('input', { type: 'time', value: sch?.tvOff || '' });
  const days = new Set(sch ? sch.days : [1, 2, 3, 4, 5]);
  const layout = el('select', {}, opt('', 'Não define (segue a unidade e o padrão)', !cfg.layout), ...LAYOUTS.filter((l) => LAYOUT_KEYS.includes(l.key)).map((l) => opt(l.key, `${l.label}: ${l.desc}`, cfg.layout === l.key)));
  dialog(`Editar a tela · ${d.name}`, el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome da tela', name), f('Unidade', office)),
    label('Grupos desta tela'),
    manual.length ? el('div', { class: 'pf-checks' }, ...manual.map((g) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: picks.has(g.id), onchange: (e) => { if (e.target.checked) picks.add(g.id); else picks.delete(g.id); } }), el('span', { text: g.name }))))
      : note('Nenhum grupo manual ainda (aba Unidades e grupos).'),
    label('Som'),
    el('div', { class: 'pf-grid two' }, f('Volume (0 a 100)', vol, 'Vazio: o volume do próprio aparelho.'), el('label', { class: 'pf-check' }, muted, el('span', { text: 'Sem som nesta tela' }))),
    label('Horário liga e desliga (vazio = segue o padrão; sem padrão, fica sempre ligada)'),
    el('div', { class: 'pf-grid two' }, f('Ligar às', on), f('Desligar às', offT)),
    el('div', { class: 'pf-checks row' }, ...[1, 2, 3, 4, 5, 6, 0].map((n) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); } }), el('span', { text: WEEK_SHORT[n] })))),
    label('Layout de reserva'),
    f('Quando nenhuma grade vale', layout, 'A grade da TV Corporativa vence este layout. Sem grade no horário, a tela usa este formato.')), {
    wide: true,
    save: async () => {
      const config = { layout: layout.value || null, volume: vol.value === '' ? null : Number(vol.value), muted: muted.checked || null, schedule: on.value && offT.value ? { tvOn: on.value, tvOff: offT.value, days: [...days] } : null };
      await tapi(`/api/tvcorp/rede/devices/${d.id}`, { method: 'PATCH', body: { name: name.value, officeId: Number(office.value), groups: [...picks], config } });
      toast('Tela salva. Ela troca em até 30 segundos.');
      await reload();
    },
  });
}

/* ------------------------------------------------------------------ mapa das unidades (sem a trava do município) */
function paintMap(mapBox, ctx) {
  V.map?.destroy?.(); V.map = null;
  const d = D();
  const byOffice = new Map();
  for (const x of active()) { if (!byOffice.has(x.officeId)) byOffice.set(x.officeId, []); byOffice.get(x.officeId).push(x); }
  const pins = d.offices.filter((o) => o.lat != null && o.lng != null).map((o) => {
    const devs = byOffice.get(o.id) || []; const st = officeStatus(devs.map(statusOf));
    return { id: o.id, lat: o.lat, lng: o.lng, status: st, label: (o.name || '?').slice(0, 3).toUpperCase(), count: devs.length, title: `${o.name} · ${devs.length} tela(s) · ${OFFICE_STATUS_LABEL[st]}` };
  });
  V.map = createMap(mapBox, { onPin: (id) => { const o = officeOf(id); if (o) toast(`${o.name}: ${(byOffice.get(id) || []).map((x) => `${x.name} (${STATUS[statusOf(x)]})`).join(', ') || 'sem telas'}`); } });
  V.map.setPins(pins);
  if (!V.map.fit(pins)) V.map.setView(-14.2, -51.9, 4);
  return pins.length;
}

export default async function paintTelas(box, ctx) {
  const d = D();
  try { const r = await tapi('/api/tvcorp/rede/availability'); V.avail = new Map((r.devices || []).map((x) => [x.id, x])); } catch { /* fica a de antes */ }
  const reload = ctx.reload;
  const rows = d.devices.map((x) => {
    const o = officeOf(x.officeId); const st = statusOf(x); const av = V.avail.get(x.id);
    const nowCell = el('td', {}, btn('Ver', guard(async (e) => { const b = e.target; b.disabled = true; try { put(nowCell, el('span', { class: 'small', text: await nowText(x) })); } catch { put(nowCell, el('span', { class: 'dim small', text: 'sem informação' })); } }), 'small'));
    return el('tr', { class: x.revokedAt ? 'pf-gone' : '' },
      el('td', {}, dot(st), ' ', el('b', { text: x.name }), el('div', { class: 'dim small', text: `#${x.id}${x.config?.volume != null ? ` · volume ${x.config.volume}` : ''}${x.config?.muted ? ' · sem som' : ''}` })),
      el('td', {}, STATUS[st] || st, el('div', { class: 'dim small', text: x.lastSeen ? ago(now() - x.lastSeen) : 'nunca' })),
      el('td', {}, o?.name || '—', el('div', { class: 'dim small', text: o ? typeLabel(o.type) : '' })),
      el('td', {}, ...groupsOf(x).map((g) => chip(g.name))),
      x.revokedAt ? el('td', { text: '—' }) : nowCell,
      el('td', { text: x.appVersion || '—' }),
      el('td', { title: 'Tempo no ar sobre o tempo acompanhado, nos últimos 7 e 30 dias' }, x.revokedAt ? '—' : `${pct(av?.d7)} · ${pct(av?.d30)}`),
      el('td', { class: 'pf-actions' },
        x.revokedAt ? null : btn('Captura, comandos e programação', () => deviceDialog(x, ctx), 'small'),
        x.revokedAt ? null : btn('Editar', () => editDevice(x, reload), 'small'),
        x.revokedAt
          ? btn('Excluir', guard(async () => { if (!confirm(`Excluir a tela revogada "${x.name}" da lista?`)) return; await tapi(`/api/tvcorp/rede/devices/${x.id}`, { method: 'DELETE' }); await reload(); }), 'small danger')
          : btn('Revogar', guard(async () => { if (!confirm(`Revogar a tela "${x.name}"? O aparelho perde o acesso e volta à tela da chave. Para religar, gere outra chave.`)) return; await tapi(`/api/tvcorp/rede/devices/${x.id}/revoke`, { method: 'POST' }); toast('Tela revogada.'); await reload(); }), 'small danger')));
  });
  const keys = (d.keys || []).map((k) => el('tr', {},
    el('td', { text: officeOf(k.officeId)?.name || '—' }), el('td', { text: k.deviceName || '—' }), el('td', { text: when(k.expiresAt) }), el('td', { text: k.createdBy || '—' }),
    el('td', { class: 'pf-actions' }, btn('Apagar', guard(async () => { await tapi(`/api/tvcorp/rede/keys/${k.id}`, { method: 'DELETE' }); await reload(); }), 'small danger'))));
  const mapBox = el('div', { class: 'pf-mapbox tc-mapbox' });
  const listBox = el('div', {}, rows.length ? table(['Tela', 'Situação', 'Unidade', 'Grupos', 'Passando agora', 'App', 'No ar (7 · 30 dias)', ''], rows) : empty('Nenhuma tela ainda. Clique em "+ TV box", gere a chave e digite-a no aplicativo da TV box.'));
  const mapNote = note('');
  const toggle = btn(V.mode === 'mapa' ? 'Ver a lista' : 'Ver no mapa', () => { V.mode = V.mode === 'mapa' ? 'lista' : 'mapa'; ctx.repaint(); }, 'small');
  put(box,
    counterRow(counters(active()), active().length),
    d.rede ? null : note('A rede de telas ainda não respondeu (rotas /api/tvcorp/rede). A lista aparece quando o servidor for atualizado.', 'pf-banner'),
    btns(btn('+ TV box', () => newKey(reload), 'primary'), toggle, btn('Instalar o aplicativo', () => ctx.go('instalar'), 'small'),
      el('span', { class: 'dim small', text: 'Cada TV box entra com uma chave de uso único (24 h), já ligada à unidade.' })),
    keys.length ? el('div', {}, label('Chaves esperando uso (a chave em si só aparece ao gerar)'), table(['Unidade', 'Nome da tela', 'Vence', 'Gerada por', ''], keys)) : null,
    V.mode === 'mapa' ? el('div', {}, mapBox, mapNote, note('Cada pino é uma unidade. Verde: todas as telas no ar. Amarelo: alguma ligada sem imagem. Vermelho: alguma desligada. Cinza: sem tela. As filiais podem estar em cidades diferentes: o mapa abre mostrando todas.')) : listBox);
  // o mapa mede a caixa: só depois de a aba entrar na página
  if (V.mode === 'mapa') {
    setTimeout(() => { try { const n = paintMap(mapBox, ctx); mapNote.textContent = n < d.offices.length ? `${d.offices.length - n} unidade(s) sem ponto no mapa: localize o endereço em Unidades e grupos.` : ''; } catch { mapNote.textContent = 'O mapa não abriu neste navegador.'; } }, 0);
  }
  if (T.demo && V.mode !== 'mapa') box.append(note('No exemplo, "Ver" mostra o que a grade de exemplo põe em cada tela.'));
}
