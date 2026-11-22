// Põe o APK do app das telas no servidor (server/assets/telas-app/), para as TV box atualizarem sozinhas
// (server/telas-app.js, docs/TELAS.md §23). Rodar depois do build do android-telas/:
//   node scripts/telas-app-publicar.mjs [caminho do APK]
// Padrão: android-telas/app/build/outputs/apk/release/app-release.apk (desde a 1.3.1, 22/11: o de depuração é bem mais
// lento na TV box; o release sai com a mesma chave de depuração das versões já instaladas quando não há keystore.properties; um
// APK com outra assinatura o Android recusa por cima do instalado). versionCode e versionName vêm do build.gradle.kts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] || path.join(root, 'android-telas/app/build/outputs/apk/release/app-release.apk'));
const gradle = fs.readFileSync(path.join(root, 'android-telas/app/build.gradle.kts'), 'utf8');
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
if (!versionCode || !versionName) throw new Error('versionCode/versionName não encontrados no build.gradle.kts');
const buf = fs.readFileSync(src);
if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`${src} não parece um APK`);
const dir = path.join(root, 'server/assets/telas-app');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'NEXA-Telas.apk'), buf);
const meta = { versionCode, versionName, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`APK ${versionName} (versionCode ${versionCode}, ${(buf.length / 1048576).toFixed(1)} MB) em server/assets/telas-app/`);
