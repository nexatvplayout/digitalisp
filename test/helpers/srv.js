// Ajudantes dos testes de plataforma: sobe o servidor de verdade (porta livre, banco temporário) e fala com a API.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, removeDir, untrackDir } from './tmp.js'; // pastas nexa-* apagadas no fim, mesmo com o teste falhando

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

export const SUPER = { user: 'superadmin', password: 'super-senha-longa-123' };

// servidores de teste ainda no ar quando o processo do arquivo sai (o teste falhou antes do stop): derrubados ANTES de
// apagar as pastas (prependListener: roda antes da limpeza do tmp.js), senão seguem vivos segurando o banco e a memória
const live = new Set();
/** Derruba o processo e os filhos dele, sem esperar (handler de saída). */
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } }
}
process.prependListener('exit', () => { for (const p of live) if (p.exitCode === null && !p.signalCode) killTree(p.pid); });

/** Sobe o servidor (sem demo, sem RTMP, motores parados). No Windows o processo às vezes morre ao subir: tenta de novo. */
export async function boot(env = {}) {
  const dataDir = env.DATA_DIR || tmpDir('nexa-plat');
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = env.PORT ? Number(env.PORT) : await freePort(); // PORT fixa: religar o "mesmo" servidor (ex.: central trocando a chave)
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      cwd: root,
      env: {
        ...process.env, PORT: String(port), RTMP_INGEST: '0', SEED_DEMO: '0', ENGINE_AUTOSTART: '0', DATA_DIR: dataDir,
        ADMIN_PASSWORD: 'senha-inicial-longa', SUPERADMIN_PASSWORD: SUPER.password, SESSION_SECRET: 'segredo-do-teste-plataforma', BILLING_MOCK: '1',
        // a tradução das legendas (server/legendas-traducao.js) fica desligada nos servidores de teste: com a OPENAI_API_KEY falsa e
        // as Legendas por IA ligadas, ela iria à OpenAI de verdade. Quem testa a tradução liga (CAPTIONS_TRANSLATE: '1') com o provedor falso
        CAPTIONS_TRANSLATE: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    live.add(p);
    p.once('exit', () => live.delete(p));
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    // um servidor esquecido (o teste falhou antes do stop) não prende o processo do arquivo: o processo e os pipes não
    // seguram o laço de eventos, e o gancho de 'exit' acima derruba a árvore. No Windows os FFmpeg filhos herdam os pipes
    // e, órfãos, os manteriam abertos para sempre
    p.unref(); p.stdout.unref?.(); p.stderr.unref?.();
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60 && p.exitCode === null && !p.signalCode; i++) {
      try {
        if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3000) })).ok) {
          return {
            base, port, dataDir, out: () => out,
            stop: () => new Promise((r) => {
              if (p.exitCode !== null || p.signalCode) return r();
              p.ref(); // esperando a saída: o laço fica vivo até ela (senão o arquivo terminaria com a promessa pendente)
              const late = setTimeout(() => { if (p.exitCode === null && !p.signalCode) killTree(p.pid); r(); }, 5000);
              p.once('exit', () => { clearTimeout(late); r(); });
              // Windows: não há SIGINT entre processos (kill = TerminateProcess só do node), e os FFmpeg dos motores
              // ficavam órfãos no ar segurando os pipes; derruba a árvore inteira. Fora dele, o desligamento normal
              if (process.platform === 'win32') killTree(p.pid); else p.kill('SIGINT');
            }),
          };
        }
      } catch { /* subindo */ }
      await sleep(500);
    }
    last = out;
    if (p.exitCode === null && !p.signalCode) { killTree(p.pid); break; }
  }
  throw new Error(`servidor não subiu:\n${last}`);
}

/** Apaga o diretório temporário. No Windows os arquivos podem demorar a ser liberados após parar o servidor: nunca derruba o teste. */
export const cleanup = (dir) => { if (removeDir(dir, { retries: 8, delay: 400 })) untrackDir(dir); /* senão: a saída do processo tenta de novo (tmp.js) */ };

/** api(base, token)(método, url, corpo, headers) -> { status, data, headers } */
export const api = (base, token) => async (method, url, body, headers = {}) => {
  const res = await fetch(`${base}${url}`, {
    signal: AbortSignal.timeout(30000), method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => null) : await res.text(), headers: res.headers };
};

/** GET com Host personalizado (domínio do cliente), que o fetch não deixa trocar com segurança. */
export const getWithHost = (base, urlPath, host, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const req = http.request({ host: u.hostname, port: u.port, path: urlPath, method: 'GET', headers: { host, ...headers } }, (res) => {
    let buf = '';
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let data = buf; try { data = JSON.parse(buf); } catch { /* texto */ } resolve({ status: res.statusCode, data }); });
  });
  req.on('error', reject);
  req.end();
});

export async function platformLogin(base, cred = SUPER) {
  const r = await api(base)('POST', '/api/platform/login', { username: cred.user, password: cred.password });
  if (r.status !== 200) throw new Error(`login da plataforma falhou: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

/** Cria um cliente pela API da plataforma e devolve { id, slug, token } (token do administrador do cliente). */
export async function newTenant(P, base, { slug, name, planCode, adminUsername, adminPassword = 'senha-do-cliente-123', status } = {}) {
  const r = await P('POST', '/api/platform/tenants', { name: name || `Cliente ${slug}`, slug, planCode, contactName: `Contato ${slug}`, contactEmail: `contato@${slug}.example.com`, adminUsername: adminUsername || `admin.${slug}`, adminPassword, mustChange: false, status });
  if (r.status !== 201) throw new Error(`criar cliente ${slug}: ${r.status} ${JSON.stringify(r.data)}`);
  const login = await api(base)('POST', '/api/admin/login', { tenant: slug, username: adminUsername || `admin.${slug}`, password: adminPassword });
  if (login.status !== 200) throw new Error(`login do cliente ${slug}: ${login.status} ${JSON.stringify(login.data)}`);
  return { id: r.data.tenant.id, slug, token: login.data.token, username: adminUsername || `admin.${slug}`, password: adminPassword, api: api(base, login.data.token) };
}

/** Cria um plano e devolve o objeto. limits/features parciais; features não citadas ficam desligadas. */
export async function newPlan(P, { code, limits = {}, features = {}, priceCents = 4990, interval = 'month', trialDays = 7, ...rest }) {
  const r = await P('POST', '/api/platform/plans', { code, name: `Plano ${code}`, priceCents, interval, trialDays, limits, features, ...rest });
  if (r.status !== 201) throw new Error(`criar plano ${code}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export const ALL_FEATURES = { app: true, shop: true, polls: true, scte: true, graphics: true, rtmpIngest: true, customDomain: true, api: true };
