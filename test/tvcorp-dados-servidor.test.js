// TV Corporativa, pacote B no servidor (server/tvcorp-dados.js), nos dois bancos, com provedores falsos (nada de rede):
// as rotas do painel (fontes, pessoas, planilha, comunicados com "Li", indicadores, widgets, endereço do celular,
// sugestões), a página do celular (CSP estrita, token só no cabeçalho, freio por minuto), o link da unidade (só a própria
// unidade, aprovação), a integração por chave, o dataFor no formato que o app lê, o isolamento entre clientes e a privacidade
// (aniversário sem ano, foto só com consentimento e apagada ao retirar).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { tmpDir } from './helpers/tmp.js';

const ROOT_DIR = tmpDir('nexa-tvcorp-b');
process.env.DATA_DIR = ROOT_DIR; // config.js (lido por módulos vizinhos) não escreve na pasta do projeto

const express = (await import('express')).default;
const { createTvcorpDados } = await import('../server/tvcorp-dados.js');
const { tvcorpDadosDDL, TVCORP_DADOS_TABLES, TVCORP_DADOS_COPY, TVCORP_DADOS_IDENTITY } = await import('../server/db/schema-tvcorp-dados.js');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const T0 = Date.UTC(2026, 10, 20, 15, 0); // 20/11/2026 12:00 em Brasília (sexta)

async function boot(db, { settings = new Map(), files }) {
  let clock = T0;
  const audits = [];
  const routes = [];
  const fetcher = async (url) => {
    routes.push(url);
    if (/agenciabrasil/.test(url)) return { status: 200, text: () => '<rss><channel><item><title>Inflação cai em outubro</title><link>https://agenciabrasil.ebc.com.br/n1</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Safra recorde</title></item></channel></rss>' };
    if (/awesomeapi/.test(url)) return { status: 200, text: () => JSON.stringify({ USDBRL: { bid: '5.31', ask: '5.32', pctChange: '-0.4', timestamp: '1795600000' } }) };
    if (/planilha\.example/.test(url)) return { status: 200, text: () => 'Mes;Vendas\nNov;"82,5"\n' };
    if (/quebrado\.example/.test(url)) return { status: 500, text: () => '' };
    throw new Error(`rede proibida no teste: ${url}`);
  };
  const parseFeed = (s) => ({ items: [...s.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({ title: /<title>(.*?)<\/title>/.exec(m[1])?.[1] || '', link: /<link>(.*?)<\/link>/.exec(m[1])?.[1] || '', date: Date.parse(/<pubDate>(.*?)<\/pubDate>/.exec(m[1])?.[1] || '') })) });
  const weatherOf = async () => ({ source: 'INMET', place: { city: 'Niterói', uf: 'RJ' }, now: null, today: { min: 19, max: 27, text: 'Muitas nuvens', cond: 'cloudy' }, days: [] });
  const dados = createTvcorpDados({
    db, audit: async (a) => { audits.push(a); }, publicUrl: () => 'https://painel.exemplo.test', fetcher, parseFeed, weatherOf,
    settingsOf: async (t) => settings.get(t) || {}, files: { dir: files, prepare: async () => JPG }, photoUrl: (name) => `https://midia.exemplo.test/${name}`,
    now: () => clock, timers: false, isCorpOffice: (o) => ['matriz', 'filial', 'fabrica'].includes(o.type),
  });
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  // a sessão do painel de mentira: x-tenant = o cliente; x-perm: no = sem a permissão
  const needs = (perm) => (req, res, next) => {
    if (req.get('x-perm') === 'no' || perm !== 'tvcorp.manage') return res.status(403).json({ error: 'Sem permissão.' });
    req.tenantId = Number(req.get('x-tenant')); req.user = { username: `admin${req.tenantId}` };
    res.on('finish', () => { if (res.locals.audit) audits.push({ tenantId: req.tenantId, detail: res.locals.audit }); });
    next();
  };
  // a sessão do link da unidade de mentira: x-office = a unidade, x-role = o papel
  const office = async (req, res, next) => {
    const row = await db.get('SELECT * FROM telas_offices WHERE id = ?', [Number(req.get('x-office'))]);
    if (!row) return res.status(401).json({ error: 'Sessão encerrada.' });
    req.office = row; req.tenantId = Number(row.tenant_id); req.role = req.get('x-role') || 'gestor'; req.by = `repartição: ${row.name}`;
    next();
  };
  const gestorOnly = (req, res, next) => (req.role === 'gestor' ? next() : res.status(403).json({ error: 'Só o gestor.' }));
  const note = async (req, action, detail, status) => { audits.push({ tenantId: req.tenantId, action, detail, status }); };
  const apiKey = (req, res, next) => { const m = /^Bearer chave-(\d+)$/.exec(req.get('authorization') || ''); if (!m) return res.status(401).json({ error: 'Chave inválida.' }); req.tenantId = Number(m[1]); next(); };
  dados.mount(app, { needs, office, gestorOnly, note, apiKey });
  app.use((err, _req, res, _next) => res.status(err.status || (err.type === 'entity.too.large' ? 413 : 500)).json({ error: err.status ? err.message : `erro: ${err.message}` }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (headers) => async (method, url, body, extra = {}) => {
    const isBuf = Buffer.isBuffer(body); const isStr = typeof body === 'string';
    const res = await fetch(`${base}${url}`, { method, headers: { ...headers, ...(body != null ? { 'content-type': isBuf ? 'image/png' : isStr ? 'text/csv' : 'application/json' } : {}), ...extra }, body: body == null ? undefined : isBuf || isStr ? body : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
  return {
    dados, base, audits, routes, call, setClock: (t) => { clock = t; },
    P: (tenant) => call({ 'x-tenant': String(tenant) }), U: (officeId, role = 'gestor') => call({ 'x-office': String(officeId), 'x-role': role }), M: (token, who) => call({ authorization: `Bearer ${token}`, ...(who ? { 'x-tvc-who': encodeURIComponent(who) } : {}) }),
    stop: () => new Promise((r) => { dados.stop(); server.close(r); }),
  };
}

async function roteiro(db, files) {
  await db.exec(tvcorpDadosDDL(db.dialect));
  await db.exec(tvcorpDadosDDL(db.dialect)); // idempotente
  const ins = (sql, a) => db.insert(sql, a);
  const matriz = await ins("INSERT INTO telas_offices(tenant_id,name,type,created_at) VALUES(1,'Matriz','matriz',?)", [T0]);
  const fabrica = await ins("INSERT INTO telas_offices(tenant_id,name,type,created_at) VALUES(1,'Fábrica Sul','fabrica',?)", [T0]);
  const upa = await ins("INSERT INTO telas_offices(tenant_id,name,type,created_at) VALUES(1,'UPA (prefeitura)','upa',?)", [T0]);
  const outra = await ins("INSERT INTO telas_offices(tenant_id,name,type,created_at) VALUES(2,'Matriz do B','matriz',?)", [T0]);
  const grupo = await ins("INSERT INTO telas_groups(tenant_id,name,created_at) VALUES(1,'Refeitórios',?)", [T0]);
  const grupoB = await ins("INSERT INTO telas_groups(tenant_id,name,created_at) VALUES(2,'Do B',?)", [T0]);
  const settings = new Map();
  const s = await boot(db, { settings, files });
  try {
    const A = s.P(1); const B = s.P(2);
    const ok = (r, want = 200) => { assert.equal(r.status, want, JSON.stringify(r.data)); return r.data; };

    /* ---------------------------------------------------------------- permissão */
    assert.equal((await s.call({ 'x-tenant': '1', 'x-perm': 'no' })('GET', '/api/tvcorp/people')).status, 403);

    /* ---------------------------------------------------------------- pessoas e privacidade */
    const ana = ok(await A('POST', '/api/tvcorp/people', { name: 'Ana Souza Lima', birthday: '20/11/1988', sector: 'Financeiro', officeId: matriz, hireDate: '2021-11-22' }), 201);
    assert.deepEqual([ana.display, ana.birthday, ana.hireDate], ['Ana L.', { day: 20, month: 11 }, '2021-11-22']);
    assert.equal((await A('POST', '/api/tvcorp/people', { name: 'X Y', officeId: outra })).status, 404, 'unidade de outro cliente');
    const rows = await db.all('SELECT * FROM tvcorp_people');
    assert.ok(!JSON.stringify(rows).includes('1988'), 'o ano não chega ao banco');
    const imp = ok(await A('POST', '/api/tvcorp/people/import', 'Nome;Aniversário;Setor;Admissão;Unidade\nBruno Costa;21/11/1990;Produção;10/11/2026;Fábrica Sul\nCarla Dias;31/04;RH;;\nAna Souza Lima;20/11;Controladoria;;Matriz\n'));
    assert.deepEqual([imp.added, imp.updated, imp.errorCount], [1, 1, 1]);
    assert.equal((await A('GET', '/api/tvcorp/people')).data.people.find((p) => p.id === ana.id).sector, 'Controladoria', 'a mesma pessoa na mesma unidade foi atualizada');
    const csv = await A('GET', '/api/tvcorp/people/export');
    assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.data, /Ana Souza Lima;Controladoria;20\/11;22\/11\/2021;Matriz;não;sim/);
    assert.ok(!csv.data.includes('1990'));
    const peopleB = (await B('GET', '/api/tvcorp/people')).data;
    assert.equal(peopleB.total, 0, 'o outro cliente não vê ninguém');
    assert.equal((await B('PATCH', `/api/tvcorp/people/${ana.id}`, { sector: 'x' })).status, 404);
    // foto: só com consentimento; retirar o consentimento apaga o arquivo
    assert.equal((await A('PUT', `/api/tvcorp/people/${ana.id}/photo`, PNG)).status, 409);
    ok(await A('PATCH', `/api/tvcorp/people/${ana.id}`, { photoConsent: true }));
    assert.equal((await A('PUT', `/api/tvcorp/people/${ana.id}/photo`, Buffer.from('GIF89a-nao-e-imagem'))).status, 400, 'conferida pelo conteúdo');
    const withPhoto = ok(await A('PUT', `/api/tvcorp/people/${ana.id}/photo`, PNG));
    assert.equal(withPhoto.photo, true);
    const photoFile = (await db.get('SELECT photo FROM tvcorp_people WHERE id = ?', [ana.id])).photo;
    assert.ok(fs.existsSync(path.join(files, photoFile)));
    const bday = await s.dados.dataFor(1, matriz, 'birthdays');
    assert.deepEqual(bday.people.map((p) => [p.name, p.day, p.month]), [['Ana L.', 20, 11]]);
    assert.match(bday.people[0].photo.url, /^https:\/\/midia\.exemplo\.test\/tvcpessoa-/); assert.match(bday.people[0].photo.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!('year' in bday.people[0]));
    const week = await s.dados.dataFor(1, fabrica, { kind: 'birthdays', params: { range: 'week' } });
    assert.deepEqual(week.people.map((p) => p.name), ['Bruno C.'], 'só a unidade (e quem não tem unidade)');
    ok(await A('PATCH', `/api/tvcorp/people/${ana.id}`, { photoConsent: false }));
    assert.ok(!fs.existsSync(path.join(files, photoFile)), 'desmarcar apaga a foto na hora');
    assert.equal((await s.dados.dataFor(1, matriz, 'birthdays')).people[0].photo, undefined);
    settings.set(1, { fullNames: true });
    assert.equal((await s.dados.dataFor(1, matriz, 'birthdays')).people[0].name, 'Ana Souza Lima', 'a empresa escolheu o nome completo');
    settings.set(1, {});
    assert.equal((await s.dados.dataFor(1, fabrica, 'welcome')).fields.text, 'Bruno C. · Produção');
    s.setClock(Date.UTC(2026, 10, 22, 15)); // 22/11: 5 anos de casa da Ana
    assert.equal((await s.dados.dataFor(1, matriz, 'tenure')).fields.text, 'Ana L. · 5 anos de casa');
    s.setClock(T0);

    /* ---------------------------------------------------------------- comunicados, alcance e "Li" */
    const p1 = ok(await A('POST', '/api/tvcorp/posts', { category: 'rh', title: 'Férias coletivas', text: 'De 22/12 a 5/1.', needsAck: true, qr: 'https://empresa.example/ferias', validTo: T0 + 7 * 86400_000 }), 201);
    const p2 = ok(await A('POST', '/api/tvcorp/posts', { category: 'evento', title: 'Almoço especial', scope: { kind: 'groups', ids: [grupo] } }), 201);
    const p3 = ok(await A('POST', '/api/tvcorp/posts', { category: 'seguranca', title: 'Use o EPI', scope: { kind: 'offices', ids: [fabrica] } }), 201);
    assert.equal((await A('POST', '/api/tvcorp/posts', { title: 'Grupo do outro', scope: { kind: 'groups', ids: [grupoB] } })).status, 404, 'grupo de outro cliente');
    assert.equal((await A('POST', '/api/tvcorp/posts', { title: 'Oi', qr: 'javascript:alert(1)' })).status, 400);
    const forMatriz = await s.dados.dataFor(1, matriz, 'post');
    assert.deepEqual(forMatriz.map((p) => p.id), [`p${p1.id}`], 'a matriz sem o grupo e sem a fábrica');
    assert.deepEqual(Object.keys(forMatriz[0]).sort(), ['body', 'category', 'date', 'header', 'id', 'kind', 'needsAck', 'qr', 'template', 'title']);
    assert.deepEqual((await s.dados.dataFor(1, fabrica, 'post', { groupIds: [grupo] })).map((p) => p.id).sort(), [`p${p1.id}`, `p${p2.id}`, `p${p3.id}`].sort());
    assert.equal(await s.dados.dataFor(2, outra, `post:${p1.id}`), null, 'outro cliente');
    // o endereço do celular
    const link = ok(await A('POST', '/api/tvcorp/mobile', { officeId: matriz }), 201);
    assert.match(link.url, /^https:\/\/painel\.exemplo\.test\/tvc\/[A-Za-z0-9_-]{43}$/);
    const tok = link.url.split('/').pop();
    assert.ok(!JSON.stringify(await db.all('SELECT * FROM tvcorp_mobile')).includes(tok), 'só o SHA-256 no banco');
    assert.ok(!JSON.stringify((await A('GET', '/api/tvcorp/mobile')).data).includes(tok), 'aparece uma vez');
    const page = await fetch(`${s.base}/tvc/${tok}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'; style-src 'self'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.match(page.headers.get('x-robots-tag'), /noindex/);
    const html = await page.text();
    assert.ok(!/<script>|<script(?![^>]*src=)|style="|\son[a-z]+=/i.test(html), 'sem script nem estilo inline');
    for (const f of ['tvc.js', 'tvc.css']) assert.equal((await fetch(`${s.base}/tvc/${f}`)).status, 200);
    const js = fs.readFileSync(new URL('../public/tvc/tvc.js', import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\.style\.|setAttribute\('style'|eval\(/.test(js), 'sem HTML em texto nem estilo pelo script');
    assert.ok(!/\/api\/tvc[^'`]*\$\{token\}|\?token=/.test(js), 'o token nunca vai no endereço da API');
    const Mb = s.M(tok); const Mana = s.M(tok, 'Ana Souza');
    assert.equal((await s.call({})('GET', '/api/tvc')).status, 401);
    assert.equal((await s.call({})('GET', `/api/tvc?token=${tok}`)).status, 401, 'o token no endereço não vale');
    const st = ok(await Mb('GET', '/api/tvc'));
    assert.deepEqual([st.office, st.posts.map((p) => p.id), st.birthdays.map((b) => [b.name, b.today])], ['Matriz', [p1.id], [['Ana L.', true]]]);
    assert.ok(st.dates.some((d) => d.date === '2026-11-20') && st.campaigns.includes('Novembro Azul (saúde do homem)'));
    assert.equal((await Mb('POST', `/api/tvc/ack/${p1.id}`, {})).status, 400, 'o nome é obrigatório');
    assert.equal((await Mb('POST', `/api/tvc/ack/${p3.id}`, { who: 'Ana' })).status, 404, 'comunicado de outra unidade');
    const li = ok(await Mb('POST', `/api/tvc/ack/${p1.id}`, { who: 'Ana  Souza' }));
    assert.equal(ok(await Mb('POST', `/api/tvc/ack/${p1.id}`, { who: 'ana souza' })).ackedAt, li.ackedAt, 'ler de novo não muda a hora');
    assert.equal((await Mana('GET', '/api/tvc')).data.posts[0].ackedAt, li.ackedAt);
    const acks = ok(await A('GET', `/api/tvcorp/posts/${p1.id}/acks`));
    assert.deepEqual([acks.total, acks.acks[0].who], [1, 'Ana Souza']);
    assert.equal((await B('GET', `/api/tvcorp/posts/${p1.id}/acks`)).status, 404);
    // sugestão anônima com imagem; o IP não é guardado
    const sug = ok(await Mb('POST', '/api/tvc/suggest', { kind: 'conteudo', text: 'Foto da equipe na SIPAT', who: 'Ana' }), 201);
    ok(await Mb('PUT', `/api/tvc/suggest/${sug.id}/image`, PNG));
    assert.equal((await Mb('PUT', `/api/tvc/suggest/${sug.id}/image`, PNG)).status, 404, 'uma imagem só');
    const sRow = await db.get('SELECT * FROM tvcorp_suggestions WHERE id = ?', [sug.id]);
    assert.deepEqual([sRow.who, sRow.office_id, /^tvcsug-/.test(sRow.media_file)], ['', matriz, true]);
    assert.ok(!Object.values(sRow).some((v) => String(v).includes('127.0.0.1')));
    assert.equal(s.audits.find((a) => a.action === 'POST /api/tvc/suggest').ip, null);
    const box = ok(await A('GET', '/api/tvcorp/suggestions'));
    assert.deepEqual(box.suggestions.map((x) => [x.kind, x.anonymous, x.image]), [['conteudo', true, true]]);
    assert.equal((await A('GET', `/api/tvcorp/suggestions/${sug.id}/file`)).status, 200);
    assert.equal((await B('GET', `/api/tvcorp/suggestions/${sug.id}/file`)).status, 404);
    assert.deepEqual(ok(await A('GET', '/api/tvcorp/dados/pending')), { posts: 0, suggestions: 1 });
    const dec = ok(await A('POST', `/api/tvcorp/suggestions/${sug.id}/decide`, { approve: true, post: { title: 'Fotos da SIPAT', category: 'evento' } }));
    assert.deepEqual([dec.suggestion.status, dec.post.title, dec.post.text, dec.post.officeId], ['ok', 'Fotos da SIPAT', 'Foto da equipe na SIPAT', matriz]);
    // endereço desligado
    ok(await A('DELETE', `/api/tvcorp/mobile/${link.id}`));
    assert.equal((await Mb('GET', '/api/tvc')).status, 401);

    /* ---------------------------------------------------------------- link da unidade (F11) e aprovação */
    const U = s.U(fabrica);
    assert.equal((await s.U(upa)('GET', '/api/reparticao/tvcorp')).status, 403, 'repartição da prefeitura não tem a aba');
    assert.equal((await s.U(fabrica, 'atendente')('GET', '/api/reparticao/tvcorp')).status, 403, 'só o gestor');
    const ov = ok(await U('GET', '/api/reparticao/tvcorp'));
    assert.deepEqual([ov.people.map((p) => p.name), ov.posts.length], [['Bruno Costa'], 0], 'a unidade só vê o que é dela');
    settings.set(1, { approval: true });
    const up = await U('POST', '/api/reparticao/tvcorp/posts', { title: 'Treinamento de empilhadeira', category: 'seguranca', scope: { kind: 'all' } });
    assert.equal(up.status, 202, 'com a aprovação ligada, vai para a fila');
    assert.equal(await s.dados.dataFor(1, fabrica, `post:${up.data.id}`), null, 'pendente não vai à tela');
    assert.deepEqual(ok(await A('GET', '/api/tvcorp/dados/pending')), { posts: 1, suggestions: 0 });
    assert.equal((await A('POST', `/api/tvcorp/posts/${up.data.id}/decide`, { approve: false })).status, 400, 'devolver pede o motivo');
    ok(await A('POST', `/api/tvcorp/posts/${up.data.id}/decide`, { approve: true }));
    assert.equal((await s.dados.dataFor(1, fabrica, `post:${up.data.id}`)).title, 'Treinamento de empilhadeira');
    assert.equal(await s.dados.dataFor(1, matriz, `post:${up.data.id}`), null, 'o comunicado da unidade não sai na matriz');
    assert.equal((await U('DELETE', `/api/reparticao/tvcorp/posts/${p1.id}`)).status, 404, 'não mexe no da empresa');
    assert.equal((await s.U(outra)('DELETE', `/api/reparticao/tvcorp/posts/${up.data.id}`)).status, 404, 'outro cliente');
    assert.equal((await U('PATCH', `/api/reparticao/tvcorp/people/${ana.id}`, { sector: 'x' })).status, 404, 'pessoa de outra unidade');
    const pu = ok(await U('POST', '/api/reparticao/tvcorp/people', { name: 'Davi Reis', birthday: '01/12', photoConsent: true, officeId: matriz }), 201);
    assert.deepEqual([pu.officeId, pu.photoConsent], [fabrica, false], 'a unidade só cadastra na própria e sem foto');
    const iu = ok(await U('POST', '/api/reparticao/tvcorp/people/import', { csv: 'Nome;Aniversário;Unidade\nEva Lima;02/12;Matriz\n' }));
    assert.equal(iu.added, 1);
    assert.equal((await db.get("SELECT office_id FROM tvcorp_people WHERE name = 'Eva Lima'")).office_id, fabrica, 'a planilha da unidade fica na unidade');
    settings.set(1, {});

    /* ---------------------------------------------------------------- fontes, indicadores e widgets no formato do app */
    const fn = ok(await A('POST', '/api/tvcorp/feeds', { kind: 'rss', config: { source: 'agencia-brasil' } }), 201);
    const fq = ok(await A('POST', '/api/tvcorp/feeds', { kind: 'quotes', config: { currencies: ['USD'] } }), 201);
    const fw = ok(await A('POST', '/api/tvcorp/feeds', { kind: 'weather', config: { ibge: 3303302, city: 'Niterói', uf: 'RJ', offices: [matriz] } }), 201);
    assert.equal((await A('POST', '/api/tvcorp/feeds', { kind: 'rss', config: { source: 'own', url: 'https://quebrado.example/rss' } })).status, 201);
    assert.equal((await A('POST', '/api/tvcorp/feeds', { kind: 'weather', config: { ibge: 3303302, offices: [outra] } })).status, 404);
    await s.dados.tick();
    const feeds = ok(await A('GET', '/api/tvcorp/feeds')).feeds;
    assert.deepEqual(feeds.map((f) => [f.kind, Boolean(f.fetchedAt), Boolean(f.lastError)]).sort(), [['quotes', true, false], ['rss', false, true], ['rss', true, false], ['weather', true, false]]);
    assert.ok(s.routes.every((u) => u.startsWith('https://')));
    // DIGITAL ISP: uma notícia por item (a foto em tela cheia e a faixa); mode 'lista' mantém a lista de manchetes
    const um = await s.dados.dataFor(1, matriz, `news:${fn.id}`);
    assert.ok(Array.isArray(um) && um.length >= 2);
    assert.deepEqual([um[0].id, um[0].single, um[0].items.length, um[0].items[0].title, um[1].id], [`n${fn.id}-1`, true, 1, 'Inflação cai em outubro', `n${fn.id}-2`]);
    const news = await s.dados.dataFor(1, matriz, { kind: 'news', id: fn.id, params: { mode: 'lista' } });
    assert.deepEqual([news.kind, news.source, news.items[0].title, news.items[0].source, news.items[0].qr, news.items[1].qr], ['news', 'Agência Brasil (EBC) · licença CC BY', 'Inflação cai em outubro', 'Agência Brasil (EBC) · licença CC BY', 'https://agenciabrasil.ebc.com.br/n1', undefined]);
    const q = await s.dados.dataFor(1, matriz, { ref_kind: 'quotes', ref_id: fq.id });
    assert.deepEqual(q.items, [{ label: 'USD', name: 'Dólar americano', value: 5.32, change: -0.4, prefix: 'R$ ', decimals: 2, at: 1795600000000 }]);
    assert.equal((await s.dados.dataFor(1, matriz, 'weather')).tempC, 27);
    assert.equal(await s.dados.dataFor(1, fabrica, 'weather'), null, 'a fonte do clima é da matriz');
    const t1 = (await db.get('SELECT fetched_at FROM tvcorp_feeds WHERE id = ?', [fn.id])).fetched_at;
    s.setClock(T0 + 10 * 60_000); await s.dados.tick();
    assert.equal((await db.get('SELECT fetched_at FROM tvcorp_feeds WHERE id = ?', [fn.id])).fetched_at, t1, 'segura o mesmo dado por pelo menos 15 min');
    s.setClock(T0 + 7 * 3600_000);
    assert.equal(await s.dados.dataFor(1, matriz, `news:${fn.id}`), null, 'mais de 6 h sem busca boa: sai da tela');
    s.setClock(T0);
    assert.equal(await s.dados.dataFor(2, outra, `news:${fn.id}`), null, 'outro cliente');
    const test1 = ok(await A('POST', `/api/tvcorp/feeds/${fn.id}/test`, {}));
    assert.equal(test1.ok, true);
    // indicador por planilha, manual e pela integração
    const k1 = ok(await A('POST', '/api/tvcorp/kpis', { name: 'Vendas do mês', unit: '%', target: 100, source: 'csv', sourceCfg: { url: 'https://planilha.example/pub.csv', cell: 'B2' } }), 201);
    await s.dados.tick();
    const kpi = await s.dados.dataFor(1, matriz, `kpi:${k1.id}`);
    assert.deepEqual([kpi.kind, kpi.name, kpi.value, kpi.target, kpi.unit, kpi.band, kpi.direction], ['kpi', 'Vendas do mês', 82.5, 100, '%', 'warn', 'up']);
    const k2 = ok(await A('POST', '/api/tvcorp/kpis', { name: 'Acidentes no ano', target: 2, direction: 'down', source: 'api', officeId: fabrica }), 201);
    assert.equal((await s.call({ authorization: 'Bearer chave-2' })('POST', `/api/tvcorp-api/kpis/${k2.id}/value`, { value: 1 })).status, 404, 'a chave de outro cliente');
    ok(await s.call({ authorization: 'Bearer chave-1' })('POST', `/api/tvcorp-api/kpis/${k2.id}/value`, { value: '1' }));
    assert.equal((await s.dados.dataFor(1, fabrica, `kpi:${k2.id}`)).band, 'ok');
    assert.equal(await s.dados.dataFor(1, matriz, `kpi:${k2.id}`), null, 'o indicador da fábrica não vai à matriz');
    assert.equal((await s.call({ authorization: 'Bearer chave-1' })('POST', `/api/tvcorp-api/kpis/${k1.id}/value`, { value: 3 })).status, 409, 'o de planilha não aceita valor pela API');
    const ap = ok(await s.call({ authorization: 'Bearer chave-1' })('POST', '/api/tvcorp-api/posts', { title: 'Meta batida!', category: 'reconhecimento' }), 201);
    assert.equal(ap.via, 'api');
    assert.equal((await s.call({})('POST', '/api/tvcorp-api/posts', { title: 'x' })).status, 401);
    // widgets
    const wc = ok(await A('POST', '/api/tvcorp/widgets', { kind: 'countdown', data: { title: 'SIPAT', at: T0 + 3 * 86400_000 } }), 201);
    const ws = ok(await A('POST', '/api/tvcorp/widgets', { kind: 'safety', data: { lastAccident: '2026-10-21', record: 15 } }), 201);
    const ww = ok(await A('POST', '/api/tvcorp/widgets', { kind: 'worldclock', data: { zones: ['America/Sao_Paulo', 'Europe/Lisbon'] } }), 201);
    ok(await A('POST', '/api/tvcorp/widgets', { kind: 'menu', data: { title: 'Refeitório', days: { 5: ['Peixe grelhado', { name: 'Salada', price: '12,50' }] }, showPrice: true } }), 201);
    assert.deepEqual(await s.dados.dataFor(1, matriz, `widget:${wc.id}`), { id: `w${wc.id}`, kind: 'countdown', title: 'SIPAT', target: T0 + 3 * 86400_000, text: '' });
    assert.deepEqual(await s.dados.dataFor(1, matriz, `widget:${ws.id}`), { id: `w${ws.id}`, kind: 'safety', title: 'Dias sem acidente', days: 30, record: 30, goal: null, since: '2026-10-21' });
    assert.deepEqual((await s.dados.dataFor(1, matriz, `widget:${ww.id}`)).clocks, [{ tz: 'America/Sao_Paulo', label: 'Brasília' }, { tz: 'Europe/Lisbon', label: 'Lisboa' }]);
    const menu = await s.dados.dataFor(1, matriz, 'menu');
    assert.deepEqual([menu.kind, menu.day, menu.items], ['menu', '2026-11-20', [{ name: 'Peixe grelhado' }, { name: 'Salada', price: 12.5 }]]);
    assert.equal(await s.dados.dataFor(2, outra, `widget:${wc.id}`), null);
    assert.equal((await s.dados.dataFor(1, matriz, 'dates')).fields.title, 'Dia Nacional de Zumbi e da Consciência Negra');
    assert.equal(await s.dados.dataFor(1, matriz, 'inventado'), null);

    /* ---------------------------------------------------------------- auditoria, limpeza e saída da unidade */
    const audit = JSON.stringify(s.audits);
    assert.ok(!audit.includes(tok), 'o token não vai à auditoria');
    assert.ok(!audit.includes('Ana Souza Lima'), 'o nome da pessoa não vai à auditoria');
    for (const want of [/comunicado \\"Férias coletivas\\" \(Recursos Humanos\) publicado/, /endereço do celular \\"Matriz\\" gerado/, /enviado para aprovação na unidade/]) assert.match(audit, want);
    s.setClock(T0 + 200 * 86400_000);
    await s.dados.prune();
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM tvcorp_suggestions')).n), 0, 'sugestões saem em 180 dias');
    assert.ok(!fs.readdirSync(files).some((n) => n.startsWith('tvcsug-')), 'com o arquivo');
    await db.tx((x) => s.dados.dropOffice(x, 1, fabrica));
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM tvcorp_people WHERE office_id = ?', [fabrica])).n), 0);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM tvcorp_kpis WHERE office_id = ?', [fabrica])).n), 0);
    for (const t of TVCORP_DADOS_TABLES) assert.ok(TVCORP_DADOS_COPY.includes(t), `${t} na cópia`);
    for (const t of TVCORP_DADOS_IDENTITY) assert.ok(TVCORP_DADOS_TABLES.includes(t));
  } finally { await s.stop(); }
}

/** O freio por minuto do celular (instância à parte: o relógio do freio não anda). */
async function freio(db, files) {
  const s = await boot(db, { files });
  try {
    const link = (await s.P(1)('POST', '/api/tvcorp/mobile', {})).data;
    const Mb = s.M(link.url.split('/').pop());
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await Mb('POST', '/api/tvc/suggest', { text: `Sugestão número ${i}` })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
    assert.deepEqual(codes.slice(10), [429, 429], '10 escritas por minuto por IP');
    const reads = [];
    for (let i = 0; i < 61; i++) reads.push((await Mb('GET', '/api/tvc')).status);
    assert.equal(reads.filter((c) => c === 200).length, 60); assert.equal(reads.at(-1), 429, '60 leituras por minuto por IP');
  } finally { await s.stop(); }
}

test('SQLite: fontes, RH, indicadores, widgets, celular, unidade e integração', { timeout: 300000 }, async (t) => {
  const { createSqlite } = await import('../server/db/sqlite.js');
  const dir = tmpDir('nexa-tvcorp-b-sql', t);
  const db = createSqlite(path.join(dir, 'b.db'));
  db.dialect = 'sqlite';
  await roteiro(db, path.join(dir, 'arquivos'));
  await freio(db, path.join(dir, 'arquivos'));
});

test('Postgres: o mesmo roteiro (as tabelas nascem no banco, em UTF-8)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let db = null;
  try {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: pgs.url });
    await c.connect();
    await c.query("CREATE DATABASE tvcorpb ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'");
    await c.end();
    const u = new URL(pgs.url); u.pathname = '/tvcorpb';
    db = await createPg(u.toString(), { max: 3 });
    db.dialect = 'pg';
    const dir = tmpDir('nexa-tvcorp-b-pg', t);
    await roteiro(db, path.join(dir, 'arquivos'));
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('tvcorp_people', 'tvcorp_posts', 'tvcorp_mobile')");
    const type = (tb, col) => cols.find((x) => x.table_name === tb && x.column_name === col)?.data_type;
    assert.deepEqual([type('tvcorp_people', 'bday_day'), type('tvcorp_posts', 'created_at'), type('tvcorp_mobile', 'token_hash')], ['integer', 'bigint', 'text']);
    assert.equal(type('tvcorp_people', 'bday_year'), undefined, 'não existe coluna de ano');
  } finally {
    if (db) await db.close().catch(() => {});
    await pgs.stop().catch(() => {});
  }
});
