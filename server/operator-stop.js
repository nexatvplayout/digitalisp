// Motor parado pelo operador (Parar, com a confirmação dupla): a marca fica no banco (tabela settings, chave
// "engine.stopped.<id do canal>") e sobrevive a reinícios e deploys: na subida o canal não liga o motor.
// Sem a marca o canal segue como sempre. Queda ou erro do motor não grava nada: só a parada pelo painel ou pelo app.
// Iniciar ou Reiniciar apagam a marca. Não precisa de migração: a tabela settings existe nos dois bancos.
import { db } from './db.js';

const PREFIX = 'engine.stopped.';
const marks = new Map(); // slug -> { channelId, at, by }

/** Lê as marcas do banco (uma vez, na subida, depois de carregar os canais). registry: o Registry com os canais. */
export async function loadOperatorStops(registry) {
  marks.clear();
  const rows = await db.all(`SELECT key, value FROM settings WHERE key LIKE '${PREFIX}%'`);
  for (const r of rows) {
    const id = Number(String(r.key).slice(PREFIX.length));
    const e = registry.byId(id);
    if (!e) { db.run('DELETE FROM settings WHERE key=?', [r.key]).catch(() => {}); continue; } // canal que não existe mais
    let v = {};
    try { v = JSON.parse(r.value) || {}; } catch { /* valor antigo ou corrompido: vale a marca */ }
    marks.set(e.channel.slug, { channelId: id, at: Number(v.at) || null, by: v.by || null });
  }
  return [...marks.keys()];
}

/** Canais parados pelo operador (para a tela azul de fora do ar dos players, desde a subida). */
export const operatorStoppedSlugs = () => [...marks.keys()];

/** O operador parou este canal (e a marca ainda vale)? */
export const isStoppedByOperator = (slug) => marks.has(slug);

/** { at, by } da parada, para o painel; null se o canal não está parado pelo operador. */
export function operatorStopInfo(slug) {
  const m = marks.get(slug);
  return m ? { at: m.at, by: m.by } : null;
}

/** Grava a parada pelo operador (depois de o motor parar). */
export async function markOperatorStop(channel, by) {
  const m = { channelId: channel.id, at: Date.now(), by: by || null };
  await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [PREFIX + channel.id, JSON.stringify({ at: m.at, by: m.by })]);
  marks.set(channel.slug, m);
}

/** Apaga a marca (Iniciar, Reiniciar). Devolve true se havia marca. */
export async function clearOperatorStop(channel) {
  const had = marks.delete(channel.slug);
  await db.run('DELETE FROM settings WHERE key=?', [PREFIX + channel.id]);
  return had;
}

/** Canal excluído: apaga a marca dele, se houver. */
export function forgetOperatorStop(slug) {
  const m = marks.get(slug);
  if (!m) return;
  marks.delete(slug);
  db.run('DELETE FROM settings WHERE key=?', [PREFIX + m.channelId]).catch(() => {});
}
