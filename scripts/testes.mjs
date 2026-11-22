// Roda uma bateria de testes: "unidade" (rápida, sem subir o servidor) ou "servidor" (sobe o servidor de verdade).
// Uma bateria pesada por vez (regra herdada). Uso: node scripts/testes.mjs unidade|servidor
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const kind = process.argv[2] === 'servidor' ? 'servidor' : 'unidade';
const SERVIDOR = /(servidor|integracao|licenca|imagem-offline|telas-pg)/;
const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js'))
  .filter((f) => (kind === 'servidor') === SERVIDOR.test(f)).map((f) => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
