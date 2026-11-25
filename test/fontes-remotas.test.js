import test from 'node:test';
import assert from 'node:assert/strict';
import { icsEvents, sheetMenu, cleanRemoteUrl, sheetCsvUrl } from '../server/fontes-remotas.js';
import { parseCsv } from '../server/tvcorp-rh.js';

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'DTSTART;TZID=America/Sao_Paulo:20261124T090000', 'DTEND;TZID=America/Sao_Paulo:20261124T100000', 'SUMMARY:Reunião geral', 'LOCATION:Auditório', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261125T150000Z', 'DTEND:20261125T160000Z', 'SUMMARY:Treinamento', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261126', 'SUMMARY:Feriado interno', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;TZID=America/Sao_Paulo:20261102T080000', 'DTEND;TZID=America/Sao_Paulo:20261102T083000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Alinhamento semanal', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261127T120000Z', 'SUMMARY:Cancelado', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261001T120000Z', 'SUMMARY:Antigo', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('agenda .ics: horário local, dia inteiro, repetição semanal, cancelado e antigo fora', () => {
  const from = Date.UTC(2026, 10, 23, 12); // 23/11/2026 09:00 em Brasília
  const ev = icsEvents(ICS, { tz: 'America/Sao_Paulo', from, days: 14 });
  assert.deepEqual(ev.find((e) => e.title === 'Reunião geral'), { date: '2026-11-24', time: '09:00', end: '10:00', title: 'Reunião geral', place: 'Auditório' });
  assert.ok(ev.some((e) => e.date === '2026-11-25' && e.time === '12:00' && e.title === 'Treinamento'), 'Z vira o horário de Brasília');
  assert.ok(ev.some((e) => e.date === '2026-11-26' && !e.time && e.title === 'Feriado interno'));
  assert.deepEqual(ev.filter((e) => e.title === 'Alinhamento semanal').map((e) => e.date), ['2026-11-23', '2026-11-30']); // de hoje (o dia inteiro) até 14 dias
  assert.ok(!ev.some((e) => e.title === 'Cancelado' || e.title === 'Antigo'));
});

test('planilha do cardápio: colunas pelo nome, preço em reais, dia da semana ou todo dia', () => {
  const rows = parseCsv('Item;Preço;Descrição;Dia\nPrato feito;R$ 18,90;Arroz e feijão;seg, qua\nSuco;6;;\nFeijoada;29,90;;sábado\n');
  const { days } = sheetMenu(rows);
  assert.deepEqual(days['1'][0], { name: 'Prato feito', price: 18.9, note: 'Arroz e feijão' });
  assert.ok(days['0'].some((x) => x.name === 'Suco') && !days['0'].some((x) => x.name === 'Prato feito'));
  assert.deepEqual(days['6'].map((x) => x.name), ['Suco', 'Feijoada']);
  assert.deepEqual(sheetMenu(parseCsv('nome,valor\nX-burger,25\n')).days['3'], [{ name: 'X-burger', price: 25 }]);
});

test('endereços: só https; webcal vira https; link de compartilhar do Google vira CSV', () => {
  assert.equal(cleanRemoteUrl('webcal://example.com/a.ics', 'Agenda'), 'https://example.com/a.ics');
  assert.throws(() => cleanRemoteUrl('http://example.com/a.ics', 'Agenda'));
  assert.equal(cleanRemoteUrl('', 'Agenda'), '');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/AbC_12-3/edit#gid=77'), 'https://docs.google.com/spreadsheets/d/AbC_12-3/export?format=csv&gid=77');
});
