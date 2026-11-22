/* NEXA Telas · segurança pública (docs/TELAS.md §21; contrato telas-contrato.md §10).

   Botão de pânico (silencioso). A repartição com o módulo "panico" ligado tem, no painel dela, um botão que avisa a
   Segurança (CCO). NADA aparece em tela nenhuma: o aviso não entra em rota nenhuma do aparelho (config, sinal de vida,
   fila). Ele chega ao painel das repartições do tipo "seguranca" e ao Painel da Prefeitura, que marcam Recebido e
   Encerrar (com uma nota). Sem repartição de Segurança cadastrada, o botão diz que não há quem receba e não finge que
   enviou. Freio: 3 por minuto por repartição. Histórico: 90 dias.
     POST /api/reparticao/panic              qualquer usuário da repartição (gestor ou atendente)
     GET  /api/reparticao/panic/mine         os últimos acionamentos desta repartição (enviado, recebido, encerrado)
     GET  /api/reparticao/panic              o gestor da Segurança: os abertos e os recentes, com a repartição e o ponto
     POST /api/reparticao/panic/:id/ack|close
     GET  /api/prefeitura/panic · POST /api/prefeitura/panic/:id/ack|close     o Painel da Prefeitura

   Chave de integração (API) do emissor conveniado (Polícia Civil e Militar). Gerada no Painel da Prefeitura, mostrada
   uma vez, só o SHA-256 no banco, revogável, com a data do último uso. Com Authorization: Bearer <chave>:
     POST /api/telas-emissor/alerts          cria um alerta (o mesmo caminho do link: validação, freio, aprovação, auditoria)
     GET  /api/telas-emissor/alerts          os alertas e os pedidos do próprio emissor
     POST /api/telas-emissor/alerts/:id/cancel
   Sem envio de foto por aqui: desaparecido e cartela, só pela tela. */
import { db } from './db.js';
import * as C from './telas-core.js';
import { createLimiter, ipKey } from './ratelimit.js';
import { officeModules, typeLabel, isExternal } from '../public/shared/telas-tipos.js';

const { fail, line, idOf, sha256 } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v == null ? null : Number(v));
export const PANIC_KEEP_DAYS = 90;

export function createSeguranca({ available, audit = async () => {}, ipOf = (req) => req.ip, apiAllowed = async () => true, now = () => Date.now() }) {
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const panicPerOffice = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_PANIC_PER_MIN) || 3, maxKeys: 50_000 });
  const hasCco = async (tenantId) => Boolean(await db.get("SELECT id FROM telas_offices WHERE tenant_id = ? AND type = 'seguranca' LIMIT 1", [tenantId]));
  const SQL = `SELECT p.*, o.name AS o_name, o.type AS o_type, o.address AS o_address, o.lat AS o_lat, o.lng AS o_lng FROM telas_panic p
    LEFT JOIN telas_offices o ON o.id = p.office_id AND o.tenant_id = p.tenant_id`;
  /** O que o CCO vê: a repartição (nome, tipo, endereço e ponto), quem acionou e a hora, quem recebeu e quem encerrou. */
  const dto = (p) => ({
    id: Number(p.id), officeId: Number(p.office_id), office: p.o_name || `repartição #${p.office_id} (excluída)`, officeType: p.o_type || null, officeTypeLabel: p.o_type ? typeLabel(p.o_type) : '',
    address: p.o_address || '', lat: num(p.o_lat), lng: num(p.o_lng), sentBy: p.sent_by || '', sentAt: Number(p.sent_at),
    ackBy: p.ack_by || null, ackAt: num(p.ack_at), closedBy: p.closed_by || null, closedAt: num(p.closed_at), note: p.note || null,
    status: p.closed_at ? 'encerrado' : p.ack_at ? 'recebido' : 'novo',
  });
  /** O que quem acionou vê: só a hora do envio e a do recebimento. */
  const mineDto = (p) => ({ id: Number(p.id), sentAt: Number(p.sent_at), ackAt: num(p.ack_at), closedAt: num(p.closed_at) });
  async function list(tenantId) {
    const t = now();
    const rows = await db.all(`${SQL} WHERE p.tenant_id = ? AND (p.closed_at IS NULL OR p.sent_at > ?) ORDER BY p.id DESC LIMIT 300`, [tenantId, t - PANIC_KEEP_DAYS * 86400_000]);
    const all = rows.map(dto);
    return { serverTime: t, open: all.filter((p) => p.status !== 'encerrado').reverse(), closed: all.filter((p) => p.status === 'encerrado').slice(0, 100) };
  }
  async function ack(tenantId, id, by) {
    const r = await db.run('UPDATE telas_panic SET ack_by = ?, ack_at = ? WHERE id = ? AND tenant_id = ? AND ack_at IS NULL AND closed_at IS NULL', [line(by, 64), now(), idOf(id, 'Ocorrência'), tenantId]);
    const p = await db.get(`${SQL} WHERE p.id = ? AND p.tenant_id = ?`, [idOf(id, 'Ocorrência'), tenantId]);
    if (!p) throw fail(404, 'Ocorrência não encontrada.');
    return { p: dto(p), changed: r.changes === 1 };
  }
  async function close(tenantId, id, by, note) {
    const t = now(); const pid = idOf(id, 'Ocorrência');
    const cur = await db.get('SELECT * FROM telas_panic WHERE id = ? AND tenant_id = ?', [pid, tenantId]);
    if (!cur) throw fail(404, 'Ocorrência não encontrada.');
    if (cur.closed_at) throw fail(409, 'Esta ocorrência já foi encerrada.');
    const text = line(note, 300);
    if (text.length < 3) throw fail(400, 'Escreva uma nota para encerrar (o que foi feito).');
    await db.run('UPDATE telas_panic SET ack_by = COALESCE(ack_by, ?), ack_at = COALESCE(ack_at, ?), closed_by = ?, closed_at = ?, note = ? WHERE id = ? AND tenant_id = ? AND closed_at IS NULL', [line(by, 64), t, line(by, 64), t, text, pid, tenantId]);
    return dto(await db.get(`${SQL} WHERE p.id = ? AND p.tenant_id = ?`, [pid, tenantId]));
  }

  /** office: a sessão do link (qualquer papel); gestorOnly: o filtro do papel; note: a auditoria da repartição. */
  function mountOffice(app, { office, gestorOnly, note }) {
    const cco = [office, gestorOnly, (req, res, next) => (req.office.type === 'seguranca' ? next() : res.status(403).json({ error: 'Só a Segurança (CCO) recebe o botão de pânico.' }))];
    app.post('/api/reparticao/panic', office, ah(async (req, res) => {
      const o = req.office;
      if (!officeModules(o.type, C.parseJson(o.modules, {})).panico) throw fail(403, 'O botão de pânico está desligado nesta repartição (a prefeitura liga em Repartições → Editar → Módulos).');
      // sem quem receba, o botão não finge que enviou
      if (!(await hasCco(req.tenantId))) throw fail(409, 'A prefeitura ainda não tem uma repartição de Segurança (CCO) para receber o aviso. Em caso de emergência, ligue 190 ou 153.', { code: 'no_cco' });
      if (!panicPerOffice.hit(String(o.id))) throw fail(429, 'O aviso já foi enviado há instantes. Aguarde um minuto ou ligue 190.');
      const t = now();
      const id = await db.insert('INSERT INTO telas_panic(tenant_id,office_id,sent_by,sent_at) VALUES(?,?,?,?)', [req.tenantId, o.id, line(req.by, 120), t]);
      await note(req, 'POST /api/reparticao/panic', `prefeitura: BOTÃO DE PÂNICO acionado em "${o.name}" (ocorrência #${id}): aviso silencioso enviado à Segurança`, 201);
      noStore(res).status(201).json({ id: Number(id), sentAt: t });
    }));
    app.get('/api/reparticao/panic/mine', office, ah(async (req, res) => {
      const rows = await db.all('SELECT * FROM telas_panic WHERE tenant_id = ? AND office_id = ? AND sent_at > ? ORDER BY id DESC LIMIT 5', [req.tenantId, req.office.id, now() - 86400_000]);
      noStore(res).json({ serverTime: now(), enabled: Boolean(officeModules(req.office.type, C.parseJson(req.office.modules, {})).panico), receiver: await hasCco(req.tenantId), sent: rows.map(mineDto) });
    }));
    app.get('/api/reparticao/panic', cco, ah(async (req, res) => noStore(res).json(await list(req.tenantId))));
    app.post('/api/reparticao/panic/:id/ack', cco, ah(async (req, res) => {
      const r = await ack(req.tenantId, req.params.id, req.by);
      if (r.changed) await note(req, 'POST /api/reparticao/panic/ack', `prefeitura: botão de pânico de "${r.p.office}" (ocorrência #${r.p.id}) RECEBIDO pela Segurança`);
      res.json(r.p);
    }));
    app.post('/api/reparticao/panic/:id/close', cco, ah(async (req, res) => {
      const p = await close(req.tenantId, req.params.id, req.by, req.body?.note);
      await note(req, 'POST /api/reparticao/panic/close', `prefeitura: botão de pânico de "${p.office}" (ocorrência #${p.id}) ENCERRADO pela Segurança`);
      res.json(p);
    }));
  }
  function mountPanel(app, { M, own, who, publicUrl }) {
    app.get('/api/prefeitura/panic', M, ah(async (req, res) => noStore(res).json(await list(req.tenantId))));
    app.post('/api/prefeitura/panic/:id/ack', M, ah(async (req, res) => {
      const r = await ack(req.tenantId, req.params.id, who(req));
      if (r.changed) res.locals.audit = `prefeitura: botão de pânico de "${r.p.office}" (ocorrência #${r.p.id}) RECEBIDO pelo Painel da Prefeitura`;
      res.json(r.p);
    }));
    app.post('/api/prefeitura/panic/:id/close', M, ah(async (req, res) => {
      const p = await close(req.tenantId, req.params.id, who(req), req.body?.note);
      res.locals.audit = `prefeitura: botão de pânico de "${p.office}" (ocorrência #${p.id}) ENCERRADO pelo Painel da Prefeitura`;
      res.json(p);
    }));
    /* ---- a chave de integração do emissor conveniado: aparece UMA vez; só o hash fica; gerar outra troca a de antes */
    const external = async (req) => { const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição'); if (!isExternal(o.type)) throw fail(409, 'Só um emissor conveniado (Polícia Civil ou Militar) tem chave de integração.'); return o; };
    app.get('/api/prefeitura/offices/:id/api-key', M, ah(async (req, res) => {
      const o = await external(req);
      const k = await db.get('SELECT created_at, created_by, last_used FROM telas_api_keys WHERE office_id = ? AND tenant_id = ?', [o.id, req.tenantId]);
      noStore(res).json({ on: Boolean(k), createdAt: num(k?.created_at), createdBy: k?.created_by || '', lastUsed: num(k?.last_used), allowed: await apiAllowed(req.tenantId), endpoint: `${publicUrl(req)}/api/telas-emissor/alerts` });
    }));
    app.post('/api/prefeitura/offices/:id/api-key', M, ah(async (req, res) => {
      const o = await external(req);
      if (!(await apiAllowed(req.tenantId))) throw fail(403, 'O plano desta prefeitura não inclui o acesso por API.');
      const token = C.newToken();
      await db.run('DELETE FROM telas_api_keys WHERE office_id = ? AND tenant_id = ?', [o.id, req.tenantId]);
      await db.run('INSERT INTO telas_api_keys(office_id,tenant_id,token_hash,created_by,created_at) VALUES(?,?,?,?,?)', [o.id, req.tenantId, sha256(token), line(who(req), 64), now()]);
      res.locals.audit = `prefeitura: chave de integração do emissor conveniado "${o.name}" gerada (a anterior deixou de valer)`;
      noStore(res).status(201).json({ key: token, endpoint: `${publicUrl(req)}/api/telas-emissor/alerts` });
    }));
    app.delete('/api/prefeitura/offices/:id/api-key', M, ah(async (req, res) => {
      const o = await external(req);
      await db.run('DELETE FROM telas_api_keys WHERE office_id = ? AND tenant_id = ?', [o.id, req.tenantId]);
      res.locals.audit = `prefeitura: chave de integração do emissor conveniado "${o.name}" revogada`;
      res.json({ ok: true });
    }));
  }
  /**
   * As rotas da chave de integração. officeAlert(o, body, { by, via }), alertsOf(o) e cancelOf(o, id, by) são as mesmas
   * regras do link de controle (server/telas.js): a chave só emite pelo emissor dela.
   */
  function mountApi(app, { officeAlert, alertsOf, cancelOf }) {
    const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_EMISSOR_PER_IP_MIN) || 60, maxKeys: 100_000 });
    const DENIED = 'Chave de integração inválida ou revogada.';
    const key = ah(async (req, res, next) => {
      noStore(res);
      if (!perIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const k = tok ? await db.get('SELECT office_id, tenant_id FROM telas_api_keys WHERE token_hash = ?', [sha256(tok)]) : null;
      const o = k ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [k.office_id, k.tenant_id]) : null;
      // a mesma resposta para chave inexistente, revogada, de repartição que deixou de ser emissora, modo ou plano desligados
      if (!o || !isExternal(o.type) || !(await available(Number(o.tenant_id))) || !(await apiAllowed(Number(o.tenant_id)))) return res.status(401).json({ error: DENIED });
      await db.run('UPDATE telas_api_keys SET last_used = ? WHERE office_id = ? AND tenant_id = ?', [now(), o.id, o.tenant_id]);
      req.office = o; req.tenantId = Number(o.tenant_id); req.by = `${C.officeActor(o.name)} (API)`.slice(0, 120);
      next();
    });
    const log = (req, action, detail, status) => audit({ username: req.by.slice(0, 64), action, detail, status, ip: ipOf(req), tenantId: req.tenantId });
    app.post('/api/telas-emissor/alerts', key, ah(async (req, res) => {
      const out = await officeAlert(req.office, req.body || {}, { by: req.by, via: 'pela chave de integração' });
      await log(req, 'POST /api/telas-emissor/alerts', out.log, out.status);
      res.status(out.status).json(out.body);
    }));
    app.get('/api/telas-emissor/alerts', key, ah(async (req, res) => res.json(await alertsOf(req.office))));
    app.post('/api/telas-emissor/alerts/:id/cancel', key, ah(async (req, res) => {
      const cur = await cancelOf(req.office, req.params.id, req.by);
      await log(req, 'POST /api/telas-emissor/alerts/cancel', `prefeitura: alerta "${cur.title}" encerrado pela chave de integração`, 200);
      res.json({ ok: true });
    }));
  }
  async function prune(t = now()) { await db.run('DELETE FROM telas_panic WHERE closed_at IS NOT NULL AND sent_at < ?', [t - PANIC_KEEP_DAYS * 86400_000]); }
  /** A repartição saiu: os acionamentos e a chave dela. x = a transação. */
  async function dropOffice(x, tenantId, officeId) {
    await x.run('DELETE FROM telas_panic WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    await x.run('DELETE FROM telas_api_keys WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
  }
  return { mountOffice, mountPanel, mountApi, prune, dropOffice, list, hasCco };
}
