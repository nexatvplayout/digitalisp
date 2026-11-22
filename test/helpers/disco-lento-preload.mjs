// O volume lento dentro do servidor de teste (--import deste arquivo; test/helpers/disco-lento.js): DISCO_LENTO_DIR (o DATA_DIR),
// DISCO_LENTO_MS (a espera constante de cada gravação: a síncrona prende a thread que chamou, a assíncrona uma thread do
// threadpool) ou DISCO_LENTO_TEMPESTADE="cada,duração" em ms (o freio do kernel: dentro da tempestade a gravação espera até ela
// acabar). Desligado até o teste criar DATA_DIR/.disco-lento (a subida e a 1ª partida do canal rápidas). DISCO_LENTO_STATS:
// arquivo (fora do DATA_DIR) com as contas, a cada 250 ms.
import fs from 'node:fs';
import path from 'node:path';
import { slowDisk } from './disco-lento.js';

const dir = process.env.DISCO_LENTO_DIR;
// só no processo do servidor (os processos Node filhos dele, como o do 5.1 convertido, herdam o NODE_OPTIONS)
if (dir && /server[\\/]index\.js$/.test(process.argv[1] || '')) {
  const ms = Number(process.env.DISCO_LENTO_MS) || 1500;
  const [every, length] = String(process.env.DISCO_LENTO_TEMPESTADE || '').split(',').map(Number);
  const storm = every > 0 && length > 0 ? { everyMs: every, lengthMs: length } : null;
  const disco = await slowDisk({ dir, syncMs: ms, asyncMs: ms, storm, exclude: [path.join(dir, 'digitalisp.db')], active: false });
  globalThis.__discoLento = disco;
  const marker = path.join(dir, '.disco-lento');
  const stats = process.env.DISCO_LENTO_STATS || null;
  const t = setInterval(() => {
    fs.stat(marker, (err) => { if (!err && !disco.active) disco.on(); else if (err && disco.active) disco.off(); });
    if (stats) fs.writeFile(stats, JSON.stringify({ active: disco.active, ...disco.stats() }), () => {});
  }, 250);
  t.unref();
}
