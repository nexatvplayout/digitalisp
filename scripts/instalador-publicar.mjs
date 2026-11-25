// Põe o APK do instalador pelo celular no servidor (server/assets/instalador/), em www.digitalisp.com.br/instalador
// (server/telas-tv.js). Rodar depois do build de release de apps-celular/instalador (LEIAME.md de lá):
//   node scripts/instalador-publicar.mjs [caminho do APK]
// Padrão: apps-celular/instalador/app/build/outputs/apk/release/app-release.apk (assinado; sem keystore.properties,
// só com -Pinstalador.assinarComDebug=true). versionCode e versionName vêm do build.gradle.kts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'apps-celular/instalador');
const src = path.resolve(process.argv[2] || path.join(base, 'app/build/outputs/apk/release/app-release.apk'));
const gradle = fs.readFileSync(path.join(base, 'app/build.gradle.kts'), 'utf8');
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
if (!versionCode || !versionName) throw new Error('versionCode/versionName não encontrados no build.gradle.kts');
const buf = fs.readFileSync(src);
if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`${src} não parece um APK`);
if (/unsigned/.test(path.basename(src))) throw new Error('APK sem assinatura: o celular não instala (veja o LEIAME do instalador)');
const dir = path.join(root, 'server/assets/instalador');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
const file = 'DIGITAL-ISP-Instalador.apk';
fs.writeFileSync(path.join(dir, file), buf);
const meta = { versionCode, versionName, file, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Instalador ${versionName} (versionCode ${versionCode}, ${(buf.length / 1048576).toFixed(1)} MB) em server/assets/instalador/`);
