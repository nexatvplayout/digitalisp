// NEXA Telas (docs/TELAS.md): o layout de fábrica de cada tipo de repartição e o conteúdo de EXEMPLO da prévia da TV box
// (public/shared/telas-previa.js), os mesmos do blueprint das telas de controle. Usado pelo assistente "Nova repartição" do
// Painel da Prefeitura: escolhido o tipo, a prévia já aparece no layout dele, e a troca de layout é ali mesmo. Só dados e
// funções puras; nada daqui vai ao aparelho (a tela de verdade mostra o que a repartição cadastrar).
import { OFFICE_TYPE, LAYOUT_KEYS, isQueueLayout, serviceColor } from './telas-tipos.js';

/** O layout com que cada tipo nasce (a repartição troca depois; vale o que ela escolher). */
export const DEFAULT_LAYOUT = Object.freeze({
  secom: 'ticker', 'defesa-civil': 'ticker', seguranca: 'ticker', 'policia-civil': 'ticker', 'policia-militar': 'ticker',
  upa: 'queue', hospital: 'side', ubs: 'side', caps: 'side', escola: 'side', creche: 'ticker', cras: 'queue',
  'central-cidadao': 'queue', sine: 'side', camara: 'side', cultura: 'portrait', terminal: 'side', outro: 'ticker',
});
export const defaultLayout = (type) => DEFAULT_LAYOUT[type] || 'ticker';
/** Os layouts que o tipo pode usar: "Chamada de senha" só com a chamada de senha entre os módulos de fábrica. */
export const layoutsFor = (type) => LAYOUT_KEYS.filter((k) => !isQueueLayout(k) || (OFFICE_TYPE[type] || OFFICE_TYPE.outro).modules.includes('senha'));

/** O programa, os avisos e o cartão de exemplo de cada tipo (texto de TESTE, sem nome de gente de verdade). */
const S = {
  secom: { p: ['Jornal da Cidade', 'Edição da tarde'], tk: ['TESTE · Vacinação contra a gripe até sexta em todas as UBS', 'Ouvidoria: 156'], cd: ['Prefeitura informa (teste)', ['IPTU com desconto até dia 30', 'Coleta de lixo normal no feriado']] },
  'defesa-civil': { p: ['Cidade em Alerta', 'Boletim da Defesa Civil'], tk: ['TESTE · Defesa Civil: ligue 199', 'Em área de risco, procure o abrigo mais próximo'], cd: ['Defesa Civil (teste)', ['Plantão 24 horas: 199', 'Abrigos: escolas municipais']] },
  seguranca: { p: ['Cidade Segura', 'Programa de teste'], tk: ['TESTE · Guarda Municipal: 153', 'Emergência: 190', 'Disque Denúncia: 181'], cd: ['Segurança (teste)', ['Guarda Municipal: 153', 'Disque Denúncia: 181']] },
  'policia-civil': { p: ['Cidade Segura', 'Programa de teste'], tk: ['TESTE · Polícia Civil: 197', 'Disque Denúncia: 181 · sigilo garantido'], cd: ['Polícia Civil (teste)', ['Delegacia on-line', 'Disque Denúncia: 181']] },
  'policia-militar': { p: ['Cidade Segura', 'Programa de teste'], tk: ['TESTE · Polícia Militar: 190', 'Em caso de emergência, ligue 190'], cd: ['Polícia Militar (teste)', ['Emergência: 190']] },
  upa: { p: ['Saúde em Dia', 'Programa de teste'], q: { title: 'UPA · Chamada', now: ['C 047', 'Consultório 2'], last: ['C 046', 'P 012', 'C 045', 'C 044', 'P 011'], risk: { vermelho: 0, laranja: 1, amarelo: 4, verde: 9, azul: 2 } }, cd: ['Plantão de hoje (teste)', ['Clínica geral: Dr. Teste A', 'Pediatria: Dra. Teste B']], tk: ['TESTE · Atendimento por classificação de risco'] },
  hospital: { p: ['Saúde em Dia', 'Programa de teste'], sn: ['P 012', 'Pediatria'], cd: ['Plantão de hoje (teste)', ['Ortopedia: Dr. Teste C', 'Cirurgia: Dra. Teste D']], tk: ['TESTE · Visitas das 14h às 16h'] },
  ubs: { p: ['Saúde da Família', 'Programa de teste'], sn: ['A 015', 'Sala 2'], w: ['clock', 'weather'], cd: ['Avisos (teste)', ['Vacina da gripe: seg. a sex.', 'Farmácia até as 16h']], tk: ['TESTE · Vacina da gripe de segunda a sexta'] },
  caps: { p: ['Saúde da Família', 'Programa de teste'], sn: ['A 008', 'Sala 1'], cd: ['Avisos (teste)', ['Acolhimento das 8h às 17h', 'Grupo de convivência: quarta']], tk: ['TESTE · Acolhimento das 8h às 17h'] },
  escola: { p: ['TV Escola', 'Programa de teste'], w: ['clock', 'weather'], cd: ['Merenda de hoje (teste)', ['Arroz e feijão', 'Peixe assado', 'Salada', 'Banana']], tk: ['TESTE · Reunião de pais dia 14, às 19h'] },
  creche: { p: ['Hora da História', 'Programa de teste'], tk: ['TESTE · Saída às 17h', 'Tragam a carteira de vacinação até sexta', 'Reunião de pais dia 14'], cd: ['Cardápio de hoje (teste)', ['Sopa de legumes', 'Fruta']] },
  cras: { p: ['Cidade em Serviço', 'Programa de teste'], q: { title: 'CRAS · Atendimento', now: ['A 031', 'Sala 3'], last: ['A 030', 'P 004', 'A 029'], waiting: 9 }, cd: ['Avisos (teste)', ['Cadastro Único: traga documento com foto']], tk: ['TESTE · Cadastro Único: traga documento com foto'] },
  'central-cidadao': { p: ['Cidade em Serviço', 'Programa de teste'], q: { title: 'Central do Cidadão', now: ['A 128', 'Guichê 3'], last: ['P 031', 'A 127', 'A 126', 'D 019', 'A 125'], waiting: 14 }, cd: ['Avisos (teste)', ['Atendimento das 8h às 17h', 'Traga documento com foto']], tk: ['TESTE · Atendimento das 8h às 17h'] },
  sine: { p: ['Emprego e Renda', 'Programa de teste'], sn: ['A 042', 'Guichê 1'], cd: ['Vagas abertas (teste)', ['Auxiliar de cozinha · 3 vagas', 'Motorista cat. D · 2 vagas', 'Atendente · 5 vagas']], tk: ['TESTE · Novas vagas toda segunda'] },
  camara: { p: ['Sessão Ordinária', 'Transmissão de teste'], cd: ['Pauta da sessão (teste)', ['1. Leitura da ata', '2. Projeto de lei 45/2026', '3. Indicações']], tk: ['TESTE · Sessão ordinária às terças, 18h'] },
  cultura: { p: ['Agenda Cultural', 'Programa de teste'], cd: ['Agenda (teste)', ['Sex 20h · Orquestra jovem', 'Sáb 16h · Teatro infantil', 'Dom 18h · Cinema na praça']], tk: ['TESTE · Bilheteria das 14h às 20h'] },
  terminal: { p: ['Cidade em Movimento', 'Programa de teste'], cd: ['Próximas partidas (teste)', ['101 · Vila Nova · 14:40', '205 · Hospital · 14:45', '310 · Circular · 14:50']], tk: ['TESTE · Linha 205 com novo horário'] },
  outro: { p: ['Prefeitura Informa', 'Programa de teste'], w: ['clock', 'qr'], cd: ['Avisos (teste)', ['Seg. a sex., 8h às 14h', 'Telefone: (21) 0000-0000']], tk: ['TESTE · Atendimento ao público das 8h às 14h'] },
};

/** A configuração da prévia (tvPreview) do tipo no layout escolhido, com o nome da repartição no alto da lateral. */
export function sampleFor(type, layout, name = '') {
  const s = S[type] || S.outro; const t = OFFICE_TYPE[type] || OFFICE_TYPE.outro;
  const l = layout || defaultLayout(type);
  const card = s.cd ? { title: s.cd[0], lines: s.cd[1] } : null;
  return {
    layout: l, channel: 'TV PREFEITURA', program: s.p, ticker: s.tk || [],
    side: { title: name || t.short, widgets: [...(s.w || ['clock']), ...(s.sn ? ['queue'] : [])],...(s.sn ? { queue: s.sn } : {}), ...(card ? { card } : {}) },
    ...(isQueueLayout(l) ? { queue: queueSample(type, s.q) } : {}),
  };
}

/**
 * A chamada de senha de exemplo (layout queue e os do §15): a atual, as anteriores com o local e a hora (rows), as filas com a
 * última senha de cada (services, para queue-duo e queue-grid) e quem espera. Os nomes de fila e de local são de TESTE.
 */
const SAMPLE_SERVICES = {
  upa: [['Clínica geral', 'C', 'Consultório'], ['Pediatria', 'P', 'Consultório'], ['Ortopedia', 'O', 'Sala'], ['Curativo', 'K', 'Sala'], ['Medicação', 'M', 'Sala'], ['Raio X', 'R', 'Sala'], ['Exames', 'E', 'Guichê'], ['Triagem', 'T', 'Sala']],
  cras: [['Cadastro Único', 'A', 'Sala'], ['Bolsa Família', 'B', 'Sala'], ['Benefícios', 'D', 'Guichê'], ['Psicologia', 'S', 'Sala']],
  outro: [['Atendimento geral', 'A', 'Guichê'], ['Protocolo', 'B', 'Guichê'], ['Documentos', 'D', 'Guichê'], ['Tributos', 'T', 'Guichê'], ['Ouvidoria', 'O', 'Sala'], ['Habitação', 'H', 'Sala']],
};
export function queueSample(type, q) {
  const base = q || { title: 'Chamada de senha', now: ['A 128', 'Guichê 3'], last: ['A 127', 'A 126', 'P 031', 'A 125', 'A 124'], waiting: 5 };
  const svc = SAMPLE_SERVICES[type] || SAMPLE_SERVICES.outro;
  const risky = Boolean(base.risk);
  const RK = ['amarelo', 'verde', 'laranja', 'verde', 'azul', 'amarelo'];
  const hh = (i) => `14:${String(32 - i * 3).padStart(2, '0')}`;
  // a mesma letra do local da atual: 'Guichê 3' -> 'Guichê'; o número vai mudando nas anteriores
  const word = String(base.now?.[1] || 'Guichê 3').replace(/\s*\d+\s*$/, '') || 'Guichê';
  const rows = (base.last || []).slice(0, 6).map((t, i) => ({ ticket: t, desk: `${word} ${(i % 4) + 1}`, time: hh(i + 1), risk: risky ? RK[i % RK.length] : null, prio: /^P/.test(t) }));
  const services = svc.map(([name, letter, place], i) => ({ name, ticket: `${letter} ${String(40 - i * 3).padStart(3, '0')}`, desk: `${place} ${i + 1}`, color: serviceColor(i), hot: i === 0 }));
  return { ...base, nowRisk: risky ? 'amarelo' : null, nowPrio: false, nowTime: hh(0), nowService: svc[0][0], rows, services, serving: [{ ticket: `${svc[1][1]} 019`, desk: `${word} 4`, risk: risky ? 'verde' : null }] };
}
