// NEXA Telas: as regras sem banco das telas de controle por família (public/shared/telas-tipos.js, server/telas-core.js,
// server/telas-conteudo-core.js, server/telas-desaparecidos.js): as 7 famílias e as abas de cada tipo, módulo e papel; a
// sessão de um usuário da repartição; o usuário, o papel e a senha; o catálogo de tipos de aviso e a gravidade (contrato
// §9); o texto sugerido que a prefeitura troca; o caso de pessoa desaparecida e o item do contrato §8 (sem a autorização).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';

process.env.DATA_DIR = tmpDir('nexa-telasctl');
process.env.SESSION_SECRET = 'segredo-do-teste-de-controle';
const TT = await import('../public/shared/telas-tipos.js');
const C = await import('../server/telas-core.js');
const K = await import('../server/telas-conteudo-core.js');
const D = await import('../server/telas-desaparecidos.js');
const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status || 500; } };

test('famílias: cada tipo de repartição numa família e as abas pelo tipo, pelos módulos e pelo papel', () => {
  for (const t of TT.OFFICE_TYPE_KEYS) assert.equal(TT.FAMILIES.filter((f) => f.types.includes(t)).length, 1, `${t} numa família só`);
  assert.deepEqual(TT.FAMILIES.map((f) => f.n), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11']);
  // F11 (TV Corporativa): publicar, comunicados e aniversariantes da unidade; a senha e o pânico pelos módulos de fábrica
  assert.deepEqual(TT.officeTabs({ type: 'filial', modules: TT.officeModules('filial') }).map((t) => t.key), ['publicar', 'comunicados', 'aniversariantes', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(TT.officeTabs({ type: 'recepcao', modules: TT.officeModules('recepcao') }).map((t) => t.key).slice(0, 5), ['publicar', 'comunicados', 'aniversariantes', 'atendimento', 'recepcao']);
  assert.deepEqual([TT.familyOf('secom'), TT.familyOf('defesa-civil'), TT.familyOf('upa'), TT.familyOf('sine'), TT.familyOf('creche'), TT.familyOf('terminal'), TT.familyOf('outro'), TT.familyOf('inventado')], ['comando', 'emergencia', 'pronto', 'senha', 'educacao', 'informacao', 'geral', 'geral']);
  const tabs = (type, extra = {}, mods = null) => TT.officeTabs({ type, modules: TT.officeModules(type, mods), ...extra }).map((t) => t.key);
  assert.deepEqual(tabs('secom'), ['aprovacoes', 'geral', 'alerta', 'desaparecidos', 'avisos', 'card-unidade', 'telas']);
  assert.deepEqual(tabs('defesa-civil'), ['novo-alerta', 'no-ar', 'desaparecidos', 'avisos', 'card-unidade', 'telas']);
  assert.deepEqual(tabs('upa', { risk: true }), ['atendimento', 'recepcao', 'triagem', 'codigos', 'salas', 'apoio', 'indicadores', 'card-escala', 'card-unidade', 'avisos', 'alerta', 'interna', 'telas']);
  assert.deepEqual(tabs('upa'), ['atendimento', 'recepcao', 'codigos', 'salas', 'apoio', 'indicadores', 'card-escala', 'card-unidade', 'avisos', 'alerta', 'interna', 'telas'], 'sem a classificação de risco não há Triagem');
  // comunicação interna (§25): os códigos para qualquer papel, a gestão só para o gestor; desligada, as abas somem
  assert.deepEqual(tabs('upa', {}, { interna: false }), ['atendimento', 'recepcao', 'salas', 'apoio', 'indicadores', 'card-escala', 'card-unidade', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(tabs('hospital', { role: 'atendente' }, { senha: false }), ['codigos'], 'o atendente sem a senha ainda dispara um código');
  assert.deepEqual(tabs('ubs', {}, { interna: true }), ['atendimento', 'recepcao', 'codigos', 'salas', 'apoio', 'indicadores', 'card-unidade', 'avisos', 'alerta', 'interna', 'telas']);
  assert.deepEqual(tabs('central-cidadao'), ['atendimento', 'recepcao', 'salas', 'apoio', 'indicadores', 'card-unidade', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(tabs('sine'), ['atendimento', 'recepcao', 'salas', 'apoio', 'indicadores', 'card-vagas', 'card-unidade', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(tabs('escola'), ['card-merenda', 'card-calendario', 'card-unidade', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(tabs('creche'), ['card-merenda', 'card-unidade', 'avisos', 'alerta', 'telas'], 'a creche não tem Calendário');
  assert.deepEqual(tabs('terminal'), ['card-linhas', 'card-unidade', 'avisos', 'alerta', 'telas']);
  assert.deepEqual(tabs('outro'), ['avisos', 'card-unidade', 'alerta', 'telas'], 'a tela mínima');
  // a prefeitura liga ou desliga um módulo: a aba acompanha
  assert.deepEqual(tabs('ubs', {}, { senha: false }), ['avisos', 'card-unidade', 'alerta', 'telas'], 'sem a senha, a UBS fica com a tela mínima');
  assert.deepEqual(tabs('outro', {}, { senha: true, avisos: false }), ['atendimento', 'recepcao', 'salas', 'apoio', 'indicadores', 'card-unidade', 'alerta', 'telas']);
  // o atendente só vê Atendimento e Recepção; sem a chamada de senha, nada
  assert.deepEqual(tabs('upa', { role: 'atendente', risk: true }), ['atendimento', 'recepcao', 'codigos']);
  assert.deepEqual(tabs('secom', { role: 'atendente' }), []);
  for (const t of TT.OFFICE_TYPE_KEYS) { const keys = tabs(t, { risk: true }); assert.equal(new Set(keys).size, keys.length, `${t}: abas sem repetição`); if (!TT.isExternal(t)) assert.equal(keys.at(-1), 'telas'); }
  // segurança pública: o CCO, e os emissores conveniados (órgãos de fora: só o que emitem e os próprios envios)
  assert.deepEqual(tabs('seguranca'), ['ocorrencias', 'aprovacoes', 'novo-alerta', 'desaparecidos', 'no-ar', 'avisos', 'card-unidade', 'telas']);
  assert.deepEqual(tabs('policia-civil'), ['desaparecidos', 'novo-alerta', 'no-ar']); assert.deepEqual(tabs('policia-militar'), ['novo-alerta', 'no-ar'], 'a Polícia Militar não tem Desaparecidos');
  assert.deepEqual(tabs('policia-militar', { devices: 2 }), ['novo-alerta', 'no-ar', 'telas'], 'a aba Telas só com tela vinculada'); assert.deepEqual(tabs('policia-civil', { role: 'atendente' }), []);
  assert.deepEqual([TT.isExternal('policia-civil'), TT.isExternal('seguranca'), TT.issuerOf('seguranca'), TT.issuerOf('ubs'), TT.alertCategoriesOf('policia-civil'), TT.alertCategoriesOf('policia-militar'), TT.alertCategoriesOf('defesa-civil')], [true, false, 'Guarda Municipal', null, ['seguranca'], ['seguranca', 'transito'], null]);
  assert.deepEqual([TT.issuerHeader('seguranca', 'info'), TT.issuerHeader('policia-militar', 'warn'), TT.issuerHeader('policia-civil', 'critical'), TT.issuerHeader('defesa-civil', 'info'), TT.issuerHeader('ubs', 'info')], ['ALERTA · GUARDA MUNICIPAL', 'ALERTA SEVERO · POLÍCIA MILITAR', 'ALERTA EXTREMO · POLÍCIA CIVIL', 'AVISO · DEFESA CIVIL', null]);
  for (const t of ['escola', 'creche', 'upa', 'hospital', 'ubs', 'caps', 'cras']) assert.equal(TT.officeModules(t).panico, true, `${t}: o botão de pânico nasce ligado`);
  for (const t of ['secom', 'seguranca', 'terminal', 'outro', 'policia-civil']) assert.equal(TT.officeModules(t).panico, false, t);
  assert.deepEqual(TT.OFFICE_ROLE_KEYS, ['gestor', 'atendente']);
});

test('sessão de um usuário da repartição: presa à repartição, à versão do link, ao usuário e à versão dele', () => {
  const S = C.createOfficeSessions('segredo-de-teste'); const now = 1.8e12;
  const { token, exp } = S.sign(7, 3, now, { id: 12, ver: 2 });
  assert.match(token, /^r2\.7\.3\.12\.2\./);
  assert.deepEqual(S.read(token, now + 1000), { officeId: 7, ver: 3, userId: 12, userVer: 2, exp });
  assert.equal(S.read(token, exp), null, 'vencida');
  for (const forged of [token.replace('r2.7.', 'r2.8.'), token.replace('.12.2.', '.13.2.'), token.replace('.12.2.', '.12.3.'), token.replace(/^r2/, 'r1'), `${token.slice(0, -2)}AA`]) assert.equal(S.read(forged, now), null);
  // a sessão da senha única não vira a de um usuário, nem o contrário
  const legacy = S.sign(7, 3, now).token;
  assert.deepEqual(S.read(legacy, now), { officeId: 7, ver: 3, exp: now + C.OFFICE_SESSION_MS });
  assert.equal(S.read(legacy.replace(/^r1\.7\.3\./, 'r2.7.3.12.2.'), now), null);
  assert.equal(C.createOfficeSessions('outro').read(token, now), null);
});

test('usuário, papel, senha e o nome na auditoria', () => {
  assert.equal(C.cleanOfficeUsername('  Ana.Gestora '), 'ana.gestora');
  for (const v of ['ab', 'com espaço', 'ação', '-começa', 'a'.repeat(41), '', null, { $ne: 1 }]) assert.equal(status(() => C.cleanOfficeUsername(v)), 400, String(v));
  assert.equal(C.cleanOfficeRole('atendente'), 'atendente'); assert.equal(status(() => C.cleanOfficeRole('admin')), 400);
  assert.equal(C.cleanOfficePassword('senha-boa-2026', 'ana'), 'senha-boa-2026');
  for (const [pw, user] of [['curta', 'ana'], ['12345678', 'ana'], ['ana.gestora', 'ana.gestora'], [null, 'ana'], ['x'.repeat(73), 'ana']]) assert.equal(status(() => C.cleanOfficePassword(pw, user)), 400, String(pw).slice(0, 12));
  assert.equal(status(() => C.cleanOfficePassword('nove-letr', 'ana', true)), 400, 'em produção, 10 ou mais');
  assert.equal(C.officeActor('UBS Centro', 'ana.gestora'), 'repartição: UBS Centro (ana.gestora)');
  assert.equal(C.officeActor('UBS Centro'), 'repartição: UBS Centro', 'a senha única do link, como antes');
  assert.ok(!C.OFFICE_DEVICE_CONFIG_KEYS.includes('pin') && !C.OFFICE_DEVICE_CONFIG_KEYS.includes('exitSeq') && !C.OFFICE_DEVICE_CONFIG_KEYS.includes('tickerItems'));
});

test('tipos de aviso: catálogo com ids únicos, textos dentro do contrato, gravidade e a linha de cima', () => {
  assert.deepEqual(TT.ALERT_CATEGORY_KEYS.slice(0, 5), ['meteorologico', 'geologico', 'tecnologico', 'incendio-ar', 'saude']);
  assert.ok(TT.ALERT_CATEGORY_KEYS.includes('teste') && TT.ALERT_CATEGORY_KEYS.includes('outro'));
  const ids = TT.ALERT_TYPES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  for (const t of TT.ALERT_TYPES) {
    assert.match(t.id, /^[a-z0-9-]{3,40}$/, t.id); assert.ok(TT.ALERT_LEVEL_KEYS.includes(t.level), t.id);
    assert.ok(t.name.length >= 3 && t.title.length <= TT.LIMITS.alertTitle && t.text.length <= TT.LIMITS.alertText, `${t.id}: tamanho`);
    if (t.id !== 'outro') { assert.ok(t.title.length >= 2 && t.text.length >= 40, `${t.id}: título e texto com a orientação`); assert.ok(!/desaparecid/i.test(t.name), 'desaparecido é a aba própria, não um tipo'); }
    assert.equal(t.test, t.category === 'teste');
    if (t.test) { assert.match(t.title, /^TESTE:/); assert.match(t.text, /Não há perigo real/); assert.equal(t.level, 'info'); }
  }
  for (const [cat, n] of [['meteorologico', 10], ['geologico', 4], ['tecnologico', 5], ['incendio-ar', 3], ['saude', 3], ['teste', 2]]) assert.ok(TT.alertCategory(cat).types.length >= n, cat);
  // gravidade: Aviso, Severo, Extremo sobre os níveis do contrato
  assert.deepEqual(TT.SEVERITIES.map((s) => [s.key, s.label, s.sound]), [['info', 'Aviso', false], ['warn', 'Severo', false], ['critical', 'Extremo', true]]);
  assert.equal(TT.alertHeader({ level: 'warn', issuer: 'Defesa Civil' }), 'ALERTA SEVERO · DEFESA CIVIL');
  assert.equal(TT.alertHeader({ level: 'critical', issuer: 'Defesa Civil' }), 'ALERTA EXTREMO · DEFESA CIVIL');
  assert.equal(TT.alertHeader({ level: 'info', issuer: 'UBS  Centro' }), 'AVISO · UBS CENTRO');
  assert.equal(TT.alertHeader({ level: 'critical', issuer: 'Defesa Civil', test: true }), 'TESTE DO SISTEMA');
  assert.ok(TT.alertHeader({ level: 'info', issuer: 'x'.repeat(200) }).length <= 60, 'até 60 (contrato §9)');
  // quem emite: a Defesa Civil leva a gravidade; o painel, só com categoria; as outras, só "AVISO · nome" no informativo
  assert.equal(K.headerFor({ level: 'warn', issuer: { kind: 'defesa-civil' } }), 'ALERTA SEVERO · DEFESA CIVIL');
  assert.equal(K.headerFor({ level: 'warn', category: 'saude', issuer: { kind: 'panel' } }), 'ALERTA SEVERO · PREFEITURA');
  assert.equal(K.headerFor({ level: 'warn', issuer: { kind: 'panel' } }), null, 'alerta do painel sem categoria: como antes');
  assert.equal(K.headerFor({ level: 'info', issuer: { kind: 'office', name: 'Escola Norte' } }), 'AVISO · ESCOLA NORTE');
  assert.equal(K.headerFor({ level: 'critical', issuer: { kind: 'office', name: 'Escola Norte' } }), null);
  assert.equal(K.headerFor({ level: 'info', test: true, issuer: { kind: 'office', name: 'Escola' } }), 'TESTE DO SISTEMA');
  // a categoria e o tipo que vêm com o alerta
  assert.deepEqual(K.cleanAlertKind({}), { category: null, kind: null, test: false });
  assert.deepEqual(K.cleanAlertKind({ category: 'teste', kind: 'simulado' }), { category: 'teste', kind: 'simulado', test: true });
  assert.deepEqual(K.cleanAlertKind({ category: 'saude' }), { category: 'saude', kind: null, test: false });
  assert.equal(status(() => K.cleanAlertKind({ category: 'saude', kind: 'vendaval' })), 400); assert.equal(status(() => K.cleanAlertKind({ category: 'x' })), 400);
});

test('texto sugerido dos tipos: só o que a prefeitura trocou fica guardado', () => {
  assert.equal(K.cleanAlertTexts(null), null); assert.equal(K.cleanAlertTexts({}), null);
  const t = TT.ALERT_TYPE.vendaval;
  assert.equal(K.cleanAlertTexts({ vendaval: { title: t.title, text: t.text } }), null, 'igual ao catálogo');
  assert.deepEqual(K.cleanAlertTexts({ vendaval: { title: ' Vento  forte ', text: 'Fique em casa.' }, inventado: { title: 'x', text: 'y' }, outro: { title: 'Livre', text: 'y' } }), { vendaval: { title: 'Vento forte', text: 'Fique em casa.' } });
  assert.equal(status(() => K.cleanAlertTexts({ vendaval: { title: 'V', text: '' } })), 400); assert.equal(status(() => K.cleanAlertTexts(['x'])), 400);
  assert.deepEqual(K.alertTextsOf('lixo'), {}); assert.deepEqual(K.alertTextsOf({ vendaval: { title: 'V' } }), {}, 'guardado fora do formato não derruba');
  assert.deepEqual([TT.alertTypeText('vendaval', { vendaval: { title: 'Outro', text: 'Texto' } }).title, TT.alertTypeText('vendaval', null).title, TT.alertTypeText('nada')], ['Outro', t.title, null]);
});

test('pessoa desaparecida: a autorização é obrigatória, os limites do contrato §8 e o item que vai ao aparelho', () => {
  const now = Date.parse('2026-11-12T15:00:00Z'); const allowed = ['city', 'regions', 'groups', 'office', 'radius'];
  const base = { kind: 'crianca', name: 'Ana Teste', age: 8, since: '2026-11-10', lastSeen: 'Praça de teste', description: 'Blusa amarela', reportNo: 'BO 123/2026', authName: 'Mãe de teste', authRelation: 'familiar', authOk: true, scope: { kind: 'city' } };
  const ok = D.cleanMissing(base, null, { now, allowed });
  assert.deepEqual([ok.kind, ok.name, ok.age, ok.since, ok.contact, ok.show, ok.fullSec, ok.bannerSec, ok.everyMin, ok.until], ['crianca', 'Ana Teste', 8, '2026-11-10', 'Ligue 199 ou 190', 'both', 15, 20, 10, now + 7 * 86400000]);
  for (const [patch, why] of [
    [{ authOk: false }, 'sem a confirmação'], [{ authOk: 'sim' }, 'confirmação que não é verdadeiro'], [{ authOk: undefined }, 'confirmação ausente'], [{ reportNo: '' }, 'sem o registro de ocorrência'], [{ authName: '' }, 'sem quem autorizou'],
    [{ authRelation: 'vizinho' }, 'vínculo inválido'], [{ name: 'A' }, 'nome curto'], [{ kind: 'animal' }, 'tipo inválido'], [{ age: 130 }, 'idade'], [{ age: 3.5 }, 'idade quebrada'], [{ since: '2026-11-20' }, 'data no futuro'], [{ since: '10/11/2026' }, 'data torta'],
    [{ show: 'popup' }, 'como mostrar'], [{ fullSec: 5 }, 'tela cheia curta'], [{ bannerSec: 500 }, 'faixa longa'], [{ everyMin: 1 }, 'ciclo curto'], [{ days: 31 }, 'validade acima de 30 dias'], [{ until: now + 1000 }, 'validade no passado'], [{ scope: { kind: 'regions', regions: [] } }, 'alcance vazio'],
  ]) assert.equal(status(() => D.cleanMissing({ ...base, ...patch }, null, { now, allowed })), 400, why);
  assert.equal(status(() => D.cleanMissing({ ...base, scope: { kind: 'city' } }, null, { now, allowed: ['office'] })), 403, 'alcance fora do que o acesso permite');
  assert.equal(D.cleanMissing({ ...base, days: 30 }, null, { now, allowed }).until, now + 30 * 86400000);
  assert.deepEqual([D.cleanMissing({ ...base, age: '', since: '', contact: '' }, null, { now, allowed }).age, D.cleanMissing({ ...base, age: null }, null, { now, allowed }).since], [null, '2026-11-10']);
  assert.equal(D.cleanMissing({ ...base, name: 'x'.repeat(200), lastSeen: 'y'.repeat(300), description: 'z'.repeat(300), contact: 'c'.repeat(200) }, null, { now, allowed }).name.length, 80);
  // edição: campo ausente fica; a confirmação não pode ser desmarcada; renovar conta a partir de agora
  const row = { id: 5, kind: 'crianca', name: 'Ana Teste', age: 8, since: '2026-11-10', last_seen: 'Praça', description: '', contact: 'Ligue 199 ou 190', show_mode: 'both', full_sec: 15, banner_sec: 20, every_min: 10, scope: 'city', scope_data: '{}', until_at: now + 86400000, report_no: 'BO 1', auth_name: 'Mãe', auth_relation: 'familiar', photo_file: 'desap-00000000-0000-4000-8000-000000000000.jpg', photo_sha: 'ab'.repeat(32), photo_bytes: 1234 };
  const ed = D.cleanMissing({ description: 'Mochila rosa', days: 7 }, row, { now, allowed });
  assert.deepEqual([ed.name, ed.description, ed.reportNo, ed.scope, ed.until], ['Ana Teste', 'Mochila rosa', 'BO 1', { kind: 'city' }, now + 7 * 86400000]);
  assert.equal(status(() => D.cleanMissing({ authOk: false }, row, { now, allowed })), 400);
  // o que vai ao aparelho (contrato §8.1): nada da autorização
  const item = D.missingContract(row, 'https://midia.exemplo.test/graphics/x.jpg');
  assert.deepEqual(Object.keys(item).sort(), ['age', 'bannerSec', 'contact', 'description', 'everyMin', 'fullSec', 'id', 'kind', 'lastSeen', 'name', 'photo', 'show', 'since', 'until']);
  assert.deepEqual(item.photo, { url: 'https://midia.exemplo.test/graphics/x.jpg', sha256: 'ab'.repeat(32), bytes: 1234 });
  assert.ok(!/BO 1|Mãe|familiar|desap-/.test(JSON.stringify(item)), 'registro, quem autorizou e o nome do arquivo ficam no servidor');
  assert.equal(D.missingContract({ ...row, photo_file: null }, null).photo, null, 'sem foto: null (o app desenha a silhueta)');
  // a foto pelo conteúdo, não pela extensão
  assert.equal(D.sniffImage(Buffer.from('GIF89a..........')), null); assert.equal(D.sniffImage(Buffer.from('<html>não sou foto</html>')), null);
  assert.equal(D.sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpg');
  assert.match('desap-00000000-0000-4000-8000-000000000000.jpg', D.PHOTO_RE); assert.doesNotMatch('../desap-x.jpg', D.PHOTO_RE);
  assert.deepEqual([TT.MISSING_LIMITS.active, TT.MISSING_LIMITS.photoSide, TT.MISSING_LIMITS.photoBytes, TT.MISSING_LIMITS.daysMax], [5, 1280, 600 * 1024, 30]);
  // a foto só vai ao aparelho com https, o SHA-256 inteiro e o tamanho que o app aceita (1 a 1.048.576)
  assert.equal(D.missingContract(row, 'http://local.test/graphics/x.jpg').photo, null, 'sem https: silhueta');
  assert.equal(D.missingContract({ ...row, photo_bytes: 0 }, 'https://m.test/x.jpg').photo, null); assert.equal(D.missingContract({ ...row, photo_bytes: 2e6 }, 'https://m.test/x.jpg').photo, null);
  assert.equal(D.missingContract({ ...row, photo_sha: 'abc' }, 'https://m.test/x.jpg').photo, null);
});

test('QR code de contato (contrato §11): só https, tel:+ e sms:+; a repartição, a prefeitura e o caso', () => {
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '+55 (21) 99999-0000' }), 'https://wa.me/5521999990000');
  assert.equal(D.cleanQrData({ kind: 'tel', value: '55 21 3333-0000' }), 'tel:+552133330000'); assert.equal(D.cleanQrData({ kind: 'sms', value: '5521999990000' }), 'sms:+5521999990000');
  assert.equal(D.cleanQrData({ kind: 'url', value: ' https://prefeitura.exemplo.test/form?x=1 ' }), 'https://prefeitura.exemplo.test/form?x=1');
  for (const bad of [{ kind: 'url', value: 'http://x.test' }, { kind: 'url', value: 'javascript:alert(1)' }, { kind: 'url', value: 'data:text/html,x' }, { kind: 'url', value: 'intent://x' }, { kind: 'url', value: 'texto solto' }, { kind: 'url', value: 'https://u:p@x.test/' }, { kind: 'url', value: 'https://localhost' },
    { kind: 'url', value: `https://x.test/${'a'.repeat(300)}` }, { kind: 'url', value: '' }, { kind: 'whatsapp', value: '123' }, { kind: 'whatsapp', value: '55abc21999990000' }, { kind: 'tel', value: '1234567' }, { kind: 'tel', value: '1'.repeat(16) }, { kind: 'fax', value: '552133330000' }, { kind: undefined, value: 'https://x.test' }]) {
    assert.equal(status(() => D.cleanQrData(bad)), 400, JSON.stringify(bad));
  }
  for (const [d, ok] of [['https://wa.me/5521999990000', true], ['tel:+552133330000', true], ['sms:+552133330000', true], ['http://x.test', false], ['tel:552133330000', false], ['javascript:alert(1)', false], ['https://x.test/ com espaço', false], [`https://x.test/${'a'.repeat(300)}`, false], [null, false]]) assert.equal(D.qrDataOk(d), ok, String(d).slice(0, 30));
  // número do Brasil digitado só com o DDD ganha o 55 (sem ele o wa.me abre outro país); com "+" fica como está
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '21999089151' }), 'https://wa.me/5521999089151');
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '(21) 99908-9151' }), 'https://wa.me/5521999089151');
  assert.equal(D.cleanQrData({ kind: 'tel', value: '21 3333-0000' }), 'tel:+552133330000');
  // RS: o DDD 55 não se confunde com o código do país; quem decide é o tamanho (10/11 dígitos = só DDD + número)
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '55 99999-0000' }), 'https://wa.me/5555999990000', 'DDD 55, celular, sem o 55 do país');
  assert.equal(D.cleanQrData({ kind: 'tel', value: '55 3222-0000' }), 'tel:+555532220000', 'DDD 55, fixo, sem o 55 do país');
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '55 55 99999-0000' }), 'https://wa.me/5555999990000', 'DDD 55 já com o 55 do país');
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '+55 55 99999-0000' }), 'https://wa.me/5555999990000');
  assert.equal(D.cleanQrData({ kind: 'whatsapp', value: '+1 212 555 1234' }), 'https://wa.me/12125551234', 'outro país, com +');
  assert.equal(D.qrSettingOf({ kind: 'whatsapp', value: '21999089151', label: 'x' }).data, 'https://wa.me/5521999089151', 'o já guardado sem o 55 se corrige na leitura');
  assert.equal(TT.qrDataOf('whatsapp', '21999089151'), 'https://wa.me/5521999089151', 'a prévia do painel igual ao servidor');
  assert.equal(D.cleanQrSetting(null), null); assert.equal(D.cleanQrSetting({ kind: '', value: '' }), null);
  assert.deepEqual(D.cleanQrSetting({ kind: 'whatsapp', value: '55 21 99999-0000', label: `  ${'x'.repeat(60)}` }), { kind: 'whatsapp', value: '5521999990000', data: 'https://wa.me/5521999990000', label: 'x'.repeat(40) });
  assert.equal(D.cleanQrSetting({ kind: 'tel', value: '552133330000' }).label, 'Aponte a câmera e fale agora');
  assert.equal(D.qrSettingOf({ kind: 'url', value: 'http://x' }), null, 'guardado fora do formato não derruba nem vai ao aparelho');
  // o caso: o padrão, desligado ou outro destino só nele
  assert.deepEqual(D.cleanCaseQr(undefined), { mode: 'default', data: null, label: null }); assert.deepEqual(D.cleanCaseQr({ mode: 'off' }), { mode: 'off', data: null, label: null });
  assert.deepEqual(D.cleanCaseQr({ mode: 'custom', kind: 'tel', value: '552133330000' }), { mode: 'custom', data: 'tel:+552133330000', label: 'Aponte a câmera e fale agora' });
  assert.equal(status(() => D.cleanCaseQr({ mode: 'custom', kind: 'url', value: 'http://x.test' })), 400); assert.equal(status(() => D.cleanCaseQr({ mode: 'sempre' })), 400);
  const office = { data: 'https://wa.me/5521999990000', label: 'Fale com a Defesa Civil' }; const tenant = { data: 'tel:+552133330000', label: 'Ligue agora' };
  assert.deepEqual(D.effectiveQr({ qr_mode: 'default' }, { office, tenant }), office, 'a repartição que cadastrou vence a prefeitura');
  assert.deepEqual(D.effectiveQr({ qr_mode: 'default' }, { tenant }), tenant); assert.equal(D.effectiveQr({ qr_mode: 'default' }, {}), null);
  assert.equal(D.effectiveQr({ qr_mode: 'off' }, { office, tenant }), null);
  assert.deepEqual(D.effectiveQr({ qr_mode: 'custom', qr_data: 'sms:+5521999990000', qr_label: 'Mande um SMS' }, { office }), { data: 'sms:+5521999990000', label: 'Mande um SMS' });
  assert.equal(D.effectiveQr({ qr_mode: 'custom', qr_data: 'javascript:alert(1)', qr_label: 'x' }, { office }), null, 'conteúdo inválido guardado nunca sai');
  // no item do contrato: o campo só existe quando há QR code válido
  const row = { id: 1, kind: 'adulto', name: 'Teste', show_mode: 'both', full_sec: 15, banner_sec: 20, every_min: 10, until_at: 1 };
  assert.deepEqual(D.missingContract(row, null, office).qr, office); assert.ok(!('qr' in D.missingContract(row, null, null))); assert.ok(!('qr' in D.missingContract(row, null, { data: 'http://x', label: 'y' })));
  // a prévia monta o mesmo conteúdo (a validação que vale é a do servidor)
  assert.deepEqual([TT.qrDataOf('whatsapp', '+55 (21) 99999-0000'), TT.qrDataOf('tel', '552133330000'), TT.qrDataOf('url', 'http://x.test'), TT.qrDataOf('whatsapp', '123')], ['https://wa.me/5521999990000', 'tel:+552133330000', null, null]);
});
