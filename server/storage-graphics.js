// Imagens do cliente no armazenamento (graphics/): logos e marcas d'água, cartelas e fundos do plantão, imagens da vitrine
// e do conteúdo do app, e os fundos das mídias. Contam na cota do plano e no medidor (docs/ARMAZENAMENTO.md), pelo dono
// no nome:
//   - t<cliente>-…: envio do cliente (server/graphics-files.js, ownerPrefix);
//   - mbg-<cliente>-…: fundo de um vídeo da biblioteca (server/media.js);
//   - cartela-<canal>-…: a arte das cartelas desenhada do CG (server/cartelas.js; uma por cartela, as antigas saem), pelo
//     dono do canal. Ela só conta: desenhar no MOSTRAR não é barrado pela cota (tiraria a cartela do ar).
// p-… é da plataforma e mural-… são fotos do público (somem em 7 dias): ficam fora. Os tamanhos vêm da listagem do
// armazenamento (pasta local ou R2) e ficam guardados GRAPHICS_TTL; quem grava uma imagem esquece a listagem
// (forgetGraphics). Se a listagem falhar, vale a última (ou nada): uma falha do R2 não trava envio nenhum.
// No armazenamento local o arquivo recebido já está na pasta durante a conferência da cota: ele fica "chegando"
// (holdIncoming) e não entra na soma até a resposta sair, senão contaria duas vezes (na pasta e na reserva).
import { db } from './db.js';
import { storage } from './storage.js';

export const GRAPHICS_TTL = 60_000;
const OWNER_RE = /^(?:t|mbg-)(\d+)-/;
const CARTELA_RE = /^cartela-(\d+)-/;
const prefixesOf = async (tenantId) => [
  `t${Number(tenantId)}-`, `mbg-${Number(tenantId)}-`,
  ...(await db.all('SELECT id FROM channels WHERE tenant_id = ?', [Number(tenantId)])).map((r) => `cartela-${Number(r.id)}-`),
];
const cache = new Map(); // tenantId -> { at, files: [{ name, size }] }
let all = null; // { at, files: [{ name, size }] }
const incoming = new Set(); // nomes recebidos ainda em conferência da cota

/** O arquivo recebido ainda está na conferência da cota: fora da soma até releaseIncoming. */
export const holdIncoming = (name) => { if (name) incoming.add(String(name)); };
export const releaseIncoming = (name) => { incoming.delete(String(name)); };

/** Esquece a listagem do cliente (e a da plataforma): uma imagem entrou ou saiu. Sem id: todas. */
export function forgetGraphics(tenantId = null) {
  if (tenantId == null) cache.clear(); else cache.delete(Number(tenantId));
  all = null;
}

const sum = (files) => files.reduce((s, f) => s + (incoming.has(f.name) ? 0 : Number(f.size) || 0), 0);

/** Bytes das imagens do cliente no armazenamento (listagem guardada GRAPHICS_TTL). */
export async function graphicsBytes(tenantId) {
  const id = Number(tenantId);
  if (!Number.isSafeInteger(id) || id < 1) return 0;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < GRAPHICS_TTL) return sum(hit.files);
  try {
    const files = [];
    for (const p of await prefixesOf(id)) for (const f of await storage.list('graphics', p)) files.push({ name: f.name, size: Number(f.size) || 0 });
    cache.set(id, { at: Date.now(), files });
    return sum(files);
  } catch (err) {
    console.warn(`[armazenamento] imagens do cliente ${id}: listagem falhou (${String(err.message).slice(0, 120)}); vale a última`);
    return hit ? sum(hit.files) : 0;
  }
}

/** Bytes das imagens de todos os clientes, numa listagem só (o total da plataforma; guardada GRAPHICS_TTL). */
export async function graphicsBytesAll() {
  if (!all || Date.now() - all.at >= GRAPHICS_TTL) {
    try {
      all = { at: Date.now(), files: (await storage.list('graphics', '')).map((f) => ({ name: f.name, size: Number(f.size) || 0 })) };
    } catch (err) {
      console.warn(`[armazenamento] imagens: listagem falhou (${String(err.message).slice(0, 120)}); vale a última`);
      if (!all) return new Map();
    }
  }
  const owner = new Map((await db.all('SELECT id, tenant_id FROM channels')).map((r) => [Number(r.id), Number(r.tenant_id)])); // canal -> cliente
  const byTenant = new Map();
  for (const f of all.files) {
    if (incoming.has(f.name)) continue;
    const m = OWNER_RE.exec(f.name);
    const c = m ? null : CARTELA_RE.exec(f.name);
    const tid = m ? Number(m[1]) : c ? owner.get(Number(c[1])) : null;
    if (tid) byTenant.set(tid, (byTenant.get(tid) || 0) + f.size);
  }
  return byTenant;
}
