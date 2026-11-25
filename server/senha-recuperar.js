// DIGITAL ISP · "Esqueci minha senha" da revenda e do cliente final, por e-mail.
//
// GET  /api/admin/senha                 { email: true|false } (a tela de login mostra o link só com o e-mail ligado)
// POST /api/admin/senha/esqueci         { username, tenant? } -> sempre a mesma resposta (não diz se a conta existe)
// POST /api/admin/senha/redefinir       { token, password }   -> troca a senha e derruba as sessões abertas
//
// O link vai para o e-mail da conta (o usuário da revenda e do cliente é o e-mail) e vale 30 min, uma vez só. No banco fica
// só o hash do código (isp_senha_reset). O código viaja depois do "#" do endereço: não aparece em log de servidor nem de
// proxy. A equipe da plataforma não usa este caminho (o superadmin recupera pelo npm run admin:reset, no servidor).
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import * as access from './auth.js';
import { checkPasswordPolicy } from './authcore.js';
import { hostTenantId } from './domains.js';
import { createLimiter } from './ratelimit.js';
import { emailLigado, enviarEmail } from './email.js';

export const RESET_MS = 30 * 60 * 1000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OK = { ok: true, message: 'Se esse e-mail tiver uma conta, o link para criar uma nova senha chega em alguns minutos. Confira também o spam.' };
const hashOf = (token) => createHash('sha256').update(String(token)).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** A revenda do usuário: a própria conta, ou a revenda dona do cliente final. */
async function contaDe(tenantId) {
  const t = await db.get('SELECT id, slug, name FROM tenants WHERE id = ?', [tenantId]);
  if (!t) return null;
  const c = await db.get("SELECT revenda_id FROM isp_conta WHERE tenant_id = ? AND tipo = 'cliente'", [tenantId]);
  return { ...t, id: Number(t.id), cliente: Boolean(c), revendaId: c ? Number(c.revenda_id) : Number(t.id) };
}

/**
 * Onde o link abre. O endereço do pedido só vale se for o domínio verificado da própria conta (ou da revenda dela): um Host
 * forjado não pode mandar o link de outra pessoa para um site de terceiros. Fora disso, PLATFORM_PUBLIC_URL; sem ela, só em
 * desenvolvimento o endereço do pedido.
 */
async function baseDoLink(req, conta) {
  const host = String(req.hostname || '').toLowerCase();
  const tid = host ? await hostTenantId(host) : null;
  if (tid && (tid === conta.id || tid === conta.revendaId)) return `https://${host}`;
  if (config.platform.publicUrl) return config.platform.publicUrl;
  return config.production ? null : `${req.protocol}://${req.get('host')}`;
}

const textoEmail = (nome, link) => [
  `Olá${nome ? `, ${nome}` : ''}.`,
  '',
  'Recebemos um pedido para criar uma nova senha do seu acesso ao DIGITAL ISP.',
  'Para escolher a nova senha, abra o link abaixo (vale por 30 minutos e uma vez só):',
  '',
  link,
  '',
  'Se não foi você, ignore este e-mail: a sua senha continua a mesma.',
].join('\n');

const htmlEmail = (nome, link) => `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0f172a">
<p>Olá${nome ? `, ${esc(nome)}` : ''}.</p>
<p>Recebemos um pedido para criar uma nova senha do seu acesso ao <b>DIGITAL ISP</b>.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#0a7cff;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Criar nova senha</a></p>
<p style="color:#475569;font-size:13px">O link vale por 30 minutos e uma vez só. Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>
</body></html>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountSenhaRecuperar(app, { ipOf, now = () => Date.now() } = {}) {
  const r = express.Router();
  r.use(express.json({ limit: '4kb' }));
  // por IP e por conta: ninguém usa a rota para encher a caixa de alguém nem para varrer e-mails
  const porIp = createLimiter({ windowMs: 15 * 60 * 1000, max: Number(process.env.SENHA_RESET_PER_IP || 10), maxKeys: 50000 });
  const porConta = createLimiter({ windowMs: 60 * 60 * 1000, max: 3, maxKeys: 50000 });
  const trocaPorIp = createLimiter({ windowMs: 15 * 60 * 1000, max: 20, maxKeys: 50000 });

  r.get('/', (_req, res) => res.set('Cache-Control', 'no-store').json({ email: emailLigado() }));

  r.post('/esqueci', ah(async (req, res) => {
    if (!emailLigado()) throw fail(503, 'A recuperação de senha por e-mail ainda não está ligada. Peça uma senha nova à sua revenda (ou ao suporte do DIGITAL ISP).');
    const ip = ipOf(req);
    if (!porIp.hit(ip)) throw fail(429, 'Muitos pedidos. Aguarde alguns minutos.');
    const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 64);
    const slug = String(req.body?.tenant ?? '').trim().toLowerCase().slice(0, 80);
    if (!EMAIL_RE.test(username)) throw fail(400, 'Informe o e-mail da conta.');
    // a resposta sai antes do envio e é sempre a mesma: o tempo também não pode dizer se a conta existe
    res.json(OK);
    try {
      if (!porConta.hit(username)) return;
      const u = await db.get('SELECT id, username, name, active, tenant_id FROM users WHERE username = ? AND tenant_id IS NOT NULL', [username]);
      if (!u || !u.active) { await access.audit({ username, action: 'senha: pedido de recuperação', detail: u ? 'conta desativada' : 'conta inexistente', status: 404, ip }); return; }
      const conta = await contaDe(Number(u.tenant_id));
      if (!conta || (slug && conta.slug !== slug)) return; // no endereço de um cliente, só a conta daquele cliente
      const base = await baseDoLink(req, conta);
      if (!base) { console.warn('[senha] PLATFORM_PUBLIC_URL vazia: sem endereço seguro para o link de recuperação.'); return; }
      const token = randomBytes(32).toString('base64url');
      const t = now();
      await db.run('UPDATE isp_senha_reset SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [t, u.id]); // vale só o último
      await db.insert('INSERT INTO isp_senha_reset(user_id, token_hash, expires_at, created_at, ip) VALUES(?,?,?,?,?)', [u.id, hashOf(token), t + RESET_MS, t, String(ip || '').slice(0, 64)]);
      const link = `${base}${conta.cliente ? `/c/${conta.slug}/` : '/admin/'}#redefinir=${token}`;
      await enviarEmail({ to: u.username, subject: 'DIGITAL ISP: criar uma nova senha', text: textoEmail(u.name, link), html: htmlEmail(u.name, link) });
      await access.audit({ userId: Number(u.id), username: u.username, action: 'senha: link de recuperação enviado', status: 200, ip, tenantId: conta.id });
    } catch (err) {
      console.error('[senha] o e-mail de recuperação não saiu:', err.message);
    }
  }));

  r.post('/redefinir', ah(async (req, res) => {
    const ip = ipOf(req);
    if (!trocaPorIp.hit(ip)) throw fail(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const INVALIDO = 'Este link não vale mais (já foi usado ou passou de 30 minutos). Peça outro em "Esqueci minha senha".';
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw fail(400, INVALIDO);
    const row = await db.get('SELECT r.id, r.user_id, r.expires_at, r.used_at, u.username, u.active, u.tenant_id FROM isp_senha_reset r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?', [hashOf(token)]);
    if (!row || row.used_at != null || Number(row.expires_at) < now() || !row.active || row.tenant_id == null) throw fail(400, INVALIDO);
    try { checkPasswordPolicy(password, { username: row.username, production: config.production }); } catch (err) { throw fail(400, err.message); }
    // marca o uso antes de trocar: dois pedidos ao mesmo tempo com o mesmo link, só um passa
    const claim = await db.run('UPDATE isp_senha_reset SET used_at = ? WHERE id = ? AND used_at IS NULL', [now(), row.id]);
    if (!claim.changes) throw fail(400, INVALIDO);
    // a troca sobe o token_ver: as sessões abertas com a senha antiga caem
    await access.resetPassword(Number(row.user_id), password, { mustChange: false }, Number(row.tenant_id));
    await access.audit({ userId: Number(row.user_id), username: row.username, action: 'senha: redefinida pelo link do e-mail', status: 200, ip, tenantId: Number(row.tenant_id) });
    res.json({ ok: true, username: row.username, message: 'Senha nova criada. Entre com ela.' });
  }));

  app.use('/api/admin/senha', r);
}
