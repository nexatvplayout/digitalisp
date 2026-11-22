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

    function desenharItem(caixa, it, prog, depois) {
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

    function faixa(caixa, textos, velocidade) {
      if (!textos.length) return;
      var t = el('div', 'faixa');
      var s = el('span', null, textos.join('     •     '));
      t.appendChild(s);
      caixa.appendChild(t);
      // velocidade do contrato: dp/s (60 ≈ 120 px/s em 1080p)
      var px = velocidade * (window.innerHeight / 540);
      setTimeout(function () {
        var dist = s.offsetWidth + t.offsetWidth;
        s.style.animationDuration = Math.max(5, dist / px) + 's';
        s.classList.add('rolando');
      }, 50);
    }

    /** Zona de vídeo: ao vivo com rede; sem rede (ou ao vivo com erro), os vídeos guardados em laço. */
    function zonaVideo(caixa, prog) {
      var guardados = prog.offline.itens, k = 0;
      function guardado() {
        if (!guardados.length) { caixa.innerHTML = ''; return semVideo(); }
        var f = guardados[k++ % guardados.length];
        ctx.url(f.sha256).then(function (u) {
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
      if (prog.stream.hls && ctx.online() && podeHls()) {
        var v = novoVideo();
        v.onerror = function () { guardado(); };
        v.src = prog.stream.hls;
        trocar(caixa, v);
        tocar(v);
        // vigia: parado por 15 s = volta aos guardados (e o app tenta o ao vivo de novo no próximo ciclo)
        var ultimo = -1, parado = 0;
        timers.push(setInterval(function () {
          if (!v.parentNode) return;
          if (v.currentTime === ultimo) parado += 5; else parado = 0;
          ultimo = v.currentTime;
          if (parado >= 15 || !ctx.online()) { parado = 0; guardado(); }
        }, 5000));
      } else {
        guardado();
      }
    }

    function podeHls() {
      var v = document.createElement('video');
      return !!(v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL'));
    }

    /** Mostra o bloco da programação. */
    function mostrar(prog, bloco) {
      limpar();
      atual = { prog: prog, bloco: bloco };
      raizEl.style.background = (bloco && bloco.layout.fundo) || prog.marca.fundo || '#000';
      if (!bloco) {
        // sem TV Corporativa/grade: tela cheia com o vídeo (como o layout `full` do Android) e os avisos embaixo
        var z = el('div', 'zona');
        z.style.left = '0'; z.style.top = '0'; z.style.width = '100%';
        z.style.height = prog.avisos.length ? '90%' : '100%';
        raizEl.appendChild(z);
        zonaVideo(z, prog);
        if (prog.avisos.length) {
          var f = el('div', 'zona zona-ticker');
          f.style.left = '0'; f.style.top = '90%'; f.style.width = '100%'; f.style.height = '10%';
          raizEl.appendChild(f);
          faixa(f, prog.avisos, prog.velocidade);
        }
        return;
      }
      bloco.layout.zonas.forEach(function (zona) {
        var c = el('div', 'zona zona-' + zona.kind);
        c.style.left = zona.x + '%'; c.style.top = zona.y + '%'; c.style.width = zona.w + '%'; c.style.height = zona.h + '%';
        raizEl.appendChild(c);
        var itens = bloco.itens[zona.id] || [];
        if (zona.kind === 'video') zonaVideo(c, prog);
        else if (zona.kind === 'playlist') playlist(c, itens, prog);
        else if (zona.kind === 'ticker') faixa(c, prog.avisos.concat(itens.filter(function (i) { return i.kind === 'text'; }).map(function (i) { return i.title || i.text; })), prog.velocidade);
        else if (zona.kind === 'clock') relogio(c, prog);
        else if (zona.kind === 'logo') logo(c, prog);
        else if (zona.kind === 'text') { var cc = el('div', 'cartao'); if (zona.title) cc.appendChild(el('div', 'titulo', zona.title)); if (zona.text) cc.appendChild(el('div', 'texto', zona.text)); c.appendChild(cc); }
        else if (itens.length) playlist(c, itens, prog); // news, quotes… com itens: como playlist
      });
    }

    return { mostrar: mostrar, limpar: limpar, atual: function () { return atual; } };
  }

  raiz.TelasTela = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
