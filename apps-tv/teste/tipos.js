'use strict';
/*
 * Um item de cada tipo que o servidor manda na grade (server/tvcorp.js signageFor + server/tvcorp-dados.js dataFor),
 * com os dados no mesmo formato, para o teste visual do app de TV contra a prévia do painel.
 * `arquivo(nome)` devolve { url, sha256, bytes, type } de um arquivo de mídia do servidor falso.
 */
function itensTipos(arquivo, agora) {
  const hoje = new Date(agora);
  const dia = (d) => { const x = new Date(agora + d * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const f = (nome) => { const a = arquivo(nome); return a ? { url: a.url, sha256: a.sha256, bytes: a.bytes } : null; };
  const s = 4;
  return [
    Object.assign({ id: 'm-img', kind: 'image', seconds: s, caption: 'Oferta da semana', fit: 'contain' }, f('oferta-a.svg')),
    { id: 's-comunicado', kind: 'slide', seconds: s, template: 'comunicado', fields: { title: 'Reunião geral', text: 'Quinta, às 9h, no auditório.\nTraga sugestões.', lines: ['Quinta, às 9h, no auditório.', 'Traga sugestões.'], qr: 'https://exemplo.com.br/reuniao' } },
    { id: 's-boasvindas', kind: 'slide', seconds: s, template: 'boas-vindas', fields: { title: 'Seja bem-vinda!', name: 'Ana Souza', sector: 'Financeiro', image: f('foto-ana.svg') } },
    { id: 's-evento', kind: 'slide', seconds: s, template: 'evento', fields: { title: 'Festa de fim de ano', place: 'Salão principal', text: 'Traga a família', target: `${dia(12)}T19:00`, qr: 'https://exemplo.com.br/festa' } },
    { id: 's-indicador', kind: 'slide', seconds: s, template: 'indicador', fields: { title: 'Vendas do mês', value: 82, target: 100, unit: '%', kpi: { value: 82, target: 100, unit: '%' } } },
    { id: 's-legenda', kind: 'slide', seconds: s, template: 'imagem-com-legenda', fields: { image: f('cardapio.svg'), caption: 'Nosso prato do dia' } },
    { id: 's-seguranca', kind: 'slide', seconds: s, template: 'seguranca', fields: { title: 'Use os EPIs', text: 'Capacete, luvas e óculos.', lines: ['Capacete', 'Luvas', 'Óculos'] } },
    { id: 's-vaga', kind: 'slide', seconds: s, template: 'vaga', fields: { title: 'Analista de suporte', area: 'TI', text: 'Inscrições com o RH.', until: dia(10) } },
    { id: 's-cardapio', kind: 'slide', seconds: s, template: 'cardapio', fields: { title: 'Cardápio de hoje', text: 'Arroz e feijão\nFrango grelhado\nSalada', items: ['Arroz e feijão', 'Frango grelhado', 'Salada'] } },
    { id: 's-datas', kind: 'slide', seconds: s, template: 'data-comemorativa', fields: { title: 'Dia do Técnico', text: 'Parabéns a toda a equipe!' } },
    // os modelos com arte e foto de fundo da biblioteca (public/tvcorp/arte: .svg e .jpg), paleta e em pé
    { id: 's-arte', kind: 'slide', seconds: s, template: 'comunicado', fields: { title: 'Arte de fundo', text: 'Listras da biblioteca', art: 'listras' } },
    { id: 's-oferta', kind: 'slide', seconds: s, template: 'oferta', fields: { title: 'Pão francês', price: 'R$ 12,90', oldPrice: 'R$ 15,90', unit: 'kg', tag: 'Oferta', text: 'Quentinho toda hora', until: dia(3), art: 'foto-padaria', artFile: f('foto-marcos.svg'), qr: 'https://exemplo.com.br/oferta' } },
    { id: 's-precos', kind: 'slide', seconds: s, template: 'precos', fields: { title: 'Preços de hoje', text: 'Café | R$ 5,00\nPão de queijo | R$ 6,50\nSuco | R$ 8,00', note: 'Válido hoje', art: 'foto-cafeteria', palette: 'marrom' } },
    { id: 's-combo', kind: 'slide', seconds: s, template: 'combo', fields: { title: 'Combo pizza', text: 'Pizza grande\nRefrigerante 2 L', price: 'R$ 59,90', oldPrice: 'R$ 72,00', tag: 'Combo', art: 'foto-pizzaria', palette: 'vermelho' } },
    { id: 's-horario', kind: 'slide', seconds: s, template: 'horario', fields: { title: 'Horário', text: 'Seg a sex | 6h às 22h\nSábado | 8h às 18h', note: 'Fechado aos domingos', art: 'foto-academia' } },
    { id: 's-redes', kind: 'slide', seconds: s, template: 'redes', fields: { title: 'Siga a gente', handle: '@provedorx', text: 'Novidades toda semana', site: 'provedorx.com.br', qr: 'https://exemplo.com.br/redes', palette: 'rosa' } },
    { id: 's-port', kind: 'slide', seconds: s, template: 'oferta', fields: { title: 'Em pé', price: 'R$ 9,99', tag: 'Hoje', art: 'foto-supermercado', orient: 'port', palette: 'dourado' } },
    { id: 'p1', kind: 'post', seconds: s, category: 'comunicado', header: 'Comunicado', template: 'comunicado', title: 'Novo horário do refeitório', body: 'A partir de segunda, das 11h às 14h.', date: agora, qr: 'https://exemplo.com.br/refeitorio' },
    { id: 'p2', kind: 'post', seconds: s, category: 'vaga', header: 'Vaga', template: 'vaga', title: 'Vaga para eletricista', body: 'Fale com o RH até sexta.', date: agora },
    { id: 'p3', kind: 'post', seconds: s, category: 'seguranca', header: 'Segurança', template: 'seguranca', title: 'Piso molhado', body: 'Atenção na área de lavagem.', date: agora, image: f('oferta-b.svg') },
    { id: 'w:birthdays-month', kind: 'birthdays', seconds: s, title: 'Aniversariantes do mês', people: [
      { name: 'Ana Souza', day: hoje.getDate(), month: hoje.getMonth() + 1, sector: 'Financeiro', initials: 'AS', photo: f('foto-ana.svg') },
      { name: 'Bruno Lima', day: 3, month: hoje.getMonth() + 1, sector: 'Vendas', initials: 'BL' },
      { name: 'Marcos Silva', day: 18, month: hoje.getMonth() + 1, sector: 'Logística', initials: 'MS', photo: f('foto-marcos.svg') },
      { name: 'Carla Dias', day: 27, month: hoje.getMonth() + 1, sector: 'RH', initials: 'CD' }] },
    { id: 'k1', kind: 'kpi', seconds: s, name: 'Produção diária', value: 940, target: 1000, unit: 'peças', band: 'warn', direction: 'up', at: agora },
    { id: 'n1', kind: 'news', seconds: s, title: 'Notícias', source: 'Agência Brasil', at: agora, items: [
      { title: 'Governo anuncia novo programa de qualificação', source: 'Agência Brasil', at: agora - 3600000 },
      { title: 'Chuvas devem continuar no fim de semana', source: 'Agência Brasil', at: agora - 7200000 },
      { title: 'Feira de tecnologia abre inscrições', source: 'Agência Brasil', at: agora - 9000000 }] },
    { id: 'q1', kind: 'quotes', seconds: s, source: 'Banco Central', note: 'Valores de referência', at: agora, items: [
      { label: 'USD', name: 'Dólar', value: 5.42, change: 0.31, prefix: 'R$ ', decimals: 2 },
      { label: 'EUR', name: 'Euro', value: 5.88, change: -0.12, prefix: 'R$ ', decimals: 2 },
      { label: 'BTC', name: 'Bitcoin', value: 512340, change: 1.8, prefix: 'R$ ', decimals: 0 }] },
    { id: 'm1', kind: 'menu', seconds: s, title: 'Cardápio do dia', day: dia(0), weekday: 'segunda', items: [{ name: 'Feijoada', price: 24.9 }, { name: 'Salada verde' }, { name: 'Pudim', price: 8 }] },
    { id: 'w1', kind: 'countdown', seconds: s, title: 'Faltam para as férias coletivas', target: agora + 20 * 86400000, text: 'Boas festas!' },
    { id: 'w1b', kind: 'countdown', seconds: s, title: 'Black Friday', target: agora - 3600000, until: agora + 2 * 86400000 + 5 * 3600000, text: 'Termina em breve' },
    { id: 'w2', kind: 'safety', seconds: s, title: 'Dias sem acidente', days: 999, record: 210, goal: 365, since: dia(-128) },
    { id: 'w3', kind: 'worldclock', seconds: s, clocks: [{ tz: 'America/Sao_Paulo', label: 'São Paulo' }, { tz: 'Europe/Lisbon', label: 'Lisboa' }, { tz: 'Asia/Tokyo', label: 'Tóquio' }] },
    { id: 't1', kind: 'text', seconds: s, title: 'Aviso', text: 'Estacionamento fechado amanhã para manutenção.' },
    { id: 'qr1', kind: 'qr', seconds: s, qr: 'https://exemplo.com.br/cardapio', title: 'Veja o cardápio no celular' },
    { id: 'c1', kind: 'weather', seconds: s, city: 'Campinas', uf: 'SP', tempC: 27.4, min: 18, max: 31, text: 'Parcialmente nublado', cond: 'cloudy', source: 'INMET', at: agora },
    { id: 'clk', kind: 'clock', seconds: s },
    // os gadgets (widgets) da TV Corporativa
    { id: 'wclk', kind: 'clock', seconds: s, face: 'digital', tz: 'Europe/Lisbon', label: 'Lisboa', showSeconds: true, date: true },
    { id: 'wclka', kind: 'clock', seconds: s, face: 'analog', tz: 'America/Sao_Paulo', label: 'Brasília', date: true },
    { id: 'wwx', kind: 'weather', seconds: s, city: 'Campinas', uf: 'SP', tempC: 27, text: 'Nublado', source: 'INMET',
      days: [{ date: dia(1), weekday: 'Ter', min: 17, max: 29, text: 'Sol' }, { date: dia(2), weekday: 'Qua', min: 18, max: 30, text: 'Chuva' }, { date: dia(3), weekday: 'Qui', min: 19, max: 31 }] },
    { id: 'wag', kind: 'agenda', seconds: s, title: 'Agenda das salas', today: dia(0), events: [{ date: dia(0), time: '09:00', end: '10:00', title: 'Reunião comercial', place: 'Sala 1' }, { date: dia(1), time: '14:00', title: 'Treinamento', place: 'Auditório' }] },
    { id: 'wrv', kind: 'reviews', seconds: s, title: 'O que dizem os clientes', qr: 'https://exemplo.com.br/avaliar', items: [{ stars: 5, text: 'Internet rápida e suporte atencioso.', name: 'Carla' }, { stars: 4, text: 'Instalação no mesmo dia.', name: 'João' }] },
    { id: 'wdash', kind: 'dashboard', seconds: s, title: 'Indicadores', items: [{ name: 'Vendas', value: 82, target: 100, unit: '%', band: 'warn' }, { name: 'NPS', value: 71, target: 70, band: 'ok' }, { name: 'Chamados', value: 12, unit: 'abertos', band: 'bad' }] },
    { id: 'wdir', kind: 'directions', seconds: s, title: 'Como chegar', address: 'Rua das Flores, 123 – Centro', reference: 'Em frente à praça', hours: 'Seg a sex, 8h às 18h', phone: '(19) 3333-4444', qr: 'https://maps.example.com/?q=rua' },
    { id: 'wweb', kind: 'web', seconds: s, url: 'https://example.com/', refreshMin: 5 }
  ];
}

function fotoSvg(cor, iniciais) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="${cor}"/><circle cx="200" cy="160" r="80" fill="#fde3c8"/><rect x="90" y="260" width="220" height="160" rx="100" fill="#fde3c8"/>
<text x="200" y="385" font-family="Arial" font-size="40" text-anchor="middle" fill="#334155">${iniciais}</text></svg>`);
}

module.exports = { itensTipos, fotoSvg };
