// DIGITAL ISP · a biblioteca de templates (docs/FUNCIONALIDADES.md §4): gerada por família a partir dos dados de
// public/shared/templates-dados.js, nada escrito um a um. Cada segmento tem 12 peças; cada peça, 5 variações de texto, cada
// uma com o seu estilo (cor, tema claro ou escuro, arte) e nos dois formatos (deitado e em pé): 12 × 5 × 2 = 120 por segmento.
// Um template é um slide de modelo pronto ({ template, fields }) no formato que o servidor valida (cleanSlide) e a prévia
// desenha (slidePreview). Sem DOM e sem dependências além dos dados: o painel, o servidor e os testes importam direto.
//
//   templateCatalog()                 todos (memorizado), na ordem: grupo, segmento, peça, variação, formato
//   filterTemplates(list, { q, group, segment, piece, orient })
import { GROUPS, SEGMENTS, CORP_SEGMENTS, CORP, HORARIOS, DATAS, INTERNOS, PROVEDOR_FOTOS } from './templates-dados.js';

export { GROUPS };
/** As peças (o filtro "peça" do painel). */
export const PIECES = [
  ['oferta', 'Oferta'], ['preco', 'Preço'], ['combo', 'Combo e pacote'], ['destaque', 'Destaque'], ['cardapio', 'Cardápio e tabela de preços'],
  ['promocao', 'Promoção da semana'], ['boas-vindas', 'Boas-vindas'], ['horario', 'Horário'], ['datas', 'Datas comemorativas'], ['aviso', 'Avisos'],
  ['institucional', 'Institucional'], ['qr', 'QR code'], ['redes', 'Redes sociais'], ['servicos', 'Serviços'], ['agenda', 'Agenda e programação'],
  ['evento', 'Evento'], ['dica', 'Dicas e orientações'], ['campanha', 'Campanhas'], ['indicador', 'Metas e indicadores'], ['seguranca', 'Segurança do trabalho'],
  ['vaga', 'Vagas'], ['reconhecimento', 'Reconhecimento'], ['aniversariantes', 'Aniversariantes'], ['beneficio', 'Benefícios'], ['visitante', 'Visitantes'],
].map(([key, label]) => ({ key, label }));
export const PIECE = Object.fromEntries(PIECES.map((p) => [p.key, p]));
export const ALL_SEGMENTS = [...SEGMENTS, ...CORP_SEGMENTS, INTERNOS, PROVEDOR_FOTOS];
export const SEGMENT = Object.fromEntries(ALL_SEGMENTS.map((s) => [s.key, s]));
const LOJA_PIECES = ['oferta', 'preco', 'combo', 'cardapio', 'promocao', 'boas-vindas', 'horario', 'datas', 'aviso', 'institucional', 'qr', 'redes'];
const INST_PIECES = ['servicos', 'agenda', 'evento', 'dica', 'campanha', 'boas-vindas', 'horario', 'datas', 'aviso', 'institucional', 'qr', 'redes'];
/** As peças de um segmento, na ordem. */
export const piecesOf = (seg) => (seg.kind === 'fixo' ? [...new Set(seg.itens.map((x) => x[0]))] : seg.kind === 'corp' ? seg.pecas : seg.kind === 'inst' ? INST_PIECES : LOJA_PIECES.map((p) => (p === 'combo' && seg.semCombo ? 'destaque' : p)));
export const VARIANTS = 5;

/* ------------------------------------------------------------------ utilidades */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** R$ com milhar e centavos (sem depender do Intl: igual no servidor, no painel e nas TVs). */
export function money(v) {
  const c = Math.round(Number(v) * 100);
  const int = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${int},${pad(c % 100)}`;
}
/** O "de" de uma oferta: uns 20% acima, terminado em ,90 (ou cheio nos valores altos). */
function priceUp(p) {
  const x = p * 1.2;
  if (x >= 1000) return Math.ceil(x / 100) * 100 - 1;
  if (x >= 100) return Math.ceil(x) - 0.1;
  return Math.floor(x) + 0.9;
}
/** O preço de promoção: uns 15% abaixo, terminado em ,99 (ou ,90 / cheio nos valores altos). */
function priceDown(p, f = 0.85) {
  const x = p * f;
  if (x >= 1000) return Math.floor(x / 10) * 10 - 1;
  if (x >= 100) return Math.floor(x) - 0.1;
  return Math.max(0.49, Math.floor(x * 10) / 10 - 0.01);
}
const lc1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** A data comemorativa com a assinatura da empresa (quando o texto ainda não cita o nome). */
const signed = (t) => (t.includes('{nome}') ? t : `${t} Um abraço da equipe {do} {nome}.`);
const fill = (t, seg) => { const f = seg.g === 'f'; return t.replace(/\{nome\}/g, seg.nome).replace(/\{o\}/g, f ? 'a' : 'o').replace(/\{O\}/g, f ? 'A' : 'O').replace(/\{do\}/g, f ? 'da' : 'do').replace(/\{na\}/g, f ? 'na' : 'no').replace(/\{Na\}/g, f ? 'Na' : 'No'); };
const split = (s) => { const i = s.indexOf('|'); return [s.slice(0, i), s.slice(i + 1)]; };
/** Os primeiros n sem repetir o título. */
const uniqueBy = (list, n) => { const seen = new Set(); const out = []; for (const x of list) { const k = split(x)[0]; if (!seen.has(k)) { seen.add(k); out.push(x); } if (out.length === n) break; } return out; };
const rot = (list, k) => list.map((_, i) => list[(i + k) % list.length]);
/** O endereço de exemplo do QR code (a pessoa troca pelo dela). */
const slugOf = (seg) => seg.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const qrUrl = (seg, path) => `https://exemplo.com.br/${slugOf(seg)}/${path}`;
const handleOf = (seg) => `@${slugOf(seg)}`.slice(0, 40);

/** A próxima data (a partir de hoje) de uma data comemorativa. */
export function nextDate(d, now = Date.now()) {
  const t0 = new Date(now); const today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  const at = (y) => {
    if (d.md) return new Date(y, d.md[0] - 1, d.md[1]);
    if (d.rule === 'maes' || d.rule === 'pais') { const m = d.rule === 'maes' ? 4 : 7; const first = new Date(y, m, 1); return new Date(y, m, 1 + ((7 - first.getDay()) % 7) + 7); }
    // Páscoa (algoritmo anônimo gregoriano, de Meeus/Jones/Butcher)
    const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const dd = Math.floor(b / 4); const e = b % 4;
    const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - dd - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  };
  const d1 = at(today.getFullYear());
  return iso(d1 >= today ? d1 : at(today.getFullYear() + 1));
}
const dayAhead = (n, now = Date.now()) => { const d = new Date(now + n * 86400000); return iso(d); };
/** O dia do evento: daqui a n dias, ou [mês, dia] fixo (o que tem época, como o fim de ano). */
const eventDay = (d) => (Array.isArray(d) ? nextDate({ md: d }) : dayAhead(d));

/* ------------------------------------------------------------------ textos gerais por perfil */
const T = {
  ofertaTag: ['OFERTA', 'IMPERDÍVEL', 'PREÇO BAIXO', 'SÓ ESTA SEMANA', 'APROVEITE'],
  ofertaTxt: {
    produto: ['Oferta válida enquanto durar o estoque.', 'Preço especial para pagamento à vista.', 'Limite de 5 unidades por cliente.', 'Confira as outras ofertas na loja.', 'Aproveite: o preço baixou!'],
    comida: ['Feito na hora, do jeito que você gosta.', 'Peça já o seu!', 'Vale para consumo no local e para viagem.', 'Aproveite enquanto durar.', 'Sabor caprichado e preço amigo.'],
    servico: ['Agende o seu horário.', 'Preço especial para pagamento à vista.', 'Consulte as condições no atendimento.', 'Vagas limitadas na agenda.', 'Condição especial por tempo limitado.'],
  },
  precoTag: ['PREÇO', 'NOSSO PREÇO', 'PREÇO DO DIA', 'PREÇO FIXO', 'CONFIRA'],
  precoTxt: {
    produto: ['Qualidade com preço justo.', 'Preço de todo dia.', 'Economize e leve qualidade.', 'Compare e comprove.', 'Preço válido nesta loja.'],
    comida: ['Bem servido e saboroso.', 'O preferido da casa.', 'Preparado com ingredientes frescos.', 'Experimente hoje mesmo.', 'Pediu, chegou quentinho.'],
    servico: ['Qualidade e preço justo.', 'Atendimento com hora marcada.', 'Profissionais experientes.', 'Feito com capricho.', 'Peça já o seu orçamento.'],
  },
  promoTxt: {
    produto: ['De segunda a domingo, enquanto durar o estoque.', 'Só nesta semana: aproveite!', 'Promoção válida até domingo.', 'Corra: a promoção acaba no domingo.', 'Preço especial durante toda a semana.'],
    comida: ['Só nesta semana: peça já!', 'Promoção válida até domingo.', 'Preço especial durante toda a semana.', 'Corra: a promoção acaba no domingo.', 'De segunda a domingo, no balcão e para viagem.'],
    servico: ['Só nesta semana: agende já!', 'Promoção válida até domingo.', 'Preço especial durante toda a semana.', 'Garanta o seu horário nesta semana.', 'Aproveite: só até domingo.'],
  },
  destaqueTag: ['DESTAQUE', 'NOVIDADE', 'OPORTUNIDADE', 'EXCLUSIVO', 'PRONTO PARA MORAR'],
  destaqueTxt: ['Agende a sua visita com o nosso corretor.', 'Fale com a gente e conheça.', 'Documentação em dia.', 'Ótima localização, perto de tudo.', 'Condições facilitadas. Consulte.'],
  comboNome: ['econômico', 'completo', 'da semana', 'especial', 'da casa'],
  tabelaTit: {
    produto: ['Tabela de preços', 'Preços de hoje', 'Confira os nossos preços', 'Vitrine da semana', 'Mais vendidos'],
    comida: ['Cardápio', 'Nossos pratos', 'Peça já', 'Cardápio do dia', 'Mais pedidos'],
    servico: ['Tabela de serviços', 'Nossos serviços', 'Serviços e valores', 'Mais procurados', 'Lista de preços'],
  },
  tabelaNota: {
    produto: ['Preços válidos nesta loja.', 'Consulte outras opções com o atendente.', 'Preços sujeitos a alteração sem aviso.', 'Pagamento em dinheiro, cartão ou transferência.', 'Confira as ofertas da semana no caixa.'],
    comida: ['Peça também para viagem.', 'Pergunte pelas opções do dia.', 'Pergunte pelas opções sem glúten e sem lactose.', 'Tem alergia? Avise o atendente.', 'Pagamento em dinheiro, cartão ou transferência.'],
    servico: ['Valores de referência: consulte o atendente.', 'Agende pelo telefone.', 'Pagamento em dinheiro ou cartão.', 'Consulte os pacotes no atendimento.', 'O valor final depende da avaliação.'],
  },
  bvTit: { loja: ['Seja bem-vindo!', 'Que bom ter você aqui!', 'Bem-vindo, cliente!', 'Olá! Seja bem-vindo', 'Fique à vontade!'], inst: ['Seja bem-vindo!', 'Que bom ter você aqui', 'Bem-vindo!', 'Olá, seja bem-vindo', 'Fique à vontade'] },
  bvTxt: { loja: ['Qualquer dúvida, fale com a nossa equipe.', 'Obrigado pela preferência.', 'Aqui você é atendido com carinho.', 'Aproveite a visita e conte com a gente.'], inst: ['Qualquer dúvida, fale com a recepção.', 'Obrigado pela confiança.', 'Aqui você é atendido com respeito.', 'Conte com a nossa equipe.'] },
  horTit: ['Horário {do} {nome}', 'Nosso horário', 'Estamos abertos', 'Horário de atendimento', 'Venha visitar {o} {nome}'],
  horNota: { loja: ['Nos feriados, o horário pode mudar.', 'Atendimento por telefone no mesmo horário.', 'Confira o horário especial de fim de ano.', 'Siga as nossas redes para saber das novidades.', 'Obrigado pela visita. Volte sempre!'],
    inst: ['Nos feriados, o horário pode mudar.', 'Atendimento por telefone no mesmo horário.', 'Confira o horário especial de fim de ano.', 'Siga as nossas redes para saber das novidades.', 'Dúvidas? Fale com a recepção.'] },
  aviso: {
    produto: ['Formas de pagamento|{O} {nome} aceita dinheiro, cartões de débito e de crédito e transferência na hora.', 'Atendimento prioritário|{Na} {nome}, idosos, gestantes, pessoas com deficiência e com criança de colo têm prioridade.', 'Ambiente monitorado|{O} {nome} tem câmeras de segurança para a sua tranquilidade.'],
    comida: ['Formas de pagamento|{O} {nome} aceita dinheiro, cartões de débito e de crédito e transferência na hora.', 'Alergias|Tem alergia a algum ingrediente? Avise a equipe {do} {nome}.', 'Para viagem|{O} {nome} embala o seu pedido para levar.'],
    servico: ['Formas de pagamento|{O} {nome} aceita dinheiro, cartões de débito e de crédito e transferência na hora.', 'Hora marcada|Agende {na} {nome} e evite espera.', 'Atendimento prioritário|{Na} {nome}, idosos, gestantes, pessoas com deficiência e com criança de colo têm prioridade.'],
    inst: ['Atendimento prioritário|{Na} {nome}, idosos, gestantes, pessoas com deficiência e com criança de colo têm prioridade.', 'Celular no silencioso|{O} {nome} agradece a colaboração com o silêncio.', 'Achados e perdidos|Perdeu algo {na} {nome}? Procure a recepção.'],
  },
  inst: {
    loja: ['Feito com carinho|{O} {nome} trabalha todos os dias para oferecer o melhor a você.', 'Nossa equipe|A equipe {do} {nome} está preparada para atender você bem.', 'Obrigado pela preferência|Sua confiança é o maior incentivo {do} {nome}.', 'Compromisso com a qualidade|{O} {nome} escolhe com cuidado tudo o que oferece.'],
    inst: ['Nossa missão|Atender bem, com respeito e responsabilidade: esse é o compromisso {do} {nome}.', 'Nossa equipe|A equipe {do} {nome} está preparada para cuidar de você.', 'Obrigado pela confiança|{O} {nome} trabalha todos os dias para merecer a sua preferência.', 'Acessibilidade|{O} {nome} tem espaço adaptado para pessoas com deficiência.'],
  },
  qr: {
    produto: [['Receba as ofertas da semana', 'Aponte a câmera e cadastre-se.', 'ofertas'], ['Avalie a sua compra', 'Sua opinião leva 1 minuto e ajuda muito.', 'avaliacao'], ['Compre pelo celular', 'Aponte a câmera e faça o seu pedido.', 'pedido'], ['Fale com a gente', 'Tire as suas dúvidas pelo celular.', 'contato'], ['Programa de fidelidade', 'Cadastre-se e junte pontos a cada compra.', 'fidelidade']],
    comida: [['Veja o cardápio completo', 'Aponte a câmera do celular.', 'cardapio'], ['Peça pelo celular', 'Sem fila: aponte a câmera e faça o pedido.', 'pedido'], ['Avalie a sua refeição', 'Sua opinião ajuda a gente a melhorar.', 'avaliacao'], ['Fale com a gente', 'Tire as suas dúvidas pelo celular.', 'contato'], ['Cartão fidelidade', 'A cada 10 pedidos, ganhe um desconto.', 'fidelidade']],
    servico: [['Agende pelo celular', 'Aponte a câmera e escolha o melhor horário.', 'agenda'], ['Avalie o atendimento', 'Sua opinião leva 1 minuto.', 'avaliacao'], ['Peça o seu orçamento', 'Aponte a câmera e conte o que precisa.', 'orcamento'], ['Fale com a gente', 'Tire as suas dúvidas pelo celular.', 'contato'], ['Veja os nossos trabalhos', 'Aponte a câmera e confira.', 'portfolio']],
    inst: [['Avalie o atendimento', 'Sua opinião leva 1 minuto e ajuda muito.', 'avaliacao'], ['Agende pelo celular', 'Aponte a câmera e escolha o melhor horário.', 'agenda'], ['Fale com a gente', 'Tire as suas dúvidas pelo celular.', 'contato'], ['Ouvidoria', 'Elogios, sugestões e reclamações.', 'ouvidoria'], ['Acompanhe as novidades', 'Aponte a câmera e receba as notícias.', 'novidades']],
  },
  redesTit: ['Siga a gente nas redes', 'Estamos nas redes sociais', 'Acompanhe nas redes', 'Curtiu? Siga a gente!', 'Nossas redes'],
  redesTxt: { loja: ['Fique por dentro das novidades.', 'Novidades e bastidores todos os dias.', 'Marque a gente nas suas fotos!', 'Mande a sua dúvida por mensagem: respondemos rápido.', 'Promoções exclusivas para quem segue a gente.'],
    inst: ['Fique por dentro das novidades.', 'Avisos e novidades em primeira mão.', 'Dicas e informações todos os dias.', 'Mande a sua dúvida por mensagem: respondemos rápido.', 'Acompanhe a nossa agenda.'] },
  servTit: ['Nossos serviços', 'Como podemos ajudar', 'Guia de atendimento', 'Serviços'],
  servNota: ['Dúvidas? Fale com a recepção.', 'Consulte a disponibilidade na recepção.', 'Atendimento com senha, por ordem de chegada.', 'Agende pelo telefone.', 'Obrigado pela visita.'],
  agendaTit: ['Programação', 'Agenda da semana', 'Fique por dentro', 'Anote na agenda'],
  agendaNota: ['Os horários podem mudar nos feriados.', 'Dúvidas? Fale com a recepção.', 'Acompanhe as novidades nas nossas redes.', 'Participe!', 'Obrigado pela presença.'],
  eventoInst: [['Horário especial de fim de ano', 'Recepção', 'Confira os dias de atendimento nas festas de fim de ano.', [12, 20]], ['Arrecadação de alimentos', 'Recepção', 'Doe alimentos não perecíveis até a data. O ponto de coleta fica na recepção.', 14]],
  dica: ['Gentileza gera gentileza|Um bom-dia faz diferença {na} {nome}.', 'Cuide do espaço|Lixo no lixo: ajude a cuidar {do} {nome}.', 'Fila organizada|{Na} {nome}, aguarde a sua vez e respeite o atendimento preferencial.'],
  campanha: ['Doe sangue|Uma doação pode salvar até quatro vidas.', 'Coleta seletiva|Separe o lixo reciclável e ajude o meio ambiente.', 'Campanha do agasalho|Doe roupas e cobertores em bom estado.', 'Economia de energia|Apague as luzes ao sair e economize energia.'],
};

/* ------------------------------------------------------------------ estilos: 5 por peça, girando */
/**
 * O estilo da variação v (0..4) da peça de índice pi: cor (palette), tema (variant) e arte. Gira pela peça para que as
 * variações de texto não caiam sempre no mesmo estilo.
 */
function styleOf(seg, pi, v, si = 0) {
  const k = (v + pi + si) % VARIANTS;
  const [p0, p1, p2] = seg.pal;
  const [a0, a1] = seg.arts;
  return [
    { palette: p0, variant: 'dark' },
    { palette: p1, variant: 'light' },
    { palette: p2, variant: 'dark', art: seg.foto || a0 },
    { palette: p0, variant: 'dark', art: seg.foto ? a0 : a1 },
    { palette: p1, variant: 'light', art: seg.light || 'papel' },
  ][k];
}

/* ------------------------------------------------------------------ peças: [template, fields] da variação i */
function lojaPiece(seg, piece, i) {
  const pf = seg.perfil;
  const it = seg.itens;
  const n = it.length;
  const tail = (t, ...names) => (names.some((nm) => seg.alcool?.some((a) => nm.startsWith(a))) ? `${t} Beba com moderação.` : t);
  const unitOf = ([, p, u]) => u || (seg.parcelas ? `ou ${seg.parcelas}x de ${money(Math.round((p / seg.parcelas) * 100) / 100)}` : '');
  switch (piece) {
    case 'oferta': { const x = it[i]; return ['oferta', { title: x[0], price: money(x[1]), oldPrice: money(priceUp(x[1])), unit: unitOf(x), tag: T.ofertaTag[i], text: tail(T.ofertaTxt[pf][i], x[0]) }]; }
    case 'preco': { const x = it[(i + 5) % n]; return ['oferta', { title: x[0], price: money(x[1]), unit: unitOf(x), tag: T.precoTag[i], text: tail(T.precoTxt[pf][i], x[0]) }]; }
    case 'promocao': { const x = it[(i * 2 + 1) % n]; const p = priceDown(x[1]); return ['oferta', { title: x[0], price: money(p), oldPrice: money(x[1]), unit: x[2] || '', tag: 'PROMOÇÃO DA SEMANA', text: tail(T.promoTxt[pf][i], x[0]) }]; }
    case 'destaque': { const x = it[n - 1 - i]; return ['oferta', { title: x[0], price: money(x[1]), unit: x[2] || '', tag: T.destaqueTag[i], text: T.destaqueTxt[i] }]; }
    case 'combo': {
      const word = seg.combo || (pf === 'servico' ? 'Pacote' : 'Combo');
      if (seg.combos) {
        const [title, items, price] = seg.combos[i];
        const sum = items.reduce((s, nm) => s + (it.find((x) => x[0] === nm)?.[1] || 0), 0);
        return ['combo', { title, text: items.join('\n'), price: money(price), ...(sum > price * 1.05 ? { oldPrice: money(sum), tag: `ECONOMIZE ${money(sum - price)}` } : { tag: 'PREÇO ESPECIAL' }) }];
      }
      const pick = [it[i % n], it[(i + 3) % n], it[(i + 6) % n]];
      const sum = pick.reduce((s, x) => s + x[1], 0);
      const price = priceDown(sum);
      const lines = pick.map((x) => (x[2] === 'o kg' ? `1 kg de ${lc1(x[0])}` : x[0]));
      return ['combo', { title: `${word} ${T.comboNome[i]}`, text: lines.join('\n'), price: money(price), oldPrice: money(sum), tag: `ECONOMIZE ${money(sum - price)}` }];
    }
    case 'cardapio': {
      const rows = [0, 1, 2, 3, 4, 5].map((k) => it[(i * 2 + k) % n]).map((x) => `${x[0]} | ${money(x[1])}${x[2] === 'o kg' ? '/kg' : ''}`);
      return ['precos', { title: T.tabelaTit[pf][i], text: rows.join('\n'), note: T.tabelaNota[pf][i] }];
    }
    default: return null;
  }
}
function instPiece(seg, piece, i) {
  switch (piece) {
    case 'servicos': {
      const idx = [0, 1, 2, 3, 4, 5].map((k) => (i + k) % seg.itens.length).sort((a, b) => a - b);
      const tit = [seg.servicosTitulo, ...T.servTit][i];
      return ['precos', { title: tit, text: idx.map((k) => seg.itens[k].join(' | ')).join('\n'), note: T.servNota[i] }];
    }
    case 'agenda': return ['horario', { title: [seg.agendaTitulo, ...T.agendaTit][i], text: seg.agenda.map((r) => r.join(' | ')).join('\n'), note: T.agendaNota[i] }];
    case 'evento': {
      const ev = [...seg.eventos.map((e, k) => [...e, 7 + k * 9]), ...T.eventoInst][i];
      return ['evento', { title: ev[0], place: ev[1], text: ev[2], target: `${eventDay(ev[3])}T${['09:00', '19:30', '14:00', '10:00', '08:00'][i]}`, qr: qrUrl(seg, 'agenda') }];
    }
    case 'dica': { const [title, text] = split(fill(uniqueBy([...seg.dicas, ...T.dica], 5)[i], seg)); return ['comunicado', { title, text }]; }
    case 'campanha': { const [title, text] = split(uniqueBy([...seg.campanhas, ...T.campanha], 5)[i]); return ['comunicado', { title, text, qr: qrUrl(seg, 'campanhas') }]; }
    default: return null;
  }
}
function corpPiece(seg, piece, i, si) {
  const pool = (k) => rot(CORP[k], si)[i];
  switch (piece) {
    case 'seguranca': { const [title, text] = split(pool('seguranca')); return ['seguranca', { title, text }]; }
    case 'indicador': { const [title, value, target, unit, text] = pool('indicador'); return ['indicador', { title, value, target, ...(unit ? { unit } : {}), text }]; }
    case 'evento': { const [title, place, text, d] = pool('evento'); return ['evento', { title, place, text, target: `${eventDay(d)}T${['09:00', '18:00', '14:00', '10:00', '08:30'][i]}` }]; }
    case 'vaga': { const [title, area, text, d] = pool('vaga'); return ['vaga', { title, area, text, until: dayAhead(d), qr: `https://exemplo.com.br/grupohorizonte/vagas` }]; }
    case 'reconhecimento': { const [title, name, text] = pool('reconhecimento'); return ['reconhecimento', { title, name, text }]; }
    case 'cardapio': { const [title, text] = pool('cardapio'); return ['cardapio', { title, text }]; }
    case 'aniversariantes': { const [title, text] = pool('aniversariantes'); return ['aniversariantes', { title, text }]; }
    case 'aviso': case 'institucional': case 'beneficio': case 'visitante': { const [title, text] = split(pool(piece)); return ['comunicado', { title, text }]; }
    case 'qr': { const [title, text, path] = pool('qr'); return ['qr', { title, text, qr: `https://exemplo.com.br/grupohorizonte/${path}` }]; }
    case 'boas-vindas': { const [title, name, sector, text] = pool('boas-vindas'); return ['boas-vindas', { title, name, sector, text }]; }
    case 'horario': { const [title, text] = pool('horario'); return ['horario', { title, text, note: T.horNota.inst[i] }]; }
    case 'datas': { const d = DATAS[rot(CORP.datas, si)[i]]; return ['data-comemorativa', { title: d.title, date: nextDate(d), text: fill(d.text, seg) }]; }
    case 'redes': return ['redes', { title: T.redesTit[i], handle: '@grupohorizonte', text: T.redesTxt.inst[i], qr: 'https://exemplo.com.br/grupohorizonte/redes' }];
    default: return null;
  }
}
/** As peças comuns a loja e inst (boas-vindas, horário, datas, avisos, institucional, QR, redes). */
function commonPiece(seg, piece, i) {
  const kind = seg.kind === 'loja' ? 'loja' : 'inst';
  const perfil = seg.kind === 'loja' ? seg.perfil : 'inst';
  switch (piece) {
    case 'boas-vindas': return ['boas-vindas', { title: T.bvTit[kind][i], name: seg.nome, sector: seg.label, text: [seg.bemvindo, ...T.bvTxt[kind]][i] }];
    // o nome da empresa no título ou o QR code próprio: dois segmentos com o mesmo horário não dão o mesmo template
    case 'horario': return ['horario', { title: fill(T.horTit[i], seg), text: HORARIOS[seg.horario], note: T.horNota[kind][i], ...([1, 2, 3].includes(i) ? { qr: qrUrl(seg, 'horario') } : {}) }];
    case 'datas': { const d = DATAS[seg.datas[i]]; return ['data-comemorativa', { title: d.title, date: nextDate(d), text: fill(signed(d.text), seg) }]; }
    case 'aviso': { const [title, text] = split(fill(uniqueBy([...seg.avisos, ...T.aviso[perfil]], 5)[i], seg)); return ['comunicado', { title, text }]; }
    case 'institucional': { const [title, text] = split(uniqueBy([...seg.inst, ...T.inst[kind].map((x) => fill(x, seg))], 5)[i]); return ['comunicado', { title, text }]; }
    case 'qr': { const [title, text, path] = T.qr[perfil][i]; const qrSize = ['l', 'xl', '', 'l', 'xl'][i]; return ['qr', { title, text, qr: qrUrl(seg, path), ...(qrSize ? { qrSize } : {}) }]; }
    case 'redes': return ['redes', { title: T.redesTit[i], handle: handleOf(seg), text: T.redesTxt[kind][i], qr: qrUrl(seg, 'redes') }];
    default: return null;
  }
}

/* ------------------------------------------------------------------ o catálogo */
const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.key, g.label]));

/** As datas dos prontos: { days, at } -> daqui a n dias; { md, at } -> a próxima vez no ano (com a hora, se houver). */
const whenOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? `${v.md ? nextDate({ md: v.md }) : dayAhead(v.days)}${v.at ? `T${v.at}` : ''}` : v);
/** Os prontos escritos um a um (uso interno com foto): cada um nos dois formatos, com a foto e a cor dele. */
function fixedOf(seg) {
  const out = []; const count = {};
  for (const [piece, template, base0, art, palette] of seg.itens) {
    const i = (count[piece] = (count[piece] || 0) + 1);
    const base = Object.fromEntries(Object.entries(base0).map(([k, v]) => [k, whenOf(v)]));
    for (const orient of ['land', 'port']) {
      const fields = { ...base, palette, variant: 'dark', art, ...(orient === 'port' ? { orient } : {}) };
      out.push({
        id: `${seg.key}-${piece}-${i}-${orient}`, segment: seg.key, segmentLabel: seg.label, group: seg.group, groupLabel: GROUP_LABEL[seg.group],
        piece, pieceLabel: PIECE[piece].label, variant: i, orient, template, fields, name: `${seg.label} · ${PIECE[piece].label} ${i}`,
        search: strip([seg.label, GROUP_LABEL[seg.group], PIECE[piece].label, 'foto', ...Object.values(base)].join(' ')),
      });
    }
  }
  return out;
}
/** Gera os templates (now: a data de hoje, para as datas comemorativas e os eventos). */
export function buildCatalog() {
  const out = [];
  const used = new Set();
  const corpIdx = new Map(CORP_SEGMENTS.map((s, i) => [s.key, i]));
  const order = GROUPS.flatMap((g) => ALL_SEGMENTS.filter((s) => s.group === g.key));
  for (const [segIdx, seg] of order.entries()) {
    if (seg.kind === 'fixo') { out.push(...fixedOf(seg)); continue; }
    piecesOf(seg).forEach((piece, pi) => {
      for (let i = 0; i < VARIANTS; i++) {
        const made = seg.kind === 'corp' ? corpPiece(seg, piece, i, corpIdx.get(seg.key) * 2)
          : (seg.kind === 'loja' ? lojaPiece(seg, piece, i) : instPiece(seg, piece, i)) || commonPiece(seg, piece, i);
        if (!made) throw new Error(`peça sem gerador: ${seg.key}/${piece}`);
        const [template, base] = made;
        // o estilo da vez; se o mesmo texto já saiu com ele (num tema parecido), o próximo: não há dois templates iguais
        let style = styleOf(seg, pi, i, segIdx);
        for (let s = 1; s < VARIANTS && used.has(`${template}|${JSON.stringify({ ...base, ...style })}`); s++) style = styleOf(seg, pi, i, segIdx + s);
        used.add(`${template}|${JSON.stringify({ ...base, ...style })}`);
        for (const orient of ['land', 'port']) {
          const fields = { ...base, ...style, ...(orient === 'port' ? { orient } : {}) };
          for (const k of Object.keys(fields)) if (fields[k] == null || fields[k] === '') delete fields[k];
          const label = `${seg.label} · ${PIECE[piece].label} ${i + 1}`;
          out.push({
            id: `${seg.key}-${piece}-${i + 1}-${orient}`, segment: seg.key, segmentLabel: seg.label, group: seg.group, groupLabel: GROUP_LABEL[seg.group],
            piece, pieceLabel: PIECE[piece].label, variant: i + 1, orient, template, fields, name: label,
            search: strip([seg.label, GROUP_LABEL[seg.group], PIECE[piece].label, ...Object.values(base)].join(' ')),
          });
        }
      }
    });
  }
  return out;
}
let memo = null;
/** Todos os templates (gerados uma vez por carga da página). */
export const templateCatalog = () => (memo ||= buildCatalog());

/** Filtra pela busca (sem acento, todas as palavras), grupo, segmento, peça e formato. */
export function filterTemplates(list, { q = '', group = '', segment = '', piece = '', orient = '' } = {}) {
  const words = strip(q).split(/\s+/).filter(Boolean);
  return list.filter((t) => (!group || t.group === group) && (!segment || t.segment === segment) && (!piece || t.piece === piece) && (!orient || t.orient === orient)
    && words.every((w) => t.search.includes(w)));
}
