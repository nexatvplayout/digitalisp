// TV Corporativa integrada ao servidor inteiro (docs/TV-CORPORATIVA.md §8, "Coordenador: integração"), no SQLite e no
// Postgres: a funcionalidade tvcorp ligada pelo perfil do Superadmin, a permissão tvcorp.manage, a rede de telas também em
// /api/tvcorp/rede/* (sem o município), unidade corporativa, mídia (slide e imagem), pessoa com aniversário hoje, playlist,
// layout, grade, TV box ativada pela chave, a chave `signage` no /config, o `plays` do sinal de vida no relatório de
// exibição, o celular do funcionário (/tvc/<token>), o link da unidade (rep-tvcorp.js), a exclusão da unidade (as playlists
// dela saem), a tela da prefeitura sem `signage` e o cliente sem a funcionalidade com 403 feature_unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function png(dir) {
  const out = path.join(dir, 'campanha.png');
  const r = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=800x600', '-frames:v', '1', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(out);
}

async function roteiro(env, label) {
  const work = tmpDir(`nexa-tvci-${label}`);
  const s = await boot({ PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://tv.exemplo.test', ...env });
  try {
    const anon = api(s.base);
    const dev = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));
    const ok = async (T, method, url, body, want = 200, headers) => { const r = await T(method, url, body, headers); assert.equal(r.status, want, `${label} ${method} ${url}: ${JSON.stringify(r.data)}`); return r.data; };

    /* ---------------------------------------------------------------- a funcionalidade, só ligada de propósito */
    const prof = await ok(P, 'POST', '/api/platform/feature-profiles', { name: 'Empresa', code: 'tvcorp-e', features: { tvcorp: true, prefeitura: true, api: true } }, 201);
    assert.equal(prof.features.tvcorp, true);
    await ok(P, 'POST', '/api/platform/plans', { code: 'p-tvc', name: 'TV Corporativa', priceCents: 0, profileId: prof.id, limits: { channels: 1 } }, 201);
    const sem = await ok(P, 'POST', '/api/platform/feature-profiles', { name: 'Só prefeitura', code: 'so-pref', features: { prefeitura: true } }, 201);
    await ok(P, 'POST', '/api/platform/plans', { code: 'p-sopref', name: 'Só prefeitura', priceCents: 0, profileId: sem.id, limits: { channels: 1 } }, 201);
    const A = await newTenant(P, s.base, { slug: 'emp-a', planCode: 'p-tvc', status: 'active' });
    const C = await newTenant(P, s.base, { slug: 'emp-c', planCode: 'p-sopref', status: 'active' });
    await ok(A.api, 'POST', '/api/channels', { name: 'TV Empresa A', slug: 'emp-a-tv' }, 201);
    const me = await ok(A.api, 'GET', '/api/me');
    assert.equal(me.planFeatures.tvcorp, true);
    assert.ok(me.permissions.includes('tvcorp.manage'), 'Administradores recebem tvcorp.manage');
    for (const url of ['/api/tvcorp', '/api/tvcorp/rede', '/api/tvcorp/summary']) {
      const r = await C.api('GET', url);
      assert.equal(r.status, 403, `${label} ${url} sem a funcionalidade: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.code, 'feature_unavailable');
    }
    assert.equal((await anon('GET', '/api/tvcorp')).status, 401, 'sem sessão');

    /* ---------------------------------------------------------------- a rede pela TV Corporativa */
    const matriz = await ok(A.api, 'POST', '/api/tvcorp/rede/offices', { name: 'Matriz São Paulo', type: 'matriz' }, 201);
    const filial = await ok(A.api, 'POST', '/api/tvcorp/rede/offices', { name: 'Filial Campinas', type: 'filial' }, 201);
    const ubs = await ok(A.api, 'POST', '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs' }, 201);
    assert.equal((await A.api('GET', '/api/tvcorp/rede/municipio')).status, 404, 'o município é só do Painel da Prefeitura');
    const main = await ok(A.api, 'GET', '/api/tvcorp');
    assert.deepEqual(main.offices.map((o) => o.name).sort(), ['Filial Campinas', 'Matriz São Paulo'], 'só as unidades corporativas');
    const rede = await ok(A.api, 'GET', '/api/tvcorp/rede');
    assert.equal(rede.offices.length, 3);

    /* ---------------------------------------------------------------- conteúdo */
    const slide = await ok(A.api, 'POST', '/api/tvcorp/media', { template: 'comunicado', fields: { title: 'Bem-vindos', text: 'Reunião geral às 10h', art: 'ondas', variant: 'light' }, seconds: 12 }, 201);
    assert.equal(slide.fields.art, 'ondas', 'a arte de fundo fica no slide');
    const img = await ok(A.api, 'POST', '/api/tvcorp/media/image?title=Campanha', png(work), 201, { 'content-type': 'image/png' });
    const [y, m, d] = today().split('-').map(Number);
    await ok(A.api, 'POST', '/api/tvcorp/people', { name: 'Ana Souza Lima', sector: 'Financeiro', officeId: matriz.id, birthday: { day: d, month: m } }, 201);
    const pl = await ok(A.api, 'POST', '/api/tvcorp/playlists', { name: 'Recepção' }, 201);
    await ok(A.api, 'PUT', `/api/tvcorp/playlists/${pl.id}/items`, { items: [{ refKind: 'media', refId: slide.id, seconds: 12 }, { refKind: 'media', refId: img.id, seconds: 10 }, { refKind: 'birthdays', params: { range: 'day' } }] });
    const lay = await ok(A.api, 'POST', '/api/tvcorp/layouts', { factoryKey: 'video-lateral' }, 201);
    const sch = await ok(A.api, 'POST', '/api/tvcorp/schedules', { name: 'Todo dia', layoutId: lay.id, zonePlaylists: { right: pl.id }, scope: { kind: 'all' } }, 201);
    assert.equal(sch.status, 'ok');
    // uma playlist da filial: sai junto com a unidade
    const plF = await ok(A.api, 'POST', '/api/tvcorp/playlists', { name: 'Só da filial', officeId: filial.id }, 201);

    /* ---------------------------------------------------------------- a TV box */
    const key = await ok(A.api, 'POST', '/api/tvcorp/rede/keys', { officeId: matriz.id, name: 'Recepção' }, 201);
    const act = await ok(anon, 'POST', '/api/telas/activate', { key: key.key, device: { model: 'B13', android: '11', appVersion: '1.3.0' } });
    const tv = dev(act.token);
    const cfg = await ok(tv, 'GET', '/api/telas/config');
    assert.ok(cfg.signage, `${label}: a tela da unidade corporativa recebe signage`);
    assert.equal(cfg.signage.tz, 'America/Sao_Paulo');
    const block = cfg.signage.blocks.find((b) => b.id === `s${sch.id}`);
    assert.ok(block, JSON.stringify(cfg.signage));
    assert.deepEqual(block.layout.zones.map((z) => [z.id, z.kind]), [['main', 'video'], ['right', 'playlist']]);
    const items = block.zones.right;
    const it = (id) => items.find((x) => x.id === id);
    assert.equal(it(`m${slide.id}`).kind, 'slide'); assert.equal(it(`m${slide.id}`).fields.title, 'Bem-vindos');
    assert.match(it(`m${img.id}`).url, /^https:\/\/tv\.exemplo\.test\/.+tvcmedia-[0-9a-f-]{36}\.jpg$/);
    assert.match(it(`m${img.id}`).sha256, /^[0-9a-f]{64}$/); assert.ok(it(`m${img.id}`).bytes > 0);
    const bday = items.find((x) => x.kind === 'birthdays');
    assert.ok(bday, `${label}: aniversariantes do dia (${y})`);
    assert.deepEqual(bday.people.map((p) => [p.name, p.day, p.month]), [['Ana L.', d, m]], 'nome curto e sem ano');
    assert.ok(!JSON.stringify(cfg.signage).includes(String(y - 30)), 'nada de ano de nascimento');
    // o mesmo rev enquanto nada muda (ETag)
    const again = await tv('GET', '/api/telas/config', undefined, { 'if-none-match': `"${cfg.rev}"` });
    assert.equal(again.status, 304);

    /* ---------------------------------------------------------------- o plays no sinal de vida e o relatório */
    await ok(tv, 'POST', '/api/telas/heartbeat', { state: 'playing', rev: cfg.rev, appVersion: '1.3.0' });
    await ok(tv, 'POST', '/api/telas/heartbeat', { state: 'playing', rev: cfg.rev, appVersion: '1.3.0', playsDay: today(), plays: [{ ref: `m${slide.id}`, n: 3, sec: 36 }, { ref: 'm999999', n: 5, sec: 50 }] });
    const rep = await ok(A.api, 'GET', `/api/tvcorp/reports/plays?from=${today()}&to=${today()}&by=item`);
    const row = rep.rows.find((r) => r.ref === `m${slide.id}`);
    assert.ok(row, JSON.stringify(rep));
    assert.deepEqual([row.plays, row.seconds, row.name], [3, 36, 'Bem-vindos']);
    assert.ok(!rep.rows.some((r) => r.ref === 'm999999'), 'o que a tela não recebeu é ignorado');
    const hours = await ok(A.api, 'GET', `/api/tvcorp/reports/hours?from=${today()}&to=${today()}`);
    assert.equal(hours.rows.length, 1, 'as horas em exibição da tela');
    const now = await ok(A.api, 'GET', `/api/tvcorp/devices/${act.deviceId}/now`);
    assert.equal(now.block.id, sch.id); assert.equal(now.lastPlays.items[0].name, 'Bem-vindos');
    const sum = await ok(A.api, 'GET', '/api/tvcorp/summary');
    assert.equal(sum.devices.total, 1); assert.equal(sum.devices.on, 1);
    const badge = await ok(A.api, 'GET', '/api/tvcorp/badge');
    assert.deepEqual([badge.off, badge.pending], [0, 0]);
    // o comando pela rede e o histórico
    await ok(A.api, 'POST', `/api/tvcorp/rede/devices/${act.deviceId}/commands`, { type: 'reload' }, 201);
    const cmds = await ok(A.api, 'GET', `/api/tvcorp/commands?deviceId=${act.deviceId}`);
    assert.equal(cmds.commands[0].type, 'reload');

    /* ---------------------------------------------------------------- a tela da prefeitura: sem signage */
    const kU = await ok(A.api, 'POST', '/api/prefeitura/keys', { officeId: ubs.id }, 201);
    const aU = await ok(anon, 'POST', '/api/telas/activate', { key: kU.key, device: { model: 'B13' } });
    const cU = await ok(dev(aU.token), 'GET', '/api/telas/config');
    assert.equal(cU.signage, undefined, 'a tela da UBS não recebe a chave signage');

    /* ---------------------------------------------------------------- o celular do funcionário */
    const mob = await ok(A.api, 'POST', '/api/tvcorp/mobile', { name: 'Empresa toda' }, 201);
    const tok = mob.url.split('/tvc/')[1];
    assert.match(mob.url, /^https:\/\/tv\.exemplo\.test\/tvc\/[A-Za-z0-9_-]{32,64}$/);
    const page = await anon('GET', `/tvc/${tok}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const st = await ok(dev(tok), 'GET', '/api/tvc');
    assert.equal(st.birthdays.length, 1);
    await ok(anon, 'GET', '/reparticao/rep-tvcorp.js');

    /* ---------------------------------------------------------------- excluir a unidade: as playlists dela saem */
    await ok(A.api, 'DELETE', `/api/tvcorp/rede/offices/${filial.id}`);
    assert.equal((await A.api('GET', `/api/tvcorp/playlists/${plF.id}`)).status, 404);
    assert.equal((await A.api('GET', `/api/tvcorp/playlists/${pl.id}`)).status, 200);
  } finally {
    await s.stop();
    cleanup(s.dataDir);
  }
}

test('TV Corporativa integrada: SQLite', { timeout: 300_000 }, async () => {
  await roteiro({}, 'sqlite');
});

test('TV Corporativa integrada: Postgres (UTF8)', { timeout: 300_000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  try {
    const { default: pgLib } = await import('pg');
    const admin = new pgLib.Client({ connectionString: pgs.url });
    await admin.connect();
    await admin.query("CREATE DATABASE tvci ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await admin.end();
    await roteiro({ DATABASE_URL: pgs.url.replace(/\/nexa$/, '/tvci') }, 'pg');
  } finally {
    await pgs.stop();
  }
});
