// Configuração do servidor do DIGITAL ISP, toda por variável de ambiente (veja .env.exemplo).
// Segredos (senhas, chaves do R2, endereço do banco) ficam só no ambiente: nunca no repositório.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { NIC_BR, normalizeServers } from './ntp.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve um binário: variável de ambiente > PATH do sistema > pacote npm (*-static), se houver. */
function resolveBinary(envVar, name, npmPackage, pick = (m) => m) {
  if (process.env[envVar]) return process.env[envVar];
  const probe = spawnSync(name, ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) return name;
  try {
    const p = pick(require(npmPackage));
    if (p && fs.existsSync(p)) return p;
  } catch { /* pacote opcional ausente */ }
  return null;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  version: readJson(path.join(root, 'package.json'))?.version || '0.0.0',

  // só semeiam o primeiro usuário da revenda padrão (id 1); depois disso a senha vive no banco
  adminUser: (process.env.ADMIN_USER || 'admin').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // Plataforma (equipe DIGITAL ISP)
  platform: {
    superadminUser: (process.env.SUPERADMIN_USER || 'superadmin').trim().toLowerCase(),
    superadminPassword: process.env.SUPERADMIN_PASSWORD || '',
    // a revenda padrão (id 1), criada no primeiro boot: a própria DIGITAL ISP vendendo direto
    defaultTenantName: (process.env.PLATFORM_DEFAULT_TENANT_NAME || 'DIGITAL ISP').trim(),
    host: (process.env.PLATFORM_HOST || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''),
    // endereço público (https) que as telas e os links usam; vazio = o Host do pedido
    publicUrl: (process.env.PLATFORM_PUBLIC_URL || '').replace(/\/$/, ''),
    // endereço principal (ex.: www.digitalisp.com.br): o mesmo endereço sem www é redirecionado para ele
    canonicalHost: (process.env.CANONICAL_HOST || '').trim().toLowerCase(),
  },

  dataDir,
  dbFile: path.join(dataDir, 'digitalisp.db'),
  mediaDir: process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(dataDir, 'media'),
  thumbsDir: path.join(dataDir, 'thumbs'),
  graphicsDir: path.join(dataDir, 'graphics'),

  // Postgres em produção; sem DATABASE_URL, SQLite em DATA_DIR/digitalisp.db
  databaseUrl: process.env.DATABASE_URL || null,

  // Armazenamento: local (DATA_DIR) ou Cloudflare R2 (API S3), com o disco local como cache
  storage: {
    driver: process.env.STORAGE_DRIVER === 'r2' ? 'r2' : 'local',
    bucket: process.env.R2_BUCKET || '',
    endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    publicBaseUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
    cacheMaxBytes: Number(process.env.CACHE_MAX_GB || 20) * 1024 ** 3,
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === '1',
    readHttp: process.env.R2_READ_HTTP === '1',
    storeBucket: '',
  },

  http: {
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
    // atrás de um túnel da Cloudflare (cloudflared na mesma máquina): o IP real vem no CF-Connecting-IP (server/clientip.js)
    cfTunnel: process.env.CF_TUNNEL === '1',
    // onde escutar: 127.0.0.1 atrás do túnel (nenhuma porta pública); vazio = todas as interfaces
    host: process.env.HOST || '',
  },

  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024,
  allowedExt: ['.mp4', '.mkv', '.mov', '.m4v', '.webm'],
  // o FFmpeg prepara as imagens das telas (tvcorp-midia.js) e confere vídeos; opcional em desenvolvimento
  ffmpeg: resolveBinary('FFMPEG_PATH', 'ffmpeg', 'ffmpeg-static'),
  ffprobe: resolveBinary('FFPROBE_PATH', 'ffprobe', 'ffprobe-static', (m) => m.path),

  // espaço livre mínimo antes de baixar um arquivo do R2 para o cache local
  record: { minFreeBytes: Number(process.env.MIN_FREE_GB || 2) * 1024 ** 3 },

  // relógio por NTP: as telas mudam de grade no horário mesmo sem internet, com a hora certa guardada
  ntp: {
    enabled: process.env.NTP_SYNC !== '0' && !process.env.NODE_TEST_CONTEXT,
    servers: process.env.NTP_SERVERS ? normalizeServers(process.env.NTP_SERVERS) : NIC_BR,
    intervalMin: Math.min(1440, Math.max(1, Math.floor(Number(process.env.NTP_INTERVAL_MIN) || 15))),
  },

  // chave que assina as sessões do painel; fixa, as sessões sobrevivem a reinícios e réplicas
  sessionSecret: process.env.SESSION_SECRET || '',

  // herança do NEXA: a edição local (Windows) não existe no DIGITAL ISP
  edge: { enabled: false },
};

if (config.production) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('Em produção defina ADMIN_PASSWORD com pelo menos 12 caracteres.');
  if (!process.env.SUPERADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD.length < 12) throw new Error('Em produção defina SUPERADMIN_PASSWORD com pelo menos 12 caracteres.');
  if (!config.sessionSecret || config.sessionSecret.length < 32) throw new Error('Em produção defina SESSION_SECRET com pelo menos 32 caracteres.');
}

for (const d of [config.dataDir, config.mediaDir, config.thumbsDir, config.graphicsDir]) fs.mkdirSync(d, { recursive: true });
