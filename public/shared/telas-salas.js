// NEXA Telas · salas e consultórios, etapas do atendimento e pedidos de apoio (docs/TELAS.md §26 a §31). O catálogo comum
// do servidor (server/telas-salas.js), da página da repartição (public/reparticao/rep-salas.js), da página da sala e do
// Painel da Prefeitura. Sem dependências.

/** Os tipos de sala. "consultorio" marca a 1ª chamada médica (porta–médico nos indicadores e o fim do tempo-alvo). */
export const ROOM_KINDS = [
  { key: 'consultorio', label: 'Consultório' },
  { key: 'classificacao', label: 'Classificação de risco' },
  { key: 'medicacao', label: 'Medicação' },
  { key: 'exames', label: 'Raio-X e exames' },
  { key: 'reavaliacao', label: 'Reavaliação' },
  { key: 'sala', label: 'Sala' },
  { key: 'guiche', label: 'Guichê' },
  { key: 'recepcao', label: 'Recepção' },
  { key: 'outro', label: 'Outro' },
];
export const ROOM_KIND_KEYS = ROOM_KINDS.map((k) => k.key);
export const roomKindLabel = (k) => ROOM_KINDS.find((x) => x.key === k)?.label || 'Sala';

/** A situação de cada sala: Disponível (pode receber), Pausa (não recebe pelo automático), Ocupada (com paciente). */
export const ROOM_STATES = [
  { key: 'available', label: 'Disponível' },
  { key: 'pause', label: 'Pausa' },
  { key: 'busy', label: 'Ocupada' },
];
export const ROOM_STATE_KEYS = ROOM_STATES.map((s) => s.key);
export const roomStateLabel = (k) => ROOM_STATES.find((x) => x.key === k)?.label || k;

/** O que a sala pede ao apoio, de fábrica (cada repartição troca a lista). */
export const SUPPORT_DEFAULT = Object.freeze(['Maqueiro', 'Limpeza', 'Segurança', 'Enfermagem']);
export const SUPPORT_STATUS = { open: 'Aberto', accepted: 'A caminho', done: 'Concluído', cancelled: 'Cancelado' };

/** As etapas de exemplo de uma UPA (cada etapa aponta uma fila; quem cria escolhe as filas). */
export const FLOW_EXAMPLE = Object.freeze(['Recepção', 'Classificação', 'Consultório', 'Medicação e exames', 'Reavaliação']);

/**
 * Quem chama cada etapa (20/11, do dono): a recepção no painel (como sempre), só o profissional pela página da sala (o
 * gestor chama por exceção, com registro) ou o sistema sozinho entre as salas Disponíveis dos grupos da etapa.
 */
export const STAGE_MODES = [
  { key: 'recepcao', label: 'Recepção', hint: 'a recepção ou o atendimento chama e encaminha no painel' },
  { key: 'sala', label: 'Profissional da sala', hint: 'só a página da sala (no celular) chama; no painel a senha fica aguardando o profissional' },
  { key: 'auto', label: 'Automático', hint: 'o sistema manda para a sala Disponível do grupo, a livre há mais tempo primeiro' },
];
export const STAGE_MODE_KEYS = STAGE_MODES.map((m) => m.key);
export const stageModeLabel = (k) => STAGE_MODES.find((x) => x.key === k)?.label || 'Recepção';

/**
 * A situação da chamada: chamada (esperando a pessoa chegar), chegou (confirmada; em atendimento). Sem a confirmação
 * exigida e sem o "chegou", a senha chamada é só "em atendimento", como antes.
 */
export const CALL_STATES = { called: 'Chamado', arrived: 'Chegou · em atendimento', serving: 'Em atendimento' };

export const SALAS_LIMITS = Object.freeze({
  roomName: 40, rooms: 60, groups: 20, groupName: 40, groupServices: 12,
  flowStages: 8, stageName: 30, supportKinds: 12, supportKind: 30, supportWho: 40,
  estimateText: 160, estimateHoursMin: 1, estimateHoursMax: 12,
});

/** Minutos em texto curto ("45 min", "2 h 10 min"). */
export const minText = (m) => { const n = Math.max(0, Math.round(Number(m) || 0)); return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`; };
