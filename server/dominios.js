// DIGITAL ISP · domínio próprio (white-label): a revenda (ou o cliente final dela) abre o painel e a entrada com a marca dela
// no endereço dela, ex.: telas.provedor.com.br. Como o servidor só recebe tráfego pelo Cloudflare, o domínio do cliente entra
// pelo "Cloudflare for SaaS" (Custom Hostnames) da zona digitalisp.com.br: o cliente cria um CNAME para o endereço de entrada
// (ex.: clientes.digitalisp.com.br) e dois TXT de verificação; o Cloudflare emite o certificado e passa a mandar o tráfego.
//
// Superadmin (Integrações → Cloudflare): zona, token (cifrado com SESSION_SECRET, nunca volta ao navegador) e o endereço de
// entrada. Sem a integração, o domínio fica "aguardando a plataforma" e o CNAME já pode ser criado.
//
// GET    /api/dominios                      os domínios da conta (a revenda vê também os dos clientes dela)
// POST   /api/dominios                      { hostname, tenantId? (um cliente da revenda) }
// POST   /api/dominios/:id/verificar         confere no Cloudflare e ativa quando o DNS e o certificado estão prontos
// DELETE /api/dominios/:id
// GET|PUT /api/platform/integracoes/cloudflare  { zoneId, token?, fallback } · POST …/cloudflare/testar
import express from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { invalidateHosts } from './domains.js';
import * as T from './tenancy.js';
import { contaOf, clientesDe } from './contas.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const CF_API = 'https://api.cloudflare.com/client/v4';
const CFG_KEY = 'cf_saas';
const HOST_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
const OWN = /(^|\.)digitalisp\.com\.br$/;

/* ------------------------------------------------------------------ configuração cifrada (superadmin) */
const sealKey = () => (config.sessionSecret ? createHash('sha256').update(`digitalisp-cf-token:${config.sessionSecret}`).digest() : null);
function seal(plain) {
  const k = sealKey(); if (!k) throw fail(400, 'O servidor precisa de SESSION_SECRET para guardar o token cifrado.');
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
function unseal(s) {
  const k = sealKey(); if (!k || typeof s !== 'string' || !s.startsWith('v1:')) return null;
  try { const b = Buffer.from(s.slice(3), 'base64'); const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12), { authTagLength: 16 }); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch { return null; }
}
async function cfg() { try { return JSON.parse(await getSetting(CFG_KEY)) || {}; } catch { return {}; } }
const fallbackOf = (c) => c.fallback || 'clientes.digitalisp.com.br';
async function cfReady() { const c = await cfg(); const token = unseal(c.token); return c.zoneId && token ? { ...c, token } : null; }

async function cf(c, method, path, body) {
  const r = await fetch(`${CF_API}${path}`, { method, headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw fail(502, `Cloudflare: ${(j.errors || []).map((e) => e.message).join('; ') || `resposta ${r.status}`}`);
  return j.result;
}

/** Os registros de DNS que o cliente precisa criar, a partir do que o Cloudflare devolveu (ou só o CNAME, sem a integração). */
function recordsOf(hostname, ch, fallback) {
  const out = [{ type: 'CNAME', name: hostname, value: fallback, why: 'Aponta o seu endereço para a DIGITAL ISP' }];
  const ov = ch?.ownership_verification;
  if (ov?.name && ov?.value) out.push({ type: (ov.type || 'txt').toUpperCase(), name: ov.name, value: ov.value, why: 'Comprova que o domínio é seu' });
  for (const v of ch?.ssl?.validation_records || []) if (v.txt_name && v.txt_value) out.push({ type: 'TXT', name: v.txt_name, value: v.txt_value, why: 'Libera o certificado de segurança (https)' });
  return out;
}
const statusOf = (ch) => (!ch ? 'aguardando a plataforma' : ch.status === 'active' && ch.ssl?.status === 'active' ? 'ativo' : ch.status === 'active' ? 'emitindo o certificado' : 'aguardando o DNS');

/* ------------------------------------------------------------------ o que o endereço abre */
/** O caminho de entrada de um domínio verificado: a entrada com a marca da conta dona (/c/<slug>). */
export async function entradaDoDominio(tenantId) {
  const t = await T.getTenant(tenantId);
  return t ? `/c/${t.slug}` : '/admin/';
}

export function mountDominios(app, { needs, needsPlatform }) {
  const M = needs('users.manage');
  const dto = async (r, fallback) => {
    let extra = {}; try { extra = JSON.parse((await db.get('SELECT records FROM isp_dominio_dns WHERE domain_id = ?', [r.id]))?.records || '{}'); } catch { /* sem registros */ }
    const t = await T.getTenant(Number(r.tenant_id));
    return { id: Number(r.id), hostname: r.hostname, tenantId: Number(r.tenant_id), conta: t?.name || '', status: r.status, estado: extra.estado || (r.status === 'verified' ? 'ativo' : 'aguardando o DNS'), records: extra.records || recordsOf(r.hostname, null, fallback), lastError: r.last_error || null, verifiedAt: r.verified_at ? Number(r.verified_at) : null, createdAt: Number(r.created_at) };
  };
  const contas = async (tid) => { const c = await contaOf(tid); return c.tipo === 'revenda' ? [tid, ...(await clientesDe(tid))] : [tid]; };
  const own = async (req) => {
    const r = await db.get('SELECT * FROM domains WHERE id = ?', [Number(req.params.id)]);
    if (!r || !(await contas(req.tenantId)).includes(Number(r.tenant_id))) throw fail(404, 'Domínio não encontrado.');
    return r;
  };
  async function verificar(r) {
    const c = await cfReady();
    const fallback = fallbackOf(c || (await cfg()));
    let ch = null; let erro = null;
    if (c && r.cf_id) { try { ch = await cf(c, 'GET', `/zones/${c.zoneId}/custom_hostnames/${r.cf_id}`); } catch (e) { erro = e.message; } }
    const estado = statusOf(ch);
    const ok = estado === 'ativo';
    await db.run('UPDATE domains SET status = ?, verified_at = ?, last_check_at = ?, last_error = ?, cf_status = ? WHERE id = ?', [ok ? 'verified' : 'pending', ok ? r.verified_at || Date.now() : null, Date.now(), erro || (ch?.verification_errors || []).join('; ') || null, ch?.status || null, r.id]);
    await db.run('DELETE FROM isp_dominio_dns WHERE domain_id = ?', [r.id]);
    await db.run('INSERT INTO isp_dominio_dns(domain_id, records) VALUES(?,?)', [r.id, JSON.stringify({ estado, records: recordsOf(r.hostname, ch, fallback) })]);
    invalidateHosts();
  }

  app.get('/api/dominios', M, ah(async (req, res) => {
    const ids = await contas(req.tenantId);
    const rows = await db.all(`SELECT * FROM domains WHERE tenant_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
    const c = await cfg();
    const pode = await T.hasFeature(req.tenantId, 'marcaPropria');
    res.set('Cache-Control', 'no-store').json({ domains: await Promise.all(rows.map((r) => dto(r, fallbackOf(c)))), entrada: fallbackOf(c), integrado: Boolean(c.zoneId && c.token), pode });
  }));
  app.post('/api/dominios', M, express.json({ limit: '4kb' }), ah(async (req, res) => {
    if (!(await T.hasFeature(req.tenantId, 'marcaPropria'))) throw fail(402, 'O domínio próprio faz parte do módulo "Marca própria". Peça a liberação no seu plano.');
    const hostname = String(req.body?.hostname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!HOST_RE.test(hostname)) throw fail(400, 'Endereço inválido. Use algo como telas.suaempresa.com.br (sem https:// e sem barra).');
    if (OWN.test(hostname)) throw fail(400, 'Use um domínio seu, não um endereço da DIGITAL ISP.');
    const alvo = req.body?.tenantId ? Number(req.body.tenantId) : Number(req.tenantId);
    if (!(await contas(req.tenantId)).includes(alvo)) throw fail(404, 'Conta não encontrada.');
    if (await db.get('SELECT id FROM domains WHERE hostname = ?', [hostname])) throw fail(409, 'Esse endereço já está cadastrado.');
    if (Number((await db.get('SELECT COUNT(*) AS n FROM domains WHERE tenant_id = ?', [alvo])).n) >= 5) throw fail(400, 'No máximo 5 domínios por conta.');
    const c = await cfReady();
    let cfId = null;
    if (c) cfId = (await cf(c, 'POST', `/zones/${c.zoneId}/custom_hostnames`, { hostname, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } }))?.id || null;
    const id = await db.insert('INSERT INTO domains(tenant_id, hostname, kind, status, verify_token, created_at, cf_id, mode) VALUES(?,?,?,?,?,?,?,?)',
      [alvo, hostname, 'panel', 'pending', randomBytes(12).toString('hex'), Date.now(), cfId, c ? 'cloudflare-saas' : 'manual']);
    const r = await db.get('SELECT * FROM domains WHERE id = ?', [id]);
    await verificar(r);
    res.locals.audit = `domínio ${hostname} cadastrado para a conta #${alvo}`;
    res.status(201).json(await dto(await db.get('SELECT * FROM domains WHERE id = ?', [id]), fallbackOf(c || (await cfg()))));
  }));
  app.post('/api/dominios/:id/verificar', M, ah(async (req, res) => {
    const r = await own(req);
    const c = await cfReady();
    if (c && !r.cf_id) { // cadastrado antes da integração: cria agora no Cloudflare
      const ch = await cf(c, 'POST', `/zones/${c.zoneId}/custom_hostnames`, { hostname: r.hostname, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } });
      await db.run("UPDATE domains SET cf_id = ?, mode = 'cloudflare-saas' WHERE id = ?", [ch.id, r.id]);
    }
    await verificar(await db.get('SELECT * FROM domains WHERE id = ?', [r.id]));
    res.json(await dto(await db.get('SELECT * FROM domains WHERE id = ?', [r.id]), fallbackOf(c || (await cfg()))));
  }));
  app.delete('/api/dominios/:id', M, ah(async (req, res) => {
    const r = await own(req);
    const c = await cfReady();
    if (c && r.cf_id) await cf(c, 'DELETE', `/zones/${c.zoneId}/custom_hostnames/${r.cf_id}`).catch(() => null);
    await db.run('DELETE FROM isp_dominio_dns WHERE domain_id = ?', [r.id]);
    await db.run('DELETE FROM domains WHERE id = ?', [r.id]);
    invalidateHosts();
    res.locals.audit = `domínio ${r.hostname} retirado`;
    res.json({ ok: true });
  }));

  /* superadmin: a integração com o Cloudflare for SaaS */
  const V = needsPlatform('platform.view'); const S = needsPlatform('platform.settings');
  app.get('/api/platform/integracoes/cloudflare', V, ah(async (_req, res) => {
    const c = await cfg();
    const total = Number((await db.get('SELECT COUNT(*) AS n FROM domains')).n);
    res.set('Cache-Control', 'no-store').json({ zoneId: c.zoneId || '', fallback: fallbackOf(c), tokenSet: Boolean(c.token), tokenReadable: c.token ? unseal(c.token) != null : null, canSeal: Boolean(sealKey()), dominios: total });
  }));
  app.put('/api/platform/integracoes/cloudflare', S, express.json({ limit: '4kb' }), ah(async (req, res) => {
    const c = await cfg(); const b = req.body || {};
    const zoneId = b.zoneId === undefined ? c.zoneId : String(b.zoneId || '').trim();
    if (zoneId && !/^[a-f0-9]{32}$/.test(zoneId)) throw fail(400, 'Zone ID: 32 letras e números (Cloudflare → digitalisp.com.br → Visão geral, coluna da direita).');
    const fallback = b.fallback === undefined ? fallbackOf(c) : String(b.fallback || '').trim().toLowerCase();
    if (!HOST_RE.test(fallback) || !OWN.test(fallback)) throw fail(400, 'Endereço de entrada: um subdomínio de digitalisp.com.br (ex.: clientes.digitalisp.com.br).');
    let token = c.token;
    if (b.token === null || b.token === '') token = undefined;
    else if (b.token !== undefined) { const t = String(b.token).trim(); if (!/^[\x21-\x7e]{20,200}$/.test(t)) throw fail(400, 'Token inválido.'); token = seal(t); }
    await setSetting(CFG_KEY, JSON.stringify({ zoneId, fallback, ...(token ? { token } : {}), updatedAt: Date.now() }));
    res.locals.audit = `integrações: cloudflare (zona ${zoneId ? 'definida' : 'vazia'}, token ${token ? 'definido' : 'vazio'})`;
    res.json({ ok: true });
  }));
  app.post('/api/platform/integracoes/cloudflare/testar', V, ah(async (_req, res) => {
    const c = await cfReady();
    if (!c) return res.json({ ok: false, message: 'Falta o Zone ID ou o token.' });
    try {
      const z = await cf(c, 'GET', `/zones/${c.zoneId}`);
      let fb = null; try { fb = await cf(c, 'GET', `/zones/${c.zoneId}/custom_hostnames/fallback_origin`); } catch (e) { return res.json({ ok: false, message: `Zona ${z.name} encontrada, mas o Cloudflare for SaaS não respondeu (${e.message}). Ative em SSL/TLS → Custom Hostnames.` }); }
      res.json({ ok: true, message: `Zona ${z.name}: Cloudflare for SaaS ligado, endereço de entrada ${fb?.origin || '(não definido)'} (${fb?.status || '—'}).` });
    } catch (e) { res.json({ ok: false, message: e.message }); }
  }));
}
