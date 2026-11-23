/*
 * Desenha a programação: as zonas do bloco (em % da tela) e o que passa em cada uma. Tudo o que aparece vem do
 * conteúdo do cliente; o app não escreve o nome dele em lugar nenhum (white-label).
 *
 * Arquivos sempre do aparelho (blob: do IndexedDB): a tela nunca depende da rede para mostrar o que já tem.
 * Só o ao vivo (stream.hls) usa a rede; sem ela, a zona de vídeo passa os vídeos guardados (offline.items).
 */
(function (raiz) {
  'use strict';
  var N = raiz.TelasNucleo;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  }

  function hhmm(ms, tz) {
    var l = N.horaLocal(ms, tz);
    var h = Math.floor(l.minuto / 60), m = l.minuto % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /**
   * @param raizEl  o elemento da área de conteúdo
   * @param ctx     { url(sha) → Promise<blob url>, agora() → ms, aoExibir(ref, seg), online() → bool, mudo, volume }
   */
  function criar(raizEl, ctx) {
    var atual = null, timers = [], videos = [];

    function limpar() {
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      timers = [];
      videos.forEach(function (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* nada */ } });
      videos = [];
      raizEl.innerHTML = '';
    }

    function novoVideo() {
      var v = el('video', 'midia');
      v.muted = !!ctx.mudo || ctx.volume === 0;
      v.volume = Math.max(0, Math.min(1, (ctx.volume === undefined ? 100 : ctx.volume) / 100));
      v.setAttribute('playsinline', '');
      v.autoplay = true;
      videos.push(v);
      return v;
    }

    // ---- playlist: um item por vez, cada um os seus segundos (vídeo: até acabar)
    function playlist(caixa, itens, prog) {
      var i = -1, inicio = 0, vistoAgora = null;
      function proximo() {
        if (vistoAgora) ctx.aoExibir(vistoAgora, (ctx.agora() - inicio) / 1000);
        var l = N.horaLocal(ctx.agora(), prog.tz);
        var validos = itens.filter(function (it) { return N.itemVale(it, l); });
        if (!validos.length) { caixa.innerHTML = ''; vistoAgora = null; timers.push(setTimeout(proximo, 30000)); return; }
        i = (i + 1) % validos.length;
        var it = validos[i];
        inicio = ctx.agora();
        vistoAgora = it.id;
        desenharItem(caixa, it, prog, proximo);
      }
      proximo();
    }

    // ---- o desenho da prévia do painel (TelasPrevia, gerado de public/shared/tvcorp-previa.js)

    /** As medidas da zona para o CSS da prévia: --cqw/--cqh (1% da largura/altura) e os min() (--mI). */
    function medidas(caixa) {
      var r = caixa.getBoundingClientRect();
      var w = r.width / 100, h = r.height / 100;
      caixa.style.setProperty('--cqw', w + 'px');
      caixa.style.setProperty('--cqwp', w + 'px');
      caixa.style.setProperty('--cqh', h + 'px');
      (raiz.TelasPrevia.MINS || []).forEach(function (m, i) {
        var a = m[0] * (m[1] === 'w' ? w : h), b = m[2] * (m[3] === 'w' ? w : h);
        caixa.style.setProperty('--m' + i, Math.min(a, b) + 'px');
      });
      // slide e item são containers no painel: lá dentro 1cqw é 1% da largura do conteúdo deles (sem o padding)
      var sel = raiz.TelasPrevia.CONTEINERES;
      if (!sel) return;
      Array.prototype.forEach.call(caixa.querySelectorAll(sel), function (e) {
        var cs = getComputedStyle(e);
        var cw = e.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
        e.style.setProperty('--cqw', Math.max(0, cw) / 100 + 'px');
      });
    }

    function tema(prog) { return { color: prog.tema && prog.tema.color, mode: prog.tema && prog.tema.mode }; }

    function copia(o) { return JSON.parse(JSON.stringify(o || {})); }

    /** Os endereços locais (blob:) dos arquivos do item; arquivo que não está no aparelho fica de fora. */
    function locais(it) {
      var mapa = {};
      return Promise.all(it.files.map(function (f) {
        return ctx.url(f.sha256).then(function (u) { if (u) mapa[f.sha256] = u; }, function () {});
      })).then(function () { return mapa; });
    }

    function shaDe(v) { return v && typeof v === 'object' && v.sha256 ? String(v.sha256).toLowerCase() : null; }

    /** O item do servidor no formato que a prévia lê, com as imagens trocadas pelas cópias do aparelho. */
    function paraPrevia(it, mapa) {
      var o = copia(it.raw);
      if (o.kind === 'image') { o.url = mapa[it.file.sha256] || ''; if (!o.url) return null; }
      if (o.kind === 'slide' && o.fields) {
        Object.keys(o.fields).forEach(function (k) {
          var sh = shaDe(o.fields[k]);
          if (!sh) return;
          // a foto de fundo vem da classe tvc-art-* (arte/ do pacote): o artFile não é a imagem do slide. A arte que não
          // está no pacote vai por ele, baixada e guardada (aplicada depois do desenho, em fundoReserva)
          if (k === 'artFile') {
            var noPacote = (raiz.TelasPrevia.ARTES || []).indexOf(String(o.fields.art || '')) >= 0;
            if (!noPacote && mapa[sh]) o._fundo = { url: mapa[sh], claro: o.fields[k].tone === 'light' };
            delete o.fields[k];
            return;
          }
          if (mapa[sh] && !o.image) o.image = mapa[sh];
          delete o.fields[k]; // o objeto do arquivo não é texto: não vai para o desenho
        });
      }
      if (o.kind === 'post') {
        var sp = shaDe(o.image) || shaDe(o.media);
        o.image = sp && mapa[sp] ? mapa[sp] : null;
      }
      if (o.kind === 'birthdays' && Array.isArray(o.people)) {
        o.people = o.people.map(function (p) {
          var q = copia(p), sh = shaDe(p.photo);
          if (sh && mapa[sh]) q.photo = mapa[sh]; else delete q.photo;
          return q;
        });
      }
      // conta no aparelho, pela data: segue certo sem rede (o número pronto do servidor envelhece)
      if (o.kind === 'safety' && o.since) delete o.days;
      return o;
    }

    /** Aniversariantes sem foto: as iniciais que o servidor manda (as da prévia saem erradas: ver LEIAME). */
    function iniciais(n, o) {
      if (o.kind !== 'birthdays' || !Array.isArray(o.people)) return;
      var ini = n.querySelectorAll('.tvc-av-ini');
      var sem = o.people.slice(0, 8).filter(function (p) { return !p.photo; });
      for (var i = 0; i < ini.length && i < sem.length; i++) {
        var t = sem[i].initials || String(sem[i].name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0]; }).join('');
        ini[i].textContent = String(t).toUpperCase().slice(0, 2);
      }
    }

    function dataLonga(ms, tz) {
      try { return new Date(ms).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }); } catch (e) { return ''; }
    }

    /** Repete fn a cada `ms` enquanto o nó estiver na tela: o item que saiu da playlist para sozinho, sem acumular. */
    function enquantoNaTela(no, fn, ms) {
      var t = setInterval(function () {
        if (!document.documentElement.contains(no)) { clearInterval(t); return; }
        fn();
      }, ms);
      timers.push(t);
    }

    /** Os tipos que a prévia desenha só como zona (relógio, clima, QR, logomarca): as mesmas classes dela. */
    function zonaPrevia(kind, o, prog) {
      var th = raiz.TelasPrevia.themeClass(tema(prog));
      if (kind === 'clock') {
        var c = el('div', 'tvc-z-clock ' + th), b = el('b'), sp = el('span');
        var f = function () { b.textContent = hhmm(ctx.agora(), prog.tz); sp.textContent = dataLonga(ctx.agora(), prog.tz); };
        f(); enquantoNaTela(c, f, 5000);
        c.appendChild(b); c.appendChild(sp);
        return c;
      }
      if (kind === 'weather') {
        var w = (o && typeof o.tempC === 'number') ? o : prog.clima;
        if (!w || typeof w.tempC !== 'number') return null;
        var cw = el('div', 'tvc-z-weather ' + th);
        cw.appendChild(el('b', null, Math.round(w.tempC) + '°'));
        cw.appendChild(el('span', null, [w.city, w.text || w.condition].filter(Boolean).join(' · ')));
        if (typeof w.min === 'number' && typeof w.max === 'number') cw.appendChild(el('span', null, 'mín ' + Math.round(w.min) + '° · máx ' + Math.round(w.max) + '°'));
        return cw;
      }
      if (kind === 'qr') {
        var dado = o && (o.qr || o.url);
        if (!dado) return null;
        var cq = el('div', 'tvc-z-qr ' + th);
        cq.appendChild(raiz.TelasPrevia.qrSvg(dado, 'tvc-z-qrc'));
        cq.appendChild(el('span', null, (o && (o.title || o.label)) || 'Aponte a câmera'));
        return cq;
      }
      if (kind === 'logo') {
        var cl = el('div', 'tvc-z-logo ' + th);
        logo(cl, prog);
        return cl;
      }
      return null;
    }

    /** A foto de fundo que não veio no pacote (artFile baixado): o mesmo véu escuro das fotos da biblioteca. */
    function fundoReserva(n, o) {
      if (!o._fundo || !n) return;
      var sl = n.classList.contains('tvc-sl') ? n : n.querySelector('.tvc-sl');
      if (!sl) return;
      var veu = o._fundo.claro ? 'linear-gradient(90deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.6) 100%)'
        : 'linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.6) 100%)';
      sl.style.backgroundImage = veu + ', url("' + o._fundo.url + '")';
      sl.style.backgroundSize = 'cover';
      sl.style.backgroundPosition = '72% 50%';
      sl.classList.add('tvc-art', 'tvc-photo', o._fundo.claro ? 'tvc-art-light' : 'tvc-art-dark');
    }

    function TelasN(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

    /**
     * Página da internet (item web): um quadro com o endereço por cima da prévia (que mostra o endereço) e recarga a cada
     * refreshMin minutos. Sem rede, ou se o quadro não carregar em 30 s, fica a prévia. O navegador não deixa o app saber
     * se o site recusou o quadro (X-Frame-Options/CSP): nesse caso a TV mostra a página de recusa do próprio navegador.
     */
    function paginaWeb(z, it) {
      var r = it.raw || {};
      z.setAttribute('data-web', it.id + ' ' + r.url);
      if (ctx.online && !ctx.online()) return;
      var f = el('iframe', 'tvc-web');
      f.setAttribute('scrolling', 'no');
      f.setAttribute('frameborder', '0');
      var carregou = false;
      f.onload = function () { carregou = true; };
      f.src = r.url;
      z.appendChild(f);
      timers.push(setTimeout(function () { if (!carregou && f.parentNode) f.parentNode.removeChild(f); }, 30000));
      var min = Number(r.refreshMin);
      if (min > 0) enquantoNaTela(f, function () { if (!ctx.online || ctx.online()) f.src = r.url; }, Math.max(1, min) * 60000);
    }

    function desenharPrevia(caixa, it, prog, depois) {
      locais(it).then(function (mapa) {
        var n = null;
        try {
          var r = it.raw || {};
          // relógio e clima com dados (os gadgets): o desenho de item da prévia; sem dados, o desenho de zona com o
          // relógio do app e o clima da tela. QR e logomarca: só o de zona
          var comoZona = it.kind === 'qr' || it.kind === 'logo' ||
            (it.kind === 'weather' && !(TelasN(r.tempC) || TelasN(r.min) || TelasN(r.max) || (r.days && r.days.length))) ||
            (it.kind === 'clock' && !raiz.TelasPrevia.tickWidgets);
          if (comoZona) n = zonaPrevia(it.kind, it.raw, prog);
          else if (it.kind === 'web' && caixa.firstChild && caixa.firstChild.getAttribute && caixa.firstChild.getAttribute('data-web') === it.id + ' ' + r.url) {
            // a mesma página já aberta (playlist de um item só): não recarrega a cada volta
            timers.push(setTimeout(depois, it.seconds * 1000));
            return;
          } else {
            var o = paraPrevia(it, mapa);
            if (o && o.kind === 'clock') {
              if (!o.tz) o.tz = prog.tz;
              // `seconds` do item é a duração na playlist (o servidor sobrescreve o "mostrar segundos" do gadget com ela);
              // showSeconds, quando vier, decide
              if (o.showSeconds !== undefined) o.seconds = o.showSeconds === true;
            }
            if (o) { n = raiz.TelasPrevia.itemPreview(o, { theme: tema(prog) }); iniciais(n, o); fundoReserva(n, o); }
          }
        } catch (e) {
          if (ctx.aoErro) ctx.aoErro('desenho do item ' + it.id + ': ' + e.message);
          n = null;
        }
        if (!n) return depois(); // sem o que mostrar (arquivo faltando, dado vazio): o próximo
        var z = el('div', 'tvc-z' + (caixa._ov || ''));
        z.appendChild(n);
        if (it.kind === 'web') paginaWeb(z, it);
        trocar(caixa, z);
        medidas(caixa);
        // relógios e contadores: andam a cada segundo, pelo relógio confiável do app
        var tick = raiz.TelasPrevia.tickWidgets || raiz.TelasPrevia.tickCountdowns;
        if (tick && (n.classList.contains('tvc-it-count') || n.classList.contains('tvc-tick') || n.querySelector('.tvc-it-count, .tvc-tick'))) {
          var tique = function () { tick(n, ctx.agora()); };
          tique(); enquantoNaTela(n, tique, 1000);
        }
        timers.push(setTimeout(depois, it.seconds * 1000));
      });
    }

    function desenharItem(caixa, it, prog, depois) {
      // tudo que não é vídeo vai pelo desenho do painel; sem ele (prévia não gerada), o desenho simples abaixo
      if (it.kind !== 'video' && raiz.TelasPrevia) return desenharPrevia(caixa, it, prog, depois);
      var conteudo = el('div', 'item item-' + it.kind);
      var avancar = function () { timers.push(setTimeout(depois, it.seconds * 1000)); };
      if (it.kind === 'image' || ((it.kind === 'slide' || it.kind === 'post') && it.file && !it.title && !it.text)) {
        ctx.url(it.file.sha256).then(function (u) {
          if (!u) return depois();
          var img = el('img', 'midia' + (it.contain ? ' contain' : ''));
          img.src = u;
          conteudo.appendChild(img);
          if (it.label) conteudo.appendChild(el('div', 'legenda', it.label));
          trocar(caixa, conteudo);
          avancar();
        });
        return;
      }
      if (it.kind === 'video') {
        ctx.url(it.file.sha256).then(function (u) {
          if (!u) return depois();
          var v = novoVideo();
          var fim = false;
          var seguir = function () { if (!fim) { fim = true; depois(); } };
          v.onended = seguir;
          v.onerror = seguir;
          v.src = u;
          conteudo.appendChild(v);
          trocar(caixa, conteudo);
          tocar(v);
          // vídeo travado não prende a playlist: no máximo a duração mais 10 s, ou 10 min sem duração
          timers.push(setTimeout(seguir, 600000));
          v.onloadedmetadata = function () { if (isFinite(v.duration)) timers.push(setTimeout(seguir, (v.duration + 10) * 1000)); };
        });
        return;
      }
      if (it.kind === 'slide' || it.kind === 'post' || it.kind === 'text') {
        var cartao = el('div', 'cartao');
        if (it.label) cartao.appendChild(el('div', 'rotulo', it.label));
        if (it.title) cartao.appendChild(el('div', 'titulo', it.title));
        if (it.text) cartao.appendChild(el('div', 'texto', it.text));
        conteudo.appendChild(cartao);
        if (it.file) {
          ctx.url(it.file.sha256).then(function (u) {
            if (u) { var img = el('img', 'midia fundo-cartao'); img.src = u; conteudo.insertBefore(img, cartao); }
          });
        }
      } else if (it.kind === 'news') {
        var c = el('div', 'cartao');
        if (it.label) c.appendChild(el('div', 'rotulo', it.label));
        it.news.slice(0, 5).forEach(function (n) { c.appendChild(el('div', 'manchete', n)); });
        conteudo.appendChild(c);
      } else if (it.kind === 'birthdays') {
        var b = el('div', 'cartao');
        b.appendChild(el('div', 'titulo', it.title || 'Aniversariantes'));
        it.people.slice(0, 8).forEach(function (p) {
          b.appendChild(el('div', 'texto', p.name + ' · ' + (p.day < 10 ? '0' : '') + p.day + '/' + (p.month < 10 ? '0' : '') + p.month));
        });
        conteudo.appendChild(b);
      } else if (it.kind === 'countdown') {
        var cd = el('div', 'cartao');
        cd.appendChild(el('div', 'titulo', it.title));
        var n = el('div', 'numero');
        cd.appendChild(n);
        var f = function () {
          var s = Math.max(0, Math.round((it.target - ctx.agora()) / 1000));
          var d = Math.floor(s / 86400);
          n.textContent = d > 0 ? d + (d === 1 ? ' dia' : ' dias') : hhmmss(s);
        };
        f(); timers.push(setInterval(f, 1000));
        conteudo.appendChild(cd);
      } else if (it.kind === 'clock') {
        relogio(conteudo, prog);
      } else if (it.kind === 'logo') {
        logo(conteudo, prog);
      } else {
        // tipo que este app ainda não desenha: pula sem mostrar nada
        return depois();
      }
      trocar(caixa, conteudo);
      avancar();
    }

    function hhmmss(s) {
      var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }

    function trocar(caixa, novo) {
      // vídeos que saem da tela param (libera o decodificador: TV costuma ter um ou dois)
      Array.prototype.forEach.call(caixa.querySelectorAll('video'), function (v) {
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* nada */ }
        var k = videos.indexOf(v); if (k >= 0) videos.splice(k, 1);
      });
      caixa.innerHTML = '';
      caixa.appendChild(novo);
    }

    function tocar(v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
    }

    function relogio(caixa, prog) {
      var r = el('div', 'relogio');
      var f = function () { r.textContent = hhmm(ctx.agora(), prog.tz); };
      f(); timers.push(setInterval(f, 5000));
      caixa.appendChild(r);
    }

    function logo(caixa, prog) {
      var m = prog.marca;
      if (m.logo) ctx.url(m.logo.sha256).then(function (u) { if (u) { var i = el('img', 'midia contain'); i.src = u; caixa.appendChild(i); } });
      else if (m.logoUrl && ctx.online()) { var i = el('img', 'midia contain'); i.src = m.logoUrl; caixa.appendChild(i); }
    }

    /**
     * A faixa de avisos rolando. `avisos`: [{ texto, cor?, negrito?, italico? }]. Com o estilo da faixa (prog.faixaEstilo,
     * limpo pelo mesmo código do painel, public/shared/faixa.js, quando a prévia está no pacote): o fundo, a cor, a fonte,
     * o tamanho (% da altura da faixa), o separador e a etiqueta. Sem estilo, a faixa de sempre.
     */
    function faixa(caixa, avisos, prog) {
      if (!avisos.length) return;
      var P = raiz.TelasPrevia;
      var est = prog.faixaEstilo && P && P.cleanTickerStyle ? P.cleanTickerStyle(prog.faixaEstilo) : null;
      var t = el('div', 'faixa');
      var s = el('span');
      var sep = est ? P.sepText(est.sep) : '•';
      var ESP = '\u00a0\u00a0\u00a0\u00a0'; // espaços que não somem (o separador fica no meio)
      avisos.forEach(function (a, i) {
        if (i) s.appendChild(el('span', 'faixa-sep', sep ? ESP + sep + ESP : ESP + '\u00a0\u00a0'));
        var p = el('span', 'faixa-aviso', a.texto);
        if (a.cor) p.style.color = a.cor;
        if (a.negrito) p.style.fontWeight = '700';
        if (a.italico) p.style.fontStyle = 'italic';
        s.appendChild(p);
      });
      t.appendChild(s);
      if (est) {
        caixa.style.background = est.bg;
        t.style.color = est.color;
        t.style.fontWeight = est.bold ? '700' : '400';
        t.style.fontStyle = est.italic ? 'italic' : 'normal';
        t.style.fontFamily = P.fontCss(est.font);
        t.style.fontSize = Math.round(caixa.offsetHeight * est.size / 100) + 'px';
        if (est.label) {
          var et = el('div', 'faixa-etiqueta', est.label);
          et.style.color = est.labelColor; et.style.background = est.labelBg;
          et.style.fontSize = t.style.fontSize; et.style.fontFamily = t.style.fontFamily;
          caixa.appendChild(et);
          caixa.classList.add('com-etiqueta');
        }
      }
      caixa.appendChild(t);
      // velocidade do contrato: dp/s (60 ≈ 120 px/s em 1080p)
      var px = prog.velocidade * (window.innerHeight / 540);
      setTimeout(function () {
        var dist = s.offsetWidth + t.offsetWidth;
        s.style.animationDuration = Math.max(5, dist / px) + 's';
        s.classList.add('rolando');
      }, 50);
    }

    /** Os avisos da tela: os com estilo (ticker.rich) quando vierem, senão só o texto (ticker.items). */
    function avisosDa(prog) {
      if (prog.avisosRicos) return prog.avisosRicos;
      return prog.avisos.map(function (x) { return { texto: x }; });
    }

    /**
     * Zona de vídeo: o ao vivo (stream.hls) pelo controlador TelasAoVivo, que fica numa camada própria e sobrevive
     * aos redesenhos; quando ele desiste (3 recargas sem andar) ou não há ao vivo, os vídeos guardados em laço nesta
     * zona, e o ao vivo é tentado de novo depois (30 s, 60 s… até 5 min).
     */
    function zonaVideo(caixa, prog, ret) {
      var guardados = prog.offline.itens, k = 0, emReserva = false;
      function guardado() {
        if (!guardados.length) return semVideo();
        var f = guardados[k++ % guardados.length];
        ctx.url(f.sha256).then(function (u) {
          if (!emReserva) return;
          if (!u) return timers.push(setTimeout(guardado, 1000));
          var v = novoVideo();
          v.onended = guardado;
          v.onerror = function () { timers.push(setTimeout(guardado, 1000)); };
          v.src = u;
          trocar(caixa, v);
          tocar(v);
        });
      }
      function semVideo() {
        // nada para passar: a imagem sem internet ou a logo da revenda
        var c = el('div', 'item');
        if (prog.offline.imagem) ctx.url(prog.offline.imagem.sha256).then(function (u) { if (u) { var i = el('img', 'midia'); i.src = u; c.appendChild(i); } });
        else logo(c, prog);
        trocar(caixa, c);
      }
      var vivo = ctx.aoVivo;
      if (prog.stream.hls && vivo && vivo.suporta(prog.stream.hls)) {
        usouVivo = true;
        var rodada = 0;
        var aoVivo = function () {
          emReserva = false;
          trocar(caixa, el('div', 'item')); // a zona fica vazia (transparente): o ao vivo aparece pela camada dele
          vivo.tocar(prog.stream.hls, ret, function () {
            emReserva = true;
            guardado();
            timers.push(setTimeout(aoVivo, N.esperaAoVivo(rodada++) * 1000));
          });
        };
        aoVivo();
      } else {
        emReserva = true;
        guardado();
      }
    }

    /** Mostra o bloco da programação. */
    /** Zona de relógio, logomarca, clima, QR ou texto fixo, com o desenho da prévia. */
    function zonaFixa(c, zona, prog) {
      var n = zona.kind === 'text'
        ? raiz.TelasPrevia.itemPreview({ kind: 'text', title: zona.title, text: zona.text }, { theme: tema(prog) })
        : zonaPrevia(zona.kind, zona.kind === 'qr' ? { qr: zona.qr, title: zona.title } : null, prog);
      if (!n) return;
      var z = el('div', 'tvc-z' + (c._ov || ''));
      z.appendChild(n);
      c.appendChild(z);
      medidas(c);
    }

    var usouVivo = false;

    function mostrar(prog, bloco) {
      limpar();
      usouVivo = false;
      desenharBloco(prog, bloco);
      // o bloco novo não tem zona de vídeo (ou não tem ao vivo): o ao vivo para
      if (!usouVivo && ctx.aoVivo) ctx.aoVivo.parar();
    }

    function desenharBloco(prog, bloco) {
      atual = { prog: prog, bloco: bloco };
      raizEl.style.background = (bloco && bloco.layout.fundo) || prog.marca.fundo || '#000';
      if (!bloco) {
        // sem TV Corporativa/grade: tela cheia com o vídeo (como o layout `full` do Android) e os avisos embaixo
        var z = el('div', 'zona');
        z.style.left = '0'; z.style.top = '0'; z.style.width = '100%';
        z.style.height = prog.avisos.length ? '90%' : '100%';
        raizEl.appendChild(z);
        zonaVideo(z, prog, { x: 0, y: 0, w: 100, h: prog.avisos.length ? 90 : 100 });
        if (prog.avisos.length) {
          var f = el('div', 'zona zona-ticker');
          f.style.left = '0'; f.style.top = '90%'; f.style.width = '100%'; f.style.height = '10%';
          raizEl.appendChild(f);
          faixa(f, avisosDa(prog), prog);
        }
        return;
      }
      bloco.layout.zonas.forEach(function (zona) {
        var c = el('div', 'zona zona-' + zona.kind);
        c.style.left = zona.x + '%'; c.style.top = zona.y + '%'; c.style.width = zona.w + '%'; c.style.height = zona.h + '%';
        // a zona por cima: acima da camada do ao vivo (z-index 1) e com o vidro translúcido da prévia (.tvc-ov.tvc-op-N)
        if (zona.overlay) { c.style.zIndex = '2'; c._ov = ' tvc-ov tvc-op-' + zona.opacidade; c.className += ' zona-ov'; }
        raizEl.appendChild(c);
        var itens = bloco.itens[zona.id] || [];
        if (zona.kind === 'video') zonaVideo(c, prog, { x: zona.x, y: zona.y, w: zona.w, h: zona.h });
        else if (zona.kind === 'playlist') playlist(c, itens, prog);
        else if (zona.kind === 'ticker') faixa(c, avisosDa(prog).concat(itens.filter(function (i) { return i.kind === 'text'; }).map(function (i) { return { texto: i.title || i.text }; })), prog);
        else if (raiz.TelasPrevia && !itens.length && ['clock', 'logo', 'weather', 'qr', 'text'].indexOf(zona.kind) >= 0) zonaFixa(c, zona, prog);
        else if (zona.kind === 'clock') relogio(c, prog);
        else if (zona.kind === 'logo') logo(c, prog);
        else if (zona.kind === 'text') { var cc = el('div', 'cartao'); if (zona.title) cc.appendChild(el('div', 'titulo', zona.title)); if (zona.text) cc.appendChild(el('div', 'texto', zona.text)); c.appendChild(cc); }
        else if (itens.length) playlist(c, itens, prog); // news, quotes… com itens: como playlist
      });
    }

    return {
      mostrar: mostrar,
      // limpar por fora (tela revogada, TV desligada pelo horário, conteúdo apagado) para também o ao vivo
      limpar: function () { limpar(); if (ctx.aoVivo) ctx.aoVivo.parar(); },
      atual: function () { return atual; }
    };
  }

  raiz.TelasTela = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
