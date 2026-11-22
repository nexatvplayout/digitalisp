// NEXA Telas, fases 3 e 4 (docs/TELAS.md §10 a §16; contrato §7): as regras sem banco. A ordem de chamada da senha (a
// prioridade legal intercalada, 80+ na frente, as cores do risco), a redução do nome (LGPD), a virada do dia em
// America/Sao_Paulo, os códigos das senhas, a limpeza dos cartões e o cartão do dia, a classificação dos avisos e a janela do
// modo eleitoral, o clima no formato do contrato com o rev segurado por 30 min, os vídeos guardados só com o hash, a ponte do
// EAS e a conta da disponibilidade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';

process.env.DATA_DIR = tmpDir('nexa-telasf3');
const S = await import('../server/telas-senha-core.js');
const K = await import('../server/telas-conteudo-core.js');
const C = await import('../server/telas-core.js');
const TT = await import('../public/shared/telas-tipos.js');
const { settingsOf, cleanSettings } = await import('../server/telas-conteudo.js');

const sp = (iso) => Date.parse(`${iso}-03:00`); // um instante no horário de Brasília
const w = (id, priority = 0, risk = null, queuedAt = id) => ({ id, priority, risk, queuedAt });
/** Chama todo mundo, como o servidor faz: a cada chamada, conta as normais desde a última prioritária. */
const drain = (waiting, opts) => S.orderAll(waiting, opts).map((t) => t.id);

test('senha: prioridade legal intercalada (2 normais para 1 prioritária, configurável), 80+ na frente das outras prioridades', () => {
  // N1 N2 N3 N4 chegam antes das prioritárias P5 P6; 80+ (id 7) chega por último
  const list = [w(1), w(2), w(3), w(4), w(5, 1), w(6, 1), w(7, 2)];
  // começo do dia: a prioritária sai na frente; entre as prioritárias, a de 80+ primeiro; depois 2 normais para cada prioritária
  assert.deepEqual(drain(list, { ratio: 2 }), [7, 1, 2, 5, 3, 4, 6]);
  assert.deepEqual(drain(list, { ratio: 1 }), [7, 1, 5, 2, 6, 3, 4]);
  assert.deepEqual(drain(list, { ratio: 3 }), [7, 1, 2, 3, 5, 4, 6]);
  // acabou de sair uma prioritária (sinceP 0): duas normais antes da próxima
  assert.equal(S.pickNext(list, { ratio: 2, sinceP: 0 }).id, 1);
  assert.equal(S.pickNext(list, { ratio: 2, sinceP: 1 }).id, 1);
  assert.equal(S.pickNext(list, { ratio: 2, sinceP: 2 }).id, 7);
  // sem normal esperando chama a prioritária; sem prioritária, a normal; fila vazia, nada
  assert.equal(S.pickNext([w(5, 1), w(6, 1)], { ratio: 2, sinceP: 0 }).id, 5);
  assert.equal(S.pickNext([w(1), w(2)], { ratio: 2, sinceP: 99 }).id, 1);
  assert.equal(S.pickNext([], {}), null);
  // por chegada dentro de cada grupo (queuedAt, não o id)
  assert.equal(S.pickNext([w(1, 0, null, 50), w(2, 0, null, 10)], { sinceP: 0 }).id, 2);
  // as chamadas do dia, a mais nova primeiro: quantas normais desde a última prioritária
  assert.equal(S.sinceLastPriority([{ priority: 0 }, { priority: 0 }, { priority: 1 }, { priority: 0 }]), 2);
  assert.equal(S.sinceLastPriority([{ priority: 2 }]), 0);
  assert.equal(S.sinceLastPriority([{ priority: 0 }]), Infinity, 'nenhuma prioritária ainda: ela é a próxima');
});

test('senha: classificação de risco (vermelho, laranja, amarelo, verde, azul) e depois a chegada; sem cor segue a regra comum', () => {
  const list = [w(1, 0, 'verde'), w(2, 0, 'azul'), w(3, 0, 'amarelo'), w(4, 1, 'verde'), w(5, 0, 'vermelho'), w(6, 0, 'laranja'), w(7, 0, 'amarelo')];
  assert.deepEqual(drain(list, { useRisk: true, now: 10 }), [5, 6, 3, 7, 1, 4, 2], 'a cor manda; na mesma cor, quem chegou antes (a prioridade legal não fura a cor)');
  // quem ainda não passou pela triagem (sem cor) vem depois de quem tem cor, com a intercalação da prioridade
  assert.deepEqual(drain([w(1), w(2, 1), w(3, 0, 'azul')], { useRisk: true, ratio: 2, now: 10 }), [3, 2, 1]);
  // repartição sem classificação de risco ignora a cor
  assert.deepEqual(drain([w(1, 0, 'azul'), w(2, 0, 'vermelho')], { useRisk: false, sinceP: 0 }), [1, 2]);
  assert.deepEqual(TT.RISK_KEYS, ['vermelho', 'laranja', 'amarelo', 'verde', 'azul']);
  // o resumo do contrato: byRisk na ordem do contrato só com o risco; espera média em minutos
  const dto = S.waitingDto([w(1, 0, 'verde'), w(2, 0, 'verde'), w(3, 0, 'laranja'), w(4)], [10 * 60000, 20 * 60000], { useRisk: true });
  assert.deepEqual(dto, { total: 4, byRisk: { vermelho: 0, laranja: 1, amarelo: 0, verde: 2, azul: 0 }, avgWaitMin: 15 });
  assert.deepEqual(Object.keys(dto.byRisk), ['vermelho', 'laranja', 'amarelo', 'verde', 'azul']);
  assert.deepEqual(S.waitingDto([w(1)], [], { useRisk: false }), { total: 1, byRisk: null, avgWaitMin: null });
  assert.equal(S.cleanRisk('amarelo'), 'amarelo'); assert.equal(S.cleanRisk(''), null);
  assert.throws(() => S.cleanRisk('roxo'), /risco/);
});

test('senha: o nome vai à tela só como primeiro nome + inicial do último sobrenome (LGPD)', () => {
  assert.equal(S.reduceName('Maria Aparecida da Silva'), 'Maria S.');
  assert.equal(S.reduceName('  JOÃO   pedro dos SANTOS  '), 'João S.');
  assert.equal(S.reduceName('ana'), 'Ana');
  assert.equal(S.reduceName('José de Souza Júnior'), 'José S.', 'Júnior, Filho e Neto não são o sobrenome');
  assert.equal(S.reduceName('Ângela d\'Ávila'), "Ângela D.");
  assert.equal(S.reduceName('Carlos 123.456.789-00 Lima'), 'Carlos L.', 'números (CPF, telefone) não passam');
  assert.equal(S.reduceName('Pedro\u0000\n<b>Alves</b>'), 'Pedro B.');
  assert.equal(S.reduceName(''), null); assert.equal(S.reduceName('12345'), null); assert.equal(S.reduceName(null), null);
  assert.ok(S.reduceName('Wolfeschlegelsteinhausenbergerdorff Xavier').length <= 27);
  // a chamada do contrato: o nome só com "mostrar o nome" ligado
  const call = { id: 9, code: 'AP012', desk: 'Guichê 3', name: 'Maria S.', priority: 1, at: 1000 };
  assert.deepEqual(S.callDto(call), { id: 9, ticket: 'AP012', desk: 'Guichê 3', name: null, priority: true, at: 1000, risk: null, service: null });
  // §13: a cor do risco só com a classificação ligada e só uma das cinco
  assert.equal(S.callDto({ ...call, risk: 'laranja' }).risk, null);
  assert.equal(S.callDto({ ...call, risk: 'laranja' }, { risk: true }).risk, 'laranja');
  assert.equal(S.callDto({ ...call, risk: 'roxo' }, { risk: true }).risk, null);
  assert.equal(S.callDto(call, { risk: true }).risk, null);
  assert.equal(S.callDto(call, { showName: true }).name, 'Maria S.');
});

test('senha: serving (contrato §12): a última chamada de cada senha em atendimento, sem a atual, a mais nova primeiro', () => {
  const c = (id, ticket_id) => ({ id, ticket_id });
  // chamadas abertas já em ordem (mais nova primeiro); a 5 é a atual; a 3 é a repetição da senha 30 (já contada pela 4)
  const open = [c(5, 50), c(4, 30), c(3, 30), c(2, 20)];
  assert.deepEqual(S.servingOf(open, c(5, 50)).map((x) => x.id), [4, 2]);
  assert.deepEqual(S.servingOf(open, null).map((x) => x.id), [5, 4, 2]);
  assert.deepEqual(S.servingOf([], c(5, 50)), []);
  const many = Array.from({ length: 20 }, (_, i) => c(100 - i, 100 - i));
  assert.equal(S.servingOf(many, null).length, S.SERVING_MAX);
});

test('senha: o dia é o de America/Sao_Paulo (a numeração vira à meia-noite de Brasília), códigos e letras', () => {
  assert.equal(S.localDay(sp('2026-11-10T23:59:59')).day, '2026-11-10');
  assert.equal(S.localDay(sp('2026-11-11T00:00:00')).day, '2026-11-11');
  assert.equal(S.localDay(Date.parse('2026-11-11T02:30:00Z')).day, '2026-11-10', '02:30 UTC ainda é dia 10 em Brasília');
  assert.equal(S.localDay(sp('2026-11-10T12:00:00')).weekday, 2, 'terça');
  assert.equal(S.localDay(sp('2026-11-15T12:00:00')).weekday, 0, 'domingo');
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28'); assert.equal(S.cleanDay('2026-02-31'), null); assert.equal(S.cleanDay('2026-02-28'), '2026-02-28');
  assert.equal(S.ticketCode('A', 0, 1), 'A001'); assert.equal(S.ticketCode('A', 1, 12), 'AP012'); assert.equal(S.ticketCode('TR', 2, 1000), 'TRP1000');
  assert.equal(S.cleanPrefix(' a '), 'A'); assert.equal(S.cleanPrefix('é'), 'E'); assert.equal(S.cleanPrefix('ab'), 'AB');
  for (const bad of ['', 'A1', 'ABCD', '1', 'A B']) assert.throws(() => S.cleanPrefix(bad), /Letra/, bad);
  // "A" com prioridade usa A e AP: outra fila "AP" confundiria
  assert.ok(S.prefixClash({ prefix: 'AP', priority: 0 }, [{ prefix: 'A', priority: 1, name: 'Geral' }]));
  assert.ok(S.prefixClash({ prefix: 'A', priority: 1 }, [{ prefix: 'A', priority: 0 }]));
  assert.equal(S.prefixClash({ prefix: 'AP', priority: 0 }, [{ prefix: 'A', priority: 0 }]), null);
  assert.equal(S.prefixClash({ prefix: 'B', priority: 1 }, [{ prefix: 'A', priority: 1 }]), null);
  assert.equal(S.cleanPriority(true, { priority: 1 }), 1); assert.equal(S.cleanPriority(2, { priority: 1 }), 2); assert.equal(S.cleanPriority(undefined, { priority: 0 }), 0);
  assert.throws(() => S.cleanPriority(1, { priority: 0 }), /prioritária/); assert.throws(() => S.cleanPriority(3, { priority: 1 }), /Prioridade/);
  // configuração: risco nasce ligado na UPA e no hospital
  assert.equal(S.queueConfigOf(null, 'upa').risk, true); assert.equal(S.queueConfigOf(null, 'hospital').risk, true); assert.equal(S.queueConfigOf(null, 'ubs').risk, false);
  assert.deepEqual(S.queueConfigOf({ ratio: 9, title: ' Recepção ' }, 'ubs'), { title: 'Recepção', voice: true, showName: false, ratio: 2, print: false, risk: false, targets: { vermelho: 0, laranja: 10, amarelo: 60, verde: 120, azul: 240 }, ageBoost: true, escalate: true, pair: [] });
  assert.equal(S.cleanQueueConfig({ ratio: 3, showName: true }, null, 'ubs').ratio, 3);
  assert.throws(() => S.cleanQueueConfig({ ratio: 0 }, null, 'ubs'), /Intercalação/); assert.throws(() => S.cleanQueueConfig({ voice: 'sim' }, null, 'ubs'), /verdadeiro/);
  // CSV: fórmula não passa
  assert.equal(S.csvLine(['=1+1', 'a;b', 'x"y', 3]), '\'=1+1;"a;b";"x""y";3');
});

test('catálogo: a chamada de senha e os cartões deixaram de ser "em breve"; layout e bloco queue valem', () => {
  assert.equal(TT.MODULES.filter((m) => m.soon).length, 0);
  assert.deepEqual(TT.MODULE_KEYS, ['avisos', 'senha', 'escala', 'merenda', 'calendario', 'vagas', 'sessao', 'agenda', 'linhas', 'panico', 'interna']);
  assert.ok(TT.MODULE.aprovacao.tenant && !TT.MODULE_KEYS.includes('aprovacao'), 'a aprovação é da prefeitura inteira');
  assert.ok(TT.LAYOUT_KEYS.includes('queue') && TT.WIDGET_KEYS.includes('queue'));
  assert.equal(TT.officeModules('upa', null).senha, true); assert.equal(TT.officeModules('escola', null).merenda, true); assert.equal(TT.officeModules('escola', null).senha, false);
  assert.deepEqual(TT.officeCardKinds(TT.officeModules('escola', null)), ['merenda', 'calendario', 'unidade']);
  assert.deepEqual(TT.officeCardKinds(TT.officeModules('outro', null)), ['unidade']);
  for (const k of TT.CARD_KINDS) assert.ok(k.module === null || TT.MODULE[k.module]?.card === k.key, k.key);
  // a tela sem a chamada de senha ligada não recebe o layout nem o bloco queue
  const eff = { ...C.FACTORY, layout: 'queue', widgets: ['clock', 'queue'], pin: { hash: 'h', salt: 's' } };
  const base = { eff, device: { id: 1, name: 'T' }, office: { name: 'O', type: 'ubs' }, region: null, stream: { hls: 'https://x/y.m3u8' } };
  const off = C.contractConfig(base);
  assert.equal(off.layout, 'full'); assert.deepEqual(off.side.widgets, ['clock']); assert.deepEqual(off.queue, { enabled: false, voice: false, title: null, showName: false, pair: [] });
  assert.equal(off.weather, null); assert.deepEqual(off.cards, []); assert.deepEqual(off.offline, { items: [], image: null });
  const on = C.contractConfig({ ...base, queue: { enabled: true, voice: true, title: 'Atendimento', showName: false } });
  assert.equal(on.layout, 'queue'); assert.deepEqual(on.side.widgets, ['clock', 'queue']); assert.deepEqual(on.queue, { enabled: true, voice: true, title: 'Atendimento', showName: false, pair: [] });
});

test('cartões: limpeza pelos limites do contrato (título 60, 8 linhas de 90, 3 a 120 s) e o cartão do dia da semana', () => {
  const c = K.cleanCard({ kind: 'merenda', title: `  ${'T'.repeat(80)} `, lines: `Arroz e feijão\n\n  ${'x'.repeat(120)}\r\nFruta:\u0007 banana`, weekday: 2 }, null);
  assert.equal(c.title.length, 60); assert.deepEqual(c.lines.map((l) => l.length), [14, 90, 13]); assert.equal(c.lines[2], 'Fruta: banana');
  assert.equal(c.weekday, 2); assert.equal(c.seconds, 10); assert.equal(c.class, 'utilidade');
  assert.equal(K.cleanCard({ kind: 'merenda', lines: ['a'] }, null).title, 'Merenda de hoje', 'sem título: o do modelo');
  assert.equal(K.cleanCard({ kind: 'unidade', lines: ['a'], weekday: 7 }, null).weekday, 0);
  for (const [bad, re] of [[{ kind: 'x', lines: ['a'] }, /Tipo/], [{ kind: 'merenda', lines: [] }, /ao menos uma/], [{ kind: 'merenda', lines: Array(9).fill('a') }, /8 linhas/], [{ kind: 'merenda', lines: ['a'], seconds: 2 }, /Tempo/],
    [{ kind: 'merenda', lines: ['a'], seconds: 121 }, /Tempo/], [{ kind: 'merenda', lines: ['a'], weekday: 9 }, /Dia da semana/], [{ kind: 'merenda', lines: ['a'], dateFrom: '2026-13-01' }, /data/],
    [{ kind: 'merenda', lines: ['a'], dateFrom: '2026-11-10', dateTo: '2026-11-09' }, /último dia/], [{ kind: 'merenda', lines: ['a'], class: 'propaganda' }, /Classificação/]]) assert.throws(() => K.cleanCard(bad, null), re, JSON.stringify(bad));
  assert.throws(() => K.cleanCard({ kind: 'merenda', lines: ['a'] }, null, { kinds: ['unidade'] }), /desligado/, 'tipo de um módulo desligado na repartição');
  // alteração: campo ausente fica
  assert.deepEqual(K.cleanCard({ seconds: 20 }, c).lines, c.lines);

  const card = (id, kind, extra = {}) => ({ id, kind, title: `C${id}`, lines: ['linha'], weekday: null, dateFrom: null, dateTo: null, sort: 0, seconds: 10, class: 'utilidade', ...extra });
  const cards = [card(1, 'merenda', { weekday: 1, title: 'Segunda' }), card(2, 'merenda', { weekday: 2, title: 'Terça' }), card(3, 'unidade', { sort: -1 }), card(4, 'agenda', { dateFrom: '2026-11-11', dateTo: '2026-11-20' }),
    card(5, 'unidade', { class: 'institucional' }), card(6, 'vagas')];
  const kinds = ['merenda', 'unidade', 'agenda'];
  const tue = K.cardsFor(cards, { now: sp('2026-11-10T08:00:00'), kinds });
  assert.deepEqual(tue.map((x) => x.id), ['unidade-3', 'merenda-2', 'unidade-5'], 'terça: a merenda de terça; a agenda ainda não começou; vagas fora dos módulos');
  assert.deepEqual(tue[1], { id: 'merenda-2', title: 'Terça', lines: ['linha'], seconds: 10 });
  assert.deepEqual(K.cardsFor(cards, { now: sp('2026-11-10T23:59:00'), kinds }).map((x) => x.id), ['unidade-3', 'merenda-2', 'unidade-5']);
  assert.deepEqual(K.cardsFor(cards, { now: sp('2026-11-11T00:00:30'), kinds }).map((x) => x.id), ['unidade-3', 'agenda-4', 'unidade-5'], 'quarta à meia-noite de Brasília: sem merenda de quarta, a agenda começa');
  assert.deepEqual(K.cardsFor(cards, { now: sp('2026-11-16T10:00:00'), kinds }).map((x) => x.id), ['unidade-3', 'merenda-1', 'agenda-4', 'unidade-5'], 'segunda');
  assert.deepEqual(K.cardsFor(cards, { now: sp('2026-11-16T10:00:00'), kinds, electoral: true }).map((x) => x.id), ['unidade-3', 'merenda-1', 'agenda-4'], 'período eleitoral: o institucional fica retido');
  assert.equal(K.cardsFor(Array.from({ length: 30 }, (_, i) => card(i + 1, 'unidade')), { now: Date.now(), kinds }).length, 12, 'no máximo 12 por tela');
});

test('modo eleitoral: a janela em America/Sao_Paulo, a classificação dos avisos e o que fica retido', () => {
  const e = K.cleanElectoral({ from: '2026-08-16', to: '2026-10-25' });
  assert.deepEqual(e, { from: '2026-08-16', to: '2026-10-25' });
  assert.equal(K.electoralOn(e, sp('2026-08-15T23:59:59')), false);
  assert.equal(K.electoralOn(e, sp('2026-08-16T00:00:00')), true, 'começa à meia-noite de Brasília');
  assert.equal(K.electoralOn(e, Date.parse('2026-08-16T02:59:00Z')), false, '02:59 UTC do dia 16 ainda é dia 15 em Brasília');
  assert.equal(K.electoralOn(e, Date.parse('2026-08-16T03:00:00Z')), true);
  assert.equal(K.electoralOn(e, sp('2026-10-25T23:59:59')), true, 'o último dia inteiro');
  assert.equal(K.electoralOn(e, sp('2026-10-26T00:00:00')), false);
  assert.equal(K.electoralOn(null, Date.now()), false);
  assert.equal(K.cleanElectoral(null), null); assert.equal(K.cleanElectoral({ from: '', to: '' }), null);
  for (const bad of [{ from: '2026-10-25', to: '2026-08-16' }, { from: '2026-08-16' }, { from: 'ontem', to: 'hoje' }, { from: '2026-01-01', to: '2027-06-01' }, 'sempre']) assert.throws(() => K.cleanElectoral(bad), /Modo eleitoral/, JSON.stringify(bad));
  // avisos: a marca da classificação fica guardada na forma canônica e sai antes de ir à tela
  const items = C.cleanTicker(['Vacinação até sexta.', ' [INSTITUCIONAL]   Nova praça entregue. ', '[emergencia] Evite a Rua Um.', '[utilidade pública] Posto aberto.', '[institucional]   ']);
  assert.deepEqual(items, ['Vacinação até sexta.', '[institucional] Nova praça entregue.', '[emergência] Evite a Rua Um.', 'Posto aberto.']);
  assert.deepEqual(K.tickerTexts(items, false), ['Vacinação até sexta.', 'Nova praça entregue.', 'Evite a Rua Um.', 'Posto aberto.']);
  assert.deepEqual(K.tickerTexts(items, true), ['Vacinação até sexta.', 'Evite a Rua Um.', 'Posto aberto.'], 'no período, o institucional não vai (os outros vão)');
  assert.equal(K.withheld('institucional', true), true); assert.equal(K.withheld('institucional', false), false); assert.equal(K.withheld('utilidade', true), false); assert.equal(K.withheld('emergencia', true), false);
  assert.equal(K.cleanClass(undefined), 'utilidade', 'o padrão é utilidade pública; institucional se escolhe');
  // o padrão da prefeitura: de fábrica tudo desligado, menos a ponte do alerta de emergência
  assert.deepEqual(settingsOf({}), { cidade: null, electoral: null, approval: false, eas: true, notify: { offline: false, afterMin: 10 } });
  const st = cleanSettings({ electoral: { from: '2026-08-16', to: '2026-10-25' }, approval: true, eas: false, cidade: { uf: 'RJ', city: 'niteroi' }, notify: { offline: true, afterMin: 30 } }, {});
  assert.deepEqual(st.cidade, { uf: 'RJ', city: 'Niterói', ibge: 3303302 }); assert.equal(st.approval, true); assert.equal(st.eas, false); assert.deepEqual(st.notify, { offline: true, afterMin: 30 });
  assert.throws(() => cleanSettings({ cidade: { uf: 'RJ', city: 'Cidade Que Não Existe' } }, {}), /Cidade/);
  assert.throws(() => cleanSettings({ approval: 'sim' }, {}), /verdadeiro/); assert.throws(() => cleanSettings({ notify: { afterMin: 1 } }, {}), /5 minutos/);
  assert.deepEqual(cleanSettings({}, st), st, 'campo ausente fica como está');
});

test('clima: o formato do contrato e o rev segurado (o mesmo objeto por 30 min; a busca é em segundo plano)', async () => {
  const f = (temp) => ({ place: { city: 'Niterói' }, now: { temp, text: 'Parcialmente nublado', cond: 'partly' }, today: { max: 31, min: 22, text: 'Sol', cond: 'clear' } });
  assert.deepEqual(K.weatherContract(f(27.4), 5000), { city: 'Niterói', tempC: 27, condition: 'Parcialmente nublado', icon: 'partly', at: 5000 });
  // INMET não tem "agora": a máxima de hoje; condição desconhecida vira "cloudy"; sem número, sem clima
  assert.deepEqual(K.weatherContract({ place: { city: 'X' }, now: null, today: { max: 31, min: 22, text: 'Muitas nuvens', cond: 'unknown' } }, 1), { city: 'X', tempC: 31, condition: 'Muitas nuvens', icon: 'cloudy', at: 1 });
  assert.equal(K.weatherContract({ place: { city: 'X' }, now: null, today: { max: null, min: null } }, 1), null); assert.equal(K.weatherContract(null), null);

  let t = 1_000_000; let temp = 20; let calls = 0; let fail = false;
  const hold = K.createWeatherHold({ now: () => t, fetch: async () => { calls++; if (fail) throw new Error('fora'); return f(temp); } });
  assert.equal(hold.get(3303302), null, 'a 1ª configuração não espera o provedor');
  const first = await hold.settle(3303302);
  assert.equal(first.tempC, 20); assert.equal(first.at, 1_000_000); assert.equal(calls, 1);
  const rev = (v) => C.revOf({ weather: v });
  const r0 = rev(hold.get(3303302));
  // a temperatura muda lá fora a cada minuto: por 30 min a tela recebe o MESMO objeto (o rev não muda)
  for (let m = 1; m < 30; m++) { t += 60_000; temp += 1; assert.equal(rev(hold.get(3303302)), r0, `minuto ${m}`); }
  assert.equal(calls, 1, 'nenhuma busca antes dos 30 min');
  t += 60_000; hold.get(3303302); const second = await hold.settle(3303302);
  assert.equal(calls, 2); assert.equal(second.tempC, 49); assert.equal(second.at, t, 'o at renova a cada 30 min (o app esconde o clima com mais de 3 h)');
  assert.notEqual(rev(second), r0);
  // em 3 horas, no máximo 6 valores diferentes
  const revs = new Set();
  for (let m = 0; m < 180; m++) { t += 60_000; temp += 1; hold.get(3303302); await hold.settle(3303302); revs.add(rev(hold.get(3303302))); }
  assert.ok(revs.size <= 7, `${revs.size} valores em 3 h`);
  // provedor fora: o último valor continua (com o at antigo) e a nova tentativa espera 5 min; depois de 6 h some
  fail = true; const before = calls; const kept = hold.get(3303302);
  t += 31 * 60_000; hold.get(3303302); await hold.settle(3303302);
  assert.deepEqual(hold.get(3303302), kept); assert.equal(calls, before + 1);
  t += 60_000; hold.get(3303302); await hold.settle(3303302); assert.equal(calls, before + 1, 'falhou há 1 min: ainda não tenta de novo');
  t += 7 * 3600_000; hold.get(3303302); await hold.settle(3303302);
  assert.equal(hold.get(3303302), null, 'previsão de mais de 6 h não vai à tela');
  assert.equal(hold.get(null), null);
});

test('vídeos guardados: só com SHA-256, tamanho e https; sem repetir; o institucional retido no período eleitoral', () => {
  const sha = 'a'.repeat(64);
  const rows = [
    { mediaId: 1, url: 'https://midia.exemplo.test/media/a.mp4', sha256: sha, bytes: 1000, class: 'utilidade' },
    { mediaId: 2, url: 'https://midia.exemplo.test/media/b.mp4', sha256: null, bytes: 2000, class: 'utilidade' }, // hash ainda não calculado
    { mediaId: 3, url: 'http://midia.exemplo.test/media/c.mp4', sha256: sha, bytes: 3000, class: 'utilidade' }, // sem https
    { mediaId: 1, url: 'https://midia.exemplo.test/media/a.mp4', sha256: sha, bytes: 1000, class: 'utilidade' }, // repetido (grupo + repartição)
    { mediaId: 4, url: 'https://midia.exemplo.test/media/d.mp4', sha256: sha, bytes: 4000, class: 'institucional' },
    { mediaId: 5, url: 'https://midia.exemplo.test/media/e.mp4', sha256: sha, bytes: 0, class: 'utilidade' },
    { mediaId: 6, url: null, sha256: sha, bytes: 10, class: 'utilidade' },
  ];
  assert.deepEqual(K.offlineItems(rows), [{ url: 'https://midia.exemplo.test/media/a.mp4', sha256: sha, bytes: 1000 }, { url: 'https://midia.exemplo.test/media/d.mp4', sha256: sha, bytes: 4000 }]);
  assert.deepEqual(K.offlineItems(rows, { electoral: true }).map((x) => x.bytes), [1000]);
  assert.equal(K.offlineItems(Array.from({ length: 40 }, (_, i) => ({ mediaId: i + 1, url: `https://m.test/${i}.mp4`, sha256: sha, bytes: 1, class: 'utilidade' }))).length, TT.LIMITS.offlineSent);
});

test('EAS: o alerta de emergência do canal vira um alerta critical, com id próprio (acima de 1 bilhão, em 32 bits)', () => {
  const now = 1_800_000_000_000;
  const a = K.easAlert({ id: 42, event: 'Chuvas Intensas', headline: 'Alerta laranja', description: 'Chuva de 50 mm/h.', instruction: 'Evite áreas de risco.', endAt: now + 600_000, expires: now + 3600_000, tone: true }, now);
  assert.deepEqual(a, { id: 1_000_000_042, title: 'Chuvas Intensas', text: 'Alerta laranja\nChuva de 50 mm/h.\nEvite áreas de risco.', level: 'critical', sound: true, until: now + 600_000 });
  assert.ok(K.easAlert({ id: 3_500_000_000 }, now).id < 2 ** 31);
  const b = K.easAlert({ id: 1, event: '', description: 'x'.repeat(900), endAt: now - 5, expires: null }, now);
  assert.equal(b.title, 'Alerta de emergência'); assert.equal(b.text.length, 500); assert.equal(b.until, now + 600_000, 'sem fim conhecido: 10 minutos (volta a cada sinal de vida)'); assert.equal(b.sound, false);
});

test('tela desligada: a disponibilidade em uma janela (o tempo antes da 1ª situação conhecida não conta)', () => {
  const h = 3600_000; const to = 100 * h; const from = to - 24 * h;
  // no ar desde antes da janela, desligada por 6 h no meio, sem imagem por 2 h
  const ev = [{ status: 'on', at: from - 5 * h }, { status: 'off', at: from + 4 * h }, { status: 'on', at: from + 10 * h }, { status: 'warn', at: from + 20 * h }, { status: 'on', at: from + 22 * h }];
  const a = K.availability(ev, { from, to });
  assert.equal(a.observedMs, 24 * h); assert.equal(a.onMs, 16 * h); assert.equal(a.pct, 66.7);
  // tela nova: ligou há 6 h e ficou; conta só o que existe
  assert.deepEqual(K.availability([{ status: 'on', at: to - 6 * h }], { from, to }), { pct: 100, onMs: 6 * h, observedMs: 6 * h });
  assert.equal(K.availability([{ status: 'off', at: from - h }], { from, to }).pct, 0);
  assert.equal(K.availability([], { from, to }).pct, null);
  assert.equal(K.availability([{ status: 'on', at: to + h }], { from, to }).pct, null, 'mudança depois da janela não conta');
  assert.equal(K.agoText(12 * 60000), '12 min'); assert.equal(K.agoText(5 * h), '5 h'); assert.equal(K.agoText(72 * h), '3 dias');
});
