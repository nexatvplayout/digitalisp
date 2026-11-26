// NEXA Telas sem servidor (server/telas-core.js, public/shared/telas-tipos.js, public/admin/telas-mapa.js; docs/TELAS.md): o
// catálogo íntegro, a chave de acesso (alfabeto sem ambíguos, com ou sem hífen), o PIN só em hash, a limpeza do que o painel
// manda, a precedência da configuração (tela > grupos > repartição > padrão), o alcance dos alertas (região, grupos e raio
// por haversine), a assinatura JPEG e o caminho da captura (só inteiros), a sessão do link de controle, as contas do mapa
// (Web Mercator) e o código do painel e da página da repartição (sem script de fora, sem innerHTML, CSP sem inline).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers/tmp.js'; // pastas nexa-* apagadas no fim, mesmo com o teste falhando

process.env.DATA_DIR = tmpDir('nexa-telascore');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const C = await import('../server/telas-core.js');
const TT = await import('../public/shared/telas-tipos.js');
const M = await import('../public/admin/telas-mapa.js');
const CAT = await import('../public/shared/funcionalidades.js');
const { PERMISSIONS } = await import('../server/authcore.js');
const { telasDDL, TELAS_TABLES, TELAS_COPY, TELAS_IDENTITY } = await import('../server/db/schema-telas.js');
const { tvcorpDDL } = await import('../server/db/schema-tvcorp.js');
const { tvcorpDadosDDL } = await import('../server/db/schema-tvcorp-dados.js');
const { COPY_ORDER, IDENTITY_TABLES } = await import('../server/db/schema.js');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status; } };

test('catálogo: tipos, módulos de fábrica, o que é "em breve", alcance do link por tipo e os layouts do contrato', () => {
  assert.deepEqual(TT.OFFICE_TYPE_KEYS, ['secom', 'defesa-civil', 'seguranca', 'policia-civil', 'policia-militar', 'upa', 'hospital', 'ubs', 'caps', 'escola', 'creche', 'cras', 'central-cidadao', 'sine', 'camara', 'cultura', 'terminal', 'outro',
    // TV Corporativa (docs/TV-CORPORATIVA.md §5.1): os tipos de unidade da empresa, marcados corp
    'matriz', 'filial', 'fabrica', 'loja', 'cd', 'refeitorio', 'recepcao', 'ambulatorio', 'treinamento', 'corp-outro']);
  assert.deepEqual(TT.CORP_OFFICE_TYPES.map((t) => t.key), TT.OFFICE_TYPE_KEYS.slice(-10)); assert.ok(TT.PREF_OFFICE_TYPES.every((t) => !t.corp));
  for (const t of TT.OFFICE_TYPES) {
    assert.ok(t.label && t.short, t.key);
    for (const m of t.modules) assert.ok(TT.MODULE[m], `${t.key}: módulo ${m} fora do catálogo`);
    assert.ok(t.modules.includes('alertas') && (t.external || t.modules.includes('avisos')), `${t.key}: alertas em todo tipo; avisos em todo tipo da prefeitura (o emissor conveniado só emite)`);
  }
  // fases 3 e 4: nada mais é "em breve"; a aprovação é da prefeitura inteira (não se liga por repartição)
  assert.deepEqual(TT.MODULES.filter((m) => m.soon).map((m) => m.key), []);
  assert.deepEqual(TT.MODULE_KEYS, ['avisos', 'senha', 'escala', 'merenda', 'calendario', 'vagas', 'sessao', 'agenda', 'linhas', 'panico', 'interna']); assert.equal(TT.MODULE.alertas.fixed, true);
  assert.ok(TT.MODULE.aprovacao.tenant && !TT.MODULE_KEYS.includes('aprovacao'));
  assert.deepEqual(Object.entries(TT.defaultModules('escola')).filter(([, v]) => v).map(([k]) => k), ['avisos', 'merenda', 'calendario', 'panico']);
  assert.deepEqual(Object.entries(TT.officeModules('ubs', { avisos: false, senha: true, aprovacao: true, inventado: true })).filter(([, v]) => v).map(([k]) => k), ['senha', 'panico'], 'módulo da prefeitura e chave desconhecida não entram (o pânico é de fábrica na UBS)');
  // link de controle: SECOM e Defesa Civil alcançam cidade, regiões, grupos e o raio no mapa; os outros, só a própria repartição
  for (const t of TT.OFFICE_TYPE_KEYS) assert.deepEqual(TT.officeAlertScopes(t), TT.OFFICE_TYPE[t].alertScope === 'wide' ? ['city', 'regions', 'groups', 'office', 'radius'] : ['office'], t);
  assert.deepEqual(TT.officeAlertScopes('inventado'), ['office']);
  assert.deepEqual(TT.LAYOUTS.map((l) => l.key), ['full', 'ticker', 'side', 'lbar', 'portrait', 'queue', 'queue-table', 'queue-big', 'queue-cards', 'queue-header', 'queue-info', 'queue-mosaic', 'queue-duo', 'queue-grid', 'queue-list'], 'os layouts do contrato (§2 e §15)');
  assert.ok(TT.LAYOUT_KEYS.includes('queue'), 'queue vale (a tela só o recebe com a chamada de senha ligada na repartição)');
  assert.deepEqual(TT.COMMAND_KEYS, ['reload', 'restart-app', 'reboot', 'screenshot', 'identify']);
  assert.deepEqual(TT.ALERT_LEVEL_KEYS, ['info', 'warn', 'critical']);
  assert.equal(TT.OFFLINE_MS, 120000);
  // situação: sem sinal por 120 s = desligada; ligada com erro ou parada = sem imagem
  const t = 1e12;
  assert.equal(TT.deviceStatus({ lastSeen: t - 1000, state: 'playing' }, t), 'on');
  assert.equal(TT.deviceStatus({ lastSeen: t - 1000, state: 'buffering' }, t), 'on');
  assert.equal(TT.deviceStatus({ lastSeen: t - 1000, state: 'error' }, t), 'warn');
  assert.equal(TT.deviceStatus({ lastSeen: t - 1000, state: 'idle' }, t), 'warn');
  assert.equal(TT.deviceStatus({ lastSeen: t - 120001, state: 'playing' }, t), 'off');
  assert.equal(TT.deviceStatus({ lastSeen: null }, t), 'never');
  assert.equal(TT.deviceStatus({ lastSeen: t, revokedAt: t }, t), 'revoked');
});

// (removido no DIGITAL ISP: "modo prefeitura no catálogo…" conferia o painel/banco do NEXA Broadcast; o passo 3 escreve o equivalente)

// (removido no DIGITAL ISP: "esquema: só CREATE…" conferia o painel/banco do NEXA Broadcast; o passo 3 escreve o equivalente)

test('chave de acesso: 8 símbolos sem ambíguos, com ou sem hífen, sem diferenciar maiúsculas; token opaco de 32 bytes', () => {
  assert.equal(C.KEY_ALPHABET.length, 32); assert.ok(!/[IO01]/.test(C.KEY_ALPHABET));
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const k = C.newKey(); assert.match(k, /^[A-HJ-NP-Z2-9]{8}$/); seen.add(k); }
  assert.ok(seen.size >= 499, 'chaves aleatórias');
  assert.equal(C.formatKey('ABCDEFGH'), 'ABCD-EFGH');
  for (const v of ['ABCD-EFGH', 'abcd-efgh', 'ABCDEFGH', ' abcd efgh ', 'AB-CD-EF-GH']) assert.equal(C.normalizeKey(v), 'ABCDEFGH', v);
  for (const v of ['ABCD-EFG', 'ABCD-EFGHJ', 'ABCD-EFG1', 'ABCD-EFG0', 'ABCD-EFGI', 'ABCD-EFGO', 'ÀBCD-EFGH', '', null, undefined, 12345678, {}, ['ABCDEFGH'], 'A'.repeat(100)]) assert.equal(C.normalizeKey(v), null, String(v));
  assert.equal(C.KEY_TTL_MS, 24 * 3600 * 1000);
  const tok = C.newToken();
  assert.match(tok, C.TOKEN_RE); assert.equal(Buffer.from(tok, 'base64url').length, 32); assert.notEqual(tok, C.newToken());
  assert.equal(C.sha256('abc'), sha('abc'));
});

test('PIN: 4 a 8 dígitos, guardado só como sal + SHA-256(sal + PIN); nada do PIN volta ao painel', () => {
  // vetor combinado com o app (contrato §6): o TEXTO do sal em hexadecimal + os dígitos, em UTF-8 (não os bytes do sal)
  assert.equal(C.pinHash('00ff', '1234'), sha('00ff1234'));
  assert.equal(C.pinHash('00ff', '1234'), createHash('sha256').update(Buffer.from('00ff1234', 'utf8')).digest('hex'));
  assert.notEqual(C.pinHash('00ff', '1234'), createHash('sha256').update(Buffer.concat([Buffer.from('00ff', 'hex'), Buffer.from('1234')])).digest('hex'), 'não são os bytes do sal');
  for (let i = 0; i < 50; i++) assert.match(C.randomPin(), /^\d{6}$/);
  const r = C.pinRecord('4321');
  assert.match(r.salt, /^[0-9a-f]{32}$/); assert.equal(r.hash, sha(`${r.salt}4321`)); assert.notEqual(C.pinRecord('4321').salt, r.salt);
  for (const bad of ['123', '123456789', '12a4', '', null, 1234, ' 1234']) assert.equal(status(() => C.pinRecord(bad)), 400, String(bad));
  const stored = C.mergeConfig({}, { pin: '99887766', layout: 'side' });
  assert.deepEqual(Object.keys(stored.pin).sort(), ['hash', 'salt']);
  assert.ok(!JSON.stringify(stored).includes('99887766'));
  assert.deepEqual(C.configDto(stored), { layout: 'side', hasPin: true });
  assert.deepEqual(C.configDto({}), { hasPin: false }); assert.deepEqual(C.configDto(null), { hasPin: false });
});

test('configuração guardada: campo ausente fica, vazio sai (volta a herdar), inválido é 400; o grupo só define layout e avisos', () => {
  let c = C.mergeConfig({}, { layout: 'ticker', tickerItems: ['  Um  aviso ', '', 'Outro'], tickerSpeed: 80, widgets: ['qr', 'clock', 'queue', 'x'], qrUrl: 'https://exemplo.test/a', sideTitle: ' Avisos ', backup: 'https://r.test/x.m3u8', volume: 50, muted: 1, exitSeq: ['UP', 'OK', 'LEFT', 'RIGHT'], schedule: { tvOn: '07:00', tvOff: '19:00', days: [5, 1, 1, 7, '3'] } });
  assert.deepEqual(c, { layout: 'ticker', tickerItems: ['Um aviso', 'Outro'], tickerSpeed: 80, widgets: ['clock', 'qr', 'queue'], qrUrl: 'https://exemplo.test/a', sideTitle: 'Avisos', backup: 'https://r.test/x.m3u8', volume: 50, muted: true, exitSeq: ['UP', 'OK', 'LEFT', 'RIGHT'], schedule: { tvOn: '07:00', tvOff: '19:00', days: [0, 1, 3, 5] } }, 'dias: 0 = domingo … 6 = sábado; 7 também é domingo');
  assert.deepEqual(C.mergeConfig({}, { schedule: { tvOn: '07:00', tvOff: '19:00', days: [] } }).schedule.days, [], 'lista vazia = todos os dias');
  assert.deepEqual(C.mergeConfig({}, { schedule: { tvOn: '07:00', tvOff: '19:00' } }).schedule.days, []);
  c = C.mergeConfig(c, { volume: 70 });
  assert.equal(c.volume, 70); assert.equal(c.layout, 'ticker', 'o que não veio fica');
  c = C.mergeConfig(c, { layout: null, tickerItems: [], backup: '', schedule: null, widgets: [] });
  for (const k of ['layout', 'tickerItems', 'backup', 'schedule', 'widgets']) assert.equal(k in c, false, `${k} saiu`);
  for (const bad of [{ layout: 'fila' }, { layout: 'x' }, { tickerItems: 'texto' }, { tickerItems: Array(21).fill('a') }, { tickerSpeed: 5 }, { backup: 'ftp://x' }, { backup: 'javascript:alert(1)' }, { backup: 'https://u:p@x.test/a' }, { qrUrl: 'nada' },
    { volume: 101 }, { exitSeq: ['UP'] }, { exitSeq: ['UP', 'UP', 'UP', 'HOME'] }, { schedule: { tvOn: '7:00', tvOff: '19:00', days: [1] } }, { schedule: { tvOn: '07:00', tvOff: '07:00', days: [1] } }, { schedule: { tvOn: '07:00', tvOff: '19:00', days: [0, 8] } }, { schedule: { tvOn: '07:00', tvOff: '19:00', days: [-1] } }, { schedule: { tvOn: '07:00', tvOff: '19:00', days: 'seg' } }, { pin: 'abcd' }]) {
    assert.equal(status(() => C.mergeConfig({}, bad)), 400, JSON.stringify(bad));
  }
  assert.equal(status(() => C.mergeConfig({}, 'x')), 400); assert.equal(status(() => C.mergeConfig({}, [1])), 400);
  assert.equal(C.mergeConfig({}, { tickerItems: ['x'.repeat(500)] }).tickerItems[0].length, TT.LIMITS.tickerItem);
  assert.deepEqual(C.mergeConfig({}, { tickerItems: ['linha\u0000com\ncontrole'] }).tickerItems, ['linha com controle']);
  // grupo: PIN, volume e sinal reserva não entram (nem os que já estivessem gravados)
  assert.deepEqual(C.mergeConfig({ pin: { salt: 'a', hash: 'b' }, layout: 'side' }, { pin: '1234', volume: 10, backup: 'https://x.test/a.m3u8', tickerItems: ['G'] }, C.GROUP_CONFIG_KEYS), { layout: 'side', tickerItems: ['G'] });
});

test('precedência: tela > grupos (avisos somados na ordem, layout do primeiro que define) > repartição > padrão > fábrica', () => {
  const base = { defaults: { layout: 'ticker', tickerItems: ['Padrão'], pin: { salt: 's0', hash: 'h0' }, volume: 80 }, officeType: 'ubs' };
  assert.deepEqual(C.effectiveConfig({}).tickerItems, []); assert.equal(C.effectiveConfig({}).layout, 'full'); assert.deepEqual(C.effectiveConfig({}).exitSeq, ['UP', 'UP', 'DOWN', 'DOWN', 'OK']);
  let e = C.effectiveConfig(base);
  assert.deepEqual([e.layout, e.tickerItems, e.pin.hash, e.volume, e.muted], ['ticker', ['Padrão'], 'h0', 80, false]);
  e = C.effectiveConfig({ ...base, office: { tickerItems: ['Repartição'], pin: { salt: 's1', hash: 'h1' } } });
  assert.deepEqual([e.layout, e.tickerItems, e.pin.hash], ['ticker', ['Repartição'], 'h1'], 'a repartição vence o padrão no que define');
  // módulo "avisos" desligado: os avisos da repartição não contam (cai no padrão); o resto dela continua
  e = C.effectiveConfig({ ...base, modules: { avisos: false }, office: { tickerItems: ['Repartição'], layout: 'side' } });
  assert.deepEqual([e.layout, e.tickerItems], ['side', ['Padrão']]);
  const groups = [{ tickerItems: ['G1 a', 'G1 b'] }, {}, { layout: 'lbar', tickerItems: ['G3'] }, { layout: 'portrait' }];
  e = C.effectiveConfig({ ...base, office: { tickerItems: ['Repartição'], layout: 'side', pin: { salt: 's1', hash: 'h1' } }, groups });
  assert.deepEqual(e.tickerItems, ['G1 a', 'G1 b', 'G3'], 'os avisos de todos os grupos com avisos, na ordem dos grupos');
  assert.equal(e.layout, 'lbar', 'o layout do primeiro grupo que define um'); assert.equal(e.pin.hash, 'h1', 'o grupo não mexe no PIN');
  e = C.effectiveConfig({ ...base, office: { tickerItems: ['Repartição'], layout: 'side' }, groups: [{}, { description: 'sem nada' }] });
  assert.deepEqual([e.layout, e.tickerItems], ['side', ['Repartição']], 'grupos sem avisos nem layout: vale a repartição');
  e = C.effectiveConfig({ ...base, office: { layout: 'side' }, groups, device: { tickerItems: ['Só esta tela'], layout: 'full', pin: { salt: 's2', hash: 'h2' }, backup: 'https://r.test/x.m3u8' } });
  assert.deepEqual([e.layout, e.tickerItems, e.pin.hash, e.backup], ['full', ['Só esta tela'], 'h2', 'https://r.test/x.m3u8'], 'a tela vence tudo');
  // muitos grupos: os avisos somados têm teto
  assert.equal(C.effectiveConfig({ groups: Array(10).fill({ tickerItems: Array(20).fill('x') }) }).tickerItems.length, 60);
});

test('contrato: o JSON da configuração tem exatamente os campos do contrato e o rev muda com qualquer campo', () => {
  const eff = C.effectiveConfig({ defaults: { pin: C.pinRecord('1234'), tickerItems: ['A'] } });
  const args = { eff, device: { id: 12, name: 'UBS Centro, recepção' }, office: { name: 'UBS Centro', type: 'ubs' }, region: { name: 'Centro' }, stream: { hls: 'https://hls.test/hls/x/master.m3u8' } };
  const cfg = C.contractConfig(args);
  assert.deepEqual(Object.keys(cfg), ['device', 'stream', 'layout', 'ticker', 'side', 'lock', 'offline', 'schedule', 'heartbeatSec', 'weather', 'cards', 'queue', 'captions', 'theme', 'callSound'], 'os campos do contrato §2, §7.1, §14, §15 e §16 (internal só na tela interna)');
  // §14: as legendas, desligadas de fábrica; a escolha segue a precedência (tela > grupos > repartição > padrão > fábrica)
  assert.deepEqual(cfg.captions, { on: false, lang: null });
  const capEff = C.effectiveConfig({ defaults: { captions: { on: true, lang: 'en' } }, office: { captions: { on: true, lang: null } }, device: {} });
  assert.deepEqual(C.contractConfig({ ...args, eff: capEff }).captions, { on: true, lang: null }, 'a repartição vence o padrão');
  assert.deepEqual(C.mergeConfig({}, { captions: { on: true, lang: 'es' } }).captions, { on: true, lang: 'es' });
  assert.deepEqual(C.mergeConfig({ captions: { on: true, lang: 'es' } }, { captions: null }), {}, 'null: volta a herdar');
  for (const bad of [{ on: 'sim' }, { on: true, lang: 'xx' }, 'ligado', [true]]) assert.equal(status(() => C.mergeConfig({}, { captions: bad })), 400, JSON.stringify(bad));
  assert.notEqual(C.revOf(C.contractConfig({ ...args, eff: capEff })), C.revOf(cfg), 'mudar as legendas muda o rev');
  assert.deepEqual(cfg.device, { id: 12, name: 'UBS Centro, recepção', office: 'UBS Centro', officeType: 'ubs', region: 'Centro' });
  assert.deepEqual(cfg.stream, { hls: 'https://hls.test/hls/x/master.m3u8', backup: null, volume: 100, muted: false });
  assert.deepEqual(cfg.ticker, { items: ['A'], speed: 60, style: null, rich: [{ text: 'A' }] }); assert.deepEqual(cfg.side, { widgets: ['clock'], qrUrl: null, title: null });
  assert.deepEqual(Object.keys(cfg.lock), ['pinHash', 'pinSalt', 'exitSeq']); assert.equal(cfg.lock.pinHash, sha(`${cfg.lock.pinSalt}1234`));
  assert.deepEqual([cfg.offline, cfg.schedule, cfg.heartbeatSec], [{ items: [], image: null }, null, 10]);
  assert.deepEqual(C.contractConfig({ ...args, region: null, eff: C.effectiveConfig({}) }).lock, { pinHash: null, pinSalt: null, exitSeq: ['UP', 'UP', 'DOWN', 'DOWN', 'OK'] }, 'sem PIN: nulos');
  // atualização do app: só quando a prefeitura define (https, SHA-256 e versionCode)
  const up = { url: 'https://dl.exemplo.test/telas.apk', sha256: 'A'.repeat(64), versionCode: '12' };
  assert.deepEqual(C.cleanUpdate(up), { url: 'https://dl.exemplo.test/telas.apk', sha256: 'a'.repeat(64), versionCode: 12 });
  assert.equal(C.cleanUpdate(null), null); assert.equal(C.cleanUpdate(''), null);
  for (const bad of [{ ...up, url: 'http://dl.exemplo.test/telas.apk' }, { ...up, url: 'file:///x.apk' }, { ...up, sha256: 'abc' }, { ...up, versionCode: 0 }, { ...up, versionCode: 1.5 }, 'x', [up]]) assert.equal(status(() => C.cleanUpdate(bad)), 400, JSON.stringify(bad));
  const withUp = C.contractConfig({ ...args, update: C.cleanUpdate(up) });
  assert.deepEqual(Object.keys(withUp).at(-1), 'update'); assert.deepEqual(withUp.update, { url: 'https://dl.exemplo.test/telas.apk', sha256: 'a'.repeat(64), versionCode: 12 });
  assert.equal('update' in cfg, false, 'sem atualização definida: o campo nem vai');
  const rev = C.revOf(cfg);
  assert.match(rev, /^[0-9a-f]{12}$/); assert.equal(C.revOf(C.contractConfig(args)), rev, 'mesmo conteúdo, mesmo rev');
  assert.notEqual(C.revOf(C.contractConfig({ ...args, eff: { ...eff, tickerItems: ['B'] } })), rev);
  assert.notEqual(C.revOf(C.contractConfig({ ...args, stream: { hls: 'https://hls.test/outro.m3u8' } })), rev);
});

test('alcance dos alertas: cidade, regiões, grupos, repartição e raio por haversine (ponto da tela ou da repartição)', () => {
  // 1 grau de latitude ~ 111,2 km; Rio (Praça XV) -> Niterói (Arariboia) ~ 5,1 km
  assert.ok(Math.abs(TT.distanceM(0, 0, 1, 0) - 111195) < 60);
  assert.ok(Math.abs(TT.distanceM(-22.9035, -43.1729, -22.8945, -43.1245) - 5060) < 150);
  assert.equal(TT.distanceM(-22.9, -43.2, -22.9, -43.2), 0);
  const dev = { officeId: 3, regionId: 7, groups: [2, 9], lat: -22.9035, lng: -43.1729 };
  assert.equal(TT.scopeHits({ kind: 'city' }, dev), true);
  assert.equal(TT.scopeHits({ kind: 'regions', regions: [1, 7] }, dev), true); assert.equal(TT.scopeHits({ kind: 'regions', regions: [1] }, dev), false);
  assert.equal(TT.scopeHits({ kind: 'regions', regions: [7] }, { ...dev, regionId: null }), false, 'repartição sem região não entra em alerta por região');
  assert.equal(TT.scopeHits({ kind: 'groups', groups: [9] }, dev), true); assert.equal(TT.scopeHits({ kind: 'groups', groups: [4, 5] }, dev), false);
  assert.equal(TT.scopeHits({ kind: 'groups', groups: [9] }, { ...dev, groups: [] }), false);
  assert.equal(TT.scopeHits({ kind: 'office', office: 3 }, dev), true); assert.equal(TT.scopeHits({ kind: 'office', office: 4 }, dev), false);
  const niteroi = { lat: -22.8945, lng: -43.1245 };
  assert.equal(TT.scopeHits({ kind: 'radius', ...niteroi, meters: 6000 }, dev), true); assert.equal(TT.scopeHits({ kind: 'radius', ...niteroi, meters: 4000 }, dev), false);
  assert.equal(TT.scopeHits({ kind: 'radius', ...niteroi, meters: 100000 }, { ...dev, lat: null, lng: null }), false, 'tela sem ponto não entra em raio');
  assert.equal(TT.scopeHits({ kind: 'inventado' }, dev), false); assert.equal(TT.scopeHits(null, dev), false);
});

test('alerta: campos limpos, prazo obrigatório (1 min a 7 dias), alcance só entre os permitidos a quem manda', () => {
  const now = 1.8e12; const all = ['city', 'regions', 'groups', 'office', 'radius'];
  const a = C.cleanAlert({ title: '  Defesa   Civil ', text: 'Linha 1\r\n\r\n\r\n\r\nLinha 2\u0007', level: 'critical', sound: 1, durationMin: 30, scope: { kind: 'regions', regions: [3, '3', 5] } }, { now, allowed: all });
  assert.deepEqual(a, { title: 'Defesa Civil', body: 'Linha 1\n\nLinha 2', level: 'critical', sound: true, startsAt: now, until: now + 30 * 60000, scope: { kind: 'regions', regions: [3, 5] } });
  assert.equal(C.cleanAlert({ title: 'Ok', until: now + 3600e3, scope: { kind: 'city' } }, { now, allowed: all }).level, 'info');
  const bad = (b, allowed = all) => status(() => C.cleanAlert({ title: 'Título', durationMin: 10, scope: { kind: 'city' }, ...b }, { now, allowed }));
  assert.equal(bad({}), 200);
  for (const b of [{ title: 'x' }, { level: 'vermelho' }, { durationMin: undefined }, { durationMin: 0.5 }, { durationMin: 60 * 24 * 8 }, { until: now + 30000, durationMin: undefined }, { startsAt: now - 3600e3 }, { startsAt: now + 40 * 86400e3 },
    { scope: { kind: 'regions', regions: [] } }, { scope: { kind: 'groups', groups: ['x'] } }, { scope: { kind: 'office' } }, { scope: { kind: 'radius', lat: -22, lng: -43, meters: 50 } }, { scope: { kind: 'radius', lat: 95, lng: 0, meters: 500 } }, { scope: { kind: 'radius', meters: 500 } }, { scope: null }, { scope: {} }]) {
    assert.equal(bad(b), 400, JSON.stringify(b));
  }
  // o link de uma UBS só manda para a própria repartição: qualquer outro alcance é 403
  for (const kind of ['city', 'regions', 'groups', 'radius']) assert.equal(bad({ scope: { kind, regions: [1], groups: [1], lat: 0, lng: 0, meters: 500 } }, ['office']), 403, kind);
  assert.equal(bad({ scope: { kind: 'office', office: 4 } }, ['office']), 200);
  assert.equal(bad({ scope: { kind: 'radius', lat: 0, lng: 0, meters: 500 } }, TT.officeAlertScopes('defesa-civil')), 200, 'o raio também vale no link de quem alcança a cidade');
  assert.equal(bad({ scope: { kind: 'radius', lat: 0, lng: 0, meters: 500 } }, TT.officeAlertScopes('escola')), 403, 'e só no dela');
  assert.deepEqual(C.scopeFromRow(C.scopeToRow({ kind: 'radius', lat: -22.9, lng: -43.2, meters: 800 })), { kind: 'radius', lat: -22.9, lng: -43.2, meters: 800 });
  assert.deepEqual(C.scopeToRow({ kind: 'city' }), { scope: 'city', scope_data: '{}' });
});

test('sinal de vida e cadastro: só valores conhecidos, textos cortados, ponto no mapa conferido', () => {
  assert.deepEqual(C.cleanHeartbeat({ rev: 'abc', state: 'playing', source: 'hls', net: 'wifi', appVersion: '1.0.0', uptimeSec: 3600.4, lastError: null, locked: true }),
    { rev: 'abc', state: 'playing', source: 'hls', net: 'wifi', appVersion: '1.0.0', uptimeSec: 3600, lastError: null, locked: 1 });
  assert.deepEqual(C.cleanHeartbeat({ rev: {}, state: '<script>', source: 'usb', net: 5, appVersion: 'x'.repeat(100), uptimeSec: -1, lastError: 'e'.repeat(999), locked: 'sim' }),
    { rev: null, state: null, source: null, net: null, appVersion: 'x'.repeat(40), uptimeSec: null, lastError: 'e'.repeat(300), locked: null });
  assert.deepEqual(C.cleanHeartbeat(undefined), { rev: null, state: null, source: null, net: null, appVersion: '', uptimeSec: null, lastError: null, locked: null });
  assert.deepEqual(C.cleanDeviceInfo({ model: ' B13\n', android: 13, appVersion: '1.0.0', serial: null }), { model: 'B13', android: '13', appVersion: '1.0.0', serial: '' });
  assert.deepEqual(C.cleanPoint(-22.90684999, '-43.1729'), { lat: -22.90685, lng: -43.1729 }); assert.deepEqual(C.cleanPoint(null, ''), { lat: null, lng: null });
  for (const [a, b] of [[-22, null], [null, -43], [91, 0], [0, 181], ['x', 'y'], [Infinity, 0]]) assert.equal(status(() => C.cleanPoint(a, b)), 400, `${a},${b}`);
  assert.equal(C.cleanColor('#AABBCC'), '#aabbcc'); assert.equal(C.cleanColor(''), null);
  for (const v of ['red', '#abc', 'url(x)', '#12345g']) assert.equal(status(() => C.cleanColor(v)), 400, v);
  assert.equal(C.cleanName('  UBS   Centro '), 'UBS Centro'); assert.equal(status(() => C.cleanName('x')), 400);
  assert.equal(status(() => C.cleanOfficeType('banco')), 400);
  for (const v of ['1.5', 0, -3, 'abc', null, '1; DROP TABLE x']) assert.equal(status(() => C.idOf(v)), 400, String(v));
  assert.equal(C.idOf('42'), 42);
});

test('captura: assinatura JPEG conferida e o arquivo sai só de dois inteiros (sem travessia de caminho)', async () => {
  const ok = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
  assert.equal(C.isJpeg(ok), true);
  assert.equal(C.isJpeg(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(200)])), false, 'PNG');
  assert.equal(C.isJpeg(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)])), false, 'sem o fim FF D9');
  assert.equal(C.isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9])), false, 'curto demais');
  assert.equal(C.isJpeg(Buffer.from('<html><script>alert(1)</script></html>'.repeat(5))), false); assert.equal(C.isJpeg('texto'), false); assert.equal(C.isJpeg({}), false);
  assert.equal(C.SHOT_MAX, 400 * 1024);
  const rootDir = C.shotsRoot();
  assert.equal(rootDir, path.join(process.env.DATA_DIR, 'telas', 'shots'));
  assert.equal(C.shotFile(3, 12), path.join(rootDir, '3', '12.jpg'));
  assert.equal(C.shotFile('3', '12'), path.join(rootDir, '3', '12.jpg'));
  for (const [t, d] of [['..', 1], [1, '../../x'], [1, '1/../../2'], ['1\\..', 1], [1, '12.jpg'], [0, 1], [1, 0], [-1, 1], [1.5, 1], [1, NaN], [null, 1], [1, '%2e%2e'], [1, '1\u0000']]) assert.equal(status(() => C.shotFile(t, d)), 400, `${t}/${d}`);
  await C.saveShot(3, 12, ok);
  assert.ok(fs.readFileSync(C.shotFile(3, 12)).equals(ok));
  assert.deepEqual(fs.readdirSync(path.join(rootDir, '3')), ['12.jpg'], 'sem sobra do arquivo parcial');
  await C.saveShot(4, 1, ok);
  await C.removeTenantShots(3);
  assert.equal(fs.existsSync(path.join(rootDir, '3')), false); assert.equal(fs.existsSync(C.shotFile(4, 1)), true, 'as do outro cliente ficam');
  await C.removeTenantShots('../4'); await C.removeTenantShots(null);
  assert.equal(fs.existsSync(C.shotFile(4, 1)), true, 'cliente inválido não apaga nada');
});

test('sessão do link de controle: assinada, com validade, presa à repartição e à versão do link', () => {
  const S = C.createOfficeSessions('segredo-de-teste');
  const now = 1.8e12;
  const { token, exp } = S.sign(7, 3, now);
  assert.equal(exp, now + C.OFFICE_SESSION_MS);
  assert.deepEqual(S.read(token, now + 1000), { officeId: 7, ver: 3, exp });
  assert.equal(S.read(token, exp), null, 'vencida');
  assert.equal(S.read(token.replace(/^r1\.7\./, 'r1.8.'), now), null, 'outra repartição no token não passa pela assinatura');
  assert.equal(S.read(token.replace(/^r1\.7\.3\./, 'r1.7.4.'), now), null, 'outra versão do link também não');
  assert.equal(S.read(token.replace(/\.(\d+)\.([\w-]+)$/, (_, e, s) => `.${Number(e) + 1e9}.${s}`), now), null, 'validade esticada não passa');
  assert.equal(S.read(`${token.slice(0, -2)}AA`, now), null);
  assert.equal(C.createOfficeSessions('outro-segredo').read(token, now), null, 'assinada com outro segredo');
  for (const v of ['', null, undefined, 'r1.7.3', 'abc', {}, token + token, `r1.7.3.${exp}.`]) assert.equal(S.read(v, now), null, String(v).slice(0, 20));
});

test('mapa próprio: Web Mercator ida e volta, quadros que cobrem a caixa, raio em pixels e o zoom que enquadra os pontos', () => {
  assert.deepEqual(M.project(0, 0, 0), { x: 128, y: 128 });
  assert.deepEqual(M.project(0, -180, 2), { x: 0, y: 512 });
  // quadro conhecido do OpenStreetMap: o Rio (−22,9068; −43,1729) no zoom 12 fica no quadro x=1556, y=2315
  const rio = M.project(-22.9068, -43.1729, 12);
  assert.deepEqual([Math.floor(rio.x / 256), Math.floor(rio.y / 256)], [1556, 2315]);
  for (const [lat, lng, z] of [[-22.9068, -43.1729, 12], [51.5, -0.12, 9], [-33.9, 151.2, 16], [0, 0, 3]]) {
    const p = M.project(lat, lng, z); const g = M.unproject(p.x, p.y, z);
    assert.ok(Math.abs(g.lat - lat) < 1e-9 && Math.abs(g.lng - lng) < 1e-9, `${lat},${lng}@${z}`);
  }
  assert.ok(Number.isFinite(M.project(90, 0, 5).y) && Number.isFinite(M.project(-90, 0, 5).y), 'os polos não estouram');
  // metros por pixel: ~156,5 km no equador no zoom 0; cai à metade a cada zoom e com o cosseno da latitude
  assert.ok(Math.abs(M.metersPerPixel(0, 0) - 156543.03) < 0.1); assert.ok(Math.abs(M.metersPerPixel(0, 10) - 152.874) < 0.01);
  assert.ok(Math.abs(M.metersPerPixel(60, 10) / M.metersPerPixel(0, 10) - 0.5) < 1e-9);
  // quadros: cobrem a caixa inteira, sem repetir, dentro do mundo; o endereço é o do OpenStreetMap
  const tiles = M.tilesFor({ lat: -22.9068, lng: -43.1729 }, 12, 800, 500);
  assert.ok(tiles.length >= 12 && tiles.length <= 20, String(tiles.length));
  assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
  assert.ok(Math.min(...tiles.map((t) => t.left)) <= 0 && Math.max(...tiles.map((t) => t.left)) + 256 >= 800 && Math.min(...tiles.map((t) => t.top)) <= 0 && Math.max(...tiles.map((t) => t.top)) + 256 >= 500);
  assert.ok(tiles.every((t) => t.z === 12 && t.x >= 0 && t.x < 4096 && t.y >= 0 && t.y < 4096));
  assert.ok(tiles.some((t) => t.x === 1556 && t.y === 2315));
  assert.equal(M.tileUrl({ z: 12, x: 1556, y: 2315 }), 'https://tile.openstreetmap.org/12/1556/2315.png');
  // na borda do mundo (antimeridiano) o x dá a volta; acima do polo não há quadro
  const edge = M.tilesFor({ lat: 0, lng: 179.9 }, 3, 600, 400);
  assert.ok(edge.some((t) => t.x === 0) && edge.some((t) => t.x === 7));
  assert.ok(M.tilesFor({ lat: 84, lng: 0 }, 3, 600, 2000).every((t) => t.y >= 0 && t.y < 8));
  // enquadrar: um ponto só = zoom de rua; vários = o maior zoom em que cabem, com o meio no meio
  assert.equal(M.fitView([], 800, 500), null); assert.equal(M.fitView([{ lat: null, lng: 1 }, {}], 800, 500), null);
  const solo = M.fitView([{ lat: -22.9, lng: -43.2 }], 800, 500);
  assert.ok(Math.abs(solo.lat + 22.9) < 1e-9 && Math.abs(solo.lng + 43.2) < 1e-9 && solo.zoom === 15);
  const pts = [{ lat: -22.9711, lng: -43.1863 }, { lat: -22.9021, lng: -43.2802 }, { lat: -22.9068, lng: -43.1729 }];
  const v = M.fitView(pts, 800, 500);
  assert.ok(v.zoom >= 11 && v.zoom <= 13, String(v.zoom));
  const c = M.project(v.lat, v.lng, v.zoom);
  for (const p of pts) { const q = M.project(p.lat, p.lng, v.zoom); assert.ok(Math.abs(q.x - c.x) <= 400 - 48 + 1 && Math.abs(q.y - c.y) <= 250 - 48 + 1, 'todos dentro da caixa com a margem'); }
  const tight = M.fitView(pts, 800, 500); const next = { ...tight, zoom: tight.zoom + 1 };
  const cc = M.project(next.lat, next.lng, next.zoom);
  assert.ok(pts.some((p) => { const q = M.project(p.lat, p.lng, next.zoom); return Math.abs(q.x - cc.x) > 352 || Math.abs(q.y - cc.y) > 202; }), 'um zoom a mais já não caberia');
  assert.ok(M.fitView([{ lat: -33, lng: -70 }, { lat: 60, lng: 100 }], 800, 500).zoom === M.MIN_ZOOM, 'pontos no mundo inteiro: o zoom mínimo');
});

// (removido no DIGITAL ISP: "painel: a tela registrada…" conferia o painel/banco do NEXA Broadcast; o passo 3 escreve o equivalente)

test('página da repartição: CSP estrita sem inline, nada de fora, a sessão só na aba e o link fora do endereço das chamadas', () => {
  const html = read('public/reparticao/index.html'); const srv = read('server/telas.js');
  // a página é feita de módulos (um por aba) e da prévia da TV compartilhada: a regra vale para todos eles
  const files = /const PAGE_FILES = \[([^\]]+)\]/.exec(srv)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(files.filter((f) => !fs.existsSync(path.join(root, 'public/reparticao', f))), [], 'todo arquivo servido existe');
  assert.deepEqual(fs.readdirSync(path.join(root, 'public/reparticao')).filter((f) => /^(rep-|reparticao\.)/.test(f) && !files.includes(f)), [], 'todo módulo da página é servido');
  const mods = [...files.filter((f) => f.endsWith('.js')).map((f) => `public/reparticao/${f}`), 'public/shared/telas-previa.js', 'public/shared/triagem-catalogo.js'];
  const js = mods.map(read).join('\n'); const css = read('public/reparticao/reparticao.css') + read('public/shared/telas-previa.css');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'sem script inline'); assert.ok(!/\son[a-z]+\s*=/i.test(html), 'sem on*='); assert.ok(!/\sstyle\s*=|<style/i.test(html), 'sem estilo inline');
  assert.deepEqual([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]), ['/shared/telas-previa.css', '/reparticao/reparticao.css', '#panels', '/reparticao/reparticao.js'], 'só os arquivos da própria página e a prévia da TV');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!/https?:\/\//.test(html + css), 'nenhum endereço de fora');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|\.style\b|setAttribute\('style'/.test(js), 'texto só por textContent e nenhum estilo pelo script');
  // o que a página importa: o catálogo, a prévia, os módulos dela e o mapa do painel (sem o fundo de fora: tiles: false)
  const imports = [...new Set([...js.matchAll(/from '([^']+)'/g)].map((m) => m[1]))].filter((p) => !/^\/reparticao\/rep-[a-z]+\.js$/.test(p)).sort();
  assert.deepEqual(imports, ['./qr.js', './telas-tipos.js', '/admin/telas-mapa.js', '/shared/telas-amostras.js', '/shared/telas-previa.js', '/shared/telas-salas.js', '/shared/telas-tipos.js', '/shared/triagem-catalogo.js']);
  assert.match(js, /createMap\(box, \{ tiles: false,/); assert.ok(!/createMap\((?![^)]*tiles: false)/.test(js), 'o mapa da repartição nunca busca o fundo de fora');
  assert.match(read('public/admin/telas-mapa.js'), /const want = useTiles \? tilesFor\(view, view\.zoom, w, h\) : \[\];/);
  assert.match(js, /sessionStorage/); assert.ok(!/localStorage(?!\.(getItem|setItem|removeItem)\(ROOM_KEY[,)])|document\.cookie/.test(js), 'a sessão fica só nesta aba (no navegador, só o número da sala escolhida)');
  assert.match(js, /fetch\(`\/api\/reparticao\$\{path\}`/); assert.ok(!/\/api\/reparticao\/\$\{link\}|\?token=/.test(js), 'o link vai no corpo do login, nunca no endereço de uma chamada');
  const csp = /'Content-Security-Policy': "([^"]+)"/.exec(srv.slice(srv.indexOf('function mountOffice')))[1];
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  assert.match(srv, /'Referrer-Policy': 'no-referrer'/);
  // servidor: nada de segredo em log; as rotas de alto volume fora do log de auditoria
  assert.ok(!/console\.(log|warn|error)\([^)]*(token|key|password|pin)/i.test(srv), 'nenhum segredo em console.*');
  assert.match(read('server/index.js'), /'\/telas\/heartbeat', '\/telas\/screenshot'\]\)/);
});

test('faixa: estilo da faixa e de cada aviso; o app antigo recebe só o texto', async () => {
  const { cleanAviso, tickerTexts, tickerRich } = await import('../server/telas-conteudo-core.js');
  const { cleanTickerStyle } = await import('../public/shared/faixa.js');
  assert.equal(cleanAviso('[institucional] {c=#FF0000;b} Promoção', 200), '[institucional] {c=#ff0000;b} Promoção');
  assert.equal(cleanAviso('{b;c=#zz} Só negrito', 200), '{b} Só negrito');
  assert.deepEqual(tickerTexts(['{c=#ff0000;b;i} Oferta', 'Normal']), ['Oferta', 'Normal']);
  assert.deepEqual(tickerRich(['{c=#ff0000;b;i} Oferta', 'Normal']), [{ text: 'Oferta', color: '#ff0000', bold: true, italic: true }, { text: 'Normal' }]);
  assert.equal(tickerRich(['[institucional] {b} Aviso'], true).length, 0); // institucional retido no período eleitoral
  const st = cleanTickerStyle({ color: '#FFFFFF', bg: 'azul', size: 200, font: 'x', sep: 'barra', label: '  AVISOS  ', bold: false });
  assert.deepEqual(st, { color: '#ffffff', bg: '#0b1e3a', bold: false, italic: false, size: 90, font: 'sans', sep: 'barra', label: 'AVISOS', labelColor: '#ffffff', labelBg: '#1d4ed8' });
  assert.equal(cleanTickerStyle(null), null);
});
