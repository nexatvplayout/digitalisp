// NEXA Telas: as regras sem banco das salas e consultórios (server/telas-salas-core.js, docs/TELAS.md §26 a §31).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../server/telas-salas-core.js';

test('salas e grupos: validação, round robin pela sala livre há mais tempo', () => {
  assert.deepEqual(R.cleanRoom({ name: ' Consultório  3 ', kind: 'consultorio', groupId: 7 }, null, [7]), { name: 'Consultório 3', kind: 'consultorio', groupId: 7, active: 1, sort: 0 });
  assert.throws(() => R.cleanRoom({ name: 'X', kind: 'cozinha' }), /Tipo de sala/);
  assert.throws(() => R.cleanRoom({ name: '' }), /Nome da sala/);
  assert.throws(() => R.cleanRoom({ name: 'X', groupId: 8 }, null, [7]), /Grupo não encontrado/);
  assert.deepEqual(R.cleanRoom({ active: false }, { name: 'A', kind: 'sala', group_id: 3, active: 1, sort: 2 }, [3]), { name: 'A', kind: 'sala', groupId: 3, active: 0, sort: 2 }, 'campo ausente fica');
  assert.deepEqual(R.cleanGroup({ name: 'Clínico geral', serviceIds: [1, 2, 2], auto: true }, null, [1, 2]), { name: 'Clínico geral', services: [1, 2], auto: 1, sort: 0 });
  assert.throws(() => R.cleanGroup({ name: 'X', serviceIds: [1] }, null, [1]), /Nome do grupo/);
  assert.throws(() => R.cleanGroup({ name: 'Grupo', serviceIds: [9] }, null, [1]), /não encontrada/);
  assert.throws(() => R.cleanGroup({ name: 'Grupo', serviceIds: [] }, null, [1]), /ao menos uma fila/);
  assert.deepEqual(R.servicesOfGroup({ services: 'lixo' }), []);
  const rooms = [
    { id: 1, active: 1, state: 'available', state_at: 300, sort: 0 }, { id: 2, active: 1, state: 'pause', state_at: 100, sort: 0 },
    { id: 3, active: 1, state: 'available', state_at: 200, sort: 0 }, { id: 4, active: 0, state: 'available', state_at: 50, sort: 0 },
    { id: 5, active: 1, state: 'busy', state_at: 10, sort: 0 }, { id: 6, active: 1, state: 'available', state_at: 200, sort: -1 },
  ];
  assert.deepEqual(R.roundRobin(rooms).map((r) => r.id), [6, 3, 1], 'só as disponíveis e ativas; a livre há mais tempo primeiro; empate pela ordem');
});

test('etapas, apoio e a configuração da UPA', () => {
  assert.deepEqual(R.upaConfigOf(null, 'upa'), { follow: true, followRisk: false, estimate: false, estimateHours: 3, estimateText: '', support: ['Maqueiro', 'Limpeza', 'Segurança', 'Enfermagem'], flow: [], confirm: true }, 'QR e confirmação de chegada ligados de fábrica na UPA, sem a cor');
  assert.deepEqual([R.upaConfigOf(null, 'ubs').follow, R.upaConfigOf(null, 'ubs').confirm, R.upaConfigOf(null, 'hospital').confirm], [false, false, true]);
  const c = R.cleanUpaConfig({ followRisk: true, estimate: true, estimateHours: 6, support: ['maqueiro', 'Maqueiro', 'Raio-X'], flow: [{ name: 'Recepção', serviceId: 1 }, { serviceId: 2 }] }, {}, 'upa', [1, 2]);
  assert.deepEqual([c.followRisk, c.estimate, c.estimateHours, c.support, c.flow], [true, true, 6, ['maqueiro', 'Raio-X'], [{ name: 'Recepção', serviceId: 1, mode: 'recepcao' }, { name: '', serviceId: 2, mode: 'recepcao' }]]);
  assert.throws(() => R.cleanUpaConfig({ estimateHours: 30 }, {}, 'upa'), /de 1 a 12/);
  assert.throws(() => R.cleanUpaConfig({ follow: 'sim' }, {}, 'upa'), /verdadeiro/);
  assert.throws(() => R.cleanUpaConfig({ support: ['x'] }, {}, 'upa'), /de 2 a 30/);
  assert.throws(() => R.cleanFlow([{ serviceId: 1 }, { serviceId: 1 }], [1]), /mesma fila/);
  const names = new Map([[1, 'Recepção'], [2, 'Clínico'], [3, 'Medicação']]);
  const flow = [{ name: 'Entrada', serviceId: 1 }, { name: '', serviceId: 2 }, { name: '', serviceId: 3 }];
  assert.deepEqual(R.stageOf(flow, 2, names), { index: 1, total: 3, name: 'Clínico', mode: 'recepcao', next: { name: 'Medicação', serviceId: 3, mode: 'recepcao' } });
  assert.deepEqual(R.stageOf(flow, 3, names).next, null); assert.equal(R.stageOf(flow, 9, names), null);
});

test('quem chama cada etapa: modos, atalhos, o automático por etapa, avisos e a situação da chamada', () => {
  const ids = [1, 2, 3, 4];
  assert.throws(() => R.cleanFlow([{ serviceId: 1, mode: 'robo' }], ids), /Quem chama/);
  const prev = [{ name: 'Consultório', serviceId: 3, mode: 'sala' }];
  assert.deepEqual(R.cleanFlow([{ serviceId: 1 }, { serviceId: 3 }, { serviceId: 4, mode: 'auto' }], ids, prev).map((s) => s.mode), ['recepcao', 'sala', 'auto'], 'sem mode, fica o guardado para a mesma fila');
  const stored = { flow: [{ name: 'Recepção', serviceId: 1 }, { name: 'Classificação', serviceId: 2, mode: 'auto' }, { name: 'Consultório', serviceId: 3, mode: 'sala' }, { name: 'Medicação', serviceId: 4, mode: 'xx' }] };
  const up = R.upaConfigOf(stored, 'upa');
  assert.deepEqual(up.flow.map((s) => s.mode), ['recepcao', 'auto', 'sala', 'recepcao'], 'o guardado sem mode (ou estranho) é recepção');
  assert.deepEqual(R.cleanUpaConfig({ preset: 'profissionais' }, stored, 'upa', ids).flow.map((s) => s.mode), ['recepcao', 'sala', 'sala', 'sala'], 'Profissionais chamam: a 1ª etapa segue com a recepção');
  assert.deepEqual(R.cleanUpaConfig({ preset: 'recepcao' }, stored, 'upa', ids).flow.map((s) => s.mode), ['recepcao', 'recepcao', 'recepcao', 'recepcao']);
  assert.throws(() => R.cleanUpaConfig({ preset: 'tudo' }, stored, 'upa', ids), /Atalho/);
  assert.equal(R.cleanUpaConfig({ confirm: false }, stored, 'upa', ids).confirm, false);
  assert.deepEqual([R.modeOf(up.flow, 3), R.modeOf(up.flow, 99)], ['sala', 'recepcao'], 'fora das etapas: recepção');
  assert.deepEqual(R.proServices(up.flow), [3]);
  assert.deepEqual(R.autoServices([2, 3, 4], false, up.flow), [2], 'grupo sem automático: só a etapa Automático');
  assert.deepEqual(R.autoServices([2, 3, 4, 9], true, up.flow), [2, 4, 9], 'grupo automático: tudo menos a etapa do profissional');
  const groups = [{ id: 10, services: '[2]' }, { id: 11, services: '[3]' }];
  assert.deepEqual(R.flowWarnings(up.flow, groups, [{ group_id: 10, active: 1 }]), ['Consultório: nenhuma sala ativa atende esta fila; só o gestor conseguirá chamar.']);
  assert.deepEqual(R.flowWarnings(up.flow, groups, [{ group_id: 11, active: 1 }]), ['Classificação: nenhum grupo com sala ativa atende esta fila; o automático não terá para onde mandar.']);
  assert.deepEqual(R.flowWarnings(up.flow, groups, [{ group_id: 10, active: 1 }, { group_id: 11, active: 1 }]), []);
  assert.deepEqual([R.callStateOf({ status: 'called' }, null, true), R.callStateOf({ status: 'called' }, 5, true), R.callStateOf({ status: 'called' }, null, false), R.callStateOf({ status: 'waiting' }, null, true)], ['called', 'arrived', 'serving', null]);
});

test('tempo-alvo do Manchester: quem passou, o vermelho já passa, a chamada médica encerra', () => {
  const now = 10 * 3600_000; const targets = { laranja: 10, amarelo: 60, verde: 120, azul: 240 };
  const t = (risk, waitMin, status = 'waiting') => ({ status, risk, issuedAt: now - waitMin * 60000 });
  assert.equal(R.overdueMin(t('vermelho', 0.01), { targets, now }), 0, 'vermelho: alvo 0');
  assert.equal(R.overdueMin(t('laranja', 9), { targets, now }), null);
  assert.equal(R.overdueMin(t('laranja', 25), { targets, now }), 15);
  assert.equal(R.overdueMin(t('azul', 241), { targets, now }), 1);
  assert.equal(R.overdueMin(t('azul', 300, 'called'), { targets, now }), null, 'só quem espera');
  assert.equal(R.overdueMin(t(null, 300), { targets, now }), null, 'sem cor, sem alvo');
  assert.equal(R.overdueMin(t('laranja', 25), { targets, now, doctorAt: now - 1 }), null, 'já viu o médico');
  const d = R.overdueDto([{ code: 'A001', risk: 'laranja', overMin: 15, name: 'NÃO VAI' }]);
  assert.deepEqual(d, { total: 1, byRisk: { vermelho: 0, laranja: 1, amarelo: 0, verde: 0, azul: 0 }, tickets: [{ ticket: 'A001', risk: 'laranja', overMin: 15 }] }, 'sem dados pessoais');
});

test('espera estimada, posição aproximada e o fim do dia do QR', () => {
  const e = R.estimateOf([{ risk: 'verde', waitMs: 40 * 60000 }, { risk: 'azul', waitMs: 60 * 60000 }, { risk: 'amarelo', waitMs: 10 * 60000 }, { risk: 'verde', waitMs: NaN }], { text: 'UBS ao lado', hours: 3 });
  assert.deepEqual([e.byRisk.verde, e.byRisk.azul, e.byRisk.amarelo, e.byRisk.vermelho, e.lightMin, e.light, e.text], [40, 60, 10, null, 50, 'Casos verdes e azuis: cerca de 50 min de espera', 'UBS ao lado']);
  assert.deepEqual([R.roundWait(0), R.roundWait(12), R.roundWait(47), R.roundWait(121)], [5, 15, 50, 150]);
  assert.equal(R.estimateOf([]).light, null);
  assert.deepEqual([R.positionText(0), R.positionText(1), R.positionText(3), R.positionText(7), R.positionText(23), R.positionText(null)], ['É a próxima a ser chamada.', '1 pessoa antes.', '3 pessoas antes.', 'Cerca de 8 pessoas antes.', 'Cerca de 25 pessoas antes.', null]);
  assert.equal(new Date(R.endOfDay('2026-11-19')).toISOString(), '2026-11-20T03:00:00.000Z', 'meia-noite em Brasília');
});

test('indicadores: porta–classificação, porta–médico, por cor, por sala, por hora e por período; CSV', () => {
  const at = (day, h, m = 0) => Date.parse(`${day}T${String(h + 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); // hora de Brasília
  const tickets = [
    { id: 1, day: '2026-11-16', issued_at: at('2026-11-16', 8), first_called_at: at('2026-11-16', 8, 5), status: 'done', risk: 'laranja' },
    { id: 2, day: '2026-11-16', issued_at: at('2026-11-16', 8, 30), first_called_at: at('2026-11-16', 8, 40), status: 'noshow', risk: 'verde' },
    { id: 3, day: '2026-11-18', issued_at: at('2026-11-18', 14), first_called_at: null, status: 'expired', risk: null },
  ];
  const events = [
    { ticket_id: 1, kind: 'triage', at: at('2026-11-16', 8, 2) }, { ticket_id: 1, kind: 'call', room_kind: 'classificacao', at: at('2026-11-16', 8, 5) },
    { ticket_id: 1, kind: 'call', room_kind: 'consultorio', at: at('2026-11-16', 8, 20) }, { ticket_id: 2, kind: 'triage', at: at('2026-11-16', 8, 34) },
    { ticket_id: 2, kind: 'call', room_kind: 'consultorio', at: at('2026-11-16', 8, 50) },
  ];
  const calls = [{ ticket_id: 1, desk: 'Classificação 1', at: at('2026-11-16', 8, 5) }, { ticket_id: 1, desk: 'Consultório 3', at: at('2026-11-16', 8, 20) }, { ticket_id: 2, desk: 'Consultório 3', at: at('2026-11-16', 8, 50) }];
  const ind = R.indicatorsOf({ tickets, calls, events, targets: { laranja: 10, amarelo: 60, verde: 120, azul: 240 }, by: 'week', hasDoctorRooms: true });
  assert.deepEqual(ind.totals, { key: 'total', issued: 3, served: 1, noshow: 1, doorToTriageMin: 3, doorToDoctorMin: 20, late: 1, arrived: 0, callToArriveMin: null }, 'laranja viu o médico em 20 min (alvo 10)');
  assert.deepEqual(ind.periods.map((p) => [p.key, p.issued]), [['2026-11-16', 3]], 'semana começando na segunda');
  assert.deepEqual(ind.byRisk.find((x) => x.key === 'sem').issued, 1);
  assert.deepEqual(ind.byRoom, [{ room: 'Consultório 3', calls: 2, arrived: 0, noshow: 0, callToArriveMin: null }, { room: 'Classificação 1', calls: 1, arrived: 0, noshow: 0, callToArriveMin: null }]);
  // chamada–chegada (20/11): cada chamada casa com o 1º "chegou" depois dela; "não compareceu" por sala
  const ev2 = [...events,
    { ticket_id: 1, kind: 'call', room_id: 7, room_kind: 'consultorio', at: at('2026-11-16', 9) }, { ticket_id: 1, kind: 'arrive', room_id: 7, at: at('2026-11-16', 9, 4) },
    { ticket_id: 1, kind: 'arrive', room_id: 7, at: at('2026-11-16', 9, 6) }, // a 2ª confirmação da mesma chamada não conta
    { ticket_id: 2, kind: 'noshow', room_id: 7, at: at('2026-11-16', 9, 1) }, { ticket_id: 3, kind: 'arrive', room_id: null, at: at('2026-11-18', 14, 1) },
    { ticket_id: 1, kind: 'arrive', room_id: 8, at: at('2026-11-16', 8, 7) }, // sala removida
  ];
  const ind2 = R.indicatorsOf({ tickets, calls, events: ev2, by: 'day', hasDoctorRooms: true, roomNames: new Map([[7, 'Consultório 3']]) });
  assert.deepEqual([ind2.totals.arrived, ind2.totals.callToArriveMin], [2, 3], 'chegou 2 min (8h05 → 8h07) e 4 min (9h00 → 9h04): média 3');
  assert.deepEqual(ind2.byRoom.find((r) => r.room === 'Consultório 3'), { room: 'Consultório 3', calls: 2, arrived: 1, noshow: 1, callToArriveMin: 4 });
  assert.deepEqual(ind2.byRoom.find((r) => r.room === '(sala removida)'), { room: '(sala removida)', calls: 0, arrived: 1, noshow: 0, callToArriveMin: 2 });
  assert.match(R.indicatorsCsv(ind2), /Sala;Consultório 3;2;1;1;4/); assert.match(R.indicatorsCsv(ind2), /Chamada–chegada;Total;2;3/);
  assert.deepEqual([ind.byHour[8].issued, ind.byHour[8].calls, ind.byHour[14].issued], [2, 3, 1]);
  assert.equal(R.indicatorsOf({ tickets, calls, events, by: 'day', hasDoctorRooms: false }).totals.doorToDoctorMin, 7.5, 'sem consultório: a 1ª chamada');
  assert.deepEqual(['2026-11-16', '2026-11-22'].map((d) => R.periodOf(d, 'week')), ['2026-11-16', '2026-11-16']);
  assert.equal(R.periodOf('2026-11-22', 'month'), '2026-11');
  const csv = R.indicatorsCsv(ind, { office: 'UPA', from: '2026-11-16', to: '2026-11-22' });
  assert.ok(csv.startsWith('﻿Indicadores · UPA;2026-11-16 a 2026-11-22\r\n'));
  assert.match(csv, /Total;Total;3;1;1;3;20;1/); assert.match(csv, /Sala;Consultório 3;2/); assert.match(csv, /Hora;08h;2;3/);
});
