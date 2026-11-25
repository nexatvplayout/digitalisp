// NEXA Telas · TV Corporativa, pacote A (docs/TV-CORPORATIVA.md §4 e §5.4): as regras sem banco (server/tvcorp-core.js) e
// o catálogo (public/shared/tvcorp-tipos.js). Layout por zonas, slide de modelo, itens da playlist, grade (prioridade, dia,
// faixa que vira a noite, validade, especificidade, no máximo 2 blocos ativos por minuto), plays do sinal de vida, tetos do
// contrato, dados segurados por 15 min e o CSV dos relatórios.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/shared/tvcorp-tipos.js';
import * as K from '../server/tvcorp-core.js';

const err = (fn, status = 400, re = null) => assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)));

test('catálogo: modelos de fábrica válidos, chaves sem repetir, ids dos itens vão e voltam', () => {
  assert.equal(T.TVC_LAYOUT_MODELS.length, 224, '73 de uma TV (8 com a entrada HDMI), 14 telas de 5 conjuntos, 112 por família (14 segmentos × 8) e 25 de formatos especiais');
  assert.equal(T.TVC_SLIDE_MODELS.length, 17);
  for (const m of T.TVC_LAYOUT_MODELS) {
    const l = K.cleanLayout({ factoryKey: m.key });
    assert.equal(l.zones.length, m.zones.length, m.key);
    assert.ok(l.zones.filter((z) => z.kind === 'video').length <= 1, m.key);
    assert.equal(l.factoryKey, m.key);
  }
  assert.equal(K.cleanLayout({ factoryKey: 'totem' }).orientation, 'port');
  for (const list of [T.TVC_ZONE_KEYS, T.TVC_LAYOUT_MODEL_KEYS, T.TVC_SLIDE_MODEL_KEYS, T.TVC_POST_CATEGORY_KEYS, T.TVC_REF_KIND_KEYS]) assert.equal(new Set(list).size, list.length);
  for (const c of T.TVC_POST_CATEGORIES) assert.ok(T.TVC_SLIDE_MODEL[c.template], c.key);
  for (const m of T.TVC_SLIDE_MODELS) for (const f of m.fields) assert.ok(T.TVC_FIELD_TYPES.includes(f.type), `${m.key}.${f.key}`);
  for (const [k, id] of [['media', 45], ['post', 7], ['kpi', 3], ['widget', 2], ['card', 9], ['news', 4], ['quotes', 5], ['birthdays', null], ['posts', null], ['news', null], ['quotes', null]]) {
    const ref = T.itemRef(k, id);
    assert.deepEqual(T.parseItemRef(ref), { refKind: k, refId: id || 0 }, ref);
  }
  assert.equal(T.itemRef('media', null), null);
  for (const bad of ['m0', 'x1', 'm-1', 'm1.5', '', null, 'w:outro', 'm01']) assert.equal(T.parseItemRef(bad), null, String(bad));
  assert.ok(T.isTvcOfficeType('fabrica') && !T.isTvcOfficeType('escola'));
  assert.equal(T.minutesText(1440), '24:00');
});

test('layout por zonas: limites, sobreposição, borda, um vídeo só, campos por tipo', () => {
  const z = (id, kind, x, y, w, h, extra = {}) => ({ id, kind, x, y, w, h, ...extra });
  const ok = K.cleanLayout({ name: 'Meu', zones: [z('main', 'video', 0, 0, 70, 100), z('qr', 'qr', 70, 0, 30, 50, { qr: 'https://empresa.exemplo/pesquisa', title: 'Responda' }), z('txt', 'text', 70, 50, 30, 50, { text: 'Bem-vindo\u0007!', qr: 'https://x.exemplo' })] });
  assert.deepEqual(ok.zones[1], { id: 'qr', kind: 'qr', x: 70, y: 0, w: 30, h: 50, qr: 'https://empresa.exemplo/pesquisa', title: 'Responda' });
  assert.deepEqual(ok.zones[2], { id: 'txt', kind: 'text', x: 70, y: 50, w: 30, h: 50, text: 'Bem-vindo !' }, 'controle some; url fora do tipo some');
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'video', 0, 0, 60, 100), z('b', 'playlist', 50, 0, 50, 100)] }), 400, /uma por cima/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'video', 0, 0, 50, 100), z('b', 'video', 50, 0, 50, 100)] }), 400, /uma zona de vídeo/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'playlist', 60, 0, 50, 100)] }), 400, /borda/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'playlist', 0, 0, 4, 100)] }), 400, /pelo menos 5%/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'playlist', 0, 0, 50.5, 100)] }), 400);
  err(() => K.cleanLayout({ name: 'XY', zones: Array.from({ length: 7 }, (_, i) => z(`z${i}`, 'clock', i * 14, 0, 14, 10)) }), 400, /6 zonas/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'clock', 0, 0, 50, 50), z('a', 'clock', 50, 0, 50, 50)] }), 400, /mesmo nome/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('A b', 'clock', 0, 0, 50, 50)] }), 400);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('a', 'mapa', 0, 0, 50, 50)] }), 400);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('q', 'qr', 0, 0, 50, 50)] }), 400, /endereço do QR/);
  err(() => K.cleanLayout({ name: 'XY', zones: [z('q', 'qr', 0, 0, 50, 50, { qr: 'http://inseguro.exemplo' })] }), 400, /https/);
  err(() => K.cleanLayout({ factoryKey: 'nao-existe' }), 400);
  err(() => K.cleanLayout({ name: 'Sem nada' }), 400);
  assert.equal(K.cleanLayout({ factoryKey: 'video-lateral', background: '#FFFFFF' }).background, '#ffffff');
  err(() => K.cleanLayout({ factoryKey: 'video-lateral', background: 'media:12' }), 400, /só cor|#rrggbb/);
  err(() => K.cleanLayout({ factoryKey: 'video-lateral', background: 'vermelho' }), 400);
  // edição: só o que veio muda
  const cur = K.cleanLayout({ factoryKey: 'video-barra' });
  const ed = K.cleanLayout({ name: 'Recepção nova' }, cur);
  assert.equal(ed.name, 'Recepção nova'); assert.deepEqual(ed.zones, cur.zones); assert.equal(ed.factoryKey, 'video-barra');
});

test('slide de modelo: obrigatórios, limites, linhas, imagem citada, endereço https, campos fora do modelo somem', () => {
  const s = K.cleanSlide('comunicado', { title: '  Férias coletivas  ', text: `a\nb\nc\nd\ne\nf\ng\nh\ni\nj`, image: 5, qr: 'https://rh.exemplo/ferias', estranho: 'x', variant: 'light', accent: '#1D4ED8' });
  assert.equal(s.fields.title, 'Férias coletivas');
  assert.equal(s.fields.text.split('\n').length, 8, 'até 8 linhas');
  assert.deepEqual(s.mediaIds, [5]);
  assert.equal(s.fields.accent, '#1d4ed8');
  assert.equal('estranho' in s.fields, false);
  assert.equal(K.cleanSlide('comunicado', { title: 'x'.repeat(90) }).fields.title.length, 60);
  assert.equal(K.cleanSlide('comunicado', { title: 'T', text: 'y'.repeat(400) }).fields.text.length, 280);
  err(() => K.cleanSlide('comunicado', { text: 'sem título' }), 400, /obrigatório/);
  err(() => K.cleanSlide('comunicado', { title: 'T', qr: 'javascript:alert(1)' }), 400);
  err(() => K.cleanSlide('comunicado', { title: 'T', variant: 'roxo' }), 400);
  err(() => K.cleanSlide('evento', { title: 'SIPAT' }), 400, /Quando/);
  assert.equal(K.cleanSlide('evento', { title: 'SIPAT', target: '2026-12-01T09:30' }).fields.target, '2026-12-01T09:30');
  err(() => K.cleanSlide('evento', { title: 'SIPAT', target: '2026-02-30T09:30' }), 400);
  err(() => K.cleanSlide('imagem-com-legenda', { title: 'x' }), 400);
  err(() => K.cleanSlide('nao-existe', {}), 400);
});

test('itens da playlist e grade: tempo, validade, dias, faixa e alcance', () => {
  const it = K.cleanItem({ refKind: 'media', refId: '4', seconds: 8, validFrom: '2026-11-01', validTo: '2026-11-30', days: '1,2,3', timeFrom: '07:30', timeTo: 1080 });
  assert.deepEqual(it, { refKind: 'media', refId: 4, params: {}, seconds: 8, validFrom: '2026-11-01', validTo: '2026-11-30', days: [1, 2, 3], timeFrom: 450, timeTo: 1080 });
  assert.equal(K.cleanItem({ refKind: 'birthdays', params: { period: 'week', max: 12, x: { y: 1 } } }).refId, null);
  assert.deepEqual(K.cleanItem({ refKind: 'birthdays', params: { period: 'week', max: 12, x: { y: 1 } } }).params, { period: 'week', max: 12 });
  assert.deepEqual(K.cleanItem({ refKind: 'news', days: [0, 1, 2, 3, 4, 5, 6] }).days, [], 'todos os dias = todo dia');
  err(() => K.cleanItem({ refKind: 'media' }), 400);
  err(() => K.cleanItem({ refKind: 'video', refId: 1 }), 400);
  err(() => K.cleanItem({ refKind: 'media', refId: 1, seconds: 2 }), 400);
  err(() => K.cleanItem({ refKind: 'media', refId: 1, validFrom: '2026-11-30', validTo: '2026-11-01' }), 400);
  err(() => K.cleanItem({ refKind: 'media', refId: 1, timeFrom: 60 }), 400);
  err(() => K.cleanItem({ refKind: 'media', refId: 1, days: [7] }), 400);
  err(() => K.cleanItems(Array.from({ length: 61 }, () => ({ refKind: 'news' }))), 400, /60 itens/);

  const s = K.cleanSchedule({ name: 'Noite', layoutId: 3, zonePlaylists: { right: '7', bar: null }, scope: { kind: 'city' }, timeFrom: '22:00', timeTo: '06:00', priority: 5 });
  assert.deepEqual({ ...s }, { name: 'Noite', layoutId: 3, zonePlaylists: { right: 7 }, scope: { kind: 'all' }, days: [], timeFrom: 1320, timeTo: 360, dateFrom: null, dateTo: null, priority: 5 });
  err(() => K.cleanSchedule({ name: 'XY', layoutId: 1, timeFrom: 600, timeTo: 600 }), 400, /vazia/);
  err(() => K.cleanSchedule({ name: 'XY', layoutId: 1, priority: 101 }), 400);
  err(() => K.cleanSchedule({ name: 'XY', layoutId: 1, scope: { kind: 'offices', offices: [] } }), 400);
  err(() => K.cleanSchedule({ name: 'XY', layoutId: 1, dateFrom: '2026-12-01', dateTo: '2026-11-01' }), 400);
  assert.deepEqual(K.cleanTvcScope({ kind: 'groups', groups: ['2', 2, 3] }), { kind: 'groups', groups: [2, 3] });
  assert.deepEqual(K.zonePlaylistsFor(K.cleanLayout({ factoryKey: 'video-lateral-barra' }).zones, { right: 1, main: 2, sumiu: 3 }), { right: 1 });
});

test('resolução da grade: prioridade, especificidade, mais nova, dias, período, faixa que vira a noite, 2 ativos, padrão', () => {
  const at = { deviceId: 10, officeId: 2, regionId: 4, groupIds: [7] };
  const S = (id, o) => ({ id, status: 'ok', priority: 0, scope: { kind: 'all' }, days: [], timeFrom: 0, timeTo: 1440, dateFrom: null, dateTo: null, layoutId: 1, zonePlaylists: {}, ...o });
  const today = '2026-11-20'; // sexta (5)
  const list = [
    S(1, { name: 'empresa' }),
    S(2, { scope: { kind: 'offices', offices: [2] } }),
    S(3, { scope: { kind: 'devices', devices: [10] } }),
    S(4, { scope: { kind: 'offices', offices: [99] } }),
    S(5, { priority: 9, days: [1, 2, 3, 4, 5], timeFrom: 420, timeTo: 1080 }),
    S(6, { status: 'pending', priority: 100 }),
    S(7, { priority: 50, dateTo: '2026-11-19' }),
    S(8, { priority: 50, timeFrom: 1320, timeTo: 360, days: [5] }),
  ];
  const r = K.resolveBlocks(list, at, { today });
  assert.deepEqual(r.blocks.map((s) => s.id), [8, 5, 3, 2], 'pendente, fora do alcance e vencida saem; empate de prioridade: tela > unidade > empresa; a empresa (1) é a 3ª em todo minuto e sai');
  const now = (minute, day = today) => K.blockNow(r.blocks, r.fallback, { day, minute })?.id;
  assert.equal(now(12 * 60), 5, 'meio-dia de sexta: a de prioridade 9');
  assert.equal(now(23 * 60), 8, 'a noite de sexta (22:00 em diante)');
  assert.equal(now(5 * 60, '2026-11-21'), 8, 'sábado 05:00 ainda é a noite que começou na sexta');
  assert.equal(now(7 * 60, '2026-11-21'), 3, 'sábado 07:00: a da tela');
  // a mais nova vence no empate de prioridade e alcance
  assert.deepEqual(K.resolveBlocks([S(1), S(2)], at, { today }).blocks.map((s) => s.id), [2, 1]);
  // o padrão vai sempre (no fim) e não conta para o teto
  const f = K.resolveBlocks([S(1), S(2), S(3), S(9, { priority: 0 })], at, { today, fallbackId: 1 });
  assert.equal(f.fallback.id, 1);
  assert.deepEqual(f.blocks.map((s) => s.id), [9, 3]);
  assert.equal(K.blockNow([], f.fallback, { day: today, minute: 0 }).id, 1);
  // o período: começa amanhã = vai (o app troca na virada); começa depois de amanhã = não vai
  assert.deepEqual(K.resolveBlocks([S(1, { dateFrom: '2026-11-21' }), S(2, { dateFrom: '2026-11-22' })], at, { today }).blocks.map((s) => s.id), [1]);
  // grupo e região
  assert.equal(K.resolveBlocks([S(1, { scope: { kind: 'groups', groups: [7] } }), S(2, { scope: { kind: 'regions', regions: [5] } })], at, { today }).blocks.length, 1);
  // teto de blocos mandados
  const many = Array.from({ length: 40 }, (_, i) => S(i + 1, { timeFrom: i * 30, timeTo: i * 30 + 30 }));
  assert.equal(K.resolveBlocks(many, at, { today }).blocks.length, T.TVC_LIMITS.blocksSent);
});

test('dias e horas no fuso, item na janela de hoje e amanhã, embaralhar estável no dia', () => {
  const t = Date.parse('2026-11-21T02:30:00Z'); // 23:30 de sexta em Brasília
  assert.deepEqual(K.localParts(t, 'America/Sao_Paulo'), { day: '2026-11-20', weekday: 5, minute: 23 * 60 + 30 });
  assert.equal(K.localParts(t, 'UTC').day, '2026-11-21');
  err(() => K.cleanTz('Lua/Base'), 400);
  assert.equal(K.cleanTz('America/Manaus'), 'America/Manaus');
  assert.equal(K.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(K.weekdayOf('2026-11-22'), 0);
  const today = '2026-11-20';
  assert.equal(K.itemInWindow({ validTo: '2026-11-19' }, today), false);
  assert.equal(K.itemInWindow({ validFrom: '2026-11-21' }, today), true);
  assert.equal(K.itemInWindow({ validFrom: '2026-11-22' }, today), false);
  assert.equal(K.itemInWindow({ days: [6] }, today), true, 'sábado é amanhã');
  assert.equal(K.itemInWindow({ days: [1] }, today), false);
  assert.deepEqual(K.itemWhen({ days: [], timeFrom: null }), {});
  assert.deepEqual(K.itemWhen({ days: [1], timeFrom: 60, timeTo: 120, validTo: '2026-12-01' }), { days: [1], from: 60, to: 120, dateTo: '2026-12-01' });
  const a = K.dayShuffle([1, 2, 3, 4, 5, 6, 7, 8], 'x:2026-11-20');
  assert.deepEqual(K.dayShuffle([1, 2, 3, 4, 5, 6, 7, 8], 'x:2026-11-20'), a);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('plays do sinal de vida: soma por ref, formato, teto de 100, dia de hoje ou ontem', () => {
  const today = '2026-11-20';
  const r = K.cleanPlays({ plays: [{ ref: 'm4', n: 3, sec: 30 }, { ref: 'm4', n: 2, sec: 20.4 }, { ref: 'w:birthdays', n: 1, sec: 12 }, { ref: 'zz', n: 1 }, { ref: 'p1', n: -1 }, { ref: 'p2', n: 0, sec: 0 }], playsDay: '2026-11-19' }, { today });
  assert.equal(r.day, '2026-11-19');
  assert.deepEqual(r.list, [{ ref: 'm4', refKind: 'media', refId: 4, n: 5, sec: 50 }, { ref: 'w:birthdays', refKind: 'birthdays', refId: 0, n: 1, sec: 12 }]);
  assert.equal(K.cleanPlays({ plays: [], playsDay: '2026-10-01' }, { today }).day, today);
  const big = K.cleanPlays({ plays: Array.from({ length: 150 }, (_, i) => ({ ref: `m${i + 1}`, n: 1, sec: 1 })) }, { today });
  assert.equal(big.list.length, 100);
  assert.deepEqual(K.cleanPlays({ plays: 'x' }, { today }).list, []);
});

test('tetos do contrato: 60 itens por zona, 200 arquivos e 80 MB', () => {
  const file = (i, bytes = 1000) => ({ url: `https://cdn.exemplo/${i}.jpg`, sha256: String(i).padStart(64, '0'), bytes });
  const b1 = { zones: { a: Array.from({ length: 70 }, (_, i) => ({ id: `m${i + 1}`, kind: 'image', ...file(i + 1) })) } };
  const b2 = { zones: { a: Array.from({ length: 60 }, (_, i) => ({ id: `m${i + 100}`, kind: 'image', ...file(i + 100) })), b: Array.from({ length: 60 }, (_, i) => ({ id: `m${i + 200}`, kind: 'image', ...file(i + 200) })), c: Array.from({ length: 60 }, (_, i) => ({ id: `m${i + 300}`, kind: 'image', ...file(i + 300) })) } };
  const out = K.applyCaps([b1, b2]);
  assert.equal(b1.zones.a.length, 60);
  assert.equal(out.files, 200);
  assert.equal(b2.zones.c.length, 20, 'o 201º arquivo em diante sai');
  const huge = { zones: { a: [{ id: 'm1', kind: 'image', ...file(1, 2 * 1024 * 1024) }, { id: 'p1', kind: 'slide', fields: { title: 'sem arquivo' } }] } };
  const many = [huge, ...Array.from({ length: 45 }, (_, i) => ({ zones: { a: [{ id: `m${i + 2}`, kind: 'image', ...file(i + 2, 2 * 1024 * 1024) }] } }))];
  const r = K.applyCaps(many);
  assert.ok(r.bytes <= T.TVC_LIMITS.cacheBytes);
  assert.equal(huge.zones.a.length, 2, 'item sem arquivo nunca sai pelo teto');
  // o mesmo arquivo em dois itens conta uma vez
  const same = [{ zones: { a: [{ id: 'm1', kind: 'image', ...file(1) }, { id: 'm2', kind: 'slide', fields: { image: file(1) } }] } }];
  assert.equal(K.applyCaps(same).files, 1);
  assert.equal(K.fileContract('http://x/y.jpg', 'a'.repeat(64), 10), null);
  assert.equal(K.fileContract('https://x/y.jpg', 'a'.repeat(64), 3 * 1024 * 1024), null);
  assert.deepEqual(K.fileContract('https://x/y.jpg', 'a'.repeat(64), 10), { url: 'https://x/y.jpg', sha256: 'a'.repeat(64), bytes: 10 });
});

test('dados segurados por 15 min: o mesmo objeto (o rev não muda), erro mantém o último bom', async () => {
  let t = 0; let calls = 0; let boom = false;
  const h = K.createHold({ now: () => t });
  const fn = async () => { calls++; if (boom) throw new Error('fonte fora'); return { n: calls }; };
  const a = await h.get('k', fn);
  t += 14 * 60_000;
  assert.equal(await h.get('k', fn), a); assert.equal(calls, 1);
  t += 2 * 60_000;
  const b = await h.get('k', fn); assert.notEqual(b, a); assert.equal(calls, 2);
  boom = true; t += 16 * 60_000;
  assert.equal(await h.get('k', fn), b, 'a fonte caiu: fica o último bom');
  h.clear('k'); assert.equal(h.size, 0);
});

test('configurações, opções da imagem, período e CSV sem fórmula', () => {
  const s = K.cleanSettings({ theme: { color: '#ABCDEF', mode: 'light' }, tz: 'America/Recife', approval: 1, categories: ['rh', 'xx', 'rh'], dates: ['natal', 'Dia ruim!', 'natal'], defaultSchedule: '3' }, { outra: 1 });
  assert.deepEqual(s, { outra: 1, theme: { color: '#abcdef', mode: 'light' }, tz: 'America/Recife', approval: true, categories: ['rh'], dates: ['natal'], defaultSchedule: 3 });
  assert.equal(K.settingsDto({}).tz, 'America/Sao_Paulo');
  assert.equal(K.settingsDto({}).categories.length, T.TVC_POST_CATEGORY_KEYS.length);
  err(() => K.cleanSettings({ theme: { color: 'azul' } }), 400);
  assert.deepEqual(K.cleanImageOptions({}), { orientation: 'land', fit: 'cover', bg: '#000000' });
  assert.deepEqual(K.cleanImageOptions({ orientation: 'port', fit: 'contain', bg: 'FFFFFF' }), { orientation: 'port', fit: 'contain', bg: '#ffffff' });
  err(() => K.cleanImageOptions({ fit: 'esticar' }), 400);
  assert.deepEqual(K.cleanPeriod({}, '2026-11-20'), { from: '2026-10-22', to: '2026-11-20' });
  err(() => K.cleanPeriod({ from: '2025-01-01', to: '2026-11-20' }, '2026-11-20'), 400);
  const csv = K.toCsv([{ key: 'a', label: 'Item' }, { key: 'b', label: 'Vezes' }], [{ a: '=HYPERLINK("x")', b: 3 }, { a: 'Texto; com "aspas"', b: 1 }]);
  assert.ok(csv.startsWith('﻿Item;Vezes\r\n'));
  assert.match(csv, /"'=HYPERLINK\(""x""\)";3/);
  assert.match(csv, /"Texto; com ""aspas""";1/);
  assert.equal(K.hoursText(3725), '1 h 02 min');
  assert.equal(K.cleanUrl('https://a.exemplo/x?y=1'), 'https://a.exemplo/x?y=1');
  err(() => K.cleanUrl('https://user:senha@a.exemplo/'), 400);
  assert.equal(K.text('a\u0000b\r\nc\n\n\n\nd', 100), 'a b\nc\n\nd');
});
