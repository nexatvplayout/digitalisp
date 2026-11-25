// Recupera o acesso direto no banco, no servidor (sem e-mail e sem entrar no painel): gera uma senha nova para um usuário,
// destrava a conta (tentativas e bloqueio), reativa e derruba as sessões abertas. A senha nova pede troca no primeiro acesso.
//
//   npm run admin:reset -- <usuario>                o usuário de uma revenda ou de um cliente (o e-mail dele)
//   npm run admin:reset -- --platform <usuario>     um usuário da equipe da plataforma (ex.: superadmin)
//   npm run admin:reset -- --list <texto>           procura usuários pelo pedaço do nome ou do e-mail (não muda nada)
//
// As variáveis (DATABASE_URL etc.) vêm do ambiente; sem DATABASE_URL, lê ~/.config/digitalisp/digitalisp.env ou o --env <arq>.
// Pode rodar com o servidor no ar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const envFile = opt('--env') || (!process.env.DATABASE_URL ? path.join(os.homedir(), '.config/digitalisp/digitalisp.env') : null);
if (envFile && fs.existsSync(envFile)) process.loadEnvFile(envFile);
const platform = flag('--platform');
const list = opt('--list');
const username = String(args[0] || '').trim().toLowerCase();
if (list == null && !username) {
  console.error('Uso: npm run admin:reset -- [--platform] <usuario>   |   npm run admin:reset -- --list <texto>');
  process.exit(2);
}

const { db } = await import('../server/db.js');
const { hashPassword } = await import('../server/authcore.js');
try {
  if (list != null) {
    const like = `%${String(list).toLowerCase()}%`;
    const rows = await db.all(`SELECT u.id, u.username, u.name, u.active, u.locked_until, u.tenant_id, t.slug FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.username) LIKE ? OR LOWER(u.name) LIKE ? ORDER BY u.username LIMIT 50`, [like, like]);
    if (!rows.length) console.log(`Nenhum usuário com "${list}".`);
    for (const r of rows) {
      const where = r.tenant_id == null ? 'plataforma' : `conta ${r.slug || r.tenant_id}`;
      const st = !r.active ? 'desativado' : Number(r.locked_until) > Date.now() ? 'bloqueado' : 'ativo';
      console.log(`${r.username}  (${r.name}; ${where}; ${st})`);
    }
  } else {
    const row = await db.get(`SELECT id, username, tenant_id FROM users WHERE username = ? AND tenant_id IS ${platform ? '' : 'NOT '}NULL`, [username]);
    if (!row) {
      console.error(`Não existe ${platform ? 'usuário da plataforma' : 'usuário de revenda ou cliente'} "${username}".${platform ? '' : ' (equipe da plataforma? use --platform)'} Procure com: npm run admin:reset -- --list <texto>`);
      process.exitCode = 1;
    } else {
      const password = randomBytes(12).toString('base64url'); // 16 caracteres
      await db.run('UPDATE users SET password_hash = ?, token_ver = token_ver + 1, must_change = 1, failed = 0, locked_until = 0, active = 1 WHERE id = ?', [await hashPassword(password), row.id]);
      await db.run('INSERT INTO audit_log(ts, user_id, username, action, detail, status, ip, tenant_id, impersonator) VALUES(?,?,?,?,?,?,?,?,?)',
        [Date.now(), row.id, row.username, 'senha: nova pelo admin:reset', 'no servidor (linha de comando)', 200, '', row.tenant_id ?? null, null]);
      console.log(`Senha nova de "${row.username}": ${password}`);
      console.log('Ela pede troca no primeiro acesso. As sessões abertas caíram.');
    }
  }
} finally {
  await db.close?.();
}
