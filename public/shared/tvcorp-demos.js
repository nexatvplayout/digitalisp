// DIGITAL ISP · layouts de DEMONSTRAÇÃO: 20 prontos para mostrar ao cliente, um clique e a tela já tem o que passar.
// Cada um junta o layout (zonas), as playlists das zonas (slides PREMIUM com foto, de public/shared/templates-premium.js),
// as frases fixas (zona Texto), o QR code, o relógio, o clima e o canal ao vivo (zona de vídeo). Aparecem no fim da aba
// Layouts só nas contas com a demonstração ligada (server/demo-contas.js; por padrão, a conta principal).
// pl: { seg: o segmento premium, pick: os índices dos prontos dele (0 a 7, na ordem do arquivo) }.
// Os nomes das empresas e os endereços dos QR codes são fictícios.

const Z = (id, kind, x, y, w, h, extra = {}) => ({ id, kind, x, y, w, h, ...extra });
const pl = (seg, pick = [0, 1, 2, 3, 4, 5, 6, 7]) => ({ seg: `premium-${seg}`, pick });
const frase = (id, x, y, w, h, title, text) => Z(id, 'text', x, y, w, h, title ? { title, text } : { text });
const qr = (id, x, y, w, h, title, path) => Z(id, 'qr', x, y, w, h, { title, qr: `https://exemplo.com.br/${path}` });
const BG = '#0b1220';

/** Os segmentos da seção (a ordem do filtro). */
export const DEMO_SEGMENTS = [
  ['provedor', 'Provedor de internet'], ['padaria', 'Padaria'], ['lanchonete', 'Lanchonete'], ['farmacia', 'Farmácia'],
  ['mercado', 'Mercado'], ['alimentacao', 'Restaurante e pizzaria'], ['saude', 'Saúde'], ['servicos', 'Serviços e lazer'],
  ['varejo', 'Moda, construção e imóveis'], ['bares', 'Bares e eventos'], ['corporativo', 'Empresas e escolas'],
  ['comunidade', 'Igreja, condomínio e órgão público'],
];

export const DEMO_LAYOUTS = Object.freeze([
  // ---------------------------------------------------------------- provedor
  { key: 'provedor-loja', segment: 'provedor', label: 'Provedor · Loja com TV ao vivo', desc: 'O canal ao vivo, os planos passando ao lado e a frase da promoção embaixo.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 86), Z('right', 'playlist', 70, 0, 30, 86, { pl: pl('provedor') }),
      frase('frase', 0, 86, 100, 14, '', 'Fibra óptica a partir de R$ 99,90')] },
  { key: 'provedor-recepcao', segment: 'provedor', label: 'Provedor · Recepção', desc: 'Os planos em destaque, a hora, o clima e o QR code para falar com a loja.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 72, 100, { pl: pl('provedor', [0, 1, 2, 3, 4, 5]) }), Z('clock', 'clock', 72, 0, 28, 30), Z('weather', 'weather', 72, 30, 28, 34),
      qr('qr', 72, 64, 28, 36, 'Fale com a gente', 'conectafibra/contato')] },
  { key: 'provedor-vitrine', segment: 'provedor', label: 'Provedor · Vitrine em pé', desc: 'TV em pé na vitrine: os planos, o QR code para assinar e a frase.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 82, { pl: pl('provedor', [0, 2, 3, 5, 6]) }), qr('qr', 0, 82, 45, 18, 'Assine pelo celular', 'conectafibra/assinar'),
      frase('frase', 45, 82, 55, 18, '', 'Wi-Fi 6 grátis no 600 Mega')] },
  // ---------------------------------------------------------------- padaria
  { key: 'padaria-balcao', segment: 'padaria', label: 'Padaria · Balcão', desc: 'Os pães e cafés passando, a hora, o clima e o horário das fornadas.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 70, 100, { pl: pl('padaria') }), Z('clock', 'clock', 70, 0, 30, 30), Z('weather', 'weather', 70, 30, 30, 35),
      frase('frase', 70, 65, 30, 35, 'Fornadas', 'Pão francês às 6h, 11h e 16h')] },
  { key: 'padaria-tv', segment: 'padaria', label: 'Padaria · Café com TV', desc: 'O canal ao vivo para quem toma café, as ofertas ao lado e o recado embaixo.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 72, 86), Z('right', 'playlist', 72, 0, 28, 86, { pl: pl('padaria', [0, 1, 2, 3, 6]) }),
      frase('frase', 0, 86, 100, 14, '', 'Encomende salgados e bolos no balcão')] },
  // ---------------------------------------------------------------- lanchonete
  { key: 'lanchonete-cardapio', segment: 'lanchonete', label: 'Lanchonete · Cardápio duplo', desc: 'Duas telas em uma: as ofertas de um lado, as tabelas de preço do outro.',
    orientation: 'land', background: BG,
    zones: [Z('left', 'playlist', 0, 0, 50, 86, { pl: pl('lanchonete', [0, 1, 2, 4]) }), Z('right', 'playlist', 50, 0, 50, 86, { pl: pl('lanchonete', [3, 5, 6, 7]) }),
      frase('frase', 0, 86, 100, 14, '', 'Peça no balcão · Aceitamos Pix')] },
  { key: 'lanchonete-tv', segment: 'lanchonete', label: 'Lanchonete · TV e dois quadros', desc: 'O jogo ou o canal ao vivo, e os lanches em dois quadros ao lado.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 66, 100), Z('top', 'playlist', 66, 0, 34, 50, { pl: pl('lanchonete', [0, 2, 4]) }),
      Z('bottom', 'playlist', 66, 50, 34, 50, { pl: pl('lanchonete', [1, 3, 5, 7]) })] },
  { key: 'lanchonete-totem', segment: 'lanchonete', label: 'Lanchonete · Totem em pé', desc: 'TV em pé na entrada: os lanches, a hora e o QR code do delivery.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 80, { pl: pl('lanchonete') }), Z('clock', 'clock', 0, 80, 45, 20), qr('qr', 45, 80, 55, 20, 'Peça pelo delivery', 'saborfaesquina/delivery')] },
  // ---------------------------------------------------------------- farmácia
  { key: 'farmacia-vitrine', segment: 'farmacia', label: 'Farmácia · Vitrine', desc: 'As ofertas em tela grande, a hora e o recado do farmacêutico.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 86, { pl: pl('farmacia') }), Z('clock', 'clock', 0, 86, 24, 14),
      frase('frase', 24, 86, 76, 14, '', 'Farmacêutico de plantão todo dia')] },
  { key: 'farmacia-espera', segment: 'farmacia', label: 'Farmácia · Espera com TV', desc: 'O canal ao vivo para quem espera, as ofertas ao lado e a hora.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 100), Z('right', 'playlist', 70, 0, 30, 70, { pl: pl('farmacia', [0, 1, 2, 4, 6]) }), Z('clock', 'clock', 70, 70, 30, 30)] },
  // ---------------------------------------------------------------- mercado
  { key: 'mercado-ofertas', segment: 'mercado', label: 'Mercado · Ofertas em três quadros', desc: 'A oferta grande e mais dois quadros: açougue, hortifrúti e peixaria juntos.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 66, 100, { pl: pl('supermercado', [0, 1, 2, 6]) }), Z('top', 'playlist', 66, 0, 34, 50, { pl: pl('supermercado', [3, 4]) }),
      Z('bottom', 'playlist', 66, 50, 34, 50, { pl: pl('supermercado', [5, 7]) })] },
  { key: 'mercado-tv', segment: 'mercado', label: 'Mercado · Caixa com TV', desc: 'O canal ao vivo na fila do caixa, as ofertas ao lado e a frase da entrega.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 74, 86), Z('right', 'playlist', 74, 0, 26, 86, { pl: pl('supermercado') }),
      frase('frase', 0, 86, 100, 14, '', 'Entrega grátis acima de R$ 150')] },
  // ---------------------------------------------------------------- restaurante e pizzaria
  { key: 'restaurante-salao', segment: 'alimentacao', label: 'Restaurante · Salão', desc: 'Os pratos do dia em tela grande, a hora e o recado do almoço.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 86, { pl: pl('restaurante') }), Z('clock', 'clock', 0, 86, 22, 14),
      frase('frase', 22, 86, 78, 14, '', 'Almoço executivo: seg. a sex., 11h às 15h')] },
  { key: 'pizzaria-pe', segment: 'alimentacao', label: 'Pizzaria · Cardápio em pé', desc: 'TV em pé no balcão: as pizzas, o QR code do pedido e a frase.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 84, { pl: pl('pizzaria') }), qr('qr', 0, 84, 42, 16, 'Peça pelo celular', 'pizzariabella/pedido'),
      frase('frase', 42, 84, 58, 16, '', 'Terça: a 2ª pizza pela metade')] },
  // ---------------------------------------------------------------- saúde
  { key: 'consultorio-senha', segment: 'saude', label: 'Consultório · Chamada de senha', desc: 'A senha chamada em destaque, as orientações de saúde passando e a hora.',
    orientation: 'land', background: BG, senha: true,
    zones: [Z('queue', 'queue', 0, 0, 40, 86), Z('main', 'playlist', 40, 0, 60, 86, { pl: pl('clinica') }), Z('clock', 'clock', 0, 86, 24, 14),
      frase('frase', 24, 86, 76, 14, '', 'Aguarde a chamada da sua senha')] },
  { key: 'consultorio-senha-tv', segment: 'saude', label: 'Consultório · Senha com TV ao vivo', desc: 'O canal ao vivo para quem espera e a senha chamada ao lado, com o aviso embaixo.',
    orientation: 'land', background: BG, video: true, senha: true,
    zones: [Z('main', 'video', 0, 0, 64, 86), Z('queue', 'queue', 64, 0, 36, 46), Z('right', 'playlist', 64, 46, 36, 40, { pl: pl('clinica', [0, 2, 4]) }),
      frase('frase', 0, 86, 100, 14, '', 'Fique atento à chamada da sua senha')] },
  { key: 'laboratorio-senha', segment: 'saude', label: 'Laboratório · Coleta com senha', desc: 'A senha da coleta, as orientações do exame e o clima.',
    orientation: 'land', background: BG, senha: true,
    zones: [Z('main', 'playlist', 0, 0, 62, 100, { pl: pl('laboratorio') }), Z('queue', 'queue', 62, 0, 38, 64), Z('weather', 'weather', 62, 64, 38, 36)] },
  { key: 'clinica-espera', segment: 'saude', label: 'Clínica · Sala de espera', desc: 'As orientações de saúde, a hora, o clima e o aviso da recepção.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 70, 86, { pl: pl('clinica') }), Z('clock', 'clock', 70, 0, 30, 43), Z('weather', 'weather', 70, 43, 30, 43),
      frase('frase', 0, 86, 100, 14, '', 'Bem-vindo! Aguarde ser chamado pelo nome')] },
  // ---------------------------------------------------------------- serviços e lazer
  { key: 'academia-tv', segment: 'servicos', label: 'Academia · TV e treinos', desc: 'O canal ao vivo para quem treina e as aulas e planos na coluna.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 100), Z('right', 'playlist', 70, 0, 30, 100, { pl: pl('academia') })] },
  { key: 'pet-loja', segment: 'servicos', label: 'Pet shop · Loja', desc: 'Os serviços e ofertas do pet, o clima e a hora.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 70, 100, { pl: pl('pet') }), Z('weather', 'weather', 70, 0, 30, 50), Z('clock', 'clock', 70, 50, 30, 50)] },
  { key: 'salao-espelho', segment: 'servicos', label: 'Salão de beleza · Em pé', desc: 'TV em pé ao lado do espelho: os serviços e a frase do agendamento.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 87, { pl: pl('salao') }), frase('frase', 0, 87, 100, 13, '', 'Agende pelo telefone ou no balcão')] },
  { key: 'oficina-espera', segment: 'servicos', label: 'Oficina · Espera com TV', desc: 'O canal ao vivo para quem aguarda, os serviços ao lado e a revisão em destaque.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 86), Z('right', 'playlist', 70, 0, 30, 86, { pl: pl('oficina') }),
      frase('frase', 0, 86, 100, 14, '', 'Revisão completa com 30 itens conferidos')] },
  { key: 'hotel-recepcao', segment: 'servicos', label: 'Hotel · Recepção', desc: 'As atrações do hotel, a hora, o clima e o QR code do Wi-Fi.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 70, 100, { pl: pl('hotel') }), Z('clock', 'clock', 70, 0, 30, 33), Z('weather', 'weather', 70, 33, 30, 34),
      qr('qr', 70, 67, 30, 33, 'Wi-Fi e cardápio', 'pousadarecanto/wifi')] },
  // ================================================================ mais 30 (26/11/2026): formatos e segmentos novos
  // ---------------------------------------------------------------- moda
  { key: 'moda-vitrine', segment: 'varejo', label: 'Moda · Vitrine com QR por cima', desc: 'As peças em tela cheia e o QR code da loja on-line por cima, no canto.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { pl: pl('moda') }), Z('qr', 'qr', 80, 56, 17, 40, { overlay: true, opacity: 55, title: "Compre on-line", qr: "https://exemplo.com.br/modaurbana/loja" })] },
  { key: 'moda-tv-centro', segment: 'varejo', label: 'Moda · Vídeo no meio', desc: 'O canal ao vivo no centro e as coleções passando dos dois lados.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('left', 'playlist', 0, 0, 25, 100, { pl: pl('moda', [0, 2, 4, 6]) }), Z('main', 'video', 25, 0, 50, 100), Z('right', 'playlist', 75, 0, 25, 100, { pl: pl('moda', [1, 3, 5, 7]) })] },
  // ---------------------------------------------------------------- material de construção
  { key: 'construcao-balcao', segment: 'varejo', label: 'Construção · Balcão em L', desc: 'As ofertas grandes, a coluna com hora, clima e QR, e a frase embaixo.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 75, 85, { pl: pl('construcao') }), Z('clock', 'clock', 75, 0, 25, 28), Z('weather', 'weather', 75, 28, 25, 27),
      qr('qr', 75, 55, 25, 30, 'Peça um orçamento', 'casadaobra/orcamento'), frase('frase', 0, 85, 100, 15, '', 'Entrega própria em toda a cidade')] },
  { key: 'construcao-quatro', segment: 'varejo', label: 'Construção · Quatro quadros', desc: 'Quatro ofertas ao mesmo tempo: tintas, ferramentas, hidráulica e acabamento.',
    orientation: 'land', background: BG,
    zones: [Z('q1', 'playlist', 0, 0, 50, 50, { pl: pl('construcao', [0, 1]) }), Z('q2', 'playlist', 50, 0, 50, 50, { pl: pl('construcao', [2, 3]) }),
      Z('q3', 'playlist', 0, 50, 50, 50, { pl: pl('construcao', [4, 5]) }), Z('q4', 'playlist', 50, 50, 50, 50, { pl: pl('construcao', [6, 7]) })] },
  // ---------------------------------------------------------------- imobiliária
  { key: 'imobiliaria-vitrine', segment: 'varejo', label: 'Imobiliária · Vitrine em pé', desc: 'TV em pé na vitrine: os imóveis, os destaques embaixo e o QR code para agendar a visita.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 58, { pl: pl('imobiliaria') }), Z('mid', 'playlist', 0, 58, 100, 27, { pl: pl('imobiliaria', [1, 3, 5]) }),
      qr('qr', 0, 85, 40, 15, 'Agende a visita', 'lardoce/visita'), frase('frase', 40, 85, 60, 15, '', 'Financiamento facilitado')] },
  { key: 'imobiliaria-recepcao', segment: 'varejo', label: 'Imobiliária · Recepção com logomarca', desc: 'A logomarca e a frase no alto, e os imóveis em destaque embaixo.',
    orientation: 'land', background: BG,
    zones: [Z('logo', 'logo', 0, 0, 22, 18), frase('frase', 22, 0, 78, 18, '', 'O imóvel certo para a sua família'), Z('main', 'playlist', 0, 18, 100, 82, { pl: pl('imobiliaria') })] },
  // ---------------------------------------------------------------- bar e eventos
  { key: 'bar-jogo', segment: 'bares', label: 'Bar · Jogo e petiscos', desc: 'O jogo ao vivo grande em cima e os petiscos e bebidas em dois quadros embaixo.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 100, 70), Z('left', 'playlist', 0, 70, 50, 30, { pl: pl('bar', [0, 2, 4, 6]) }), Z('right', 'playlist', 50, 70, 50, 30, { pl: pl('bar', [1, 3, 5, 7]) })] },
  { key: 'bar-cardapio-pe', segment: 'bares', label: 'Bar · Cardápio em pé', desc: 'TV em pé no balcão: os petiscos, as bebidas e a frase do happy hour.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 60, { pl: pl('bar') }), Z('mid', 'playlist', 0, 60, 100, 28, { pl: pl('bar', [2, 5, 7]) }), frase('frase', 0, 88, 100, 12, '', 'Happy hour das 17h às 20h')] },
  { key: 'eventos-festa', segment: 'bares', label: 'Eventos · Festa com QR por cima', desc: 'As fotos da festa em tela cheia, a hora e o QR code das fotos por cima.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { pl: pl('eventos') }), Z('clock', 'clock', 3, 4, 20, 22, { overlay: true, opacity: 55 }), Z('qr', 'qr', 80, 56, 17, 40, { overlay: true, opacity: 55, title: "Fotos da festa", qr: "https://exemplo.com.br/salaoestrela/fotos" })] },
  { key: 'eventos-telao', segment: 'bares', label: 'Eventos · Telão com vídeo no meio', desc: 'A transmissão ao vivo no centro e a programação do evento dos dois lados.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('left', 'playlist', 0, 0, 25, 100, { pl: pl('eventos', [0, 2, 4, 6]) }), Z('main', 'video', 25, 0, 50, 100), Z('right', 'playlist', 75, 0, 25, 100, { pl: pl('eventos', [1, 3, 5, 7]) })] },
  // ---------------------------------------------------------------- empresas e escolas
  { key: 'escola-patio', segment: 'corporativo', label: 'Escola · Pátio com faixa de título', desc: 'A faixa com o recado do dia, os avisos da escola, a hora e o clima.',
    orientation: 'land', background: BG,
    zones: [frase('frase', 0, 0, 100, 14, '', 'Bom dia, turma! Boas aulas'), Z('main', 'playlist', 0, 14, 70, 86, { pl: pl('escola') }),
      Z('clock', 'clock', 70, 14, 30, 43), Z('weather', 'weather', 70, 57, 30, 43)] },
  { key: 'escola-recepcao', segment: 'corporativo', label: 'Escola · Recepção com TV', desc: 'O canal ao vivo para os pais, os avisos ao lado e a frase da matrícula.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 68, 86), Z('right', 'playlist', 68, 0, 32, 86, { pl: pl('escola') }), frase('frase', 0, 86, 100, 14, '', 'Matrículas abertas para o próximo ano')] },
  { key: 'industria-refeitorio', segment: 'corporativo', label: 'Indústria · Refeitório em L', desc: 'Os avisos e indicadores, a hora, o clima e o QR do cardápio, com a frase de segurança.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 75, 85, { pl: pl('industria') }), Z('clock', 'clock', 75, 0, 25, 28), Z('weather', 'weather', 75, 28, 25, 27),
      qr('qr', 75, 55, 25, 30, 'Cardápio da semana', 'metalsul/cardapio'), frase('frase', 0, 85, 100, 15, '', 'Segurança em primeiro lugar')] },
  { key: 'industria-portaria', segment: 'corporativo', label: 'Indústria · Portaria com TV', desc: 'O canal ao vivo na portaria, os avisos ao lado e a hora.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 100), Z('right', 'playlist', 70, 0, 30, 72, { pl: pl('industria', [0, 2, 4, 6]) }), Z('clock', 'clock', 70, 72, 30, 28)] },
  { key: 'escritorio-recepcao', segment: 'corporativo', label: 'Escritório · Recepção com hora e clima por cima', desc: 'Os comunicados em tela cheia, com a hora e o clima por cima, nos cantos.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { pl: pl('escritorio') }), Z('clock', 'clock', 3, 4, 20, 22, { overlay: true, opacity: 55 }), Z('weather', 'weather', 77, 4, 20, 30, { overlay: true, opacity: 55 })] },
  { key: 'escritorio-quatro', segment: 'corporativo', label: 'Escritório · Quatro quadros do RH', desc: 'Vagas, aniversariantes, comunicados e indicadores ao mesmo tempo.',
    orientation: 'land', background: BG,
    zones: [Z('q1', 'playlist', 0, 0, 50, 50, { pl: pl('escritorio', [0, 1]) }), Z('q2', 'playlist', 50, 0, 50, 50, { pl: pl('escritorio', [2, 3]) }),
      Z('q3', 'playlist', 0, 50, 50, 50, { pl: pl('escritorio', [4, 5]) }), Z('q4', 'playlist', 50, 50, 50, 50, { pl: pl('escritorio', [6, 7]) })] },
  // ---------------------------------------------------------------- igreja, condomínio e órgão público
  { key: 'igreja-avisos', segment: 'comunidade', label: 'Igreja · Avisos em pé', desc: 'TV em pé no salão: os avisos da semana, os destaques e a frase.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 60, { pl: pl('igreja') }), Z('mid', 'playlist', 0, 60, 100, 28, { pl: pl('igreja', [1, 4, 6]) }), frase('frase', 0, 88, 100, 12, '', 'Sejam todos bem-vindos')] },
  { key: 'igreja-telao', segment: 'comunidade', label: 'Igreja · Telão com transmissão', desc: 'A transmissão ao vivo, os avisos ao lado e a frase do culto.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 72, 86), Z('right', 'playlist', 72, 0, 28, 86, { pl: pl('igreja') }), frase('frase', 0, 86, 100, 14, '', 'Culto de domingo às 19h')] },
  { key: 'condominio-elevador', segment: 'comunidade', label: 'Condomínio · Elevador em pé', desc: 'TV em pé no elevador: os comunicados, a hora, o clima e a frase.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 70, { pl: pl('condominio') }), Z('clock', 'clock', 0, 70, 50, 16), Z('weather', 'weather', 50, 70, 50, 16),
      frase('frase', 0, 86, 100, 14, '', 'Bom dia, vizinho!')] },
  { key: 'condominio-portaria', segment: 'comunidade', label: 'Condomínio · Hall em L', desc: 'Os comunicados grandes, a coluna com hora, clima e QR, e o recado embaixo.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 75, 85, { pl: pl('condominio') }), Z('clock', 'clock', 75, 0, 25, 28), Z('weather', 'weather', 75, 28, 25, 27),
      qr('qr', 75, 55, 25, 30, 'Reserve o salão', 'residencialjardins/reservas'), frase('frase', 0, 85, 100, 15, '', 'Silêncio depois das 22h')] },
  { key: 'publico-atendimento', segment: 'comunidade', label: 'Órgão público · Atendimento com senha', desc: 'A senha chamada, os serviços e orientações ao lado, a hora e o aviso.',
    orientation: 'land', background: BG, senha: true,
    zones: [Z('queue', 'queue', 0, 0, 38, 86), Z('main', 'playlist', 38, 0, 62, 86, { pl: pl('publico') }), Z('clock', 'clock', 0, 86, 24, 14),
      frase('frase', 24, 86, 76, 14, '', 'Tenha seus documentos em mãos')] },
  { key: 'publico-tv', segment: 'comunidade', label: 'Órgão público · Espera com TV', desc: 'O canal ao vivo na sala de espera, os serviços ao lado e a frase.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 86), Z('right', 'playlist', 70, 0, 30, 86, { pl: pl('publico') }), frase('frase', 0, 86, 100, 14, '', 'Serviços também pelo site da prefeitura')] },
  // ---------------------------------------------------------------- variações dos segmentos de antes
  { key: 'provedor-quatro', segment: 'provedor', label: 'Provedor · Quatro quadros', desc: 'Quatro planos e serviços ao mesmo tempo, para a parede da loja.',
    orientation: 'land', background: BG,
    zones: [Z('q1', 'playlist', 0, 0, 50, 50, { pl: pl('provedor', [0, 1]) }), Z('q2', 'playlist', 50, 0, 50, 50, { pl: pl('provedor', [2, 3]) }),
      Z('q3', 'playlist', 0, 50, 50, 50, { pl: pl('provedor', [4, 5]) }), Z('q4', 'playlist', 50, 50, 50, 50, { pl: pl('provedor', [6, 7]) })] },
  { key: 'padaria-pe', segment: 'padaria', label: 'Padaria · Cardápio em pé', desc: 'TV em pé no balcão: os pães e doces, os cafés embaixo e o horário das fornadas.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 60, { pl: pl('padaria') }), Z('mid', 'playlist', 0, 60, 100, 28, { pl: pl('padaria', [1, 2]) }), frase('frase', 0, 88, 100, 12, '', 'Fornadas às 6h, 11h e 16h')] },
  { key: 'lanchonete-hora', segment: 'lanchonete', label: 'Lanchonete · Tela cheia com hora por cima', desc: 'Os lanches em tela cheia, com a hora e o QR do delivery por cima.',
    orientation: 'land', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { pl: pl('lanchonete') }), Z('clock', 'clock', 3, 4, 20, 22, { overlay: true, opacity: 55 }), Z('qr', 'qr', 80, 56, 17, 40, { overlay: true, opacity: 55, title: "Delivery", qr: "https://exemplo.com.br/saborfaesquina/delivery" })] },
  { key: 'farmacia-senha', segment: 'farmacia', label: 'Farmácia · Senha do balcão', desc: 'A senha do atendimento, as ofertas ao lado, a hora e o aviso.',
    orientation: 'land', background: BG, senha: true,
    zones: [Z('queue', 'queue', 0, 0, 36, 86), Z('main', 'playlist', 36, 0, 64, 86, { pl: pl('farmacia') }), Z('clock', 'clock', 0, 86, 24, 14),
      frase('frase', 24, 86, 76, 14, '', 'Retire a sua senha no totem')] },
  { key: 'mercado-pe', segment: 'mercado', label: 'Mercado · Corredor em pé', desc: 'TV em pé no corredor: a oferta grande, as outras embaixo e a frase.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 60, { pl: pl('supermercado') }), Z('mid', 'playlist', 0, 60, 100, 28, { pl: pl('supermercado', [1, 3, 5]) }), frase('frase', 0, 88, 100, 12, '', 'Ofertas válidas até domingo')] },
  { key: 'pet-tv', segment: 'servicos', label: 'Pet shop · Espera do banho com TV', desc: 'O canal ao vivo para quem espera o banho e os serviços ao lado.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 70, 86), Z('right', 'playlist', 70, 0, 30, 86, { pl: pl('pet') }), frase('frase', 0, 86, 100, 14, '', 'Banho e tosa com hora marcada')] },
  { key: 'academia-quatro', segment: 'servicos', label: 'Academia · Quatro quadros', desc: 'As aulas, os planos, as dicas e os horários, tudo junto na parede.',
    orientation: 'land', background: BG,
    zones: [Z('q1', 'playlist', 0, 0, 50, 50, { pl: pl('academia', [0, 1]) }), Z('q2', 'playlist', 50, 0, 50, 50, { pl: pl('academia', [2, 3]) }),
      Z('q3', 'playlist', 0, 50, 50, 50, { pl: pl('academia', [4, 5]) }), Z('q4', 'playlist', 50, 50, 50, 50, { pl: pl('academia', [6, 7]) })] },
  { key: 'hotel-pe', segment: 'servicos', label: 'Hotel · Recepção em pé', desc: 'TV em pé na recepção: as atrações, o clima, a hora e o QR do Wi-Fi.',
    orientation: 'port', background: BG,
    zones: [Z('main', 'playlist', 0, 0, 100, 66, { pl: pl('hotel') }), Z('weather', 'weather', 0, 66, 50, 17), Z('clock', 'clock', 50, 66, 50, 17),
      qr('qr', 0, 83, 100, 17, 'Wi-Fi e cardápio', 'pousadarecanto/wifi')] },
  { key: 'odontologia-tv', segment: 'saude', label: 'Odontologia · Espera com TV', desc: 'O canal ao vivo e os tratamentos passando na coluna ao lado.',
    orientation: 'land', background: BG, video: true,
    zones: [Z('main', 'video', 0, 0, 68, 100), Z('right', 'playlist', 68, 0, 32, 100, { pl: pl('odontologia') })] },
]);

/**
 * As frases de cada negócio: viram slides "comunicado" com a foto do segmento e entram intercaladas na primeira playlist
 * do layout (título curto e a frase). Sem marca de terceiros.
 */
export const DEMO_FRASES = Object.freeze({
  'provedor-loja': [['Internet que não cai', 'Suporte técnico local, perto de você, todos os dias.'], ['Instalação grátis', 'Assine hoje e navegue em até 48 horas.'], ['Wi-Fi na casa toda', 'Roteador de última geração incluso no plano.']],
  'provedor-recepcao': [['Seja bem-vindo!', 'Pegue a sua senha e aguarde: já vamos atender.'], ['Mude de plano aqui', 'Mais velocidade sem trocar de número nem de endereço.'], ['Pague com Pix', 'A segunda via da fatura sai na hora pelo aplicativo.']],
  'provedor-vitrine': [['Fibra até a sua casa', 'Velocidade de verdade para estudar, trabalhar e assistir.'], ['Plano para empresas', 'IP fixo e atendimento prioritário para o seu negócio.'], ['Indique e ganhe', 'Indicou um amigo, ganhou um mês de desconto.']],
  'padaria-balcao': [['Pão quentinho', 'Fornadas às 6h, 11h e 16h todos os dias.'], ['Café da casa', 'Grãos selecionados e moídos na hora.'], ['Encomendas', 'Bolos e salgados para festas: peça com dois dias.']],
  'padaria-tv': [['Bom dia!', 'Comece o dia com o nosso café da manhã completo.'], ['Doces finos', 'Feitos aqui, com receita da casa.'], ['Peça e retire', 'Faça a sua encomenda pelo telefone e retire no balcão.']],
  'lanchonete-cardapio': [['Feito na hora', 'Lanches preparados no momento do pedido.'], ['Combo do dia', 'Lanche, batata e bebida com preço especial.'], ['Açaí do seu jeito', 'Escolha os acompanhamentos no balcão.']],
  'lanchonete-tv': [['Assista ao jogo aqui', 'Telão, petiscos e bebida gelada.'], ['Happy hour', 'De segunda a sexta, das 17h às 19h.'], ['Delivery no bairro', 'Peça pelo telefone das 11h às 23h.']],
  'lanchonete-totem': [['Bateu a fome?', 'Lanches, pastéis e sucos saindo agora.'], ['Retire em 15 minutos', 'Peça pelo celular e pegue no balcão.'], ['Suco natural', 'Fruta fresca, batida na hora.']],
  'farmacia-vitrine': [['Cuide da sua saúde', 'Aferição de pressão gratuita no balcão.'], ['Genéricos', 'Economize com a mesma eficácia do remédio de marca.'], ['Entrega em casa', 'Peça pelo telefone e receba no mesmo dia.']],
  'farmacia-espera': [['Fale com o farmacêutico', 'Tire as suas dúvidas sobre o uso dos medicamentos.'], ['Vacinação', 'Vacina da gripe disponível: pergunte no balcão.'], ['Programa de fidelidade', 'Acumule pontos e ganhe descontos.']],
  'mercado-ofertas': [['Ofertas da semana', 'Preços baixos de verdade em todos os corredores.'], ['Hortifrúti fresquinho', 'Frutas e verduras chegando todo dia de manhã.'], ['Açougue', 'Cortes na hora, do jeito que você pedir.']],
  'mercado-tv': [['Obrigado pela preferência', 'Volte sempre ao seu mercado de bairro.'], ['Cartão do cliente', 'Descontos exclusivos em centenas de produtos.'], ['Traga a sua sacola', 'Ajude o meio ambiente nas suas compras.']],
  'restaurante-salao': [['Comida caseira', 'Feita no dia, com tempero de casa.'], ['Sobremesa da casa', 'Peça a do dia para fechar a refeição.'], ['Reserve a sua mesa', 'Aniversários e confraternizações: fale com a gente.']],
  'pizzaria-pe': [['Massa artesanal', 'Fermentação lenta e forno bem quente.'], ['Borda recheada', 'Catupiry ou cheddar em qualquer sabor.'], ['Pizza em casa', 'Entrega em até 40 minutos no bairro.']],
  'consultorio-senha': [['Lave as mãos', 'Use o álcool em gel disponível na recepção.'], ['Traga seus exames', 'Ajude o médico com os resultados anteriores.'], ['Prioridade', 'Idosos, gestantes e pessoas com deficiência têm prioridade.']],
  'consultorio-senha-tv': [['Bem-vindo!', 'O atendimento segue a ordem das senhas.'], ['Mantenha o celular no silencioso', 'Obrigado pela colaboração.'], ['Prioridade', 'Idosos, gestantes e pessoas com deficiência têm prioridade.']],
  'laboratorio-senha': [['Jejum', 'Confira o tempo de jejum do seu exame com a recepção.'], ['Resultado on-line', 'Receba os seus exames pelo site, com segurança.'], ['Coleta domiciliar', 'Agende a coleta na sua casa.']],
  'clinica-espera': [['Cuide do coração', 'Caminhe 30 minutos por dia e beba bastante água.'], ['Vacinas em dia', 'Confira a sua carteira de vacinação.'], ['Agende o retorno', 'Marque a próxima consulta antes de sair.']],
  'academia-tv': [['Bora treinar!', 'Constância vale mais do que intensidade.'], ['Hidrate-se', 'Beba água antes, durante e depois do treino.'], ['Avaliação física', 'Agende a sua com o professor.']],
  'pet-loja': [['Banho e tosa', 'Agende pelo telefone e evite espera.'], ['Vacinas do pet', 'Mantenha a carteira de vacinação em dia.'], ['Ração com desconto', 'Leve dois pacotes e ganhe 10% de desconto.']],
  'salao-espelho': [['Dia de beleza', 'Corte, escova e manicure no mesmo horário.'], ['Noivas', 'Pacotes especiais para o grande dia.'], ['Pacote do mês', 'Hidratação com 20% de desconto.']],
  'oficina-espera': [['Revisão em dia', 'Evite surpresas na estrada.'], ['Alinhamento e balanceamento', 'Mais segurança e economia de pneus.'], ['Orçamento sem compromisso', 'Fale com o nosso consultor técnico.']],
  'hotel-recepcao': [['Bem-vindo!', 'Café da manhã das 6h30 às 10h no salão.'], ['Passeios', 'Pergunte na recepção pelos passeios da região.'], ['Check-out', 'Até as 12h. Precisa de mais tempo? Fale com a gente.']],
  'moda-vitrine': [['Coleção nova','Peças que acabaram de chegar: venha experimentar.'],['Troca fácil','Trocas em até 30 dias com a etiqueta.'],['Compre on-line','Retire na loja no mesmo dia.']],
  'moda-tv-centro': [['Tendência da estação','Cores e cortes que estão em alta.'],['Leve 3, pague 2','Em toda a linha básica.'],['Provador','Peça ajuda à vendedora para o seu tamanho.']],
  'construcao-balcao': [['Orçamento na hora','Traga a lista da obra e saia com o preço.'],['Tinta sob medida','Misturamos a cor que você escolher.'],['Parcele a reforma','Em até 10 vezes no cartão.']],
  'construcao-quatro': [['Do alicerce ao acabamento','Tudo para a sua obra num lugar só.'],['Ferramentas','Marcas de confiança com garantia.'],['Entrega rápida','Material na obra em até 24 horas.']],
  'imobiliaria-vitrine': [['Realize o sonho','Casas e apartamentos para todos os bolsos.'],['Avaliação grátis','Saiba quanto vale o seu imóvel.'],['Aluguel sem fiador','Pergunte pelas opções de garantia.']],
  'imobiliaria-recepcao': [['Lançamentos','Conheça os empreendimentos na planta.'],['Documentação','Cuidamos de toda a papelada para você.'],['Visita marcada','Agende e nós levamos você até o imóvel.']],
  'bar-jogo': [['Dia de jogo','Telão, petisco e bebida gelada.'],['Balde de cerveja','Promoção durante a partida.'],['Reserve a mesa','Garanta o seu lugar para o clássico.']],
  'bar-cardapio-pe': [['Petiscos da casa','Porções para dividir com a turma.'],['Drinques','Feitos na hora pelo nosso bartender.'],['Música ao vivo','Sexta e sábado a partir das 21h.']],
  'eventos-festa': [['Que festa!','Obrigado por celebrar com a gente.'],['Pista liberada','O DJ começa às 22h.'],['Fotos no QR code','Baixe as fotos da festa no celular.']],
  'eventos-telao': [['Programação','Fique de olho nos horários das atrações.'],['Credenciamento','Retire o seu crachá na recepção.'],['Coffee break','Às 10h30 e às 15h30 no saguão.']],
  'escola-patio': [['Leitura todo dia','Visite a biblioteca no intervalo.'],['Feira de ciências','Inscrições abertas na secretaria.'],['Respeito é tudo','Juntos contra o bullying.']],
  'escola-recepcao': [['Bem-vindos, famílias!','A secretaria atende das 7h às 18h.'],['Reunião de pais','Confira a data no aplicativo da escola.'],['Uniforme','Encomendas na secretaria.']],
  'industria-refeitorio': [['Use o EPI','Capacete, óculos e protetor auricular sempre.'],['Meta do mês','Produção 8% acima do planejado.'],['Lave as mãos','Antes de cada refeição.']],
  'industria-portaria': [['Bem-vindo à fábrica','Apresente o crachá na entrada.'],['Visitantes','Acompanhados o tempo todo por um colaborador.'],['Velocidade máxima','10 km/h dentro do pátio.']],
  'escritorio-recepcao': [['Bem-vindo!','Anuncie-se na recepção.'],['Wi-Fi visitante','Peça a senha para a recepcionista.'],['Café','Sirva-se à vontade enquanto espera.']],
  'escritorio-quatro': [['Vagas abertas','Indique um amigo para o nosso time.'],['Feedback','Converse com o seu gestor toda semana.'],['Ginástica laboral','Às 10h e às 15h no espaço de convivência.']],
  'igreja-avisos': [['Culto de domingo','Às 9h e às 19h. Traga a família.'],['Campanha do agasalho','Doações na secretaria até o fim do mês.'],['Grupo de jovens','Sábado às 17h no salão.']],
  'igreja-telao': [['Bem-vindo!','Que bom ter você conosco hoje.'],['Oração','Pedidos de oração na entrada.'],['Dízimos e ofertas','Também pelo Pix da igreja.']],
  'condominio-elevador': [['Coleta seletiva','Separe o lixo reciclável.'],['Assembleia','Quinta-feira às 20h no salão de festas.'],['Encomendas','Retire na portaria com documento.']],
  'condominio-portaria': [['Manutenção','Limpeza da caixa d’água no sábado.'],['Animais','Use a guia nas áreas comuns.'],['Vagas de garagem','Respeite a vaga do vizinho.']],
  'publico-atendimento': [['Agende pela internet','Evite filas: agende o seu atendimento.'],['Documentos','Traga RG, CPF e comprovante de endereço.'],['Prioridade','Idosos, gestantes e pessoas com deficiência.']],
  'publico-tv': [['Serviços on-line','Emita guias e certidões pelo site.'],['Ouvidoria','A sua opinião ajuda a melhorar o atendimento.'],['Horário','Atendimento das 8h às 17h.']],
  'provedor-quatro': [['Internet rápida','Fibra óptica do seu provedor do bairro.'],['Atendimento local','Gente daqui que entende você.'],['Combo TV','Internet e TV no mesmo boleto.']],
  'padaria-pe': [['Pão de queijo','Saindo agora do forno.'],['Bolos caseiros','Encomende para o seu aniversário.'],['Café expresso','Grãos selecionados da casa.']],
  'lanchonete-hora': [['Bateu a fome?','Lanches feitos na hora.'],['Combo do dia','Lanche, batata e refrigerante.'],['Delivery','Peça pelo QR code e receba em casa.']],
  'farmacia-senha': [['Aguarde a sua vez','Acompanhe a senha na tela.'],['Aferição de pressão','Gratuita no balcão.'],['Genéricos','Economia com a mesma eficácia.']],
  'mercado-pe': [['Hortifrúti','Fresquinho todo dia de manhã.'],['Açougue','Cortes na hora.'],['Clube de vantagens','Cadastre o seu CPF no caixa.']],
  'pet-tv': [['Banho e tosa','Seu pet cheiroso em poucas horas.'],['Vacinas','Carteira em dia é saúde garantida.'],['Rações','As melhores marcas com desconto.']],
  'academia-quatro': [['Treino em grupo','Aulas de hora em hora.'],['Avaliação física','Agende com o professor.'],['Traga um amigo','Na primeira semana ele treina de graça.']],
  'hotel-pe': [['Bem-vindo!','Café da manhã das 6h30 às 10h.'],['Piscina','Aberta das 8h às 20h.'],['Passeios','Pergunte na recepção.']],
  'odontologia-tv': [['Sorria!','Escove os dentes três vezes ao dia.'],['Clareamento','Pergunte pelas condições especiais.'],['Retorno','Marque a próxima consulta antes de sair.']],
});

/** As zonas do layout como vão ao servidor (sem a playlist de exemplo; a playlist criada entra no lugar). */
/**
 * Os slides de cada zona de playlist: os prontos premium da zona e, na primeira zona, as frases do negócio intercaladas
 * (um slide "comunicado" com a foto de um dos prontos). catalog: os templates (templateCatalog()).
 * Devolve { zona: [{ id, name, template, fields }] }.
 */
export function demoItens(d, catalog) {
  const out = {};
  const zs = d.zones.filter((z) => z.pl);
  zs.forEach((z, zi) => {
    const all = catalog.filter((t) => t.segment === z.pl.seg && t.orient === 'land');
    const slides = z.pl.pick.map((i) => all[i]).filter(Boolean).map((t) => ({ id: t.id, name: t.name.replace(' premium', ''), template: t.template, fields: t.fields }));
    const frases = zi === 0 ? (DEMO_FRASES[d.key] || []) : [];
    const lista = [];
    slides.forEach((t, i) => {
      lista.push(t);
      const fr = frases[i];
      if (fr) lista.push({ id: `${d.key}-frase-${i + 1}`, name: `${d.label} · ${fr[0]}`.slice(0, 60), template: 'comunicado', fields: { title: fr[0], text: fr[1], art: slides[(i + 1) % slides.length].fields.art, palette: slides[(i + 1) % slides.length].fields.palette, variant: 'dark' } });
    });
    out[z.id] = lista;
  });
  return out;
}

export const demoZones = (d, playlistOf = () => null, channel = null) => d.zones.map(({ pl: p, ...z }) => {
  const out = { ...z };
  if (p) { const id = playlistOf(z.id); if (id) out.playlist = id; }
  if (z.kind === 'video' && channel) out.channel = channel;
  return out;
});

/** Um canal público de teste (HLS), para a demonstração ter vídeo ao vivo quando a conta ainda não cadastrou canal. */
export const DEMO_CHANNEL = { nome: 'Canal de demonstração', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' };
