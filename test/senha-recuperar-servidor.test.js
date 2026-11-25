// "Esqueci minha senha" da revenda e do cliente final (server/senha-recuperar.js), no servidor de verdade, com o e-mail na
// caixa de saída local (MAIL_OUTBOX=1): a resposta não diz se a conta existe, o link vale uma vez, a senha velha e as
// sessões abertas caem, o link do cliente abre no endereço dele, e o código vencido ou inventado não serve. Sem e-mail
// ligado, a rota responde 503 e a tela não mostra o link. Por fim, o npm run admin:reset no mesmo banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, root } from './helpers/srv.js';

const caixa = (dir) => {
  const d = path.join(dir, 'caixa-de-saida');
  return fs.existsSync(d) ? fs.readdirSync(d).sort().map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : [];
};
const codigo = (mail) => /#redefinir=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
const esperar = async (fn, ms = 5000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 100)); } };

test('esqueci minha senha: link por e-mail para a revenda e para o cliente', { timeout: 120000 }, async (t) => {
  const dataDir = tmpDir('nexa-esqueci');
  const s = await boot({ DATA_DIR: dataDir, MAIL_OUTBOX: '1', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', SENHA_RESET_PER_IP: '100' });
  t.after(async () => { await s.stop?.(); cleanup(dataDir); });
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));
  const email = 'dona@revenda-esqueci.example.com';
  const cad = await P('POST', '/api/platform/tenants', { name: 'Revenda Esqueci', document: '11.222.333/0001-81', contactEmail: email, adminUsername: email, adminPassword: 'senha-antiga-da-revenda-1', mustChange: false, status: 'active' });
  assert.equal(cad.status, 201, JSON.stringify(cad.data));

  assert.deepEqual((await anon('GET', '/api/admin/senha')).data, { email: true });
  assert.equal((await anon('POST', '/api/admin/senha/esqueci', { username: 'sem-arroba' })).status, 400);

  // a resposta da conta que não existe é igual à da que existe, e não sai e-mail
  const nada = await anon('POST', '/api/admin/senha/esqueci', { username: 'ninguem@exemplo.test' });
  const sim = await anon('POST', '/api/admin/senha/esqueci', { username: ` ${email.toUpperCase()} ` });
  assert.equal(nada.status, 200); assert.equal(sim.status, 200);
  assert.deepEqual(nada.data, sim.data, 'a resposta não diz se a conta existe');
  const mails = await esperar(() => { const m = caixa(dataDir); return m.length ? m : null; });
  assert.equal(mails.length, 1, 'só a conta que existe recebe');
  assert.equal(mails[0].to, email);
  assert.match(mails[0].text, /^https:\/\/painel\.exemplo\.test\/admin\/#redefinir=/m, 'o link usa o endereço público, não o Host do pedido');
  const sessaoVelha = (await anon('POST', '/api/admin/login', { username: email, password: 'senha-antiga-da-revenda-1' })).data.token;

  // pedir de novo: o link anterior deixa de valer
  await anon('POST', '/api/admin/senha/esqueci', { username: email });
  const dois = await esperar(() => { const m = caixa(dataDir); return m.length >= 2 ? m : null; });
  const [velho, novo] = [codigo(dois[0]), codigo(dois[1])];
  assert.ok(velho && novo && velho !== novo);
  assert.equal((await anon('POST', '/api/admin/senha/redefinir', { token: velho, password: 'outra-senha-boa-2026' })).status, 400, 'o link anterior caiu');
  assert.equal((await anon('POST', '/api/admin/senha/redefinir', { token: 'x'.repeat(43), password: 'outra-senha-boa-2026' })).status, 400, 'código inventado');
  assert.equal((await anon('POST', '/api/admin/senha/redefinir', { token: novo, password: 'curta' })).status, 400, 'senha fraca');

  const ok = await anon('POST', '/api/admin/senha/redefinir', { token: novo, password: 'senha-nova-da-revenda-26' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.username, email);
  assert.equal((await anon('POST', '/api/admin/senha/redefinir', { token: novo, password: 'mais-uma-senha-boa-26' })).status, 400, 'o link vale uma vez');
  assert.equal((await anon('POST', '/api/admin/login', { username: email, password: 'senha-antiga-da-revenda-1' })).status, 401, 'a senha velha caiu');
  await new Promise((r) => setTimeout(r, 2100)); // o cache curto dos usuários (2 s)
  assert.equal((await api(s.base, sessaoVelha)('GET', '/api/me')).status, 401, 'a sessão aberta com a senha velha caiu');
  const entra = await anon('POST', '/api/admin/login', { username: email, password: 'senha-nova-da-revenda-26' });
  assert.equal(entra.status, 200, JSON.stringify(entra.data));
  assert.equal(entra.data.user.mustChange, false, 'quem escolheu a senha não precisa trocar de novo');

  // o cliente final da revenda: o link abre na porta dele (/c/<identificador>/), e só nela
  const R = api(s.base, entra.data.token);
  const cli = await R('POST', '/api/revenda/clientes', { name: 'Padaria do Bairro', pessoa: 'pf', document: '529.982.247-25', contactEmail: 'dono@padaria.example.com', contactName: 'Dono da Padaria' });
  assert.equal(cli.status, 201, JSON.stringify(cli.data));
  {
    const slug = cli.data.cliente?.slug;
    const antes = caixa(dataDir).length;
    await anon('POST', '/api/admin/senha/esqueci', { username: 'dono@padaria.example.com', tenant: 'outro-endereco' });
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(caixa(dataDir).length, antes, 'no endereço de outra conta, nada sai');
    await anon('POST', '/api/admin/senha/esqueci', { username: 'dono@padaria.example.com' });
    const m = await esperar(() => { const x = caixa(dataDir); return x.length > antes ? x.at(-1) : null; });
    assert.ok(m, 'o cliente recebe');
    assert.ok(slug); assert.match(m.text, new RegExp(`/c/${slug}/#redefinir=`));
  }

  // a equipe da plataforma não recupera por aqui
  await anon('POST', '/api/admin/senha/esqueci', { username: 'superadmin@exemplo.test' });

  // o admin:reset na linha de comando, no mesmo banco
  const run = (...a) => spawnSync(process.execPath, ['scripts/admin-reset.mjs', ...a], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DATABASE_URL: '' }, encoding: 'utf8' });
  const lista = run('--list', 'revenda-esqueci');
  assert.equal(lista.status, 0, lista.stderr); assert.match(lista.stdout, /dona@revenda-esqueci/);
  assert.equal(run('ninguem@exemplo.test').status, 1);
  const rs = run(email);
  assert.equal(rs.status, 0, rs.stderr);
  const nova = /Senha nova de "[^"]+": (\S+)/.exec(rs.stdout)?.[1];
  assert.ok(nova, rs.stdout);
  assert.equal((await anon('POST', '/api/admin/login', { username: email, password: 'senha-nova-da-revenda-26' })).status, 401);
  const r2 = await anon('POST', '/api/admin/login', { username: email, password: nova });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.user.mustChange, true, 'a senha do admin:reset pede troca');
  const sp = run('--platform', 'superadmin');
  assert.equal(sp.status, 0, sp.stderr);
});

test('sem e-mail ligado: a rota responde 503 e a tela não mostra o link', { timeout: 60000 }, async (t) => {
  const dataDir = tmpDir('nexa-esqueci-off');
  const s = await boot({ DATA_DIR: dataDir, SMTP_URL: '', MAIL_OUTBOX: '0' });
  t.after(async () => { await s.stop?.(); cleanup(dataDir); });
  const anon = api(s.base);
  assert.deepEqual((await anon('GET', '/api/admin/senha')).data, { email: false });
  const r = await anon('POST', '/api/admin/senha/esqueci', { username: 'alguem@exemplo.test' });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /ainda não está ligada/);
});
