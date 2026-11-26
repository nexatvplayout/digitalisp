/*
 * Regras do app de tela, sem tela nem rede (testadas com `node --test`): leitura da configuração do servidor (o mesmo
 * contrato do app Android: /api/telas/config com `signage`, `offline`, `stream`, `schedule`), a marca da revenda, a
 * escolha do bloco da grade pelo relógio, a lista de arquivos do pacote, a decisão de trocar de programação (só com
 * tudo baixado e conferido), a limpeza do que saiu, o sinal de vida e a contagem de exibição.
 *
 * Sintaxe limitada ao que o Chromium 53 (webOS 4, 2018) entende: nada de async/await, `?.`, `??` nem `...` em objeto.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TelasNucleo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSAO = '1.0.32';
  var TZ_PADRAO = 'America/Sao_Paulo';
  var SHA = /^[0-9a-f]{64}$/;
  var DIA = /^\d{4}-\d{2}-\d{2}$/;

  // Tetos do contrato (docs/origem-nexa/TV-CORPORATIVA.md §4.1), os mesmos do Android.
  var TETO = {
    blocos: 12,
    zonas: 6,
    itens: 60,
    arquivos: 200,
    bytesArquivo: 512 * 1024 * 1024, // vídeo pode ser grande; imagem vem com até 2 MB
    titulo: 60,
    texto: 280,
    offlineItens: 20
  };

  var ZONAS = ['video', 'playlist', 'ticker', 'clock', 'weather', 'qr', 'logo', 'text', 'news', 'quotes',
    'countdown', 'safety', 'worldclock', 'queue', 'widget', 'hdmi'];
  // `video` como item de playlist é extensão do DIGITAL ISP (o Android 1.3 ignora o tipo que não conhece).
  var ITENS = ['image', 'video', 'slide', 'post', 'birthdays', 'kpi', 'news', 'quotes', 'menu', 'countdown',
    'safety', 'worldclock', 'text', 'clock', 'weather', 'qr', 'logo',
    // os gadgets (widgets) da TV Corporativa: desenhados pela prévia do painel
    'agenda', 'reviews', 'dashboard', 'directions', 'web'];

  function str(o, k) {
    if (!o || typeof o !== 'object') return null;
    var v = o[k];
    if (typeof v !== 'string') return null;
    v = v.trim();
    return v ? v : null;
  }

  function num(o, k, padrao) {
    var v = o ? o[k] : undefined;
    return typeof v === 'number' && isFinite(v) ? v : padrao;
  }

  function limpar(s, max) {
    if (typeof s !== 'string') return '';
    // tira caracteres de controle (menos a quebra de linha)
    var t = s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
    t = t.split('\n').map(function (l) { return l.trim(); }).slice(0, 8).join('\n').trim();
    return max ? t.slice(0, max) : t;
  }

  function umaLinha(s, max) { return limpar(s, max).replace(/\n/g, ' '); }

  // ------------------------------------------------------------------ endereços

  /** Endereço local de teste (localhost, 127.x, 10.x, 192.168.x, 172.16–31.x): http só vale com `teste`. */
  function enderecoLocal(host) {
    return /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/i.test(host);
  }

  /** O app só fala https; http apenas para endereço local no modo de teste (como o build de depuração do Android). */
  function urlPermitida(url, teste) {
    if (typeof url !== 'string' || url.length > 2048) return false;
    var m = /^(https?):\/\/([^\/?#:]+|\[[^\]]+\])(:\d+)?([\/?#]|$)/i.exec(url);
    if (!m) return false;
    if (m[1].toLowerCase() === 'https') return true;
    return !!teste && enderecoLocal(m[2]);
  }

  /** A origem do servidor ("https://api.exemplo.com.br"), sem barra no fim, ou null. */
  function origem(url) {
    if (typeof url !== 'string') return null;
    var m = /^(https?:\/\/[^\/?#]+)/i.exec(url.trim());
    return m ? m[1].toLowerCase() : null;
  }

  // ------------------------------------------------------------------ arquivos

  /** Arquivo indicado pelo servidor: { url, sha256, bytes }. Inválido = null (o item que depende dele é pulado). */
  function arquivo(o, teste) {
    if (!o || typeof o !== 'object') return null;
    var url = str(o, 'url');
    var sha = (str(o, 'sha256') || '').toLowerCase();
    var bytes = num(o, 'bytes', 0);
    if (!url || !urlPermitida(url, teste) || !SHA.test(sha)) return null;
    if (!(bytes >= 1 && bytes <= TETO.bytesArquivo)) return null;
    var tipo = str(o, 'type') || str(o, 'mime') || tipoPeloNome(url);
    return { url: url, sha256: sha, bytes: Math.floor(bytes), tipo: tipo };
  }

  function tipoPeloNome(url) {
    var ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    var mapa = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
      svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
    return mapa[ext] || 'application/octet-stream';
  }

  // ------------------------------------------------------------------ marca da revenda

  /**
   * A marca da revenda (white-label). O contrato da marca (docs/CONTRATO-APP-MARCA.md) ainda pode não existir:
   * o app aceita a marca em `brand` no topo da configuração, em `signage.brand` ou na resposta da ativação, e
   * a logo como `{ url, sha256, bytes }` (baixada e guardada) ou como endereço puro (só mostrada com rede).
   * Campo faltando = sem ele: sem logo a tela fica só com o fundo, sem nome de app nenhum.
   */
  function lerMarca(fontes, teste) {
    var marca = { nome: '', logo: null, logoUrl: null, cor: null, fundo: null, modo: 'dark' };
    for (var i = fontes.length - 1; i >= 0; i--) { // a primeira fonte tem prioridade: lida por último
      var b = fontes[i];
      if (!b || typeof b !== 'object') continue;
      var nome = umaLinha(str(b, 'name') || str(b, 'nome') || '', 60);
      if (nome) marca.nome = nome;
      var l = b.logo;
      if (l && typeof l === 'object') {
        var f = arquivo(l, teste);
        if (f) { marca.logo = f; marca.logoUrl = null; }
      } else if (typeof l === 'string' && urlPermitida(l.trim(), teste)) {
        marca.logo = null; marca.logoUrl = l.trim();
      }
      var cor = cores(str(b, 'color') || str(b, 'cor'));
      if (cor) marca.cor = cor;
      var fundo = cores(str(b, 'background') || str(b, 'fundo'));
      if (fundo) marca.fundo = fundo;
      var modo = str(b, 'mode');
      if (modo === 'light' || modo === 'dark') marca.modo = modo;
    }
    return marca;
  }

  function cores(s) { return s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null; }

  // ------------------------------------------------------------------ configuração

  // as artes que vão no pacote (TelasPrevia.ARTES, os nomes sem extensão): o artFile delas não é baixado
  var artesNoPacote = null;
  function definirArtes(lista) { artesNoPacote = Array.isArray(lista) ? lista.slice() : null; }

  /** A foto (weather.art e afins) que já vem no pacote do app, pelo nome do arquivo: não é baixada de novo. */
  function fotoNoPacote(a) {
    var nome = String(a && a.url || '').split('?')[0].split('/').pop().replace(/\.[^.]+$/, '');
    return !!(nome && artesNoPacote && artesNoPacote.indexOf(nome) >= 0);
  }

  function lerItem(o, teste) {
    if (!o || typeof o !== 'object') return null;
    var id = str(o, 'id');
    var kind = (str(o, 'kind') || '').toLowerCase();
    if (!id || ITENS.indexOf(kind) < 0) return null;
    var seg = num(o, 'seconds', 10);
    seg = seg <= 0 ? 10 : Math.max(3, Math.min(300, Math.round(seg)));
    // `raw`: o item como o servidor mandou, para o desenho da prévia do painel (o mesmo código, comum/js/previa.js)
    var it = { id: id.slice(0, 64), kind: kind, seconds: seg, file: null, files: [], raw: o };
    var f = o.fields && typeof o.fields === 'object' ? o.fields : o;
    it.title = umaLinha(str(f, 'title') || '', TETO.titulo);
    it.text = limpar(str(f, 'text') || str(f, 'body') || '', TETO.texto);
    if (!it.text && Array.isArray(f.lines)) it.text = limpar(f.lines.filter(function (x) { return typeof x === 'string'; }).join('\n'), TETO.texto);
    it.label = umaLinha(str(o, 'caption') || str(f, 'label') || str(o, 'source') || '', 120);
    it.template = (str(o, 'template') || '').toLowerCase();
    it.contain = str(o, 'fit') === 'contain';
    // restrições do item (o app confere sozinho, sem rede)
    it.days = dias(o.days);
    it.from = num(o, 'from', null);
    it.to = num(o, 'to', null);
    it.dateFrom = DIA.test(str(o, 'dateFrom') || '') ? str(o, 'dateFrom') : null;
    it.dateTo = DIA.test(str(o, 'dateTo') || '') ? str(o, 'dateTo') : null;

    if (kind === 'image' || kind === 'video') {
      it.file = arquivo(o, teste);
      if (!it.file) return null;
      if (kind === 'video') it.file.tipo = /^video\//.test(it.file.tipo) ? it.file.tipo : 'video/mp4';
    } else if (kind === 'slide' || kind === 'post') {
      it.file = arquivo(f.image || o.image || o.media, teste);
      if (!it.title && !it.text && !it.file) return null;
    } else if (kind === 'text') {
      if (!it.title && !it.text) return null;
    } else if (kind === 'news') {
      var lista = Array.isArray(o.items) ? o.items : (Array.isArray(o.headlines) ? o.headlines : []);
      it.news = lista.slice(0, 12).map(function (n) { return n && umaLinha(str(n, 'title') || '', 140); }).filter(Boolean);
      if (!it.news.length) return null;
      // a notícia sozinha (single) com a foto: cópia do servidor (/tvcorp/noticia/<sha>), baixada como opcional (sem ela, o
      // degradê escuro com a mesma faixa; a troca de programação não espera a foto)
      var fn = o.image && typeof o.image === 'object' ? arquivo(o.image, teste) : null;
      if (fn) { fn.opcional = true; it.files.push(fn); }
    } else if (kind === 'birthdays') {
      var p = Array.isArray(o.people) ? o.people : [];
      it.people = p.slice(0, 40).map(function (x) {
        return x && { name: umaLinha(str(x, 'name') || '', 60), day: num(x, 'day', 0), month: num(x, 'month', 0) };
      }).filter(function (x) { return x && x.name && x.day >= 1 && x.day <= 31 && x.month >= 1 && x.month <= 12; });
      if (!it.people.length) return null;
    } else if (kind === 'weather') {
      // as fotos do tempo (fundo do item de clima; deitada e em pé): opcionais, não seguram a troca
      [o.art, o.artPort].forEach(function (a) {
        var fw = a && typeof a === 'object' && !fotoNoPacote(a) ? arquivo(a, teste) : null;
        if (fw) { fw.opcional = true; it.files.push(fw); }
      });
    } else if (kind === 'web') {
      // página da internet: só https (o app abre num quadro)
      if (!/^https:\/\/[^\s]+$/i.test(str(o, 'url') || '')) return null;
    } else if (kind === 'countdown') {
      it.target = epoch(o.target);
      if (!it.target) return null;
    }
    if (it.file) it.files.push(it.file);
    // as outras imagens dos campos do slide ({ url, sha256, bytes } em qualquer campo) e as fotos dos aniversariantes;
    // foto é opcional: se não baixar, a tela mostra as iniciais e a programação não espera por ela
    if (o.fields && typeof o.fields === 'object') {
      Object.keys(o.fields).forEach(function (k) {
        var v = o.fields[k];
        // artFile: a foto de fundo (fields.art). A TV leva as artes no pacote (arte/, pelo CSS); só baixa a que não está
        // nele (arte nova no servidor depois do pacote), como opcional: sem ela, o slide sai na cor do tema
        if (k === 'artFile') {
          if (artesNoPacote && artesNoPacote.indexOf(String(o.fields.art || '')) >= 0) return;
          var fr = v && typeof v === 'object' && v.sha256 ? arquivo(v, teste) : null;
          if (fr && !it.files.some(function (x) { return x.sha256 === fr.sha256; })) { fr.opcional = true; it.files.push(fr); }
          return;
        }
        var fa = v && typeof v === 'object' && !Array.isArray(v) && v.sha256 ? arquivo(v, teste) : null;
        if (fa && !it.files.some(function (x) { return x.sha256 === fa.sha256; })) it.files.push(fa);
      });
    }
    if (Array.isArray(o.people)) {
      o.people.forEach(function (p) {
        var fp = p && p.photo && typeof p.photo === 'object' ? arquivo(p.photo, teste) : null;
        if (fp) { fp.opcional = true; it.files.push(fp); }
      });
    }
    return it;
  }

  function epoch(v) {
    if (typeof v === 'number' && v > 0) return v;
    if (typeof v === 'string') { var t = Date.parse(v); return isFinite(t) ? t : 0; }
    return 0;
  }

  function dias(a) {
    var out = [];
    if (!Array.isArray(a)) return out;
    for (var i = 0; i < a.length; i++) {
      var n = a[i];
      if (typeof n === 'number' && n >= 0 && n <= 7 && out.indexOf(n % 7) < 0) out.push(n % 7);
    }
    return out;
  }

  function lerZona(o) {
    if (!o || typeof o !== 'object') return null;
    var id = str(o, 'id');
    var kind = (str(o, 'kind') || '').toLowerCase();
    if (!id || ZONAS.indexOf(kind) < 0) return null;
    var x = num(o, 'x', -1), y = num(o, 'y', -1);
    if (!(x >= 0 && x <= 99 && y >= 0 && y <= 99)) return null;
    var w = Math.min(num(o, 'w', 0), 100 - x), h = Math.min(num(o, 'h', 0), 100 - y);
    if (w <= 0 || h <= 0) return null;
    // overlay: a zona por cima das outras (widget sobre a imagem), com o fundo translúcido em degraus de 20 % (opacity)
    var ov = o.overlay === true && kind !== 'video';
    var op = ov ? Math.round(Math.max(0, Math.min(100, num(o, 'opacity', 60))) / 20) * 20 : null;
    // o recorte não retangular (zone.shape) e o filete na borda dele (zone.edge, só com shape; largura em % da altura da tela)
    var forma = /^[a-z][a-z-]{1,23}$/.test(str(o, 'shape') || '') ? str(o, 'shape') : null;
    var ed = forma && o.edge && typeof o.edge === 'object' ? o.edge : null;
    var filete = ed && /^#[0-9a-f]{6}$/i.test(str(ed, 'color') || '') && num(ed, 'width', 0) > 0
      ? { cor: str(ed, 'color').toLowerCase(), largura: Math.max(0.2, Math.min(3, num(ed, 'width', 1))) } : null;
    // zona de vídeo: proporcional (contain, faixas) por padrão; fit 'cover' preenche a zona cortando as bordas
    var preencher = str(o, 'fit') === 'cover';
    // a entrada HDMI escolhida no layout pelo painel (1 a 4); sem ela, a do menu do app
    var entrada = kind === 'hdmi' && [1, 2, 3, 4].indexOf(num(o, 'input', 0)) >= 0 ? num(o, 'input', 0) : null;
    return { id: id.slice(0, 32), kind: kind, x: x, y: y, w: w, h: h, qr: str(o, 'qr'), overlay: ov, opacidade: op, forma: forma, filete: filete, preencher: preencher, entrada: entrada,
      title: umaLinha(str(o, 'title') || '', TETO.titulo), text: limpar(str(o, 'text') || '', TETO.texto) };
  }

  /**
   * A rádio de fundo do layout (layout.audio, só em layout sem zona de vídeo): { nome, url, codec, volume (10–100) } ou
   * null. Muitas rádios são http: aceita http e https (o app do pacote não tem a regra de conteúdo misto da página).
   */
  /** Quanto esperar para reconectar a rádio que caiu: 3, 6, 12, 24, 48 e 60 s (no máximo). */
  function esperaRadio(rodada) { return Math.min(60, 3 * Math.pow(2, Math.max(0, rodada | 0))); }

  function lerAudio(a) {
    if (!a || typeof a !== 'object' || str(a, 'kind') !== 'radio') return null;
    var url = str(a, 'url');
    if (!url || !/^https?:\/\/[^\s]+$/i.test(url) || url.length > 1000) return null;
    return { id: a.id != null ? String(a.id).slice(0, 64) : '', nome: umaLinha(str(a, 'name') || '', 80), url: url,
      codec: umaLinha(str(a, 'codec') || '', 20), volume: Math.max(10, Math.min(100, Math.round(num(a, 'volume', 100)))) };
  }

  function lerBloco(o, teste) {
    if (!o || typeof o !== 'object') return null;
    var id = str(o, 'id');
    var lay = o.layout;
    if (!id || !lay || !Array.isArray(lay.zones)) return null;
    var zonas = [], ids = {}, video = false, hdmi = false;
    for (var i = 0; i < lay.zones.length && zonas.length < TETO.zonas; i++) {
      var z = lerZona(lay.zones[i]);
      if (!z || ids[z.id]) continue;
      if (z.kind === 'video') { if (video) continue; video = true; }
      // a entrada HDMI da TV: no máximo uma por layout, nunca junto com a zona de vídeo nem por cima
      if (z.kind === 'hdmi') { if (video || hdmi || z.overlay) continue; hdmi = true; }
      ids[z.id] = true;
      zonas.push(z);
    }
    if (!zonas.length) return null;
    var itens = {};
    var zo = o.zones && typeof o.zones === 'object' ? o.zones : {};
    Object.keys(zo).forEach(function (k) {
      if (!ids[k] || !Array.isArray(zo[k])) return;
      var lista = [];
      for (var j = 0; j < zo[k].length && lista.length < TETO.itens; j++) {
        var it = lerItem(zo[k][j], teste);
        if (it) lista.push(it);
      }
      if (lista.length) itens[k] = lista;
    });
    var from = Math.max(0, Math.min(1440, Math.round(num(o, 'from', 0))));
    var to = Math.max(0, Math.min(1440, Math.round(num(o, 'to', 1440))));
    return {
      id: id.slice(0, 64),
      layout: { retrato: str(lay, 'orientation') === 'port', fundo: cores(str(lay, 'background')), zonas: zonas,
        audio: video || hdmi ? null : lerAudio(lay.audio) },
      days: dias(o.days), from: from, to: to,
      dateFrom: DIA.test(str(o, 'dateFrom') || '') ? str(o, 'dateFrom') : null,
      dateTo: DIA.test(str(o, 'dateTo') || '') ? str(o, 'dateTo') : null,
      itens: itens
    };
  }

  function hm(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
    return h * 60 + mi;
  }

  // ------------------------------------------------------------------ conjunto de telas (signage.wall)
  // As contas são as de public/shared/tvcorp-wall.js (o painel e o servidor fazem iguais; o teste compara as duas).

  var GRADES_CONJUNTO = ['2x1', '3x1', '4x1', '5x1', '6x1', '1x2', '1x3', '2x2', '3x2', '2x3', '3x3'];

  /** signage.wall limpo: { id, nome, modo: 'menu'|'wall', cols, rows, pos, col, row, retrato, moldura {x,y}, sync, epoch } ou null. */
  function lerConjunto(w) {
    if (!w || typeof w !== 'object') return null;
    var cols = Math.round(num(w, 'cols', 0)), rows = Math.round(num(w, 'rows', 0));
    if (GRADES_CONJUNTO.indexOf(cols + 'x' + rows) < 0) return null;
    var pos = Math.round(num(w, 'pos', 0));
    if (!(pos >= 1 && pos <= cols * rows)) return null;
    var modo = str(w, 'mode') === 'wall' ? 'wall' : 'menu';
    var bz = w.bezel && typeof w.bezel === 'object' ? w.bezel : {};
    var lim = function (v) { return Math.max(0, Math.min(20, v)); };
    return {
      id: w.id != null ? String(w.id).slice(0, 40) : '', nome: umaLinha(str(w, 'name') || '', 60), modo: modo,
      cols: cols, rows: rows, pos: pos, col: (pos - 1) % cols, row: Math.floor((pos - 1) / cols),
      retrato: str(w, 'orientation') === 'port',
      moldura: { x: lim(num(bz, 'x', 0)), y: lim(num(bz, 'y', 0)) },
      // o videowall troca junto por padrão; o cardápio, só com sync
      sync: modo === 'wall' ? w.sync !== false : w.sync === true,
      epoch: num(w, 'epoch', 0)
    };
  }

  /**
   * A janela desta TV no videowall (wallWindow): o quadro do conjunto inteiro, com a moldura, em % de uma tela.
   * { canvasW, canvasH, left, top, scaleX, scaleY, offsetX, offsetY }.
   */
  function janelaConjunto(c) {
    var bx = Math.max(0, Number(c.moldura && c.moldura.x) || 0) / 100, by = Math.max(0, Number(c.moldura && c.moldura.y) || 0) / 100;
    var canvasW = c.cols + (c.cols - 1) * bx, canvasH = c.rows + (c.rows - 1) * by;
    var left = c.col * (1 + bx), top = c.row * (1 + by);
    var r = function (v) { return Math.round(v * 10000) / 10000; };
    return { canvasW: r(canvasW), canvasH: r(canvasH), left: r(left), top: r(top), scaleX: r(canvasW * 100), scaleY: r(canvasH * 100),
      offsetX: r(-left * 100), offsetY: r(-top * 100) };
  }

  /**
   * A troca sincronizada (syncPosition): todas as TVs fazem a mesma conta com o mesmo relógio e o mesmo epoch.
   * duracoes em ms, na ordem da playlist → { index, offset, remaining } ou null.
   */
  function posicaoSincronizada(duracoes, epoch, agora) {
    var lista = (duracoes || []).map(function (x) { return Math.max(0, Number(x) || 0); });
    var total = lista.reduce(function (a, b) { return a + b; }, 0);
    if (!lista.length || total <= 0) return null;
    var t = (Number(agora) - Number(epoch)) % total;
    if (t < 0) t += total;
    for (var i = 0; i < lista.length; i++) {
      if (t < lista[i]) return { index: i, offset: t, remaining: lista[i] - t };
      t -= lista[i];
    }
    return { index: lista.length - 1, offset: lista[lista.length - 1], remaining: 0 };
  }

  /**
   * O clima no formato do item da prévia ({ kind: 'weather', city, uf, tempC, min, max, text, cond, days, source }), a
   * partir do bloco weather da configuração da tela ({ place, now, today, days, source }) ou de um item que já vem assim.
   * Sem temperatura nenhuma: null.
   */
  function climaParaItem(w) {
    if (!w || typeof w !== 'object') return null;
    var n = function (v) { return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v); };
    if (w.now !== undefined || w.today !== undefined || w.place !== undefined) {
      var now = w.now || {}, hoje = w.today || {}, lugar = w.place || {};
      var t = n(now.temp), mi = n(hoje.min), ma = n(hoje.max);
      if (t === null && mi === null && ma === null) return null;
      return { kind: 'weather', city: lugar.city || '', uf: lugar.uf || '', tempC: t, min: mi, max: ma,
        text: now.text || hoje.text || '', cond: w.icon || now.cond || hoje.cond || 'partly',
        days: Array.isArray(w.days) ? w.days.slice(0, 4) : [], source: w.source || '', art: w.art || null, artPort: w.artPort || null };
    }
    if (n(w.tempC) === null && n(w.min) === null && n(w.max) === null) return null;
    var o = {}; for (var k in w) o[k] = w[k];
    o.kind = 'weather';
    return o;
  }

  /** Noite para a foto do clima: das 18h às 5h59 na hora da tela. */
  function ehNoite(agoraMs, tz) {
    var h = Math.floor(horaLocal(agoraMs, tz || TZ_PADRAO).minuto / 60);
    return h >= 18 || h < 6;
  }

  /**
   * O nome da foto do tempo que está no pacote (sem extensão): clima-<tempo>[-noite]-<port|land>; a noturna só se ela
   * estiver no pacote (senão, a do dia). null: não há foto desse tempo no pacote.
   */
  function nomeFotoClima(cond, emPe, noite, artes) {
    var c = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'storm'].indexOf(cond) >= 0 ? cond : 'partly';
    var forma = emPe ? 'port' : 'land';
    var lista = artes || [];
    if (noite && lista.indexOf('clima-' + c + '-noite-' + forma) >= 0) return 'clima-' + c + '-noite-' + forma;
    if (lista.indexOf('clima-' + c + '-' + forma) >= 0) return 'clima-' + c + '-' + forma;
    return null;
  }

  /**
   * As entradas HDMI da TV (tizen.systeminfo VIDEOSOURCE: { connected: [{type, number}], disconnected: [...] }) para o
   * menu: [{ n, conectada }] em ordem; sem a informação (outra TV, navegador), HDMI 1 a 4 sem saber a conexão (null).
   */
  function entradasHdmi(vs) {
    if (!vs || (!vs.connected && !vs.disconnected)) return [1, 2, 3, 4].map(function (n) { return { n: n, conectada: null }; });
    var m = {};
    (vs.connected || []).forEach(function (s) { if (s && s.type === 'HDMI' && s.number > 0) m[s.number] = true; });
    (vs.disconnected || []).forEach(function (s) { if (s && s.type === 'HDMI' && s.number > 0 && !m[s.number]) m[s.number] = false; });
    var lista = Object.keys(m).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return { n: n, conectada: m[n] }; });
    return lista.length ? lista : [1, 2, 3, 4].map(function (n) { return { n: n, conectada: null }; });
  }

  /** O retângulo da zona (em % da tela) como a janela de TV pede: ['x%', 'y%', 'w%', 'h%'], dentro da tela. */
  function retanguloJanela(r) {
    var c = function (v) { return Math.round(Math.max(0, Math.min(100, v)) * 100) / 100 + '%'; };
    var x = Math.max(0, r.x), y = Math.max(0, r.y);
    return [c(x), c(y), c(Math.min(100 - x, r.w + Math.min(0, r.x))), c(Math.min(100 - y, r.h + Math.min(0, r.y)))];
  }

  // as zonas que só mostram o que vier nos itens (sem item, ficam vazias)
  var SO_COM_ITENS = ['playlist', 'widget', 'news', 'quotes', 'countdown', 'safety', 'worldclock', 'queue'];

  /**
   * As zonas como vão para a tela: a zona que só mostra itens e está sem nenhum (um gadget sem widget escolhido, uma
   * playlist vazia) sai, e a zona logo acima dela, na mesma coluna, cresce até o fim dela — em vez de uma caixa vazia.
   * Não muda o bloco: devolve cópias.
   */
  function zonasParaTela(zonas, itens) {
    var vazia = function (z) { return SO_COM_ITENS.indexOf(z.kind) >= 0 && !(itens[z.id] && itens[z.id].length); };
    var out = zonas.map(function (z) { var c = {}; for (var k in z) c[k] = z[k]; return c; });
    var ficam = [];
    out.forEach(function (z) {
      if (!vazia(z)) { ficam.push(z); return; }
      // a de cima: mesma coluna (x e largura quase iguais), terminando logo acima (até 6 % de vão), não vazia
      var cima = null;
      out.forEach(function (o) {
        if (o === z || vazia(o) || o.overlay !== z.overlay || o.kind === 'ticker') return;
        if (Math.abs(o.x - z.x) > 0.6 || Math.abs(o.w - z.w) > 0.6) return;
        var fim = o.y + o.h;
        if (fim <= z.y + 0.6 && z.y - fim <= 6 && (!cima || fim > cima.y + cima.h)) cima = o;
      });
      if (cima) cima.h = z.y + z.h - cima.y;
    });
    return ficam;
  }

  /**
   * O retângulo de exibição do vídeo em "cover": a proporção do vídeo cobrindo a zona inteira [x, y, w, h] (px), centrado
   * nela e empurrado para dentro da tela (bw × bh); a parte que passa da zona fica por baixo da página.
   */
  function retanguloCobrir(z, aspecto, bw, bh) {
    var a = aspecto > 0 ? aspecto : 16 / 9;
    var w = z[2], h = z[3];
    if (w / h < a) w = h * a; else h = w / a;
    var x = z[0] + (z[2] - w) / 2, y = z[1] + (z[3] - h) / 2;
    x = Math.max(0, Math.min(bw - w, x)); y = Math.max(0, Math.min(bh - h, y));
    if (w > bw) { x = 0; } if (h > bh) { y = 0; }
    return [x, y, w, h];
  }

  /** O retângulo de uma zona (em % do quadro do conjunto) em % da tela desta TV. Sem videowall: o mesmo. */
  function retanguloNaTela(z, jan) {
    if (!jan) return { x: z.x, y: z.y, w: z.w, h: z.h };
    var r = function (v) { return Math.round(v * 1000) / 1000; };
    return { x: r(jan.offsetX + z.x * jan.scaleX / 100), y: r(jan.offsetY + z.y * jan.scaleY / 100),
      w: r(z.w * jan.scaleX / 100), h: r(z.h * jan.scaleY / 100) };
  }

  /**
   * A configuração inteira do servidor (JSON do /api/telas/config) no formato que o app usa.
   * Nunca lança: o que não se entende fica de fora.
   */
  function lerConfig(json, opcoes) {
    var teste = !!(opcoes && opcoes.teste);
    var o = json && typeof json === 'object' ? json : {};
    var sig = o.signage && typeof o.signage === 'object' ? o.signage : null;
    var tz = (sig && str(sig, 'tz')) || str(o, 'tz') || TZ_PADRAO;
    var blocos = [], vistos = {};
    if (sig && Array.isArray(sig.blocks)) {
      for (var i = 0; i < sig.blocks.length && blocos.length < TETO.blocos; i++) {
        var b = lerBloco(sig.blocks[i], teste);
        if (b && !vistos[b.id]) { vistos[b.id] = true; blocos.push(b); }
      }
    }
    var off = o.offline && typeof o.offline === 'object' ? o.offline : {};
    var offItens = [];
    if (Array.isArray(off.items)) {
      var shas = {};
      for (var j = 0; j < off.items.length && offItens.length < TETO.offlineItens; j++) {
        var f = arquivo(off.items[j], teste);
        if (f && !shas[f.sha256]) { shas[f.sha256] = true; if (!/^video\//.test(f.tipo)) f.tipo = 'video/mp4'; offItens.push(f); }
      }
    }
    var s = o.stream && typeof o.stream === 'object' ? o.stream : {};
    var hls = str(s, 'hls');
    var sch = o.schedule && typeof o.schedule === 'object' ? o.schedule : null;
    var horario = null;
    if (sch) {
      var on = hm(str(sch, 'tvOn')), offM = hm(str(sch, 'tvOff'));
      if (on !== null && offM !== null) horario = { on: on, off: offM, days: dias(sch.days) };
    }
    var t = o.ticker && typeof o.ticker === 'object' ? o.ticker : {};
    var marca = lerMarca([o.brand, sig && sig.brand, opcoes && opcoes.marcaAtivacao], teste);
    // o tema dos slides (cor e modo): signage.theme, signage.brand (o servidor manda color/mode ali) ou theme do topo
    var fTema = [sig && sig.theme, sig && sig.brand, o.theme];
    var tema = { color: null, mode: 'dark' };
    for (var ti = fTema.length - 1; ti >= 0; ti--) {
      var tt = fTema[ti];
      if (!tt || typeof tt !== 'object') continue;
      if (cores(str(tt, 'color'))) tema.color = cores(str(tt, 'color'));
      if (str(tt, 'mode') === 'light' || str(tt, 'mode') === 'dark') tema.mode = str(tt, 'mode');
    }
    var clima = o.weather && typeof o.weather === 'object' ? o.weather : null;
    // as fotos do tempo (weather.art deitada, weather.artPort em pé): a tela usa a da forma da zona
    var climaArte = [];
    if (clima) [clima.art, clima.artPort].forEach(function (a) {
      var fa = a && typeof a === 'object' && !fotoNoPacote(a) ? arquivo(a, teste) : null;
      if (fa) { fa.opcional = true; climaArte.push(fa); }
    });
    return {
      rev: str(o, 'rev') || '',
      tz: tz,
      nome: umaLinha((o.device && str(o.device, 'name')) || '', 80),
      // o conjunto de telas (cardápio sincronizado ou videowall): só nas telas de um conjunto
      conjunto: lerConjunto(sig && sig.wall),
      blocos: blocos,
      fallback: sig ? str(sig, 'fallback') : null,
      offline: { itens: offItens, imagem: arquivo(off.image, teste) },
      stream: {
        hls: hls && urlPermitida(hls, teste) ? hls : null,
        volume: Math.max(0, Math.min(100, num(s, 'volume', 100))),
        mudo: s.muted === true
      },
      horario: horario,
      avisos: Array.isArray(t.items) ? t.items.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 20).map(function (x) { return umaLinha(x, 200); }) : [],
      velocidade: Math.max(20, Math.min(200, num(t, 'speed', 60))),
      // o estilo da faixa (public/shared/faixa.js: cor, fundo, negrito, itálico, tamanho, fonte, separador, etiqueta) e o de
      // cada aviso (rich: { text, color?, bold?, italic? }); sem eles, a faixa de sempre
      faixaEstilo: t.style && typeof t.style === 'object' && !Array.isArray(t.style) ? t.style : null,
      avisosRicos: avisosRicos(t.rich),
      marca: marca,
      tema: tema,
      clima: clima,
      climaArte: climaArte
    };
  }

  // ------------------------------------------------------------------ pacote: o que precisa estar no aparelho

  /**
   * Todos os arquivos da programação, sem repetir (pelo sha256): logo da revenda, imagem sem internet, vídeos
   * guardados e os itens de todos os blocos. É a lista que tem de estar inteira e conferida antes da troca.
   */
  function arquivosDoPacote(prog) {
    var out = [], vistos = {};
    function add(f) {
      if (!f) return;
      var ja = vistos[f.sha256];
      if (ja) { if (ja.opcional && !f.opcional) ja.opcional = false; return; } // o mesmo arquivo obrigatório em outro lugar
      if (out.length >= TETO.arquivos) return;
      var c = { url: f.url, sha256: f.sha256, bytes: f.bytes, tipo: f.tipo, opcional: !!f.opcional };
      vistos[f.sha256] = c;
      out.push(c);
    }
    if (!prog) return out;
    add(prog.marca && prog.marca.logo);
    add(prog.offline && prog.offline.imagem);
    (prog.climaArte || []).forEach(add); // as fotos do tempo da zona de clima (opcionais)
    (prog.blocos || []).forEach(function (b) {
      Object.keys(b.itens).forEach(function (z) {
        b.itens[z].forEach(function (it) { it.files.forEach(add); });
      });
    });
    ((prog.offline && prog.offline.itens) || []).forEach(add);
    return out;
  }

  function bytesDe(lista) { return lista.reduce(function (s, f) { return s + f.bytes; }, 0); }

  /** O que falta baixar para a programação: os arquivos cujo sha256 não está em `presentes` ({ sha: true }). */
  function faltando(prog, presentes) {
    return arquivosDoPacote(prog).filter(function (f) { return !presentes[f.sha256]; });
  }

  /**
   * A regra central do offline: a programação nova só entra quando TODOS os arquivos dela estão no aparelho e
   * conferidos. Até lá a tela segue com a atual. Sem atual (primeira vez), a tela espera mostrando o progresso.
   * Devolve { acao: 'manter' | 'trocar' | 'esperar', faltam: [...], bytesFaltando }.
   */
  function decidirTroca(atual, nova, presentes) {
    if (!nova) return { acao: 'manter', faltam: [], bytesFaltando: 0, opcionais: [] };
    if (atual && atual.rev && atual.rev === nova.rev) return { acao: 'manter', faltam: [], bytesFaltando: 0, opcionais: [] };
    var todos = faltando(nova, presentes);
    var f = todos.filter(function (x) { return !x.opcional; });
    var op = todos.filter(function (x) { return x.opcional; });
    // os opcionais (fotos) não seguram a troca, mas vão junto no download
    if (!f.length) return { acao: 'trocar', faltam: [], bytesFaltando: 0, opcionais: op };
    return { acao: 'esperar', faltam: todos, bytesFaltando: bytesDe(todos), opcionais: op };
  }

  /** Arquivos guardados que nenhuma das programações (a atual e a que está chegando) cita: podem ser apagados. */
  function paraApagar(guardados, programacoes) {
    var usados = {};
    programacoes.forEach(function (p) { arquivosDoPacote(p).forEach(function (f) { usados[f.sha256] = true; }); });
    return guardados.filter(function (sha) { return !usados[sha]; });
  }

  /** Cabe? `livre` = espaço que o navegador/TV ainda dá; deixa uma folga fixa (padrão 50 MB). */
  function cabe(bytesFaltando, livre, folga) {
    if (livre === null || livre === undefined || !isFinite(livre)) return true; // a plataforma não informa: tenta
    return bytesFaltando + (folga === undefined ? 50 * 1024 * 1024 : folga) <= livre;
  }

  // ------------------------------------------------------------------ relógio e grade

  var NOMES_DIA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function dois(n) { return (n < 10 ? '0' : '') + n; }

  /** Hora no fuso da grade: { dow (0 = domingo), minuto do dia, data "AAAA-MM-DD", prevDow, prevData }. */
  function horaLocal(agoraMs, tz) {
    var p = partes(agoraMs, tz);
    var ontem = partes(agoraMs - 86400000, tz);
    return { dow: p.dow, minuto: p.h * 60 + p.mi, data: p.data, prevDow: ontem.dow, prevData: ontem.data };
  }

  function partes(ms, tz) {
    try {
      var fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      // "Sat, 11/22/2026, 14:05"
      var m = /^(\w{3}),? (\d{2})\/(\d{2})\/(\d{4}),? (\d{2}):(\d{2})/.exec(fmt.format(new Date(ms)));
      if (m) {
        var h = +m[5] % 24;
        return { dow: NOMES_DIA[m[1]], h: h, mi: +m[6], data: m[4] + '-' + m[2] + '-' + m[3] };
      }
    } catch (e) { /* fuso que a TV não conhece: hora do aparelho */ }
    var d = new Date(ms);
    return { dow: d.getDay(), h: d.getHours(), mi: d.getMinutes(), data: d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) };
  }

  function diaVale(b, dow, data) {
    if (b.days.length && b.days.indexOf(dow) < 0) return false;
    if (b.dateFrom && data < b.dateFrom) return false;
    if (b.dateTo && data > b.dateTo) return false;
    return true;
  }

  /** O bloco vale agora? Faixa que vira a meia-noite (from > to) pertence ao dia em que começa. */
  function blocoAtivo(b, l) {
    if (b.from === b.to || (b.from === 0 && b.to >= 1440)) return diaVale(b, l.dow, l.data);
    if (b.from < b.to) return l.minuto >= b.from && l.minuto < b.to && diaVale(b, l.dow, l.data);
    return (l.minuto >= b.from && diaVale(b, l.dow, l.data)) || (l.minuto < b.to && diaVale(b, l.prevDow, l.prevData));
  }

  /** O bloco da grade para agora (o primeiro que vale, na ordem de prioridade do servidor); nenhum = o `fallback`. */
  function escolherBloco(prog, agoraMs) {
    if (!prog || !prog.blocos.length) return null;
    var l = horaLocal(agoraMs, prog.tz);
    for (var i = 0; i < prog.blocos.length; i++) if (blocoAtivo(prog.blocos[i], l)) return prog.blocos[i];
    if (prog.fallback) for (var j = 0; j < prog.blocos.length; j++) if (prog.blocos[j].id === prog.fallback) return prog.blocos[j];
    return null;
  }

  /** O item da playlist vale agora (dias, faixa e datas do próprio item)? */
  function itemVale(it, l) {
    var b = { days: it.days || [], from: it.from === null || it.from === undefined ? 0 : it.from,
      to: it.to === null || it.to === undefined ? 1440 : it.to, dateFrom: it.dateFrom, dateTo: it.dateTo };
    return blocoAtivo(b, l);
  }

  /** Minutos até a próxima mudança possível de bloco (para o app reavaliar na hora certa, mesmo sem rede). */
  function proximaVirada(prog, agoraMs) {
    if (!prog) return 60;
    var l = horaLocal(agoraMs, prog.tz);
    var marcos = [0, 1440];
    prog.blocos.forEach(function (b) { marcos.push(b.from, b.to); });
    var melhor = 1440;
    marcos.forEach(function (m) { var d = (m - l.minuto + 1440) % 1440; if (d > 0 && d < melhor) melhor = d; });
    return melhor;
  }

  /** A TV deve estar ligada agora (`schedule` do contrato, 0 = domingo)? Sem horário = sempre. */
  function telaLigada(horario, l) {
    if (!horario) return true;
    var b = { days: horario.days, from: horario.on, to: horario.off, dateFrom: null, dateTo: null };
    if (horario.on === horario.off) return diaVale(b, l.dow, l.data);
    return blocoAtivo(b, l);
  }

  /**
   * Relógio confiável: o app guarda a diferença entre a hora do servidor e a do aparelho a cada resposta, e usa
   * a hora corrigida para a grade, também sem rede. Diferença absurda (mais de 3 anos) é ignorada.
   */
  function diferencaRelogio(horaServidorMs, horaAparelhoMs) {
    if (!isFinite(horaServidorMs) || horaServidorMs <= 0) return null;
    var d = horaServidorMs - horaAparelhoMs;
    return Math.abs(d) > 3 * 365 * 86400000 ? null : d;
  }

  // ------------------------------------------------------------------ código de cadastro

  var ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /** A chave/código como o servidor usa (8 caracteres sem 0, 1, I, O), formatada XXXX-XXXX, ou null. */
  function normalizarChave(bruto) {
    var s = String(bruto || '').toUpperCase(), out = '';
    for (var i = 0; i < s.length && out.length < 8; i++) if (ALFABETO.indexOf(s[i]) >= 0) out += s[i];
    return out.length === 8 ? out.slice(0, 4) + '-' + out.slice(4) : null;
  }

  /**
   * O campo da chave mudou (teclado da TV, colar): devolve { chars, texto, confuso }. `chars` só tem caracteres do
   * alfabeto, em maiúsculas, até 8; `texto` é o que o campo mostra, com o traço automático depois do 4º ("ABCD-E").
   * 0, 1, I e O saem (`confuso` = veio algum). Se a mudança foi só apagar o traço automático, apaga também o caractere
   * antes dele (senão o traço voltaria e o apagar ficaria preso), como no Android.
   */
  function editarChave(anteriores, texto) {
    var s = String(texto || '').toUpperCase(), chars = '', confuso = false;
    for (var i = 0; i < s.length; i++) {
      if (ALFABETO.indexOf(s[i]) >= 0) { if (chars.length < 8) chars += s[i]; }
      else if ('01IO'.indexOf(s[i]) >= 0) confuso = true;
    }
    var ant = String(anteriores || '');
    if (chars === ant && ant.length >= 4 && s.length < formatarChave(ant).length) chars = chars.slice(0, -1);
    return { chars: chars, texto: formatarChave(chars), confuso: confuso };
  }

  function formatarChave(chars) { return chars.length < 4 ? chars : chars.slice(0, 4) + '-' + chars.slice(4); }

  // ------------------------------------------------------------------ sinal de vida e exibição

  /** Acumula a exibição (contrato §4.3: `plays`), por dia; o app só zera depois do 200 do sinal de vida. */
  function contarExibicao(log, ref, segundos, dia) {
    var l = log && log.dia === dia ? log : { dia: dia, itens: {} };
    if (log && log.dia !== dia && log.itens && Object.keys(log.itens).length) l.anterior = log; // o dia que virou segue pendente
    var e = l.itens[ref] || (l.itens[ref] = { n: 0, sec: 0 });
    e.n += 1;
    e.sec += Math.max(0, Math.round(segundos));
    return l;
  }

  function loteExibicao(log) {
    if (!log) return null;
    var base = log.anterior || log;
    var refs = Object.keys(base.itens).slice(0, 100);
    if (!refs.length) return null;
    return { dia: base.dia, plays: refs.map(function (r) { return { ref: r, n: base.itens[r].n, sec: base.itens[r].sec }; }) };
  }

  /** Tira do log o que o servidor aceitou (o lote enviado). */
  function baixarLote(log, lote) {
    if (!log || !lote) return log;
    var base = log.anterior && log.anterior.dia === lote.dia ? log.anterior : (log.dia === lote.dia ? log : null);
    if (!base) return log;
    lote.plays.forEach(function (p) {
      var e = base.itens[p.ref];
      if (!e) return;
      e.n -= p.n; e.sec -= p.sec;
      if (e.n <= 0) delete base.itens[p.ref];
    });
    if (log.anterior && !Object.keys(log.anterior.itens).length) delete log.anterior;
    return log;
  }

  /** O corpo do POST /api/telas/heartbeat (os campos do Android, mais os da TV que o servidor pode ignorar). */
  function corpoSinal(e) {
    var c = {
      rev: e.rev || '',
      // os valores que o servidor aceita (server/telas-core.js: STATES e SOURCES)
      state: ['playing', 'buffering', 'offline-content', 'error', 'idle'].indexOf(e.estado) >= 0 ? e.estado : 'idle',
      source: ['hls', 'backup', 'offline'].indexOf(e.fonte) >= 0 ? e.fonte : 'offline',
      appVersion: VERSAO,
      uptimeSec: Math.max(0, Math.round(e.ligadoSeg || 0)),
      net: e.rede || 'wifi',
      lastError: e.erro || null,
      locked: true,
      platform: e.plataforma || 'browser',
      model: e.modelo || ''
    };
    if (e.hwid) c.hwid = e.hwid;
    if (e.pendente) c.pending = e.pendente; // { rev, files, bytes }: o que ainda está chegando
    if (e.armazenamento) c.storage = e.armazenamento; // { used, free } em bytes
    if (e.lote) { c.plays = e.lote.plays; c.playsDay = e.lote.dia; }
    return c;
  }

  /**
   * Qual camada cobre a tela quando não há programação para tocar. Sem token a tela é SEMPRE a do cadastro: nada
   * (relógio da grade, rede que cai ou volta) pode trocá-la pela abertura, que antes do cadastro é só fundo preto
   * (a TV ainda não conhece a logo da revenda). Com programação: null (o conteúdo).
   */
  function camadaSemConteudo(s) {
    if (s.atual) return null;
    if (!s.token) return 'cadastro';
    if (!s.online) return 'semrede';
    return s.baixando ? 'espera' : 'abertura';
  }

  /**
   * Vigia do ao vivo (HLS), sem relógio nem player dentro: recebe uma amostra a cada poucos segundos e diz o que fazer.
   *   s: { inicio, ultimoTempo, paradoDesde, falhas } (comece com vigiaNovo(agora))
   *   amostra: { agora (ms), tempo (posição do vídeo em s), bufferizando (bool) }
   * Regras: 30 s de tolerância na partida; parado 20 s (30 s se o player diz que está enchendo o buffer) = recarregar
   * o ao vivo; 3 recargas sem o vídeo andar = ir para a reserva (vídeos guardados) e tentar o ao vivo de novo depois.
   * O vídeo andando zera as falhas.
   */
  function vigiaNovo(agora) { return { inicio: agora, ultimoTempo: -1, paradoDesde: null, falhas: 0 }; }

  function vigiaAoVivo(s, a) {
    if (a.tempo !== s.ultimoTempo && a.tempo > 0) {
      s.ultimoTempo = a.tempo; s.paradoDesde = null; s.falhas = 0;
      return { s: s, acao: null };
    }
    if (a.agora - s.inicio < 30000) return { s: s, acao: null };
    if (s.paradoDesde === null) s.paradoDesde = a.agora;
    if (a.agora - s.paradoDesde < (a.bufferizando ? 30000 : 20000)) return { s: s, acao: null };
    return vigiaFalhou(s, a.agora);
  }

  /** Erro do player ou travada confirmada: recarregar (e recomeçar a tolerância) ou, na 3ª, ir para a reserva. */
  function vigiaFalhou(s, agora) {
    s.falhas++;
    s.paradoDesde = null;
    s.inicio = agora;
    s.ultimoTempo = -1;
    return { s: s, acao: s.falhas >= 3 ? 'reserva' : 'recarregar' };
  }

  /** Na reserva, espera até tentar o ao vivo de novo (s): 30, 60, 120… até 300. */
  function esperaAoVivo(rodada) { return Math.min(300, 30 * Math.pow(2, Math.max(0, rodada))); }

  /** A linha de diagnóstico fixa da tela de cadastro (para o dono mandar uma foto). */
  /** Os avisos com estilo (ticker.rich), limpos: { texto, cor ('#rrggbb' ou null), negrito, italico }. */
  function avisosRicos(v) {
    if (!Array.isArray(v)) return null;
    var out = [];
    for (var i = 0; i < v.length && out.length < 20; i++) {
      var x = v[i];
      if (!x || typeof x !== 'object' || typeof x.text !== 'string' || !x.text.trim()) continue;
      out.push({ texto: umaLinha(x.text, 200), cor: /^#[0-9a-f]{6}$/i.test(String(x.color || '')) ? String(x.color).toLowerCase() : null,
        negrito: x.bold === true, italico: x.italic === true });
    }
    return out.length ? out : null;
  }

  /**
   * O nível do alerta (contrato §9): o servidor manda 'info' | 'warn' | 'critical' (o app antigo esperava 0, 1 ou 2).
   * Devolve 0 (azul), 1 (âmbar) ou 2 (vermelho); o desconhecido é 0.
   */
  function nivelAlerta(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.min(2, Math.round(v)));
    var k = String(v || '').toLowerCase();
    if (k === 'critical' || k === 'extremo' || k === 'emergencia' || k === 'severe' || k === 'extreme') return 2;
    if (k === 'warn' || k === 'warning' || k === 'atencao') return 1;
    return 0;
  }
  var CABECA_ALERTA = ['COMUNICADO', 'ATENÇÃO', 'ALERTA'];
  /** A linha de cima do alerta: a do servidor (header) ou, sem ela, a da prévia do painel pelo nível. */
  function cabecaAlerta(a) {
    if (a && a.test) return 'TESTE DO SISTEMA';
    var h = a && typeof a.header === 'string' ? a.header.trim() : '';
    return (h || CABECA_ALERTA[nivelAlerta(a && a.level)]).slice(0, 60);
  }

  function linhaDiagnostico(d) {
    var srv = String(d.servidor || '—').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    var partes = ['v' + VERSAO, srv, d.plataforma || '', d.modo || ''];
    partes.push('erro: ' + (d.erro ? umaLinha(String(d.erro), 300) : 'nenhum'));
    return partes.filter(Boolean).join(' · ');
  }

  /** Espera da próxima tentativa (s): 5, 10, 20… até 300. */
  function espera(tentativa) { return Math.min(300, 5 * Math.pow(2, Math.max(0, tentativa))); }

  // ------------------------------------------------------------------ menu: a senha e o tamanho da imagem
  // A margem da tela (de 0 a 8% em cada borda): a TV que corta as bordas mostra o layout inteiro menor, numa moldura preta.
  var MARGENS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  function limparMargem(v) { var n = Number(v); return MARGENS.indexOf(n) >= 0 ? n : 0; }
  /** A janela do layout com a margem (o mesmo formato da janela do videowall), ou null sem margem. */
  function janelaMargem(m) { m = limparMargem(m); return m ? { offsetX: m, offsetY: m, scaleX: 100 - 2 * m, scaleY: 100 - 2 * m } : null; }
  // A senha do menu, a mesma em todos os aparelhos do DIGITAL ISP: guardada só pelo hash (sha256 de "digitalisp-menu:" + a senha)
  var MENU_HASH = '6a11b6cf6b331a6db8e494cdea018a19badad798d003e8cdb1416f197412f352';
  /** A senha digitada abre o menu? sha: o TelasSha256 (criar/update/hex). */
  function senhaMenuOk(pin, sha) {
    var s = String(pin == null ? '' : pin);
    if (!/^[0-9]{4,8}$/.test(s) || !sha) return false;
    s = 'digitalisp-menu:' + s;
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    var h = sha.criar(); h.update(b);
    return h.hex() === MENU_HASH;
  }

  return {
    MARGENS: MARGENS, limparMargem: limparMargem, janelaMargem: janelaMargem, senhaMenuOk: senhaMenuOk,
    VERSAO: VERSAO, TETO: TETO, ZONAS: ZONAS, ITENS: ITENS,
    urlPermitida: urlPermitida, origem: origem, arquivo: arquivo, lerMarca: lerMarca, lerConfig: lerConfig,
    arquivosDoPacote: arquivosDoPacote, faltando: faltando, decidirTroca: decidirTroca, paraApagar: paraApagar,
    cabe: cabe, bytesDe: bytesDe,
    horaLocal: horaLocal, blocoAtivo: blocoAtivo, escolherBloco: escolherBloco, itemVale: itemVale,
    proximaVirada: proximaVirada, telaLigada: telaLigada, diferencaRelogio: diferencaRelogio,
    normalizarChave: normalizarChave, editarChave: editarChave,
    contarExibicao: contarExibicao, loteExibicao: loteExibicao, baixarLote: baixarLote, corpoSinal: corpoSinal,
    espera: espera, camadaSemConteudo: camadaSemConteudo, linhaDiagnostico: linhaDiagnostico,
    nivelAlerta: nivelAlerta, cabecaAlerta: cabecaAlerta, definirArtes: definirArtes, lerAudio: lerAudio, esperaRadio: esperaRadio,
    lerConjunto: lerConjunto, janelaConjunto: janelaConjunto, retanguloCobrir: retanguloCobrir, zonasParaTela: zonasParaTela, climaParaItem: climaParaItem, entradasHdmi: entradasHdmi, retanguloJanela: retanguloJanela, ehNoite: ehNoite, nomeFotoClima: nomeFotoClima, posicaoSincronizada: posicaoSincronizada, retanguloNaTela: retanguloNaTela,
    vigiaNovo: vigiaNovo, vigiaAoVivo: vigiaAoVivo, vigiaFalhou: vigiaFalhou, esperaAoVivo: esperaAoVivo
  };
});
