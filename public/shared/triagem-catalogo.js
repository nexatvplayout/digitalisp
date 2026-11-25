// NEXA Telas, chamada de senha: os níveis do Protocolo de Manchester (cor, nome do nível, tempo-alvo de fábrica) e o
// catálogo curto de "tipo de problema" da aba Triagem (docs/TELAS.md §10). O tipo de problema serve SÓ para sugerir a cor
// na tela de quem faz a triagem: não vai ao servidor, não é guardado, não aparece na TV nem no log (o motivo do atendimento
// nunca é registrado). A decisão da cor é sempre do profissional. Os tempos-alvo daqui são o padrão de fábrica da ordem de
// chamada (server/telas-senha-core.js); cada repartição pode mudar os seus.

/** Os níveis, do mais grave ao menos. targetMin: o tempo-alvo de fábrica (vermelho = imediato, sempre 0). */
export const TRIAGE_LEVELS = [
  { key: 'vermelho', color: 'Vermelho', level: 'Emergência', targetMin: 0 },
  { key: 'laranja', color: 'Laranja', level: 'Muito urgente', targetMin: 10 },
  { key: 'amarelo', color: 'Amarelo', level: 'Urgente', targetMin: 60 },
  { key: 'verde', color: 'Verde', level: 'Pouco urgente', targetMin: 120 },
  { key: 'azul', color: 'Azul', level: 'Não urgente', targetMin: 240 },
];
/** O tempo-alvo de fábrica de cada cor (minutos). */
export const TRIAGE_TARGETS = Object.freeze(Object.fromEntries(TRIAGE_LEVELS.map((l) => [l.key, l.targetMin])));
export const levelOf = (key) => TRIAGE_LEVELS.find((l) => l.key === key) || null;
/** "Laranja · Muito urgente · até 10 min" (min = o tempo-alvo da repartição, se diferente do de fábrica). */
export function levelLabel(key, min) {
  const l = levelOf(key);
  if (!l) return String(key ?? '');
  const m = min ?? l.targetMin;
  return `${l.color} · ${l.level} · ${l.key === 'vermelho' ? 'imediato' : `até ${m} min`}`;
}

/** Os tipos de problema (exemplos do protocolo), cada um com a cor sugerida. */
export const TRIAGE_PROBLEMS = [
  { key: 'pcr', label: 'Parada cardiorrespiratória', risk: 'vermelho' },
  { key: 'infarto', label: 'Infarto (suspeita)', risk: 'vermelho' },
  { key: 'avc', label: 'AVC (suspeita)', risk: 'vermelho' },
  { key: 'trauma-grave', label: 'Trauma grave', risk: 'vermelho' },
  { key: 'falta-ar-severa', label: 'Falta de ar severa', risk: 'vermelho' },
  { key: 'dor-peito', label: 'Dor no peito intensa', risk: 'laranja' },
  { key: 'sangramento', label: 'Sangramento ativo importante', risk: 'laranja' },
  { key: 'convulsao', label: 'Convulsão recente', risk: 'laranja' },
  { key: 'fratura-exposta', label: 'Fratura exposta', risk: 'laranja' },
  { key: 'febre-alta', label: 'Febre alta persistente', risk: 'amarelo' },
  { key: 'dor-abdominal', label: 'Dor abdominal moderada', risk: 'amarelo' },
  { key: 'vomitos', label: 'Vômitos contínuos', risk: 'amarelo' },
  { key: 'desmaio', label: 'Desmaio', risk: 'amarelo' },
  { key: 'dor-leve', label: 'Dor leve', risk: 'verde' },
  { key: 'torcao', label: 'Torção simples', risk: 'verde' },
  { key: 'resfriado', label: 'Resfriado', risk: 'verde' },
  { key: 'infeccao-leve', label: 'Pequena infecção sem febre alta', risk: 'verde' },
  { key: 'receita', label: 'Troca de receita', risk: 'azul' },
  { key: 'cronica', label: 'Queixa crônica antiga', risk: 'azul' },
  { key: 'exames', label: 'Pedido de exames de rotina', risk: 'azul' },
];
/** "Outro": sem sugestão, quem faz a triagem escolhe a cor. */
export const TRIAGE_OTHER = { key: 'outro', label: 'Outro (escolher a cor)', risk: null };
/** A cor sugerida para um tipo de problema (null para "Outro" ou desconhecido). */
export const suggestRisk = (problemKey) => TRIAGE_PROBLEMS.find((p) => p.key === problemKey)?.risk ?? null;
/** Busca sem acento e sem caixa no nome do problema, no nome da cor e no do nível. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function searchProblems(q) {
  const f = fold(q).trim();
  if (!f) return TRIAGE_PROBLEMS;
  return TRIAGE_PROBLEMS.filter((p) => { const l = levelOf(p.risk); return fold(`${p.label} ${l.color} ${l.level}`).includes(f); });
}
