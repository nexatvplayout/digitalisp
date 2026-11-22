// B1 do test/legendas-ia.test.js numa Worker thread: conferir/embutir/verificar o MP4 de 3 h com o laço desta thread
// medido. Fora do test runner: dentro do node --test os ganchos async dele deixam cada promise ~10× mais cara e os laços
// por amostra do cc608 pareciam segurar o laço 60–100 ms (aqui, como em produção, ficam em ~10 ms).
import { parentPort, workerData } from 'node:worker_threads';
import * as cc from '../../server/cc608.js';
import { medidor } from './laco.js';

const { file, out, cues, fps } = workerData;
const laco = medidor({ passo: 2 });
const t0 = performance.now();
try {
  const info = await cc.inspectMp4(file);
  const r = await cc.embed608(file, out, cues, { fps });
  const v = await cc.verifyMp4(file, out, r.expect);
  laco.parar();
  parentPort.postMessage({ info, frames: r.frames, rate: r.rate, v, total: performance.now() - t0, bloqueioMax: laco.bloqueioMax, p99: laco.percentil(99), paradaMax: laco.paradaMax, resumo: laco.resumo() });
} catch (err) {
  laco.parar();
  parentPort.postMessage({ error: err?.stack || String(err) });
}
