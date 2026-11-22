// NEXA Telas, chamada de senha: a ordem de chamada (server/telas-senha-core.js, rankQueue) com a classificação de risco do
// Protocolo de Manchester (vermelho imediato, tempo-alvo de cada cor, atraso relativo, verde/azul que sobem de nível), a
// idade (80+ e 60+/preferencial) e a intercalação normal x preferencial; o motivo de cada posição; a configuração antiga
// (= os padrões); e o catálogo de "tipo de problema" da Triagem (public/shared/triagem-catalogo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';

process.env.DATA_DIR = tmpDir('nexa-senha-ordem');
const S = await import('../server/telas-senha-core.js');
const T = await import('../public/shared/triagem-catalogo.js');
const TT = await import('../public/shared/telas-tipos.js');

const MIN = 60000;
const NOW = 10_000 * MIN;
/** Uma senha que chegou há `ago` minutos. */
const tk = (id, { p = 0, risk = null, ago = 0 } = {}) => ({ id, priority: p, risk, queuedAt: NOW - ago * MIN, issuedAt: NOW - ago * MIN });
const ids = (list, opts = {}) => S.orderAll(list, { useRisk: true, now: NOW, ...opts }).map((t) => t.id);
const why = (list, opts = {}) => Object.fromEntries(S.rankQueue(list, { useRisk: true, now: NOW, ...opts }).map((x) => [x.t.id, x.reason]));

test('ordem: vermelho fura tudo; entre vermelhos, o mais antigo', () => {
  const list = [tk(1, { risk: 'laranja', ago: 50 }), tk(2, { p: 2, ago: 90 }), tk(3, { risk: 'vermelho', ago: 1 }), tk(4, { risk: 'vermelho', ago: 5 }), tk(5, { risk: 'verde', ago: 600 })];
  assert.deepEqual(ids(list).slice(0, 2), [4, 3]);
  assert.equal(S.pickNext(list, { useRisk: true, now: NOW }).id, 4);
  // vermelho não espera proporção nenhuma (sinceP 0, ratio 5) nem a idade
  assert.equal(S.pickNext([tk(1, { p: 2, risk: 'vermelho', ago: 0 }), tk(2, { risk: 'vermelho', ago: 3 })], { useRisk: true, now: NOW, sinceP: 0, ratio: 5 }).id, 2);
  assert.match(why(list)[3], /^vermelho: imediato/);
});

test('ordem: laranja vencido passa amarelo; laranja recém-chegado também (ninguém passa um laranja)', () => {
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 50 }), tk(2, { risk: 'laranja', ago: 12 })]), [2, 1]);
  assert.match(why([tk(2, { risk: 'laranja', ago: 12 })])[2], /laranja há 12 min: passou do alvo de 10 min/);
  assert.deepEqual(ids([tk(1, { risk: 'verde', ago: 900 }), tk(2, { risk: 'azul', ago: 5000 }), tk(3, { risk: 'laranja', ago: 0 })]), [3, 2, 1], 'o azul há 83 h (20x o alvo) passa o verde há 15 h (7,5x); os dois no nível do amarelo, atrás do laranja');
});

test('ordem: verde antigo acaba passando o amarelo recém-chegado (sem fome); azul sobe de nível aos poucos', () => {
  // verde há 125 min (passou do alvo de 120): nível do amarelo, com atraso 1,04 > 0 do amarelo novo
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 1 }), tk(2, { risk: 'verde', ago: 125 })]), [2, 1]);
  assert.match(why([tk(2, { risk: 'verde', ago: 125 })])[2], /verde há 125 min: passou do alvo de 120 min, sobe ao nível do amarelo/);
  // verde há 100 min (ainda no alvo) fica atrás do amarelo
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 1 }), tk(2, { risk: 'verde', ago: 100 })]), [1, 2]);
  // amarelo há 50 min (0,83 do alvo) segue na frente do verde há 125 (1,04)? não: o maior atraso relativo vence
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 50 }), tk(2, { risk: 'verde', ago: 125 })]), [2, 1]);
  // azul há 250 min: nível do verde (passa o verde novo, não o amarelo); há 500 min: nível do amarelo
  assert.deepEqual(ids([tk(1, { risk: 'verde', ago: 0 }), tk(2, { risk: 'azul', ago: 250 }), tk(3, { risk: 'amarelo', ago: 0 })]), [3, 2, 1]);
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 10 }), tk(2, { risk: 'azul', ago: 500 })]), [2, 1]);
  // sem "o atraso sobe de nível": a cor manda
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 1 }), tk(2, { risk: 'verde', ago: 125 })], { escalate: false }), [1, 2]);
});

test('ordem: dentro da mesma cor, o mais antigo; a idade acelera (80+ 1,5x, 60+ 1,25x) e desempata', () => {
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 10 }), tk(2, { risk: 'amarelo', ago: 30 }), tk(3, { risk: 'amarelo', ago: 20 })]), [2, 3, 1]);
  // 80+ há 22 min conta 33 > 30
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 30 }), tk(2, { p: 2, risk: 'amarelo', ago: 22 })]), [2, 1]);
  assert.match(why([tk(2, { p: 2, risk: 'amarelo', ago: 22 })])[2], /80\+ acelera/);
  // 60+ há 22 min conta 27,5 < 30
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 30 }), tk(2, { p: 1, risk: 'amarelo', ago: 22 })]), [1, 2]);
  // empate (chegaram juntos): 80+, depois 60+, depois a normal
  assert.deepEqual(ids([tk(1, { risk: 'verde', ago: 0 }), tk(2, { p: 1, risk: 'verde', ago: 0 }), tk(3, { p: 2, risk: 'verde', ago: 0 })]), [3, 2, 1]);
  // a idade não fura a cor
  assert.deepEqual(ids([tk(1, { p: 2, risk: 'verde', ago: 100 }), tk(2, { risk: 'amarelo', ago: 0 })]), [2, 1]);
  // sem "a idade acelera": só a espera
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 30 }), tk(2, { p: 2, risk: 'amarelo', ago: 22 })], { ageBoost: false }), [1, 2]);
});

test('ordem: a espera da cor conta desde a emissão (encaminhar não zera o relógio)', () => {
  const a = { id: 1, priority: 0, risk: 'verde', issuedAt: NOW - 130 * MIN, queuedAt: NOW - 1 * MIN }; // encaminhada agora
  const b = tk(2, { risk: 'amarelo', ago: 5 });
  assert.deepEqual(ids([a, b]), [1, 2]);
});

test('ordem: tempos-alvo da repartição mudam a conta', () => {
  // amarelo com alvo de 30 min: há 31 min passou do alvo
  assert.match(why([tk(1, { risk: 'amarelo', ago: 31 })], { targets: { laranja: 10, amarelo: 30, verde: 120, azul: 240 } })[1], /passou do alvo de 30 min/);
  // verde com alvo de 60: há 61 min sobe ao nível do amarelo e passa o amarelo novo
  assert.deepEqual(ids([tk(1, { risk: 'amarelo', ago: 0 }), tk(2, { risk: 'verde', ago: 61 })], { targets: { laranja: 10, amarelo: 60, verde: 60, azul: 240 } }), [2, 1]);
});

test('ordem sem triagem: 80+ antes de 60+; proporção normal x preferencial; motivo', () => {
  const list = [tk(1, { ago: 40 }), tk(2, { ago: 39 }), tk(3, { ago: 38 }), tk(4, { p: 1, ago: 37 }), tk(5, { p: 2, ago: 10 }), tk(6, { p: 1, ago: 36 })];
  // começo do dia: preferencial na frente (80+ primeiro), depois 2 normais para cada preferencial
  assert.deepEqual(ids(list, { useRisk: false, ratio: 2 }), [5, 1, 2, 4, 3, 6]);
  assert.deepEqual(ids(list, { useRisk: false, ratio: 1 }), [5, 1, 4, 2, 6, 3]);
  assert.deepEqual(ids(list, { useRisk: false, ratio: 2, sinceP: 0 }), [1, 2, 5, 3, 4, 6]);
  const w = why(list, { useRisk: false, ratio: 2 });
  assert.match(w[5], /^80\+: prioridade especial/); assert.match(w[4], /^preferencial \(1 a cada 2 normais\)/); assert.equal(w[1], 'ordem de chegada');
  // com o risco ligado: quem tem cor vem antes; quem não tem leva "sem triagem"
  const mixed = [tk(1, { ago: 60 }), tk(2, { risk: 'azul', ago: 0 })];
  assert.deepEqual(ids(mixed), [2, 1]);
  assert.equal(why(mixed)[1], 'sem triagem · ordem de chegada');
  // repartição sem classificação de risco ignora a cor
  assert.deepEqual(ids([tk(1, { risk: 'azul', ago: 5 }), tk(2, { risk: 'vermelho', ago: 1 })], { useRisk: false, sinceP: 0 }), [1, 2]);
});

test('configuração: a antiga (sem os campos novos) vale como o padrão; tempos-alvo validados', () => {
  const old = S.queueConfigOf({ title: 'Recepção', ratio: 3, risk: true }, 'upa');
  assert.deepEqual(old.targets, { vermelho: 0, laranja: 10, amarelo: 60, verde: 120, azul: 240 });
  assert.equal(old.ageBoost, true); assert.equal(old.escalate, true); assert.equal(old.ratio, 3);
  assert.deepEqual(S.queueConfigOf({ targets: { laranja: 'x', amarelo: 45, verde: -1 } }, 'upa').targets, { vermelho: 0, laranja: 10, amarelo: 45, verde: 120, azul: 240 });
  const c = S.cleanQueueConfig({ targets: { amarelo: 30 }, ageBoost: false }, { ratio: 2 }, 'hospital');
  assert.deepEqual([c.targets.amarelo, c.targets.laranja, c.ageBoost, c.escalate, c.risk], [30, 10, false, true, true]);
  assert.throws(() => S.cleanQueueConfig({ targets: { verde: 0 } }, null, 'upa'), /de 1 a 1440/);
  assert.throws(() => S.cleanQueueConfig({ targets: { laranja: 90 } }, null, 'upa'), /não pode ser menor/);
  assert.throws(() => S.cleanQueueConfig({ targets: [1] }, null, 'upa'), /Tempos-alvo/);
  assert.throws(() => S.cleanQueueConfig({ escalate: 'sim' }, null, 'upa'), /verdadeiro/);
  // as opções da ordem vindas da configuração antiga dão a mesma ordem que as de fábrica
  const list = [tk(1, { risk: 'amarelo', ago: 1 }), tk(2, { risk: 'verde', ago: 125 }), tk(3, { p: 1, ago: 3 })];
  assert.deepEqual(ids(list, { targets: old.targets, ageBoost: old.ageBoost, escalate: old.escalate }), ids(list));
});

test('catálogo da Triagem: cada tipo leva à cor certa, todo nível tem itens, tempos e nomes do protocolo', () => {
  assert.deepEqual(T.TRIAGE_LEVELS.map((l) => l.key), TT.RISK_KEYS, 'os níveis na ordem das cores do contrato');
  assert.deepEqual(T.TRIAGE_LEVELS.map((l) => l.level), ['Emergência', 'Muito urgente', 'Urgente', 'Pouco urgente', 'Não urgente']);
  assert.deepEqual(T.TRIAGE_TARGETS, { vermelho: 0, laranja: 10, amarelo: 60, verde: 120, azul: 240 });
  for (const l of T.TRIAGE_LEVELS) assert.ok(T.TRIAGE_PROBLEMS.filter((p) => p.risk === l.key).length >= 3, `o nível ${l.key} tem itens`);
  const expect = {
    'Parada cardiorrespiratória': 'vermelho', 'Infarto (suspeita)': 'vermelho', 'AVC (suspeita)': 'vermelho', 'Trauma grave': 'vermelho', 'Falta de ar severa': 'vermelho',
    'Dor no peito intensa': 'laranja', 'Sangramento ativo importante': 'laranja', 'Convulsão recente': 'laranja', 'Fratura exposta': 'laranja',
    'Febre alta persistente': 'amarelo', 'Dor abdominal moderada': 'amarelo', 'Vômitos contínuos': 'amarelo', 'Desmaio': 'amarelo',
    'Dor leve': 'verde', 'Torção simples': 'verde', 'Resfriado': 'verde', 'Pequena infecção sem febre alta': 'verde',
    'Troca de receita': 'azul', 'Queixa crônica antiga': 'azul', 'Pedido de exames de rotina': 'azul',
  };
  assert.deepEqual(Object.fromEntries(T.TRIAGE_PROBLEMS.map((p) => [p.label, p.risk])), expect);
  for (const p of T.TRIAGE_PROBLEMS) assert.equal(T.suggestRisk(p.key), p.risk);
  assert.equal(new Set(T.TRIAGE_PROBLEMS.map((p) => p.key)).size, T.TRIAGE_PROBLEMS.length, 'chaves únicas');
  assert.equal(T.suggestRisk('outro'), null); assert.equal(T.TRIAGE_OTHER.label, 'Outro (escolher a cor)'); assert.equal(T.suggestRisk('nada'), null);
  assert.equal(T.levelLabel('laranja'), 'Laranja · Muito urgente · até 10 min');
  assert.equal(T.levelLabel('vermelho'), 'Vermelho · Emergência · imediato');
  assert.equal(T.levelLabel('amarelo', 45), 'Amarelo · Urgente · até 45 min');
  // a busca ignora acento e caixa e também acha pelo nome da cor e do nível
  assert.deepEqual(T.searchProblems('VOMITO').map((p) => p.key), ['vomitos']);
  assert.ok(T.searchProblems('muito urgente').every((p) => p.risk === 'laranja'));
  assert.equal(T.searchProblems('').length, T.TRIAGE_PROBLEMS.length);
});
