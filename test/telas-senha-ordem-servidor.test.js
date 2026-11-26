// NEXA Telas, chamada de senha no servidor de verdade: a ordem de chamada com o motivo na lista "Esperando" (Atendimento,
// Recepção e guichê), os tempos-alvo da configuração (a antiga = os padrões), o "Chamar esta" (fora da ordem, no log da
// repartição) pelo gestor, pelo atendente e pelo endereço do guichê, e a troca da prioridade de quem espera
// (POST <base>/tickets/:tid/priority), com as permissões de cada papel. O tipo de problema da Triagem não vai ao servidor:
// a rota de risco só aceita a cor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { canal, usuario, auditoria } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test' };

test('senha: ordem com motivo, tempos-alvo, "Chamar esta" e mudar a prioridade (gestor, atendente, guichê, painel)', { timeout: 240000 }, async () => {
  const s = await boot(ENV);
  try {
    const anon = api(s.base);
    const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));
    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
    assert.equal(prof.status, 201, JSON.stringify(prof.data));
    assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
    const A = await newTenant(P, s.base, { slug: 'ord-a', planCode: 'p-pref', status: 'active' });
    const B = await newTenant(P, s.base, { slug: 'ord-b', planCode: 'p-pref', status: 'active' });
    await canal(A.api, 'TV A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
    const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    const hosp = await post(A, '/api/prefeitura/offices', { name: 'Hospital Municipal', type: 'hospital' });
    const users = `/api/prefeitura/offices/${hosp.id}/users`;
    await post(A, users, { username: 'gestora', name: 'Gestora', role: 'gestor', password: 'senha-da-gestora-26' });
    await post(A, users, { username: 'recepcao', name: 'Recepção', role: 'atendente', password: 'senha-da-recepcao-26' });
    const link = (await post(A, `/api/prefeitura/offices/${hosp.id}/link`, {})).url.split('/').pop();
    const enter = async (username, password) => { const r = await anon('POST', '/api/reparticao/login', { token: link, username, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return bearer(r.data.session); };
    const G = await enter('gestora', 'senha-da-gestora-26');
    const J = await enter('recepcao', 'senha-da-recepcao-26');
    const Q = '/api/reparticao/queue';

    /* ---------------------------------------------------------------- configuração: a antiga = padrões; tempos-alvo */
    let ov = (await G('GET', Q)).data;
    assert.deepEqual([ov.config.risk, ov.config.targets, ov.config.ageBoost, ov.config.escalate], [true, { vermelho: 0, laranja: 10, amarelo: 60, verde: 120, azul: 240 }, true, true], 'hospital: risco ligado e os tempos do protocolo');
    assert.equal((await G('PUT', `${Q}/config`, { targets: { laranja: 15, amarelo: 10 } })).status, 400, 'amarelo menor que laranja');
    assert.equal((await G('PUT', `${Q}/config`, { targets: { amarelo: 0 } })).status, 400);
    assert.equal((await J('PUT', `${Q}/config`, { targets: { amarelo: 45 } })).status, 403, 'a configuração é do gestor');
    const put = await G('PUT', `${Q}/config`, { targets: { amarelo: 45 }, ageBoost: true, escalate: true });
    assert.equal(put.status, 200, JSON.stringify(put.data)); assert.equal(put.data.config.targets.amarelo, 45); assert.equal(put.data.config.targets.verde, 120);
    assert.equal((await G('PUT', `${Q}/config`, { targets: { amarelo: 60 } })).status, 200);

    /* ---------------------------------------------------------------- senhas, triagem e a ordem com o motivo */
    const geral = (await G('POST', `${Q}/services`, { name: 'Pronto atendimento', prefix: 'P' })).data;
    const exame = (await G('POST', `${Q}/services`, { name: 'Exames', prefix: 'E', priority: false })).data;
    const emit = async (T, body) => { const r = await T(`POST`, `${Q}/tickets`, { serviceId: geral.id, ...body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.ticket; };
    const n1 = await emit(J, {}); const n2 = await emit(J, {}); const p60 = await emit(J, { priority: 1 }); const p80 = await emit(J, { priority: 2 });
    const v1 = await emit(J, {}); const am = await emit(J, {});
    const ex = (await J('POST', `${Q}/tickets`, { serviceId: exame.id })).data.ticket;
    // a triagem (gestor) só manda a cor; o tipo de problema não é campo da rota (é ignorado e não volta)
    const tri = await G('POST', `${Q}/tickets/${v1.id}/risk`, { risk: 'vermelho', problem: 'Infarto (suspeita)' });
    assert.equal(tri.status, 200); assert.ok(!JSON.stringify(tri.data).includes('Infarto'), 'o tipo de problema não volta nem é guardado');
    assert.equal((await G('POST', `${Q}/tickets/${am.id}/risk`, { risk: 'amarelo' })).status, 200);
    assert.equal((await J('POST', `${Q}/tickets/${am.id}/risk`, { risk: 'verde' })).status, 403, 'a cor é da triagem (gestor)');
    ov = (await J('GET', Q)).data;
    assert.deepEqual(ov.waiting.map((t) => t.code), [v1.code, am.code, p80.code, n1.code, n2.code, p60.code, ex.code], 'vermelho, amarelo, depois sem triagem: 80+ na frente, 2 normais, a preferencial');
    const reason = Object.fromEntries(ov.waiting.map((t) => [t.code, t.reason]));
    assert.match(reason[v1.code], /^vermelho: imediato/); assert.match(reason[am.code], /^amarelo há 0 min \(alvo 60 min\)/);
    assert.match(reason[p80.code], /^sem triagem · 80\+/); assert.equal(reason[n1.code], 'sem triagem · ordem de chegada');
    assert.ok(!JSON.stringify(ov).includes('Infarto'));

    /* ---------------------------------------------------------------- mudar a prioridade (quem emite: gestor e atendente) */
    const pr = await J('POST', `${Q}/tickets/${n2.id}/priority`, { priority: 2 });
    assert.equal(pr.status, 200, JSON.stringify(pr.data)); assert.equal(pr.data.ticket.priority, 2); assert.equal(pr.data.ticket.code, n2.code, 'o código impresso não muda');
    assert.equal((await G('POST', `${Q}/tickets/${n2.id}/priority`, { priority: 9 })).status, 400);
    assert.equal((await J('POST', `${Q}/tickets/${ex.id}/priority`, { priority: 1 })).status, 400, 'fila sem preferencial');
    ov = (await J('GET', Q)).data;
    assert.deepEqual(ov.waiting.slice(2, 4).map((t) => t.code), [n2.code, n1.code], 'agora 80+: entre as 80+, quem chegou antes (n2 antes da p80); depois a normal');
    // pelo painel da prefeitura também
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${hosp.id}/queue/tickets/${n2.id}/priority`, { priority: 0 })).status, 200);
    assert.equal((await B.api('POST', `/api/prefeitura/offices/${hosp.id}/queue/tickets/${n2.id}/priority`, { priority: 1 })).status, 404, 'outro cliente');

    /* ---------------------------------------------------------------- "Chamar esta": fora da ordem, registrado */
    const c1 = await J('POST', `${Q}/call`, { desk: 'Guichê 1', ticketId: p60.id });
    assert.equal(c1.status, 200, JSON.stringify(c1.data)); assert.equal(c1.data.ticket.code, p60.code); assert.equal(c1.data.manual, true); assert.equal(c1.data.call.desk, 'Guichê 1');
    assert.equal((await J('POST', `${Q}/call`, { desk: 'Guichê 2', ticketId: p60.id })).status, 409, 'já foi chamada');
    assert.equal((await J('POST', `${Q}/tickets/${p60.id}/priority`, { priority: 0 })).status, 409, 'só quem espera muda a prioridade');
    assert.equal((await J('POST', `${Q}/call`, { desk: 'Guichê 2', ticketId: 999999 })).status, 404);
    // a próxima pela ordem continua sendo o vermelho
    const c2 = await G('POST', `${Q}/call`, { desk: 'Consultório 1' });
    assert.equal(c2.data.ticket.code, v1.code); assert.equal(c2.data.manual, undefined);
    const c3 = await G('POST', `${Q}/call`, { desk: 'Consultório 2', ticketId: ex.id });
    assert.equal(c3.data.ticket.code, ex.code, 'o gestor também chama fora da ordem, de qualquer fila');

    /* ---------------------------------------------------------------- o guichê: a fila com o motivo (sem nomes) e o "Chamar esta" */
    const gUrl = (await G('POST', `${Q}/guiche`)).data.url;
    const GU = bearer(gUrl.split('/').at(-2));
    await emit(J, { name: 'Maria Aparecida Souza' });
    const gv = (await GU('GET', '/api/guiche')).data;
    assert.equal(gv.queue.length, gv.waiting); assert.ok(gv.queue.every((t) => typeof t.reason === 'string' && t.reason.length > 0));
    assert.ok(!JSON.stringify(gv.queue).includes('Maria'), 'o guichê não lê nomes da fila');
    assert.equal(gv.queue[0].code, am.code);
    const last = gv.queue.at(-1);
    const gc = await GU('POST', '/api/guiche/call', { desk: 'Guichê 3', ticketId: last.id });
    assert.equal(gc.status, 200, JSON.stringify(gc.data)); assert.equal(gc.data.manual, true); assert.equal(gc.data.ticket.code, last.code);
    assert.equal((await GU('POST', '/api/guiche/tickets/1/priority', { priority: 1 })).status, 404, 'o guichê não muda prioridade');
    // DIGITAL ISP: a classificação de risco pelo guichê (só a cor) e as salas para o nome do guichê
    assert.ok(Array.isArray(gv.rooms), 'as salas vão ao guichê (para escolher o nome)');
    const cor = await GU('POST', `/api/guiche/tickets/${gc.data.ticket.id}/risk`, { risk: 'amarelo', name: 'Outro Nome' });
    assert.equal(cor.status, 200, JSON.stringify(cor.data)); assert.equal(cor.data.ticket.risk, 'amarelo');
    assert.notEqual(cor.data.ticket.name, 'Outro Nome', 'o guichê não troca o nome');
    assert.equal((await GU('POST', `/api/guiche/tickets/${gc.data.ticket.id}/risk`, { risk: 'roxo' })).status, 400);

    /* ---------------------------------------------------------------- o log da repartição */
    const audit = JSON.stringify(await auditoria(s, A.id));
    assert.ok(audit.includes(`senha ${p60.code} chamada fora da ordem`), 'Chamar esta do atendente no log');
    assert.ok(audit.includes(`senha ${ex.code} chamada fora da ordem`), 'Chamar esta do gestor no log');
    assert.ok(audit.includes(`senha ${last.code} chamada fora da ordem`) && audit.includes('pelo endereço do guichê'), 'Chamar esta do guichê no log');
    assert.ok(audit.includes(`senha ${n2.code} de \\"Hospital Municipal\\" passou de normal para 80 anos ou mais`), 'a troca de prioridade no log');
    assert.ok(audit.includes('recepcao'), 'com quem fez');
    assert.ok(!audit.includes('Infarto') && !audit.includes(`chamada fora da ordem ("Chamar esta") para Consultório 1`), 'a chamada normal não é "fora da ordem"; o problema não aparece');
  } finally { await s.stop(); cleanup(s.dataDir); }
});
