'use strict';
const test = require('node:test');
const assert = require('node:assert');
const N = require('../comum/js/nucleo.js');

const H = (c) => c.repeat(64);
const img = (id, c, extra) => Object.assign({ id, kind: 'image', seconds: 5, url: 'https://cdn.x/' + id + '.jpg', sha256: H(c), bytes: 100 }, extra || {});
const zonas = [{ id: 'z', x: 0, y: 0, w: 100, h: 100, kind: 'playlist' }];
const bloco = (id, from, to, itens, extra) => Object.assign({ id, layout: { zones: zonas }, days: [], from, to, zones: { z: itens } }, extra || {});
function cfg(rev, blocos, extra) {
  return Object.assign({ rev, signage: { tz: 'America/Sao_Paulo', blocks: blocos, fallback: blocos[0] && blocos[0].id } }, extra || {});
}
// 22/11/2026 é um domingo. São Paulo é UTC-3 (sem horário de verão).
const em = (hhmm, dia) => Date.parse(`2026-11-${dia || 22}T${hhmm}:00-03:00`);

// ---------------------------------------------------------------- troca só com tudo baixado

test('programação nova com arquivo faltando: espera e diz o que falta', () => {
  const atual = N.lerConfig(cfg('r1', [bloco('a', 0, 1440, [img('m1', 'a')])]));
  const nova = N.lerConfig(cfg('r2', [bloco('a', 0, 1440, [img('m1', 'a'), img('m2', 'b')])]));
  const d = N.decidirTroca(atual, nova, { [H('a')]: true });
  assert.equal(d.acao, 'esperar');
  assert.deepEqual(d.faltam.map((f) => f.sha256), [H('b')]);
  assert.equal(d.bytesFaltando, 100);
});

test('com tudo no aparelho: troca', () => {
  const atual = N.lerConfig(cfg('r1', [bloco('a', 0, 1440, [img('m1', 'a')])]));
  const nova = N.lerConfig(cfg('r2', [bloco('a', 0, 1440, [img('m1', 'a'), img('m2', 'b')])]));
  assert.equal(N.decidirTroca(atual, nova, { [H('a')]: true, [H('b')]: true }).acao, 'trocar');
});

test('primeira vez (sem atual) também espera tudo; mesmo rev = manter', () => {
  const nova = N.lerConfig(cfg('r1', [bloco('a', 0, 1440, [img('m1', 'a')])]));
  assert.equal(N.decidirTroca(null, nova, {}).acao, 'esperar');
  assert.equal(N.decidirTroca(nova, N.lerConfig(cfg('r1', [])), {}).acao, 'manter');
  assert.equal(N.decidirTroca(nova, null, {}).acao, 'manter');
});

test('o pacote inclui logo da revenda, imagem sem internet, vídeos guardados e itens de todos os blocos, sem repetir', () => {
  const p = N.lerConfig(cfg('r', [bloco('a', 0, 720, [img('m1', 'a')]), bloco('b', 720, 1440, [img('m1', 'a'), img('m3', 'c')])], {
    brand: { logo: { url: 'https://cdn.x/logo.png', sha256: H('d'), bytes: 10 } },
    offline: { image: { url: 'https://cdn.x/off.jpg', sha256: H('e'), bytes: 20 }, items: [{ url: 'https://cdn.x/v.mp4', sha256: H('f'), bytes: 30 }] }
  }));
  assert.deepEqual(N.arquivosDoPacote(p).map((f) => f.sha256[0]).sort(), ['a', 'c', 'd', 'e', 'f']);
  // a troca espera também o vídeo do "sem internet": sem ele a tela não roda offline de verdade
  const quase = { [H('a')]: true, [H('c')]: true, [H('d')]: true, [H('e')]: true };
  assert.equal(N.decidirTroca(null, p, quase).acao, 'esperar');
});

test('limpeza: apaga só o que nenhuma programação cita', () => {
  const atual = N.lerConfig(cfg('r1', [bloco('a', 0, 1440, [img('m1', 'a')])]));
  const chegando = N.lerConfig(cfg('r2', [bloco('a', 0, 1440, [img('m2', 'b')])]));
  assert.deepEqual(N.paraApagar([H('a'), H('b'), H('z')], [atual, chegando]), [H('z')]);
  assert.deepEqual(N.paraApagar([H('a'), H('b')], [chegando]), [H('a')]);
});

test('espaço: cabe com folga; sem informação da plataforma, tenta', () => {
  assert.equal(N.cabe(100 * 1048576, 200 * 1048576), true);
  assert.equal(N.cabe(180 * 1048576, 200 * 1048576), false);
  assert.equal(N.cabe(1e12, null), true);
});

// ---------------------------------------------------------------- grade pelo relógio (sem rede)

test('escolhe o bloco pela hora no fuso da grade', () => {
  const p = N.lerConfig(cfg('r', [bloco('manha', 360, 720, [img('m1', 'a')]), bloco('tarde', 720, 1080, [img('m2', 'b')]), bloco('padrao', 0, 1440, [img('m3', 'c')])]));
  assert.equal(N.escolherBloco(p, em('07:00')).id, 'manha');
  assert.equal(N.escolherBloco(p, em('11:59')).id, 'manha');
  assert.equal(N.escolherBloco(p, em('12:00')).id, 'tarde');
  assert.equal(N.escolherBloco(p, em('20:00')).id, 'padrao');
});

test('faixa que vira a meia-noite pertence ao dia em que começa', () => {
  // só sábado (6), das 22:00 às 02:00 → vale sábado 23:00 e domingo 01:00; não vale domingo 23:00
  const p = N.lerConfig(cfg('r', [bloco('noite', 1320, 120, [img('m1', 'a')], { days: [6] }), bloco('padrao', 0, 1440, [img('m2', 'b')])]));
  assert.equal(N.escolherBloco(p, em('23:00', 21)).id, 'noite');
  assert.equal(N.escolherBloco(p, em('01:00', 22)).id, 'noite');
  assert.equal(N.escolherBloco(p, em('23:00', 22)).id, 'padrao');
});

test('nenhum bloco vale: o fallback; datas de início e fim', () => {
  const p = N.lerConfig(cfg('r', [bloco('base', 0, 60, [img('m0', 'f')]), bloco('campanha', 0, 1440, [img('m1', 'a')], { dateFrom: '2026-11-23', dateTo: '2026-11-30' })]));
  assert.equal(N.escolherBloco(p, em('12:00', 22)).id, 'base'); // fallback = o primeiro
  assert.equal(N.escolherBloco(p, em('12:00', 23)).id, 'campanha');
  assert.equal(N.escolherBloco(p, Date.parse('2026-12-01T12:00:00-03:00')).id, 'base');
});

test('fuso: a mesma hora UTC dá blocos diferentes em fusos diferentes', () => {
  const blocos = [bloco('manha', 0, 720, [img('m1', 'a')]), bloco('tarde', 720, 1440, [img('m2', 'b')])];
  const sp = N.lerConfig(cfg('r', blocos));
  const lisboa = N.lerConfig({ rev: 'r', signage: { tz: 'Europe/Lisbon', blocks: blocos } });
  const t = Date.parse('2026-11-22T13:00:00Z'); // 10:00 em São Paulo, 13:00 em Lisboa
  assert.equal(N.escolherBloco(sp, t).id, 'manha');
  assert.equal(N.escolherBloco(lisboa, t).id, 'tarde');
});

test('meia-noite: hora 00 (alguns Chromium escrevem 24) cai no começo do dia', () => {
  const l = N.horaLocal(em('00:05'), 'America/Sao_Paulo');
  assert.equal(l.minuto, 5);
  assert.equal(l.data, '2026-11-22');
  assert.equal(l.dow, 0);
  assert.equal(l.prevData, '2026-11-21');
  assert.equal(l.prevDow, 6);
});

test('próxima virada: minutos até o próximo limite de bloco', () => {
  const p = N.lerConfig(cfg('r', [bloco('a', 600, 720, [img('m1', 'a')])]));
  assert.equal(N.proximaVirada(p, em('09:50')), 10);
  assert.equal(N.proximaVirada(p, em('11:00')), 60);
});

test('item com restrição própria de dia e hora', () => {
  const l = N.horaLocal(em('08:00'), 'America/Sao_Paulo'); // domingo
  const it = N.lerConfig(cfg('r', [bloco('a', 0, 1440, [img('m1', 'a', { days: [1, 2, 3, 4, 5] }), img('m2', 'b', { from: 420, to: 540 })])])).blocos[0].itens.z;
  assert.equal(N.itemVale(it[0], l), false);
  assert.equal(N.itemVale(it[1], l), true);
});

test('horário de ligar e desligar a TV', () => {
  const p = N.lerConfig({ schedule: { tvOn: '07:00', tvOff: '22:00', days: [1, 2, 3, 4, 5, 6] } });
  assert.equal(N.telaLigada(p.horario, N.horaLocal(em('12:00', 23), p.tz)), true); // segunda
  assert.equal(N.telaLigada(p.horario, N.horaLocal(em('23:00', 23), p.tz)), false);
  assert.equal(N.telaLigada(p.horario, N.horaLocal(em('12:00', 22), p.tz)), false); // domingo
  assert.equal(N.telaLigada(null, N.horaLocal(em('03:00'), p.tz)), true);
});

test('relógio confiável: guarda a diferença e ignora absurdo', () => {
  assert.equal(N.diferencaRelogio(1000 + 5000, 1000), 5000);
  assert.equal(N.diferencaRelogio(Date.parse('2026-11-22'), Date.parse('2016-01-01')), null);
  assert.equal(N.diferencaRelogio(NaN, 1), null);
});

// ---------------------------------------------------------------- leitura tolerante

test('arquivo inválido some: http, sha curto, tamanho zero ou acima do teto', () => {
  const p = N.lerConfig(cfg('r', [bloco('a', 0, 1440, [
    img('ok', 'a'), img('http', 'b', { url: 'http://cdn.x/a.jpg' }), img('sha', 'c', { sha256: 'abc' }),
    img('zero', 'd', { bytes: 0 }), img('enorme', 'e', { bytes: 10 * 1024 * 1024 * 1024 })])]));
  assert.deepEqual(p.blocos[0].itens.z.map((i) => i.id), ['ok']);
});

test('http só em endereço local no modo de teste', () => {
  assert.equal(N.urlPermitida('http://localhost:8787/x', false), false);
  assert.equal(N.urlPermitida('http://localhost:8787/x', true), true);
  assert.equal(N.urlPermitida('http://192.168.0.10/x', true), true);
  assert.equal(N.urlPermitida('http://exemplo.com/x', true), false);
  assert.equal(N.urlPermitida('https://exemplo.com/x', false), true);
  assert.equal(N.urlPermitida('javascript:alert(1)', true), false);
});

test('configuração vazia ou estranha não quebra', () => {
  for (const c of [null, undefined, 42, 'x', {}, { signage: { blocks: 'x' } }, { signage: { blocks: [{ id: 'a' }] } }]) {
    const p = N.lerConfig(c);
    assert.deepEqual(p.blocos, []);
    assert.equal(N.escolherBloco(p, Date.now()), null);
    assert.deepEqual(N.arquivosDoPacote(p), []);
  }
});

test('zonas: no máximo uma de vídeo, coordenadas cortadas na tela, tipos desconhecidos fora', () => {
  const p = N.lerConfig(cfg('r', [{ id: 'a', layout: { zones: [
    { id: 'v1', x: 0, y: 0, w: 50, h: 50, kind: 'video' }, { id: 'v2', x: 50, y: 0, w: 50, h: 50, kind: 'video' },
    { id: 'g', x: 80, y: 80, w: 50, h: 50, kind: 'playlist' }, { id: 'q', x: 0, y: 50, w: 10, h: 10, kind: 'foguete' }] }, zones: {} }]));
  const zs = p.blocos[0].layout.zonas;
  assert.deepEqual(zs.map((z) => z.id), ['v1', 'g']);
  assert.equal(zs[1].w, 20);
});

// ---------------------------------------------------------------- marca da revenda (white-label)

test('marca: sem nenhum campo, a tela fica sem logo e sem nome (nada do app aparece)', () => {
  const m = N.lerConfig({}).marca;
  assert.equal(m.logo, null);
  assert.equal(m.logoUrl, null);
  assert.equal(m.nome, '');
});

test('marca: aceita brand no topo, em signage.brand ou da ativação; o topo manda', () => {
  const logo = (c) => ({ url: 'https://cdn.x/' + c + '.png', sha256: H(c), bytes: 50 });
  assert.equal(N.lerConfig({}, { marcaAtivacao: { name: 'Provedor X', logo: logo('a') } }).marca.logo.sha256, H('a'));
  assert.equal(N.lerConfig({ signage: { brand: { logo: logo('b') } } }, { marcaAtivacao: { logo: logo('a') } }).marca.logo.sha256, H('b'));
  const m = N.lerConfig({ brand: { name: 'Rede Y', logo: logo('c'), color: '#FF0000' }, signage: { brand: { logo: logo('b'), color: '#00ff00' } } }).marca;
  assert.equal(m.logo.sha256, H('c'));
  assert.equal(m.nome, 'Rede Y');
  assert.equal(m.cor, '#ff0000');
});

test('marca: logo como endereço puro vale (só com rede), cor inválida é ignorada', () => {
  const m = N.lerConfig({ brand: { logo: 'https://cdn.x/l.png', color: 'vermelho' } }).marca;
  assert.equal(m.logo, null);
  assert.equal(m.logoUrl, 'https://cdn.x/l.png');
  assert.equal(m.cor, null);
});

// ---------------------------------------------------------------- código, sinal de vida e exibição

test('código de cadastro: normaliza como o Android', () => {
  assert.equal(N.normalizarChave('abcd efgh'), 'ABCD-EFGH');
  assert.equal(N.normalizarChave('AB-CD-23-45'), 'ABCD-2345');
  assert.equal(N.normalizarChave('ABC0'), null);
  assert.equal(N.normalizarChave('IIOO1100'), null);
});

test('exibição: acumula por item e só zera o que o servidor aceitou', () => {
  let log = null;
  log = N.contarExibicao(log, 'm1', 10, '2026-11-22');
  log = N.contarExibicao(log, 'm1', 10.4, '2026-11-22');
  log = N.contarExibicao(log, 'm2', 5, '2026-11-22');
  const lote = JSON.parse(JSON.stringify(N.loteExibicao(log)));
  assert.equal(lote.dia, '2026-11-22');
  assert.deepEqual(lote.plays, [{ ref: 'm1', n: 2, sec: 20 }, { ref: 'm2', n: 1, sec: 5 }]);
  log = N.contarExibicao(log, 'm1', 3, '2026-11-22'); // chegou mais enquanto o sinal ia
  log = N.baixarLote(log, lote);
  assert.deepEqual(N.loteExibicao(log).plays, [{ ref: 'm1', n: 1, sec: 3 }]);
});

test('exibição: o dia que virou sem rede segue pendente e vai primeiro', () => {
  let log = N.contarExibicao(null, 'm1', 10, '2026-11-22');
  log = N.contarExibicao(log, 'm2', 10, '2026-11-23');
  const l1 = N.loteExibicao(log);
  assert.equal(l1.dia, '2026-11-22');
  log = N.baixarLote(log, l1);
  const l2 = N.loteExibicao(log);
  assert.equal(l2.dia, '2026-11-23');
  assert.deepEqual(l2.plays, [{ ref: 'm2', n: 1, sec: 10 }]);
});

test('sinal de vida: os campos do contrato do Android, com valores que o servidor aceita', () => {
  const c = N.corpoSinal({ rev: 'abc', estado: 'qualquer', fonte: 'x', ligadoSeg: 12.6, rede: 'wifi', hwid: H('a'), lote: { dia: '2026-11-22', plays: [{ ref: 'm1', n: 1, sec: 5 }] }, pendente: { rev: 'r2', files: 2, bytes: 10 } });
  assert.equal(c.state, 'idle');
  assert.equal(c.source, 'offline');
  assert.equal(c.uptimeSec, 13);
  assert.equal(c.locked, true);
  assert.equal(c.hwid, H('a'));
  assert.equal(c.playsDay, '2026-11-22');
  assert.deepEqual(c.pending, { rev: 'r2', files: 2, bytes: 10 });
  assert.equal(N.corpoSinal({ estado: 'offline-content', fonte: 'hls' }).state, 'offline-content');
});

// ---------------------------------------------------------------- tela sem programação (bug da tela preta na Samsung, 1.0.1)

test('sem token, a tela é sempre a do cadastro (o relógio da grade não pode trocá-la pela abertura preta)', () => {
  for (const online of [true, false]) for (const baixando of [true, false]) {
    assert.equal(N.camadaSemConteudo({ atual: null, token: null, online, baixando }), 'cadastro');
  }
  assert.equal(N.camadaSemConteudo({ atual: null, token: 't', online: false }), 'semrede');
  assert.equal(N.camadaSemConteudo({ atual: null, token: 't', online: true, baixando: true }), 'espera');
  assert.equal(N.camadaSemConteudo({ atual: null, token: 't', online: true, baixando: false }), 'abertura');
  assert.equal(N.camadaSemConteudo({ atual: {}, token: null, online: true }), null);
});

test('linha de diagnóstico: versão, servidor sem https, plataforma, modo e o último erro', () => {
  const l = N.linhaDiagnostico({ servidor: 'https://painel.digitalisp.com.br/', plataforma: 'tizen', modo: 'chave (pair 404)', erro: 'ativar: HTTP 404\nChave' });
  assert.equal(l, 'v' + N.VERSAO + ' · painel.digitalisp.com.br · tizen · chave (pair 404) · erro: ativar: HTTP 404 Chave');
  assert.match(N.linhaDiagnostico({}), /erro: nenhum$/);
});
