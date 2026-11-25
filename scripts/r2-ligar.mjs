#!/usr/bin/env node
// Liga o Cloudflare R2 no servidor do DIGITAL ISP (docs/SERVIDOR.md, "Bucket R2"). Roda NO SERVIDOR, na pasta do app, com as
// variáveis R2_* no ambiente (o ~/bin/gravar-r2 chama este script depois de perguntar as chaves). Faz, nesta ordem:
//   1. confere a conexão (ping) e grava, lê e apaga um arquivo de teste no bucket;
//   2. confere o endereço público (R2_PUBLIC_URL), se houver;
//   3. copia para o bucket os arquivos que hoje estão só no disco (imagens, vídeos, miniaturas e logos das telas).
// Não muda nada se o passo 1 falhar. Saída: 0 = pronto para ligar STORAGE_DRIVER=r2; 1 = algo falhou (a mensagem diz o quê).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { createStorage, KINDS } from '../server/storage.js';

const cfg = { ...config.storage, driver: 'r2' };
for (const [k, v] of Object.entries({ R2_BUCKET: cfg.bucket, 'R2_ACCOUNT_ID ou R2_ENDPOINT': cfg.endpoint, R2_ACCESS_KEY_ID: cfg.accessKeyId, R2_SECRET_ACCESS_KEY: cfg.secretAccessKey })) {
  if (!v) { console.error(`Falta ${k}.`); process.exit(1); }
}
const st = createStorage(cfg);
try {
  await st.ping({ timeoutMs: 15000 });
  const nome = `r2-teste-${Date.now()}.txt`;
  fs.mkdirSync(KINDS.graphics, { recursive: true });
  fs.writeFileSync(path.join(KINDS.graphics, nome), 'DIGITAL ISP: teste do R2');
  await st.put('graphics', nome);
  const h = await st.head('graphics', nome);
  if (!h) throw new Error('o arquivo de teste não apareceu no bucket');
  if (cfg.publicBaseUrl) {
    const r = await fetch(`${cfg.publicBaseUrl}/graphics/${nome}`).catch((e) => ({ ok: false, status: e.message }));
    console.log(r.ok ? `Endereço público ok: ${cfg.publicBaseUrl}` : `Atenção: o endereço público ${cfg.publicBaseUrl} não abriu o arquivo de teste (${r.status}). Confira o domínio do bucket.`);
  }
  await st.remove('graphics', nome);
  fs.rmSync(path.join(KINDS.graphics, nome), { force: true });
  console.log('Conexão com o R2 ok (gravar, ler e apagar).');
} catch (e) { console.error(`O R2 não respondeu como esperado: ${e.message}`); process.exit(1); }

let n = 0; let bytes = 0; let erros = 0;
for (const kind of ['graphics', 'media', 'thumbs']) {
  const dir = KINDS[kind]; if (!dir || !fs.existsSync(dir)) continue;
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome); const s = fs.statSync(p); if (!s.isFile()) continue;
    try { if (!(await st.head(kind, nome))) { await st.put(kind, nome); n++; bytes += s.size; } } catch (e) { erros++; console.error(`não copiou ${kind}/${nome}: ${e.message}`); }
  }
}
console.log(`Arquivos copiados para o R2: ${n} (${Math.round(bytes / 1048576)} MB)${erros ? `, ${erros} com erro` : ''}.`);
process.exit(erros ? 1 : 0);
