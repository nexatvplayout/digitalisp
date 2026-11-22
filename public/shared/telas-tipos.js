// NEXA Telas (docs/TELAS.md): o catálogo do modo prefeitura, o mesmo arquivo no servidor (server/telas.js, as validações), no
// Painel da Prefeitura (public/admin/views/prefeitura.js) e na página de controle da repartição (public/reparticao/).
// Sem DOM e sem dependências: só dados e funções puras.
//
// Fases 1 e 2: os avisos (texto rolante), o layout e os alertas em tela cheia. Fases 3 e 4 (contrato §7): a chamada de senha
// (módulo "senha", layout e bloco "queue") e os cartões de informação por tipo de repartição (merenda, escala, vagas, agenda,
// pauta, calendário, linhas), cada um ligado pelo módulo dele. A aprovação da SECOM vale para a prefeitura inteira (tenant).

/**
 * Módulos de uma repartição. fixed: sempre ligado (não se desliga); tenant: vale para a prefeitura inteira (liga em "Padrão
 * da prefeitura", não por repartição); card: o tipo de cartão de informação que o módulo liga (CARD_KINDS); soon: fase
 * futura (só aparece, não liga; hoje nenhum).
 */
export const MODULES = [
  { key: 'alertas', label: 'Alertas em tela cheia', desc: 'Os alertas da Defesa Civil e da prefeitura por cima do vídeo, com ou sem som.', fixed: true },
  { key: 'avisos', label: 'Avisos da repartição', desc: 'O texto rolante com os avisos que a própria repartição escreve (pelo painel ou pelo link de controle).' },
  { key: 'senha', label: 'Chamada de senha', desc: 'A fila de atendimento na tela (senha, guichê, voz da chamada), com o totem de retirada e a página do guichê.' },
  { key: 'escala', label: 'Escala de plantão', desc: 'Os profissionais e as especialidades de plantão no dia.', card: 'escala' },
  { key: 'merenda', label: 'Cardápio da merenda', desc: 'O cardápio da semana: a tela mostra o do dia.', card: 'merenda' },
  { key: 'calendario', label: 'Calendário escolar', desc: 'As datas da escola: provas, reuniões e eventos.', card: 'calendario' },
  { key: 'vagas', label: 'Vagas de emprego', desc: 'As vagas abertas do SINE.', card: 'vagas' },
  { key: 'sessao', label: 'Pauta da sessão', desc: 'A pauta da sessão da Câmara.', card: 'pauta' },
  { key: 'agenda', label: 'Agenda cultural e esportiva', desc: 'A programação dos espaços de cultura e de esporte.', card: 'agenda' },
  { key: 'linhas', label: 'Horários das linhas', desc: 'As partidas do terminal de ônibus.', card: 'linhas' },
  { key: 'panico', label: 'Botão de pânico', desc: 'Um botão no painel da repartição que avisa a Segurança (CCO) em silêncio: nada aparece em tela nenhuma.' },
  { key: 'interna', label: 'Comunicação interna', desc: 'Telas internas (posto de enfermagem, repouso, copa): avisos da direção com "Li" no celular, escala, treinamentos e os códigos de emergência hospitalar. Nada disso vai às telas do público.' },
  { key: 'aprovacao', label: 'Aprovação de avisos', desc: 'Os avisos, os cartões e os alertas das repartições passam pela SECOM antes de ir às telas (liga em Padrão da prefeitura).', tenant: true },
];
export const MODULE = Object.fromEntries(MODULES.map((m) => [m.key, m]));
/**
 * As cores dos códigos de emergência hospitalar (comunicação interna, docs/TELAS.md §25): uma paleta fechada, para a página
 * pintar por classe (cc-<chave>, sem estilo pelo script; a CSP não aceita inline) e o app receber o hexadecimal. fg: o texto.
 */
export const CODE_COLORS = Object.freeze([
  { key: 'azul', label: 'Azul', hex: '#1565c0', fg: '#ffffff' },
  { key: 'vermelho', label: 'Vermelho', hex: '#c62828', fg: '#ffffff' },
  { key: 'rosa', label: 'Rosa', hex: '#d81b60', fg: '#ffffff' },
  { key: 'laranja', label: 'Laranja', hex: '#ef6c00', fg: '#ffffff' },
  { key: 'cinza', label: 'Cinza', hex: '#616161', fg: '#ffffff' },
  { key: 'amarelo', label: 'Amarelo', hex: '#f9a825', fg: '#1a1a1a' },
  { key: 'verde', label: 'Verde', hex: '#2e7d32', fg: '#ffffff' },
  { key: 'roxo', label: 'Roxo', hex: '#6a1b9a', fg: '#ffffff' },
  { key: 'marrom', label: 'Marrom', hex: '#5d4037', fg: '#ffffff' },
  { key: 'preto', label: 'Preto', hex: '#212121', fg: '#ffffff' },
  { key: 'branco', label: 'Branco', hex: '#eeeeee', fg: '#1a1a1a' },
  { key: 'turquesa', label: 'Turquesa', hex: '#00838f', fg: '#ffffff' },
]);
/** A chave da cor pelo hexadecimal (a classe cc-<chave>); fora da paleta: cinza. */
export const codeColorKey = (hex) => CODE_COLORS.find((c) => c.hex === String(hex || '').toLowerCase())?.key || 'cinza';
/** Módulos que uma repartição pode ligar e desligar. */
export const MODULE_KEYS = MODULES.filter((m) => !m.soon && !m.fixed && !m.tenant).map((m) => m.key);

/**
 * Cartões de informação (contrato §7.1 "cards"): um armazenamento só, com o modelo de cada tipo. module: o módulo que liga o
 * tipo na repartição (null: sempre disponível); weekly: costuma ter um cartão por dia da semana (a tela recebe o de hoje).
 */
export const CARD_KINDS = [
  { key: 'merenda', label: 'Merenda', module: 'merenda', title: 'Merenda de hoje', weekly: true, hint: 'Um item do cardápio por linha. Faça um cartão para cada dia da semana: a tela mostra o de hoje.' },
  { key: 'escala', label: 'Escala do dia', module: 'escala', title: 'Plantão de hoje', weekly: true, hint: 'Um profissional ou especialidade por linha. Sem dia marcado, vale todos os dias.' },
  { key: 'vagas', label: 'Vagas de emprego', module: 'vagas', title: 'Vagas abertas', hint: 'Uma vaga por linha (cargo, quantidade, como se candidatar).' },
  { key: 'agenda', label: 'Agenda', module: 'agenda', title: 'Agenda', hint: 'Um evento por linha (dia, hora e local).' },
  { key: 'pauta', label: 'Pauta', module: 'sessao', title: 'Pauta da sessão', hint: 'Um item da pauta por linha.' },
  { key: 'calendario', label: 'Calendário escolar', module: 'calendario', title: 'Calendário escolar', hint: 'Uma data por linha.' },
  { key: 'linhas', label: 'Horários das linhas', module: 'linhas', title: 'Próximas partidas', hint: 'Uma linha de ônibus por linha (número, destino e horários).' },
  { key: 'unidade', label: 'Aviso da unidade', module: null, title: 'Avisos', hint: 'Informação geral da unidade (horário de funcionamento, documentos, telefones).' },
];
export const CARD_KIND = Object.fromEntries(CARD_KINDS.map((k) => [k.key, k]));
export const CARD_KIND_KEYS = CARD_KINDS.map((k) => k.key);
/** Os tipos de cartão que a repartição usa: os dos módulos ligados e o aviso da unidade. modules: officeModules(). */
export const officeCardKinds = (modules) => CARD_KINDS.filter((k) => !k.module || modules?.[k.module]).map((k) => k.key);
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Classificação do conteúdo (modo eleitoral, docs/TELAS.md): no período definido pela prefeitura, o que é "institucional"
 * fica retido (não é apagado) e não vai às telas. O padrão é utilidade pública; institucional se escolhe de propósito.
 */
export const CONTENT_CLASSES = [
  { key: 'utilidade', label: 'Utilidade pública' },
  { key: 'institucional', label: 'Institucional' },
  { key: 'emergencia', label: 'Emergência' },
];
export const CONTENT_CLASS_KEYS = CONTENT_CLASSES.map((c) => c.key);
export const classLabel = (k) => CONTENT_CLASSES.find((c) => c.key === k)?.label || k;
/** Um aviso (texto rolante) marcado: "[institucional] texto" ou "[emergência] texto"; sem marca = utilidade pública. */
const MARK_RE = /^\[\s*(institucional|emerg[eê]ncia|utilidade(?: p[uú]blica)?)\s*\]\s*/i;
export function splitAviso(item) {
  const s = String(item ?? '');
  const m = MARK_RE.exec(s);
  if (!m) return { class: 'utilidade', text: s };
  const k = m[1].toLowerCase();
  return { class: k.startsWith('inst') ? 'institucional' : k.startsWith('emerg') ? 'emergencia' : 'utilidade', text: s.slice(m[0].length) };
}
export const markAviso = (text, cls) => (cls === 'institucional' ? `[institucional] ${text}` : cls === 'emergencia' ? `[emergência] ${text}` : String(text));

/** Classificação de risco (UPA e hospital), da mais grave para a menos: a ordem de chamada. */
export const RISKS = [
  { key: 'vermelho', label: 'Vermelho (emergência)', color: '#d92d20' },
  { key: 'laranja', label: 'Laranja (muito urgente)', color: '#f08c00' },
  { key: 'amarelo', label: 'Amarelo (urgente)', color: '#e6b800' },
  { key: 'verde', label: 'Verde (pouco urgente)', color: '#2f9e44' },
  { key: 'azul', label: 'Azul (não urgente)', color: '#1c7ed6' },
];
export const RISK_KEYS = RISKS.map((r) => r.key);
/** Tipos de repartição que nascem com a classificação de risco ligada. */
export const RISK_OFFICE_TYPES = ['upa', 'hospital'];
/** Prioridade legal da senha: 0 normal, 1 prioritária (60+, gestante, PcD, lactante, criança de colo), 2 = 80 anos ou mais. */
export const PRIORITIES = [
  { key: 0, label: 'Normal', desc: '' },
  { key: 1, label: 'Preferencial (60+)', desc: 'Idosos (60+), gestantes, pessoas com deficiência, lactantes e pessoas com criança de colo.' },
  { key: 2, label: '80 anos ou mais', desc: 'Passa à frente das outras prioridades (Lei 13.466/2017).' },
];

/**
 * Tipos de repartição. modules: os módulos de fábrica do tipo (os "em breve" ficam listados para a fase deles);
 * alertScope: o que o link de controle da repartição alcança num alerta ('wide' = a cidade toda, regiões e grupos;
 * 'own' = só as telas da própria repartição).
 */
export const OFFICE_TYPES = [
  { key: 'secom', label: 'SECOM (comunicação)', short: 'SECOM', modules: ['alertas', 'avisos', 'aprovacao'], alertScope: 'wide', desc: 'Avisos gerais da prefeitura e a aprovação dos avisos das repartições.' },
  { key: 'defesa-civil', label: 'Defesa Civil', short: 'Defesa Civil', modules: ['alertas', 'avisos'], alertScope: 'wide', issuer: 'Defesa Civil', desc: 'Alertas por região, por grupo ou para a cidade toda.' },
  { key: 'seguranca', label: 'Segurança e Guarda Municipal (CCO)', short: 'Segurança', modules: ['alertas', 'avisos', 'aprovacao'], alertScope: 'wide', issuer: 'Guarda Municipal', desc: 'O centro de controle: recebe o botão de pânico, aprova os emissores conveniados e manda alertas de segurança e de trânsito.' },
  { key: 'policia-civil', label: 'Polícia Civil (emissor conveniado)', short: 'Polícia Civil', modules: ['alertas'], alertScope: 'wide', external: true, issuer: 'Polícia Civil', desc: 'Órgão estadual, por convênio: desaparecidos e pedidos de informação. O que envia espera a aprovação do CCO.' },
  { key: 'policia-militar', label: 'Polícia Militar (emissor conveniado)', short: 'Polícia Militar', modules: ['alertas'], alertScope: 'wide', external: true, issuer: 'Polícia Militar', desc: 'Órgão estadual, por convênio: alertas operacionais por área. O que envia espera a aprovação do CCO.' },
  { key: 'upa', label: 'UPA', short: 'UPA', modules: ['alertas', 'avisos', 'senha', 'escala', 'panico', 'interna'] },
  { key: 'hospital', label: 'Hospital', short: 'Hospital', modules: ['alertas', 'avisos', 'senha', 'escala', 'panico', 'interna'] },
  { key: 'ubs', label: 'UBS (posto de saúde)', short: 'UBS', modules: ['alertas', 'avisos', 'senha', 'panico'] },
  { key: 'caps', label: 'CAPS', short: 'CAPS', modules: ['alertas', 'avisos', 'senha', 'panico'] },
  { key: 'escola', label: 'Escola', short: 'Escola', modules: ['alertas', 'avisos', 'merenda', 'calendario', 'panico'] },
  { key: 'creche', label: 'Creche', short: 'Creche', modules: ['alertas', 'avisos', 'merenda', 'panico'] },
  { key: 'cras', label: 'CRAS / CREAS', short: 'CRAS', modules: ['alertas', 'avisos', 'senha', 'panico'] },
  { key: 'central-cidadao', label: 'Central do Cidadão', short: 'Central', modules: ['alertas', 'avisos', 'senha'] },
  { key: 'sine', label: 'SINE (emprego)', short: 'SINE', modules: ['alertas', 'avisos', 'vagas', 'senha'] },
  { key: 'camara', label: 'Câmara Municipal', short: 'Câmara', modules: ['alertas', 'avisos', 'sessao'] },
  { key: 'cultura', label: 'Cultura (teatro, biblioteca, museu)', short: 'Cultura', modules: ['alertas', 'avisos', 'agenda'] },
  { key: 'terminal', label: 'Terminal de ônibus', short: 'Terminal', modules: ['alertas', 'avisos', 'linhas'] },
  { key: 'outro', label: 'Outra repartição', short: 'Outro', modules: ['alertas', 'avisos'] },
  // TV Corporativa (docs/TV-CORPORATIVA.md §5.1): as unidades da empresa. corp: true = não aparecem no Painel da Prefeitura
  // (e os tipos da prefeitura não aparecem na TV Corporativa); família F11 no link da unidade
  { key: 'matriz', label: 'Matriz / sede', short: 'Matriz', modules: ['alertas', 'avisos'], corp: true, desc: 'A sede da empresa.' },
  { key: 'filial', label: 'Filial / escritório', short: 'Filial', modules: ['alertas', 'avisos'], corp: true, desc: 'Escritórios e filiais.' },
  { key: 'fabrica', label: 'Fábrica / planta', short: 'Fábrica', modules: ['alertas', 'avisos', 'interna'], corp: true, desc: 'Chão de fábrica: indicadores, segurança do trabalho e comunicação interna.' },
  { key: 'loja', label: 'Loja / ponto de venda', short: 'Loja', modules: ['alertas', 'avisos'], corp: true, desc: 'Telas para clientes e equipe da loja.' },
  { key: 'cd', label: 'Centro de distribuição', short: 'CD', modules: ['alertas', 'avisos', 'interna'], corp: true, desc: 'Logística e armazém.' },
  { key: 'refeitorio', label: 'Refeitório', short: 'Refeitório', modules: ['alertas', 'avisos'], corp: true, desc: 'Cardápio do dia, aniversariantes e comunicados.' },
  { key: 'recepcao', label: 'Recepção / portaria', short: 'Recepção', modules: ['alertas', 'avisos', 'senha', 'panico'], corp: true, desc: 'Boas-vindas aos visitantes, chamada de senha e o botão de pânico.' },
  { key: 'ambulatorio', label: 'Ambulatório da empresa', short: 'Ambulatório', modules: ['alertas', 'avisos', 'senha'], corp: true, desc: 'Atendimento de saúde ocupacional com chamada de senha.' },
  { key: 'treinamento', label: 'Sala de treinamento', short: 'Treinamento', modules: ['alertas', 'avisos'], corp: true, desc: 'Treinamentos e integração de novos funcionários.' },
  { key: 'corp-outro', label: 'Outra unidade da empresa', short: 'Outra', modules: ['alertas', 'avisos'], corp: true },
].map((t) => ({ alertScope: 'own', desc: '', external: false, issuer: null, corp: false, ...t }));
/** Os tipos do Painel da Prefeitura (sem os corporativos) e os da TV Corporativa. */
export const PREF_OFFICE_TYPES = OFFICE_TYPES.filter((t) => !t.corp);
export const CORP_OFFICE_TYPES = OFFICE_TYPES.filter((t) => t.corp);
export const isCorpType = (type) => Boolean(OFFICE_TYPES.find((t) => t.key === type)?.corp);
/** Órgão de fora da prefeitura (emissor conveniado): só emite o que o tipo permite e vê os próprios envios. */
export const isExternal = (type) => Boolean(OFFICE_TYPE[type]?.external);
/** Quem assina o alerta na linha de cima ("ALERTA SEVERO · DEFESA CIVIL"): os tipos que emitem pelo catálogo. null = os outros. */
export const issuerOf = (type) => OFFICE_TYPE[type]?.issuer || null;
/** As categorias de aviso que cada emissor usa (null = todas). A Polícia Civil só Segurança pública; a Militar, também Trânsito. */
export const alertCategoriesOf = (type) => ({ 'policia-civil': ['seguranca'], 'policia-militar': ['seguranca', 'transito'], seguranca: ['seguranca', 'transito', 'meteorologico', 'geologico', 'tecnologico', 'incendio-ar', 'saude', 'teste', 'outro'] }[type] || null);
/** Tipos de repartição que aprovam o que espera: a SECOM e a Segurança (CCO). */
export const APPROVER_TYPES = ['secom', 'seguranca'];
export const OFFICE_TYPE = Object.fromEntries(OFFICE_TYPES.map((t) => [t.key, t]));
export const OFFICE_TYPE_KEYS = OFFICE_TYPES.map((t) => t.key);
export const typeLabel = (k) => OFFICE_TYPE[k]?.label || k;
export const typeShort = (k) => OFFICE_TYPE[k]?.short || k;
/** A sigla de cada tipo, escrita no pino da repartição no mapa (até 4 letras). */
export const TYPE_SIGLA = Object.freeze({
  secom: 'SEC', 'defesa-civil': 'DC', seguranca: 'SEG', 'policia-civil': 'PC', 'policia-militar': 'PM', upa: 'UPA', hospital: 'HOSP', ubs: 'UBS', caps: 'CAPS', escola: 'ESC', creche: 'CRE', cras: 'CRAS',
  'central-cidadao': 'CC', sine: 'SINE', camara: 'CAM', cultura: 'CULT', terminal: 'TERM', outro: 'REP',
  matriz: 'MTZ', filial: 'FIL', fabrica: 'FAB', loja: 'LOJA', cd: 'CD', refeitorio: 'REF', recepcao: 'REC', ambulatorio: 'AMB', treinamento: 'TRE', 'corp-outro': 'UNI',
});
export const typeSigla = (k) => TYPE_SIGLA[k] || TYPE_SIGLA.outro;

/** Os módulos de fábrica do tipo que já se ligam hoje: { avisos: true, … } (o que a repartição nova recebe). */
export const defaultModules = (type) => Object.fromEntries(MODULE_KEYS.map((k) => [k, (OFFICE_TYPE[type] || OFFICE_TYPE.outro).modules.includes(k)]));
/** Os módulos da repartição com o de fábrica no que não foi escolhido: { chave: boolean } só das que se ligam hoje. */
export function officeModules(type, saved) {
  const d = defaultModules(type);
  for (const k of MODULE_KEYS) if (saved && typeof saved[k] === 'boolean') d[k] = saved[k];
  return d;
}

/** Layouts da tela (contrato do aparelho, telas-contrato.md §2 e §7.1). queue pede a chamada de senha ligada na repartição. */
export const LAYOUTS = [
  { key: 'full', label: 'Tela cheia', desc: 'Só o vídeo do canal.' },
  { key: 'ticker', label: 'Vídeo + avisos', desc: 'O vídeo com o texto rolante dos avisos embaixo.' },
  { key: 'side', label: 'Vídeo + lateral', desc: 'O vídeo com a coluna lateral (relógio, clima, QR).' },
  { key: 'lbar', label: 'L (lateral + avisos)', desc: 'O vídeo com a lateral e o texto rolante.' },
  { key: 'portrait', label: 'Em pé (totem)', desc: 'A tela na vertical: vídeo em cima, avisos embaixo.' },
  { key: 'queue', label: 'Chamada de senha', desc: 'O painel de senha grande com o canal pequeno no canto (pede a chamada de senha ligada).' },
  // §15 do contrato (15/11): os painéis de senha novos. Todos pedem a chamada de senha ligada (sem ela a tela recebe "full");
  // com a TV em pé o app desenha o "queue" de sempre. video: o canal aparece no painel (os sem vídeo deixam só a senha).
  { key: 'queue-table', queue: true, video: true, label: 'Senha: vídeo + tabela', desc: 'O vídeo à esquerda, a tabela SENHA | GUICHÊ com as últimas à direita e o texto rolante com o relógio embaixo.' },
  { key: 'queue-big', queue: true, video: false, label: 'Senha gigante', desc: 'Sem vídeo: o tipo no alto, SENHA e GUICHÊ em caixas grandes e, à direita, a tabela das anteriores.' },
  { key: 'queue-cards', queue: true, video: true, label: 'Senha: cartões', desc: 'Cabeçalho com o nome e o relógio, o vídeo com a senha atual ao lado e embaixo as últimas senhas em cartões.' },
  { key: 'queue-header', queue: true, video: true, label: 'Senha: cabeçalho e lista', desc: 'Cabeçalho com o nome, a hora e a data; a senha atual num cartão grande e, à direita, as últimas chamadas e o canal.' },
  { key: 'queue-info', queue: true, video: true, label: 'Senha em faixas', desc: 'SENHA, ATENDIMENTO e LOCAL em faixas rotuladas; à esquerda o nome da repartição, o relógio e o canal.' },
  { key: 'queue-mosaic', queue: true, video: true, label: 'Senha: mosaico', desc: 'A senha atual grande e o canal em cima, três cartões das anteriores embaixo e o rodapé com o setor e o relógio.' },
  { key: 'queue-duo', queue: true, video: false, label: 'Duas filas lado a lado', desc: 'Sem vídeo: a tela dividida em duas filas, cada uma com a sua senha atual; embaixo as últimas chamadas.' },
  { key: 'queue-grid', queue: true, video: true, label: 'Senha por fila (grade)', desc: 'O vídeo à esquerda e uma grade com a última senha de cada fila, na cor da fila; rodapé com a data e o relógio.' },
  { key: 'queue-list', queue: true, video: true, label: 'Últimas chamadas + vídeo', desc: 'As últimas chamadas numa coluna à esquerda; à direita a chamada atual no alto, o vídeo embaixo e o texto rolante.' },
];
export const LAYOUT_KEYS = LAYOUTS.filter((l) => !l.soon).map((l) => l.key);
export const layoutLabel = (k) => LAYOUTS.find((l) => l.key === k)?.label || k;
/** Os layouts de chamada de senha (o "queue" e os do §15): só chegam à tela com a chamada de senha ligada. */
export const QUEUE_LAYOUT_KEYS = LAYOUTS.filter((l) => l.key === 'queue' || l.queue).map((l) => l.key);
export const isQueueLayout = (k) => QUEUE_LAYOUT_KEYS.includes(k);

/**
 * Tema dos painéis de senha do §15 (contrato §15): a cor principal e o claro/escuro. Só as cores desta lista (a prévia as
 * desenha por classe, sem estilo pelo script). De fábrica: azul, escuro.
 */
export const THEME_COLORS = [
  { key: 'azul', hex: '#1d4ed8', label: 'Azul' },
  { key: 'verde', hex: '#15803d', label: 'Verde' },
  { key: 'petroleo', hex: '#0f766e', label: 'Petróleo' },
  { key: 'vinho', hex: '#9f1239', label: 'Vinho' },
  { key: 'roxo', hex: '#6d28d9', label: 'Roxo' },
  { key: 'laranja', hex: '#c2410c', label: 'Laranja' },
  { key: 'grafite', hex: '#334155', label: 'Grafite' },
];
export const THEME_MODES = [{ key: 'dark', label: 'Escuro' }, { key: 'light', label: 'Claro' }];
export const THEME_DEFAULT = Object.freeze({ color: '#1d4ed8', mode: 'dark' });
/** A chave da cor (azul, verde…) de um hex do tema; desconhecido = azul. */
export const themeColorKey = (hex) => THEME_COLORS.find((c) => c.hex === String(hex || '').toLowerCase())?.key || 'azul';
/** A cor de cada fila nos painéis por fila (queue-grid, queue-duo), pela ordem das filas da repartição. */
export const SERVICE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#4d7c0f'];
export const serviceColor = (i) => SERVICE_COLORS[((Number(i) || 0) % SERVICE_COLORS.length + SERVICE_COLORS.length) % SERVICE_COLORS.length];

/** Blocos da lateral (side.widgets). queue: a senha atual (só vai à tela com a chamada de senha ligada na repartição). */
export const WIDGETS = [
  { key: 'clock', label: 'Relógio e data' },
  { key: 'weather', label: 'Clima' },
  { key: 'qr', label: 'QR code' },
  { key: 'queue', label: 'Senha atual' },
];
export const WIDGET_KEYS = WIDGETS.filter((w) => !w.soon).map((w) => w.key);

export const ALERT_LEVELS = [
  { key: 'info', label: 'Informativo' },
  { key: 'warn', label: 'Atenção' },
  { key: 'critical', label: 'Emergência' },
];
export const ALERT_LEVEL_KEYS = ALERT_LEVELS.map((l) => l.key);
export const levelLabel = (k) => ALERT_LEVELS.find((l) => l.key === k)?.label || k;

/** Alcance de um alerta. O painel usa todos; o link de controle usa office e, nos tipos 'wide' (SECOM e Defesa Civil), também city, regions, groups e radius. */
export const ALERT_SCOPES = [
  // 'reach' (o alcance que a prefeitura marcou na ficha de uma repartição de emergência) não entra aqui: só o link de
  // controle da repartição o usa, e o servidor o monta (REACH_TYPES, reachScope abaixo)
  { key: 'city', label: 'Cidade toda' },
  { key: 'regions', label: 'Regiões' },
  { key: 'groups', label: 'Grupos de telas' },
  { key: 'office', label: 'Uma repartição' },
  { key: 'radius', label: 'Raio no mapa' },
];
export const ALERT_SCOPE_KEYS = ALERT_SCOPES.map((s) => s.key);
/** Alcances que o link de controle de uma repartição deste tipo pode usar. */
export const officeAlertScopes = (type) => ((OFFICE_TYPE[type] || OFFICE_TYPE.outro).alertScope === 'wide' ? ['city', 'regions', 'groups', 'office', 'radius'] : ['office']);
export const isWide = (type) => (OFFICE_TYPE[type] || OFFICE_TYPE.outro).alertScope === 'wide';

/**
 * "Alcance dos alertas" das repartições de emergência (docs/TELAS.md): o que a prefeitura marca na ficha da repartição e que
 * o alerta dela alcança com um clique ("Alcance da prefeitura" no painel da repartição), todas as telas ao mesmo tempo.
 *   mode: 'own' (só as telas da própria repartição) | 'all' (todas as TV box da prefeitura) | 'pick' (a própria repartição
 *   mais as regiões e os grupos escolhidos); eas: também no ar dos canais (o alerta de emergência do canal, só Severo e Extremo).
 * A Defesa Civil nasce com 'all'; as outras de emergência, com 'own' (a prefeitura liga). Tipo fora da lista: sempre 'own'.
 */
export const REACH_TYPES = ['defesa-civil', 'seguranca', 'policia-civil', 'policia-militar'];
export const REACH_MODES = [
  { key: 'own', label: 'Só as telas desta repartição' },
  { key: 'all', label: 'Todas as TV box da prefeitura' },
  { key: 'pick', label: 'Regiões e grupos escolhidos (e as telas desta repartição)' },
];
export const hasReach = (type) => REACH_TYPES.includes(type);
export const defaultReach = (type) => ({ mode: type === 'defesa-civil' ? 'all' : 'own', regions: [], groups: [], eas: false });
/** O alcance guardado (JSON da coluna alert_reach) ou o de fábrica do tipo. Tipo fora da lista: só as próprias telas. */
export function reachOf(type, raw) {
  if (!hasReach(type)) return { ...defaultReach('outro') };
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || !REACH_MODES.some((m) => m.key === v.mode)) return defaultReach(type);
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : []);
  return { mode: v.mode, regions: v.mode === 'pick' ? ids(v.regions) : [], groups: v.mode === 'pick' ? ids(v.groups) : [], eas: v.eas === true };
}
/** O alcance de um alerta "para o alcance da prefeitura" (scope kind 'reach'): a própria repartição sempre entra. */
export const reachScope = (reach, officeId) => ({ kind: 'reach', all: reach.mode === 'all', offices: [Number(officeId)], regions: reach.mode === 'pick' ? reach.regions : [], groups: reach.mode === 'pick' ? reach.groups : [] });
/** O alcance em palavras ("todas as TV box da prefeitura", "2 região(ões) e 1 grupo(s), mais as telas desta repartição"). */
export function reachText(reach, { regions = [], groups = [] } = {}) {
  if (reach.mode === 'all') return 'todas as TV box da prefeitura';
  if (reach.mode === 'own') return 'só as telas desta repartição';
  const names = (ids, list) => ids.map((id) => list.find((x) => Number(x.id) === id)?.name).filter(Boolean);
  const r = names(reach.regions, regions); const g = names(reach.groups, groups);
  const parts = [r.length ? `regiões ${r.join(', ')}` : reach.regions.length ? `${reach.regions.length} região(ões)` : '', g.length ? `grupos ${g.join(', ')}` : reach.groups.length ? `${reach.groups.length} grupo(s)` : ''].filter(Boolean);
  return `${parts.join(' e ') || 'nenhuma região nem grupo escolhido'}, mais as telas desta repartição`;
}

/**
 * Gravidade de um alerta (contrato §9): o nome que o operador vê para cada `level` do contrato, com a definição que aparece
 * ao lado da escolha. Extremo pede uma confirmação a mais (confirmExtreme no servidor) e vem com o som ligado.
 */
export const SEVERITIES = [
  { key: 'info', label: 'Aviso', word: 'AVISO', color: 'azul', sound: false, desc: 'Comunicado sem risco imediato.' },
  { key: 'warn', label: 'Severo', word: 'ALERTA SEVERO', color: 'âmbar', sound: false, desc: 'Ameaça significativa que pede atenção e medidas preventivas. A população ainda tem tempo para se preparar e se proteger.' },
  { key: 'critical', label: 'Extremo', word: 'ALERTA EXTREMO', color: 'vermelho', sound: true, desc: 'Nível máximo: só com risco iminente à vida ou ao patrimônio. Pede evacuação ou ação imediata.' },
];
export const severityOf = (level) => SEVERITIES.find((s) => s.key === level) || SEVERITIES[0];

/**
 * Catálogo de tipos de aviso da Defesa Civil (contrato §9 `category`): categorias e, em cada uma, os tipos com o título e o
 * texto sugeridos (curtos, de utilidade pública, com o que fazer agora) e a gravidade sugerida. O operador troca o que
 * quiser antes de enviar; a prefeitura pode trocar o texto sugerido de cada tipo em "Padrão da prefeitura" (só o que ela
 * mudou fica guardado: o catálogo é o padrão). Pessoa desaparecida NÃO é um tipo de alerta: é a aba Desaparecidos (§8).
 */
const T = (id, name, level, title, text) => ({ id, name, level, title, text });
export const ALERT_CATEGORIES = [
  { key: 'meteorologico', label: 'Meteorológicos e hidrológicos', short: 'Chuva, vento, calor e frio', types: [
    T('chuva-intensa', 'Chuva intensa', 'warn', 'Chuva intensa', 'Chuva forte na região. Evite sair, fique longe de encostas e não atravesse ruas alagadas. Emergência: ligue 199 ou 193.'),
    T('vendaval', 'Vendaval', 'warn', 'Vendaval', 'Ventos fortes na região. Fique em local fechado, longe de janelas, árvores, postes e placas. Emergência: 199 ou 193.'),
    T('granizo', 'Granizo', 'warn', 'Chuva de granizo', 'Risco de granizo. Abrigue-se em local coberto, afaste-se das janelas e guarde o veículo se puder.'),
    T('enxurrada', 'Enxurrada', 'critical', 'Enxurrada', 'Água com força nas ruas. Não atravesse a pé nem de carro: poucos centímetros de água em movimento derrubam uma pessoa. Vá para um lugar alto. Emergência: 193.'),
    T('inundacao', 'Inundação', 'critical', 'Inundação', 'Rio fora do leito. Saia das áreas baixas e vá para um lugar alto e seguro. Desligue a energia se a água chegar em casa. Emergência: 199 ou 193.'),
    T('alagamento', 'Alagamento', 'warn', 'Alagamento', 'Há pontos de alagamento na região. Evite sair e não tente atravessar ruas alagadas a pé ou de carro. Emergência: 199 ou 193.'),
    T('ciclone', 'Ciclone', 'critical', 'Ciclone', 'Ciclone com vento forte e chuva intensa. Fique em casa, longe de janelas, e guarde água, lanterna e documentos. Emergência: 199 ou 193.'),
    T('tornado', 'Tornado', 'critical', 'Risco de tornado', 'Abrigue-se agora no cômodo mais interno e baixo do prédio, longe de janelas e portas. Proteja a cabeça. Emergência: 193.'),
    T('onda-calor', 'Onda de calor', 'warn', 'Onda de calor', 'Beba água várias vezes ao dia, evite o sol entre 10h e 16h e dê atenção a crianças e idosos. Em caso de mal-estar, procure a unidade de saúde mais próxima.'),
    T('frio-extremo', 'Frio extremo', 'warn', 'Frio intenso', 'Temperatura muito baixa. Agasalhe-se, proteja crianças, idosos e animais. Viu alguém em situação de rua precisando de abrigo? Ligue 199.'),
  ] },
  { key: 'geologico', label: 'Riscos geológicos', short: 'Deslizamento, erosão e tremor', types: [
    T('deslizamento', 'Deslizamento de terra', 'critical', 'Risco de deslizamento', 'Rachaduras, estalos, postes ou árvores inclinados são sinais de perigo. Saia de casa agora e vá para um ponto de apoio. Emergência: 199 ou 193.'),
    T('desmoronamento', 'Desmoronamento de encosta', 'critical', 'Desmoronamento de encosta', 'Encosta com risco de desmoronar. Deixe a área agora e não volte para buscar pertences. Emergência: 199 ou 193.'),
    T('erosao', 'Erosão grave', 'warn', 'Erosão grave', 'Solo cedendo na região. Não se aproxime da área isolada e avise a Defesa Civil se notar novas rachaduras no chão ou nas paredes: 199.'),
    T('tremor', 'Tremor de terra', 'warn', 'Tremor de terra', 'Foi sentido um tremor de terra. Mantenha a calma, afaste-se de janelas e objetos que possam cair e confira se há rachaduras. Dúvidas: 199.'),
  ] },
  { key: 'tecnologico', label: 'Desastres tecnológicos e industriais', short: 'Barragem, produto químico, incêndio', types: [
    T('barragem', 'Risco ou rompimento de barragem', 'critical', 'Risco em barragem', 'Siga agora pela rota de fuga até o ponto de encontro mais alto. Vá a pé, não volte para casa e ajude quem precisa. Emergência: 199.'),
    T('quimico', 'Vazamento de produto químico perigoso', 'critical', 'Vazamento de produto químico', 'Afaste-se da área. Se estiver em casa, feche portas e janelas e desligue o ar-condicionado. Sentiu mal-estar? Procure atendimento. Emergência: 193.'),
    T('radiologico', 'Acidente nuclear ou radiológico', 'critical', 'Emergência radiológica', 'Entre em um local fechado, feche portas e janelas e aguarde as orientações oficiais. Não saia para buscar ninguém. Emergência: 199.'),
    T('incendio-urbano', 'Incêndio urbano de grandes proporções', 'critical', 'Incêndio de grandes proporções', 'Afaste-se da área e deixe as ruas livres para os bombeiros. Se houver fumaça, feche as janelas. Emergência: 193.'),
    T('colapso', 'Colapso de estrutura', 'critical', 'Risco de colapso de estrutura', 'Deixe o prédio e a área isolada agora, sem usar o elevador. Não volte para buscar pertences. Emergência: 193 ou 199.'),
  ] },
  { key: 'incendio-ar', label: 'Incêndios florestais e qualidade do ar', short: 'Queimada, ar seco e fumaça', types: [
    T('queimada', 'Queimada perto de área habitada', 'warn', 'Queimada perto de casas', 'Fogo em vegetação na região. Feche portas e janelas, afaste-se da fumaça e esteja pronto para sair se for orientado. Emergência: 193.'),
    T('baixa-umidade', 'Baixa umidade do ar', 'info', 'Baixa umidade do ar', 'Ar muito seco. Beba bastante água, evite exercícios entre 10h e 16h e não queime lixo nem vegetação.'),
    T('fumaca', 'Fumaça tóxica', 'critical', 'Fumaça tóxica', 'Fumaça perigosa na região. Fique em local fechado, com portas e janelas fechadas. Com falta de ar, procure atendimento. Emergência: 193.'),
  ] },
  { key: 'saude', label: 'Emergências de saúde pública', short: 'Surto, água e medida sanitária', types: [
    T('surto', 'Surto epidêmico', 'warn', 'Alerta de saúde', 'Aumento de casos na cidade. Lave as mãos, mantenha a vacinação em dia e, com sintomas, procure a unidade de saúde mais próxima.'),
    T('agua-contaminada', 'Água de abastecimento contaminada', 'critical', 'Não beba a água da torneira', 'A água de abastecimento pode estar contaminada. Não beba nem use para cozinhar até novo aviso. Use água mineral ou fervida.'),
    T('risco-biologico', 'Risco biológico com medida sanitária', 'warn', 'Medida sanitária em vigor', 'Há uma medida sanitária em vigor na região. Siga as orientações das equipes de saúde e evite circular sem necessidade.'),
  ] },
  { key: 'seguranca', label: 'Segurança pública', short: 'Área a evitar, evacuação, isolamento', types: [
    T('ocorrencia', 'Ocorrência policial em andamento', 'warn', 'Ocorrência em andamento: evite a área', 'Há uma ocorrência policial em andamento na região. Evite a área e siga as orientações dos agentes. Emergência: ligue 190.'),
    T('evacuacao-predio', 'Evacuação de prédio público', 'critical', 'Evacuação do prédio', 'Saia do prédio agora, com calma, pela saída mais próxima. Não use o elevador e siga as orientações dos agentes.'),
    T('area-isolada', 'Área isolada', 'warn', 'Área isolada', 'A área está isolada pelas equipes de segurança. Não se aproxime e siga as orientações dos agentes.'),
  ] },
  { key: 'transito', label: 'Trânsito', short: 'Bloqueio, interdição e desvio', types: [
    T('bloqueio-via', 'Bloqueio de via', 'warn', 'Via bloqueada', 'Há um bloqueio de via na região. Evite o trecho e use um caminho alternativo. Siga as orientações dos agentes.'),
    T('interdicao', 'Interdição', 'info', 'Via interditada', 'A via está interditada. Use um caminho alternativo e siga a sinalização.'),
    T('desvio', 'Desvio', 'info', 'Desvio no trânsito', 'O trânsito está desviado na região. Siga a sinalização e as orientações dos agentes.'),
  ] },
  { key: 'teste', label: 'Teste e simulação do sistema', short: 'Teste programado e simulado', test: true, types: [
    T('teste-programado', 'Teste programado', 'info', 'TESTE: teste do sistema de alertas', 'Este é apenas um teste do sistema de alertas da Defesa Civil. Não há perigo real. Nenhuma ação é necessária.'),
    T('simulado', 'Simulado', 'info', 'TESTE: simulado da Defesa Civil', 'Simulado em andamento. Não há perigo real. Quem participa do exercício deve seguir as orientações das equipes no local.'),
  ] },
  { key: 'outro', label: 'Outro', short: 'Texto livre', types: [
    T('outro', 'Outro (texto livre)', 'warn', '', ''),
  ] },
];
export const ALERT_CATEGORY_KEYS = ALERT_CATEGORIES.map((c) => c.key);
export const ALERT_TYPES = ALERT_CATEGORIES.flatMap((c) => c.types.map((t) => ({ ...t, category: c.key, test: Boolean(c.test) })));
export const ALERT_TYPE = Object.fromEntries(ALERT_TYPES.map((t) => [t.id, t]));
export const alertCategory = (key) => ALERT_CATEGORIES.find((c) => c.key === key) || null;
/** O tipo com o texto sugerido em vigor: o do catálogo, com o que a prefeitura trocou por cima (overrides: { id: { title, text } }). */
export function alertTypeText(id, overrides = null) {
  const t = ALERT_TYPE[id];
  if (!t) return null;
  const o = overrides && typeof overrides === 'object' ? overrides[id] : null;
  return { ...t, title: o?.title || t.title, text: o?.text ?? t.text };
}
/** A linha de cima do alerta (contrato §9 `header`, até 60): pela gravidade e por quem emite; no teste, "TESTE DO SISTEMA". */
export function alertHeader({ level, issuer = '', test = false, plain = false }) {
  if (test) return 'TESTE DO SISTEMA';
  const who = String(issuer || '').toUpperCase().replace(/\s+/g, ' ').trim();
  // plain: os emissores de segurança dizem "ALERTA · GUARDA MUNICIPAL" no nível informativo (e SEVERO ou EXTREMO quando for o caso)
  const word = plain && level === 'info' ? 'ALERTA' : severityOf(level).word;
  return `${word}${who ? ` · ${who}` : ''}`.slice(0, 60);
}
/** Os emissores de segurança pública (o cabeçalho deles é "ALERTA · …"). */
export const SECURITY_TYPES = ['seguranca', 'policia-civil', 'policia-militar'];
/** A linha de cima do alerta de uma repartição emissora, como o servidor monta. */
export const issuerHeader = (type, level, test = false) => (issuerOf(type) ? alertHeader({ level, issuer: issuerOf(type), test, plain: SECURITY_TYPES.includes(type) }) : null);

/** Pessoas desaparecidas (contrato §8): o tipo do caso, como mostrar e os limites. */
export const MISSING_KINDS = [
  { key: 'crianca', label: 'Criança', head: 'CRIANÇA DESAPARECIDA' },
  { key: 'adolescente', label: 'Adolescente', head: 'ADOLESCENTE DESAPARECIDO(A)' },
  { key: 'adulto', label: 'Adulto', head: 'PESSOA DESAPARECIDA' },
  { key: 'idoso', label: 'Idoso', head: 'IDOSO(A) DESAPARECIDO(A)' },
];
export const MISSING_KIND_KEYS = MISSING_KINDS.map((k) => k.key);
/** Cartela policial (contrato §10, só a Polícia Civil): `kind: informacao` com o cabeçalho de uma lista fechada. */
export const INFO_KIND = 'informacao';
export const INFO_HEADERS = [
  { key: 'informacoes', label: 'A POLÍCIA PEDE INFORMAÇÕES' },
  { key: 'procurado', label: 'PROCURADO PELA JUSTIÇA', warrant: true, fixed: 'Não aborde. Ligue 190 ou 181.' },
];
export const INFO_CONTACT = 'Disque Denúncia 181 · sigilo garantido';
export const INFO_DAYS_MAX = 15;
export const MISSING_SHOWS = [
  { key: 'both', label: 'Tela cheia e faixa' },
  { key: 'full', label: 'Só tela cheia' },
  { key: 'banner', label: 'Só faixa' },
];
export const MISSING_SHOW_KEYS = MISSING_SHOWS.map((s) => s.key);
export const MISSING_RELATIONS = [{ key: 'familiar', label: 'Familiar ou responsável' }, { key: 'autoridade', label: 'Autoridade policial' }];
export const MISSING_CLOSE = [{ key: 'localizado', label: 'Localizado(a)' }, { key: 'encerrado', label: 'Encerrado' }, { key: 'vencido', label: 'Vencido' }];
export const MISSING_LIMITS = Object.freeze({
  active: 5, name: 80, lastSeen: 120, description: 200, contact: 80, report: 40, authName: 80, ageMax: 120,
  fullSecMin: 8, fullSecMax: 60, fullSec: 15, bannerSecMin: 8, bannerSecMax: 120, bannerSec: 20, everyMinMin: 2, everyMinMax: 60, everyMin: 10,
  days: 7, daysMax: 30, uploadBytes: 5 * 1024 * 1024, photoBytes: 600 * 1024, photoSide: 1280, keepDays: 90,
});
export const MISSING_CONTACT = 'Ligue 199 ou 190';
/** O QR code de contato imediato do caso (contrato §11): para onde ele leva e a frase ao lado. */
export const QR_TARGETS = [
  { key: 'whatsapp', label: 'WhatsApp', hint: 'O número com o DDD (ex.: 21 99999-0000); o 55 do Brasil entra sozinho. De outro país: comece com + e o código do país.' },
  { key: 'tel', label: 'Telefone', hint: 'O número com o DDD (ex.: 21 3333-0000); o 55 do Brasil entra sozinho. De outro país: comece com +.' },
  { key: 'sms', label: 'SMS', hint: 'O número com o DDD; o 55 do Brasil entra sozinho. De outro país: comece com +.' },
  { key: 'url', label: 'Endereço de uma página ou formulário (https)', hint: 'Só endereço que começa por https://' },
];
export const QR_LABEL_DEFAULT = 'Aponte a câmera e fale agora';
/**
 * Os dígitos de um número de WhatsApp/telefone/SMS com o código do país. Número do Brasil digitado só com o DDD (10 ou 11
 * dígitos, ex.: 21999990000) ganha o 55 na frente: sem ele o wa.me abre outro país. Começou com "+": é o número completo
 * de qualquer país e fica como está.
 */
export function phoneDigits(value) {
  const raw = String(value ?? '').trim();
  const d = raw.replace(/[\s().+-]/g, '');
  return !raw.startsWith('+') && /^\d{10,11}$/.test(d) ? `55${d}` : d;
}
/** O conteúdo do QR code para a prévia (a validação que vale é a do servidor): null se ainda não dá para montar. */
export function qrDataOf(kind, value) {
  const d = phoneDigits(value);
  if (kind === 'whatsapp') return /^\d{10,15}$/.test(d) ? `https://wa.me/${d}` : null;
  if (kind === 'tel' || kind === 'sms') return /^\d{8,15}$/.test(d) ? `${kind}:+${d}` : null;
  const s = String(value ?? '').trim();
  return kind === 'url' && /^https:\/\/[^\s]+\.[^\s]+$/.test(s) && s.length <= 300 ? s : null;
}


/** Papéis de um usuário do painel da repartição: o gestor faz tudo da repartição; o atendente só chama e emite senha. */
export const OFFICE_ROLES = [
  { key: 'gestor', label: 'Gestor', desc: 'Tudo da repartição: avisos, cartões, alertas, a chamada de senha e as TV box.' },
  { key: 'atendente', label: 'Atendente', desc: 'Só a chamada de senha: as abas Atendimento e Recepção (a tela do guichê).' },
];
export const OFFICE_ROLE_KEYS = OFFICE_ROLES.map((r) => r.key);
export const roleLabel = (k) => OFFICE_ROLES.find((r) => r.key === k)?.label || k;

/**
 * As 7 famílias de tela da página de controle: o tipo da repartição define a família (o desenho da página) e os módulos
 * ligados definem as abas.
 */
export const FAMILIES = [
  { key: 'comando', n: 'F1', label: 'Comando da comunicação', types: ['secom'] },
  { key: 'emergencia', n: 'F2', label: 'Emergência', types: ['defesa-civil'] },
  { key: 'pronto', n: 'F3', label: 'Pronto atendimento', types: ['upa', 'hospital'] },
  { key: 'senha', n: 'F4', label: 'Atendimento por senha', types: ['ubs', 'caps', 'cras', 'central-cidadao', 'sine'] },
  { key: 'educacao', n: 'F5', label: 'Educação', types: ['escola', 'creche'] },
  { key: 'informacao', n: 'F6', label: 'Informação ao público', types: ['camara', 'cultura', 'terminal'] },
  { key: 'geral', n: 'F7', label: 'Geral', types: ['outro'] },
  { key: 'cco', n: 'F8', label: 'Segurança (CCO)', types: ['seguranca'] },
  { key: 'policia-civil', n: 'F9', label: 'Polícia Civil', types: ['policia-civil'] },
  { key: 'policia-militar', n: 'F10', label: 'Polícia Militar', types: ['policia-militar'] },
  { key: 'corporativa', n: 'F11', label: 'Unidade corporativa', types: ['matriz', 'filial', 'fabrica', 'loja', 'cd', 'refeitorio', 'recepcao', 'ambulatorio', 'treinamento', 'corp-outro'] },
];
export const familyOf = (type) => FAMILIES.find((f) => f.types.includes(type))?.key || 'geral';
/** O nome da aba de cada tipo de cartão. */
export const CARD_TAB_LABEL = Object.freeze({ merenda: 'Merenda', escala: 'Escala', vagas: 'Vagas', agenda: 'Agenda', pauta: 'Pauta da sessão', calendario: 'Calendário', linhas: 'Horários das linhas', unidade: 'Aviso da unidade' });
/**
 * As abas da página de controle, na ordem do uso diário: [{ key, label, card? }]. modules: officeModules(); role: o papel de
 * quem entrou (o atendente só vê Atendimento e Recepção); risk: a classificação de risco ligada na chamada de senha (aba
 * Triagem). A família só muda a ordem e as abas próprias (Aprovações e Aviso geral na SECOM; Novo alerta e No ar na Defesa
 * Civil); qualquer módulo ligado acrescenta a aba dele em qualquer família.
 */
export function officeTabs(opts = {}) {
  const list = baseTabs(opts);
  const m = opts.modules || {};
  if (!m.interna || isExternal(opts.type)) return list;
  // comunicação interna: "Códigos de emergência" logo depois do atendimento (qualquer papel dispara e encerra) e
  // "Comunicação interna" (setores, avisos com "Li", telas internas) antes de Telas, só para o gestor
  const at = Math.max(0, ...['atendimento', 'recepcao', 'triagem'].map((k) => list.findIndex((t) => t.key === k) + 1));
  list.splice(at, 0, { key: 'codigos', label: 'Códigos de emergência' });
  if ((opts.role || 'gestor') === 'gestor') { const i = list.findIndex((t) => t.key === 'telas'); list.splice(i < 0 ? list.length : i, 0, { key: 'interna', label: 'Comunicação interna' }); }
  return list;
}
function baseTabs({ type, modules = {}, role = 'gestor', risk = false, devices = 0 } = {}) {
  const fam = familyOf(type); const m = modules || {};
  // emissores conveniados (órgãos de fora): só o que o tipo emite e os próprios envios; a aba Telas só com tela vinculada
  if (isExternal(type)) {
    if (role !== 'gestor') return [];
    const own = [{ key: 'novo-alerta', label: 'Novo alerta' }, { key: 'no-ar', label: 'Meus envios' }, ...(devices > 0 ? [{ key: 'telas', label: 'Telas' }] : [])];
    return type === 'policia-civil' ? [{ key: 'desaparecidos', label: 'Desaparecidos e cartelas' }, ...own] : own;
  }
  const desk = m.senha ? [{ key: 'atendimento', label: 'Atendimento' }, { key: 'recepcao', label: 'Recepção' }] : [];
  if (role !== 'gestor') return desk;
  const cards = officeCardKinds(m).filter((k) => k !== 'unidade').map((k) => ({ key: `card-${k}`, label: CARD_TAB_LABEL[k] || k, card: k }));
  const unidade = { key: 'card-unidade', label: CARD_TAB_LABEL.unidade, card: 'unidade' };
  const avisos = m.avisos ? [{ key: 'avisos', label: 'Avisos' }] : [];
  const alerta = { key: 'alerta', label: 'Alerta' };
  const telas = { key: 'telas', label: 'Telas' };
  const triagem = m.senha && risk ? [{ key: 'triagem', label: 'Triagem' }] : [];
  // §26 a §31: as salas e consultórios, os pedidos de apoio e os indicadores (do gestor), junto da chamada de senha
  const salas = m.senha ? [{ key: 'salas', label: 'Salas e consultórios' }, { key: 'apoio', label: 'Apoio' }, { key: 'indicadores', label: 'Indicadores' }] : [];
  const desap = { key: 'desaparecidos', label: 'Desaparecidos' };
  if (fam === 'comando') return [{ key: 'aprovacoes', label: 'Aprovações' }, { key: 'geral', label: 'Aviso geral' }, alerta, desap, ...desk, ...triagem, ...salas, ...cards, ...avisos, unidade, telas];
  if (fam === 'cco') return [{ key: 'ocorrencias', label: 'Ocorrências' }, { key: 'aprovacoes', label: 'Aprovações' }, { key: 'novo-alerta', label: 'Novo alerta' }, desap, { key: 'no-ar', label: 'No ar' }, ...desk, ...triagem, ...salas, ...cards, ...avisos, unidade, telas];
  // F11 (TV Corporativa): publicar na própria unidade, comunicados, aniversariantes; a senha e o resto pelos módulos ligados
  if (fam === 'corporativa') return [{ key: 'publicar', label: 'Publicar' }, { key: 'comunicados', label: 'Comunicados' }, { key: 'aniversariantes', label: 'Aniversariantes' }, ...desk, ...triagem, ...salas, ...avisos, alerta, telas];
  if (fam === 'emergencia') return [{ key: 'novo-alerta', label: 'Novo alerta' }, { key: 'no-ar', label: 'No ar' }, desap, ...desk, ...triagem, ...salas, ...cards, ...avisos, unidade, telas];
  if (!desk.length && !cards.length) return [...avisos, unidade, alerta, telas];
  return [...desk, ...triagem, ...salas, ...cards, unidade, ...avisos, alerta, telas];
}

/** Comandos que o painel manda ao aparelho (contrato §3). */
export const COMMANDS = [
  { key: 'reload', label: 'Recarregar' },
  { key: 'restart-app', label: 'Reiniciar o app' },
  { key: 'reboot', label: 'Reiniciar o aparelho' },
  { key: 'screenshot', label: 'Captura da tela' },
];
export const COMMAND_KEYS = COMMANDS.map((c) => c.key);

/** Teclas da sequência de saída (lock.exitSeq). */
export const EXIT_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK'];
export const DEFAULT_EXIT_SEQ = ['UP', 'UP', 'DOWN', 'DOWN', 'OK'];

/* Limites (os mesmos no painel e no servidor) */
export const LIMITS = {
  name: 80, address: 200, contact: 120, description: 200,
  tickerItems: 20, tickerItem: 200, tickerSpeedMin: 20, tickerSpeedMax: 200,
  alertTitle: 80, alertText: 500, alertMaxMs: 7 * 86400000, alertMinMs: 60000,
  radiusMin: 100, radiusMax: 100000,
  pinMin: 4, pinMax: 8, exitSeqMin: 4, exitSeqMax: 10,
  linkPasswordMin: 8, linkPasswordMax: 72,
  offices: 2000, regions: 500, groups: 500, devices: 20000,
  // cartões de informação (contrato §7.1): o que a tela recebe e o que a repartição guarda
  cardsSent: 12, cardTitle: 60, cardLines: 8, cardLine: 90, cardsPerOffice: 60, cardSecondsMin: 3, cardSecondsMax: 120, cardSeconds: 10,
  // chamada de senha
  queueServices: 20, queueServiceName: 40, queuePrefix: 3, queueDesk: 30, queueTitle: 60, queueRatioMin: 1, queueRatioMax: 5, queueName: 60, queueWaitingMax: 2000,
  // vídeos guardados (offline.items): por nível (padrão, grupo, repartição) e o que uma tela recebe
  offlinePerScope: 10, offlineSent: 20,
};

/** Sem sinal de vida por isto = desligada (contrato §3). */
export const OFFLINE_MS = 120000;
/** Situação de uma tela para o mapa e as listas: 'on' (no ar), 'warn' (ligada sem imagem), 'off' (sem sinal), 'never' (nunca ligou), 'revoked'. */
export function deviceStatus(d, now = Date.now()) {
  if (d.revokedAt) return 'revoked';
  if (!d.lastSeen) return 'never';
  if (now - d.lastSeen > OFFLINE_MS) return 'off';
  return d.state === 'error' || d.state === 'idle' ? 'warn' : 'on';
}
export const STATUS_LABEL = { on: 'No ar', warn: 'Ligada, sem imagem', off: 'Desligada', never: 'Nunca ligou', revoked: 'Revogada' };

/** Distância em metros entre dois pontos (haversine). */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8; const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad; const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * O alerta alcança a tela? scope: { kind, regions: [ids], groups: [ids], office: id, lat, lng, meters }.
 * dev: { officeId, regionId, lat, lng (os da tela, ou os da repartição), groups: [ids dos grupos da tela] }.
 */
export function scopeHits(scope, dev) {
  switch (scope?.kind) {
    case 'city': return true;
    case 'regions': return dev.regionId != null && (scope.regions || []).includes(dev.regionId);
    case 'groups': return (scope.groups || []).some((g) => (dev.groups || []).includes(g));
    case 'office': return dev.officeId === scope.office;
    case 'radius': return Number.isFinite(dev.lat) && Number.isFinite(dev.lng) && distanceM(scope.lat, scope.lng, dev.lat, dev.lng) <= scope.meters;
    // o alcance da prefeitura (repartição de emergência): tudo, ou a união da própria repartição, das regiões e dos grupos
    case 'reach': return Boolean(scope.all) || (scope.offices || []).includes(dev.officeId) || (dev.regionId != null && (scope.regions || []).includes(dev.regionId)) || (scope.groups || []).some((g) => (dev.groups || []).includes(g));
    default: return false;
  }
}
