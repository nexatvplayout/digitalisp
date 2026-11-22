// O estresse do volume lento num processo à parte (o tamanho do threadpool do libuv é do processo: UV_THREADPOOL_SIZE na subida).
// Uso: node estresse-disco.mjs <pasta-lenta> <pasta-hls> <segundos> [modo]
//   modo "antes": os escritores como até a 0.5.166 (gravações síncronas na thread principal: o diário com writeFileSync + renameSync
//   e o grafo com writeFileSync; o download com o fs.createWriteStream);
//   modo "depois": os de agora (createStateFile, writeFileAtomic, SyncedWriter de server/escrita.js).
// No ar ao mesmo tempo: um "alimentador" (pedaços de MPEG-TS a cada 40 ms por um pipe, como o fan-out do motor), um "segmentador"
// gravando um segmento de 2 s no HLS (disco rápido) e um cliente pedindo o segmento novo pelo express.static, como o /hls do servidor.
// O volume lento: tempestades de 3 s a cada 5 s (test/helpers/disco-lento.js). Saída: uma linha JSON com as medidas.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import express from 'express';
import { slowDisk } from './disco-lento.js';

const [slow, hls, secs = '20', mode = 'depois'] = process.argv.slice(2);
const disco = await slowDisk({ dir: slow, storm: { everyMs: 5000, lengthMs: 3000 }, active: false });
// as pastas antes do volume ficar lento (como no servidor: elas nascem na subida)
for (const d of ['bipe', 'grafos', 'media']) fs.mkdirSync(path.join(slow, d), { recursive: true });
disco.on();
const { createStateFile, writeFileAtomic, SyncedWriter } = await import('../../server/escrita.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = Date.now() + Number(secs) * 1000;
const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
const res = { mode, pool: Number(process.env.UV_THREADPOOL_SIZE) || 4, saves: 0, graphs: 0, downloadMB: 0, segs: [], hlsFails: 0, feederLateMs: 0 };

// o ar: o "alimentador" (um pipe com pedaços a cada 40 ms) e o "segmentador" (um segmento a cada 2 s no disco rápido)
fs.mkdirSync(hls, { recursive: true });
let seq = 0;
const segTimer = setInterval(() => { seq += 1; fs.writeFile(path.join(hls, `seg_${seq}.ts`), Buffer.alloc(512 * 1024, 0x47), () => {}); }, 2000);
let lastFeed = performance.now();
const feedTimer = setInterval(() => { const t = performance.now(); res.feederLateMs = Math.max(res.feederLateMs, t - lastFeed - 40); lastFeed = t; }, 40);
const app = express();
app.use('/hls', express.static(hls, { etag: false }));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const client = (async () => {
  let seen = 0;
  while (Date.now() < until) {
    if (seq > seen) {
      seen = seq;
      const t0 = performance.now();
      try { const r = await fetch(`${base}/hls/seg_${seen}.ts`, { signal: AbortSignal.timeout(20_000) }); await r.arrayBuffer(); if (r.status !== 200) res.hlsFails += 1; } catch { res.hlsFails += 1; }
      res.segs.push(performance.now() - t0);
    }
    await sleep(100);
  }
})();

// os escritores de fundo no volume lento
const state = { current: { stage: 'encoding', n: 0 }, pendingDeletes: [] };
const journal = createStateFile(path.join(slow, 'bipe', 'state.json'));
const saver = (async () => {
  while (Date.now() < until) {
    state.current.n += 1;
    if (mode === 'antes') {
      fs.writeFileSync(path.join(slow, 'bipe', 'state.json.tmp'), JSON.stringify(state));
      fs.renameSync(path.join(slow, 'bipe', 'state.json.tmp'), path.join(slow, 'bipe', 'state.json'));
    } else journal.save(state);
    res.saves += 1;
    await sleep(300);
  }
})();
const grapher = (async () => {
  const text = 'aeval=exprs=val(ch):c=same,'.repeat(1500);
  while (Date.now() < until) {
    const f = path.join(slow, 'grafos', `grafo-${res.graphs}.txt`);
    if (mode === 'antes') fs.writeFileSync(f, text); else await writeFileAtomic(f, text);
    res.graphs += 1;
    await sleep(1500);
  }
})();
const downloader = (async () => {
  // três downloads ao mesmo tempo para o cache, em pedaços de 64 KiB (o corpo de um GetObject)
  await Promise.all([0, 1, 2].map(async (k) => {
    const file = path.join(slow, 'media', `dl-${k}.part`);
    const ws = mode === 'antes' ? fs.createWriteStream(file) : new SyncedWriter(file, { budget: 4 * 1024 * 1024 });
    const chunk = Buffer.alloc(64 * 1024, k);
    while (Date.now() < until) {
      if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
      res.downloadMB += chunk.length / 1048576;
      await sleep(5);
    }
    await new Promise((r) => ws.end(r));
  }));
})();

await Promise.all([client, saver, grapher, downloader]);
await journal.flush();
clearInterval(segTimer); clearInterval(feedTimer);
h.disable();
server.close();
const sorted = [...res.segs].sort((a, b) => a - b);
const out = {
  mode: res.mode, pool: res.pool, lagMaxMs: Math.round(h.max / 1e6), lagP99Ms: Math.round(h.percentile(99) / 1e6), feederLateMs: Math.round(res.feederLateMs),
  hlsP50Ms: Math.round(sorted[Math.floor(sorted.length / 2)] || 0), hlsMaxMs: Math.round(sorted[sorted.length - 1] || 0), hlsN: sorted.length, hlsFails: res.hlsFails,
  saves: res.saves, graphs: res.graphs, downloadMB: Math.round(res.downloadMB), disco: disco.stats(),
};
await disco.close();
console.log(JSON.stringify(out));
process.exit(0);
