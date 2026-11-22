// TV Corporativa, pacote B: as regras puras (docs/TV-CORPORATIVA.md §2.3, §2.4, §7.2 e §7.3). Aniversários SEM ano (nem
// vindo da planilha), nome reduzido, tempo de casa, comunicados (limites, validade, alcance), CSV de ida e volta, datas
// comemorativas (Páscoa e móveis), fontes com provedores falsos (nada de rede), indicadores (número do Brasil, célula,
// caminho, faixas de cor) e widgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../server/tvcorp-rh.js';
import * as F from '../server/tvcorp-fontes.js';
import { cleanWidget, sniffImage } from '../server/tvcorp-dados.js';
import { easter, datesOfYear, datesOn, upcomingDates, cleanDateKeys, DEFAULT_DATE_KEYS } from '../public/shared/tvcorp-datas.js';

test('aniversário: só dia e mês; o ano que vier é descartado', () => {
  assert.deepEqual(R.parseBirthday('20/11'), { day: 20, month: 11 });
  assert.deepEqual(R.parseBirthday('20/11/1990'), { day: 20, month: 11 });
  assert.deepEqual(R.parseBirthday('1990-11-20'), { day: 20, month: 11 });
  assert.deepEqual(R.parseBirthday('29/02/1988'), { day: 29, month: 2 });
  assert.equal(R.parseBirthday(''), null);
  assert.throws(() => R.parseBirthday('31/04'), /calendário/);
  assert.throws(() => R.parseBirthday('ontem'), /dia\/mês/);
  const p = R.cleanPerson({ name: '  Ana   Souza Lima ', birthday: '05/03/1985', hireDate: '03/02/2020', sector: 'Financeiro' });
  assert.deepEqual([p.name, p.bday_day, p.bday_month, p.hire_date, p.sector], ['Ana Souza Lima', 5, 3, '2020-02-03', 'Financeiro']);
  assert.ok(!JSON.stringify(p).includes('1985'), 'o ano de nascimento não sobrevive');
  assert.throws(() => R.cleanPerson({ name: 'A' }), /Nome/);
  assert.equal(R.cleanPerson({ name: 'Bia', photoConsent: 'sim' }).photo_consent, 0, 'só true liga o consentimento');
});

test('nome reduzido como na senha e iniciais', () => {
  assert.equal(R.displayName('Ana Souza Lima'), 'Ana L.');
  assert.equal(R.displayName('João da Silva'), 'João S.');
  assert.equal(R.displayName('Maria dos Santos e Souza'), 'Maria S.');
  assert.equal(R.displayName('Pelé'), 'Pelé');
  assert.equal(R.displayName('Ana Souza Lima', true), 'Ana Souza Lima');
  assert.equal(R.initials('João da Silva'), 'JS');
  assert.equal(R.whoKey('  ÁNA   souza '), 'ana souza');
});

test('aniversariantes da janela, virada do ano e 29/02 no ano que não é bissexto', () => {
  const people = [
    { id: 1, name: 'Ana', bday_day: 31, bday_month: 12, active: 1 },
    { id: 2, name: 'Bia', bday_day: 1, bday_month: 1, active: 1 },
    { id: 3, name: 'Caio', bday_day: 29, bday_month: 2, active: 1 },
    { id: 4, name: 'Davi', bday_day: 2, bday_month: 1, active: 0 },
    { id: 5, name: 'Eva', bday_day: null, bday_month: null, active: 1 },
  ];
  assert.deepEqual(R.birthdaysIn(people, '2026-12-30', 3).map((p) => [p.name, p.date]), [['Ana', '2026-12-31'], ['Bia', '2027-01-01']]);
  assert.deepEqual(R.birthdaysIn(people, '2027-02-28', 1).map((p) => p.name), ['Caio'], '29/02 cai no 28 em 2027');
  assert.deepEqual(R.birthdaysIn(people, '2028-02-28', 1).map((p) => p.name), [], 'em 2028 (bissexto) é no dia 29');
  assert.deepEqual(R.birthdaysIn(people, '2028-02-29', 1).map((p) => p.name), ['Caio']);
});

test('tempo de casa e boas-vindas pela data de admissão', () => {
  const people = [{ id: 1, name: 'Ana', hire_date: '2021-11-22', active: 1 }, { id: 2, name: 'Bia', hire_date: '2026-11-10', active: 1 }, { id: 3, name: 'Caio', hire_date: '2026-11-21', active: 1 }];
  assert.equal(R.yearsOfHouse('2021-11-22', '2026-11-21'), 4);
  assert.equal(R.yearsOfHouse('2021-11-22', '2026-11-22'), 5);
  assert.deepEqual(R.tenureIn(people, '2026-11-20', 7).map((p) => [p.name, p.years, p.date]), [['Ana', 5, '2026-11-22']]);
  assert.equal(R.yearsText(1), '1 ano de casa'); assert.equal(R.yearsText(5), '5 anos de casa');
  assert.deepEqual(R.newHires(people, '2026-11-20', 30).map((p) => p.name), ['Bia'], 'a admissão futura ainda não entra');
});

test('planilha: cabeçalho, ano descartado, unidade pelo nome, erros por linha; exportação sem fórmula', () => {
  const csv = '﻿Nome;Aniversário;Setor;Admissão;Unidade\r\n"Ana Souza";20/11/1990;Financeiro;03/02/2020;Matriz\r\nBia Lima;31/04;RH;;Matriz\r\nCaio;1/1;;;Filial X\r\n"=cmd|calc";2/2;"Setor; com ponto";;\r\n';
  const { rows, errors } = R.importPeopleCsv(csv, { officeOf: (s) => (s === 'Matriz' ? 7 : null) });
  assert.deepEqual(rows.map((r) => [r.line, r.person.name, r.person.bday_day, r.person.bday_month, r.person.office_id]), [[2, 'Ana Souza', 20, 11, 7], [5, '=cmd|calc', 2, 2, null]]);
  assert.deepEqual(errors.map((e) => e.line), [3, 4]);
  assert.match(errors[1].error, /Filial X/);
  assert.ok(!JSON.stringify(rows).includes('1990'));
  const sem = R.importPeopleCsv('Ana;20/11;TI\nBia;05/05;RH');
  assert.deepEqual(sem.rows.map((r) => [r.person.name, r.person.sector]), [['Ana', 'TI'], ['Bia', 'RH']], 'sem cabeçalho: Nome; Aniversário; Setor');
  const out = R.peopleCsv([{ name: '=cmd|calc', sector: 'Setor; com ponto', bday_day: 2, bday_month: 2, hire_date: '2020-02-03', office_id: 7, photo_consent: 0, active: 1 }], () => 'Matriz');
  assert.ok(out.startsWith('﻿Nome;Setor;Aniversário'));
  assert.match(out, /'=cmd\|calc;"Setor; com ponto";02\/02;03\/02\/2020;Matriz;não;sim/);
  assert.throws(() => R.importPeopleCsv('Setor;Aniversário\nTI;1/1'), /planilha precisa da coluna Nome|Nome/);
});

test('comunicado: limites, QR só https, validade e alcance', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const p = R.cleanPost({ category: 'rh', title: 'Férias coletivas', text: 'De 22/12 a 5/1.', qr: 'https://empresa.example/ferias', needsAck: true, validTo: now + 86400_000 }, { now });
  assert.deepEqual([p.category, p.scope, p.scope_data, p.needs_ack, p.qr_url], ['rh', 'all', '{}', 1, 'https://empresa.example/ferias']);
  assert.throws(() => R.cleanPost({ title: 'x' }, { now }), /Título/);
  assert.throws(() => R.cleanPost({ title: 'Oi', category: 'fofoca' }, { now }), /Categoria/);
  assert.throws(() => R.cleanPost({ title: 'Oi', qr: 'http://x.example' }, { now }), /https/);
  assert.throws(() => R.cleanPost({ title: 'Oi', text: 'a\nb\nc\nd\ne\nf\ng\nh\ni' }, { now }), /8 linhas/);
  assert.equal(R.cleanPost({ title: 'Oi', text: 'x'.repeat(400) }, { now }).body.length, 280);
  assert.throws(() => R.cleanPost({ title: 'Oi', validFrom: now, validTo: now - 1 }, { now }), /depois do início/);
  assert.throws(() => R.cleanPost({ title: 'Oi', validTo: now + 400 * 86400_000 }, { now }), /1 ano/);
  const g = R.cleanPost({ title: 'Oi', scope: { kind: 'groups', ids: [3, '3', 4] } }, { now });
  assert.deepEqual([g.scope, JSON.parse(g.scope_data)], ['groups', { ids: [3, 4] }]);
  const row = { status: 'ok', scope: 'groups', scope_data: g.scope_data, office_id: null, valid_from: null, valid_to: now + 1000 };
  assert.equal(R.postActive(row, now), true); assert.equal(R.postActive(row, now + 1000), false);
  assert.equal(R.postHits(row, { officeId: 1, groupIds: [4] }), true);
  assert.equal(R.postHits(row, { officeId: 1, groupIds: [5] }), false);
  assert.equal(R.postHits({ ...row, scope: 'all', office_id: 9 }, { officeId: 1 }), false, 'comunicado da unidade 9 não vai à 1');
  assert.equal(R.postHits({ ...row, scope: 'all', office_id: null }, { officeId: null }), true, 'o celular da empresa vê o que é de todos');
  assert.equal(R.postHits({ ...row, scope: 'offices', scope_data: '{"ids":[1]}' }, { officeId: null }), false);
  assert.throws(() => R.cleanWho(' a '), /nome/);
  assert.deepEqual(R.cleanSuggestion({ text: 'Mais frutas no café', who: 'Ana' }), { kind: 'sugestao', text: 'Mais frutas no café', who: '' }, 'anônima por padrão');
  assert.equal(R.cleanSuggestion({ text: 'Mais frutas', who: 'Ana', anonymous: false }).who, 'Ana');
});

test('datas comemorativas: Páscoa, móveis e campanhas do mês', () => {
  assert.deepEqual(easter(2026), { year: 2026, month: 4, day: 5 });
  assert.deepEqual(easter(2027), { year: 2027, month: 3, day: 28 });
  const y = Object.fromEntries(datesOfYear(2026).map((d) => [d.key, d.date]));
  assert.equal(y.carnaval, '2026-02-17'); assert.equal(y['sexta-santa'], '2026-04-03'); assert.equal(y['corpus-christi'], '2026-06-04');
  assert.equal(y.maes, '2026-05-10'); assert.equal(y.pais, '2026-08-09');
  assert.deepEqual(datesOn('2026-11-20').map((d) => d.key).sort(), ['consciencia-negra', 'novembro-azul']);
  assert.ok(datesOn('2026-11-20').some((d) => d.key === 'consciencia-negra'));
  assert.ok(datesOn('2026-11-03').some((d) => d.key === 'novembro-azul'), 'a campanha vale o mês inteiro');
  assert.ok(!datesOn('2026-11-20', ['natal']).length, 'só as escolhidas');
  assert.deepEqual(upcomingDates('2026-12-20', 15).map((d) => d.key), ['natal', 'ano-novo']);
  assert.deepEqual(cleanDateKeys(['natal', 'inventada', 'natal']), ['natal']);
  assert.deepEqual(cleanDateKeys(undefined), [...DEFAULT_DATE_KEYS]);
});

test('fontes: configuração só com o que é permitido', () => {
  assert.deepEqual(F.cleanFeed('rss', { config: { source: 'agencia-brasil' } }).config, { source: 'agencia-brasil' });
  assert.equal(F.cleanFeed('rss', { config: { source: 'agencia-brasil' } }).name, 'Agência Brasil');
  assert.throws(() => F.cleanFeed('rss', { config: { source: 'portal-comercial' } }), /lista permitida/);
  assert.throws(() => F.cleanFeed('rss', { config: { source: 'own', url: 'http://empresa.example/rss' } }), /https/);
  assert.equal(F.cleanFeed('rss', { config: { source: 'own', url: 'https://empresa.example/rss' } }).config.url, 'https://empresa.example/rss');
  assert.throws(() => F.cleanFeed('quotes', { config: { provider: 'ptax', currencies: ['BTC'] } }), /Moedas/);
  assert.deepEqual(F.cleanFeed('quotes', { config: { currencies: ['usd', 'EUR'] } }).config, { provider: 'awesome', currencies: ['USD', 'EUR'] });
  assert.equal(F.cleanFeed('quotes', { refreshMin: 1 }).refresh_min, 15, 'no mínimo 15 min (o rev não muda a cada minuto)');
  assert.throws(() => F.cleanFeed('weather', { config: { ibge: 12 } }), /município/);
  assert.throws(() => F.cleanFeed('traffic', { config: { mode: 'texto' } }), /aviso/);
  assert.deepEqual(F.cleanFeed('traffic', { config: { mode: 'texto', lines: 'Av. Brasil lenta\n\n' } }).config, { mode: 'texto', lines: ['Av. Brasil lenta'] });
  assert.throws(() => F.cleanFeed('esportes', {}), /Tipo/);
});

const fakeFetcher = (routes, seen = []) => async (url) => {
  seen.push(url);
  for (const [re, body, status = 200] of routes) if (re.test(url)) return { status, text: () => body };
  throw new Error(`rede proibida no teste: ${url}`);
};

test('fontes: RSS limpo (HTML, controle, link só https), AwesomeAPI, PTAX, clima e trânsito por provedores falsos', async () => {
  const xml = '<rss><channel><title>AB</title><item><title><![CDATA[<b>Inflação</b> cai\u0007 em outubro]]></title><link>https://agenciabrasil.ebc.com.br/x</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Sem link seguro</title><link>http://inseguro.example/y</link></item><item><title>ab</title></item></channel></rss>';
  const parseFeed = (s) => ({ items: [...s.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({ title: (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(m[1])?.[1] || '').replace(/<[^>]+>/g, ''), link: /<link>(.*?)<\/link>/.exec(m[1])?.[1] || '', date: Date.parse(/<pubDate>(.*?)<\/pubDate>/.exec(m[1])?.[1] || '') })) });
  const seen = [];
  const deps = { fetcher: fakeFetcher([[/agenciabrasil/, xml], [/awesomeapi/, JSON.stringify({ USDBRL: { bid: '5.31', ask: '5.32', pctChange: '-0.4', timestamp: '1795600000' } })], [/olinda\.bcb/, JSON.stringify({ value: [{ cotacaoCompra: 5.30, cotacaoVenda: 5.31, dataHoraCotacao: '2026-11-19 13:05:00.000', tipoBoletim: 'Fechamento' }, { cotacaoCompra: 5.2, cotacaoVenda: 5.21, dataHoraCotacao: '2026-11-18 13:05:00.000', tipoBoletim: 'Fechamento' }] })]], seen), parseFeed, now: () => 1795650000000 };
  const news = await F.fetchFeed({ kind: 'rss', config: { source: 'agencia-brasil' } }, deps);
  assert.equal(news.source, 'Agência Brasil (EBC) · licença CC BY');
  assert.deepEqual(news.items.map((i) => [i.title, i.link]), [['Inflação cai em outubro', 'https://agenciabrasil.ebc.com.br/x'], ['Sem link seguro', null]]);
  const q = await F.fetchFeed({ kind: 'quotes', config: { provider: 'awesome', currencies: ['USD', 'EUR'] } }, deps);
  assert.deepEqual(q.items.map((i) => [i.code, i.buy, i.sell, i.change]), [['USD', 5.31, 5.32, -0.4]], 'a moeda que não veio fica de fora');
  assert.equal(q.note, 'Valores de referência');
  const pt = await F.fetchFeed({ kind: 'quotes', config: { provider: 'ptax', currencies: ['USD'] } }, deps);
  assert.deepEqual([pt.source, pt.items[0].sell, pt.items[0].bulletin], ['Banco Central do Brasil (PTAX)', 5.31, 'Fechamento'], 'a última cotação do período');
  assert.ok(seen.every((u) => u.startsWith('https://')), 'só https');
  await assert.rejects(F.fetchFeed({ kind: 'quotes', config: { provider: 'awesome', currencies: ['GBP'] } }, deps), /nenhuma das moedas/);
  const weatherOf = async (ibge) => ({ source: 'INMET', place: { city: 'Niterói', uf: 'RJ', ibge: String(ibge) }, now: null, today: { min: 19, max: 27.6, text: 'Muitas nuvens', cond: 'cloudy' }, days: [] });
  const w = await F.fetchFeed({ kind: 'weather', config: { ibge: 3303302 } }, { ...deps, weatherOf });
  assert.deepEqual([w.city, w.tempC, w.min, w.max, w.hasNow, w.source], ['Niterói', 28, 19, 28, false, 'INMET']);
  await assert.rejects(F.fetchFeed({ kind: 'weather', config: { ibge: 3303302 } }, deps), /sem fonte/);
  const t = await F.fetchFeed({ kind: 'traffic', config: { mode: 'rio' } }, { ...deps, trafficOf: async () => ({ ok: true, source: { name: 'COR' }, items: [{ road: 'Centro', status: 'Acidente', at: 1 }] }) });
  assert.deepEqual(t.items, [{ title: 'Centro: Acidente', at: 1 }]);
  assert.deepEqual((await F.fetchFeed({ kind: 'traffic', config: { mode: 'texto', lines: ['Ponte lenta'] } }, deps)).items, [{ title: 'Ponte lenta', at: null }]);
});

test('indicadores: número do Brasil, célula, caminho, faixas e leitura por provedor falso', async () => {
  assert.equal(F.parseNumber('1.234,5'), 1234.5); assert.equal(F.parseNumber('82%'), 82); assert.equal(F.parseNumber('R$ 10,00'), 10);
  assert.equal(F.parseNumber('1,234.5'), 1234.5); assert.equal(F.parseNumber('12.5'), 12.5); assert.equal(F.parseNumber('abc'), null);
  assert.deepEqual(F.parseCell('B2'), { row: 1, col: 1 }); assert.deepEqual(F.parseCell('AA10'), { row: 9, col: 26 });
  assert.equal(F.atPath({ a: { b: [{ c: 3 }] } }, 'a.b.0.c'), 3); assert.equal(F.atPath({ a: 1 }, '__proto__.x'), undefined);
  assert.equal(F.kpiBand({ value: 82, target: 100 }), 'warn'); assert.equal(F.kpiBand({ value: 70, target: 100 }), 'bad'); assert.equal(F.kpiBand({ value: 100, target: 100 }), 'ok');
  assert.equal(F.kpiBand({ value: 3, target: 5, direction: 'down' }), 'ok'); assert.equal(F.kpiBand({ value: 7, target: 5, direction: 'down' }), 'bad');
  assert.equal(F.kpiBand({ value: 50, target: 100, bands: F.cleanBands([{ from: 0, band: 'warn' }, { from: 40, band: 'ok' }]) }), 'ok');
  assert.equal(F.kpiBand({ value: 50, target: null }), null);
  assert.throws(() => F.cleanBands([{ from: 10, band: 'roxo' }]), /cor/);
  const k = F.cleanKpi({ name: 'Vendas do mês', unit: '%', target: '100', source: 'csv', sourceCfg: { url: 'https://docs.example/pub.csv', cell: 'b2' } });
  assert.deepEqual([k.target, k.source, JSON.parse(k.source_cfg).cell], [100, 'csv', 'B2']);
  assert.throws(() => F.cleanKpi({ name: 'X1', source: 'json', sourceCfg: { url: 'https://x.example', path: 'a b' } }), /caminho/);
  assert.throws(() => F.cleanKpi({ name: 'X1', source: 'csv', sourceCfg: { url: 'ftp://x', cell: 'A1' } }), /https/);
  const fetcher = fakeFetcher([[/pub\.csv/, 'Mês;Vendas\nNov;"1.234,5"\n'], [/api\.json/, '{"dados":{"total":"87,5"}}']]);
  assert.equal(await F.fetchKpiValue({ source: 'csv', source_cfg: k.source_cfg }, { fetcher, parseCsv: R.parseCsv }), 1234.5);
  assert.equal(await F.fetchKpiValue({ source: 'json', source_cfg: JSON.stringify({ url: 'https://erp.example/api.json', path: 'dados.total' }) }, { fetcher }), 87.5);
  await assert.rejects(F.fetchKpiValue({ source: 'csv', source_cfg: JSON.stringify({ url: 'https://docs.example/pub.csv', cell: 'A2' }) }, { fetcher, parseCsv: R.parseCsv }), /não tem um número/);
});

test('widgets e o tipo da imagem pelo conteúdo', () => {
  assert.deepEqual(cleanWidget('safety', { data: { lastAccident: '2026-10-01', record: '120', goal: 365 } }).data, { title: 'Dias sem acidente', lastAccident: '2026-10-01', record: 120, goal: 365 });
  assert.throws(() => cleanWidget('worldclock', { data: { zones: ['Marte/Base'] } }), /lista/);
  const m = cleanWidget('menu', { data: { days: { 1: ['Arroz', { name: 'Feijoada', price: '19,90' }], 9: ['ignorado'] }, showPrice: true } }).data;
  assert.deepEqual(m.days, { 1: [{ name: 'Arroz' }, { name: 'Feijoada', price: 19.9 }] });
  assert.throws(() => cleanWidget('countdown', { data: { title: 'SIPAT', at: 'amanhã' } }), /data/);
  assert.throws(() => cleanWidget('horoscopo', {}), /Tipo/);
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg');
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
});
