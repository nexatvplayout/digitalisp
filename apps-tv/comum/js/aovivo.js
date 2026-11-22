/*
 * O vídeo ao vivo (HLS) da zona de vídeo, separado do resto da tela:
 *   - Tizen (Samsung): AVPlay (webapis.avplay), o player da própria TV, recomendado pela Samsung para HLS ao vivo.
 *     O vídeo é desenhado num plano de hardware atrás da página, na posição de um <object type="application/avplayer">.
 *   - webOS e navegador: <video> nativo.
 * O player vive numa camada própria (#aovivo), fora das zonas: o redesenho da grade, uma configuração nova ou a
 * playlist de outra zona não recriam o vídeo. Mesmo endereço = só reposiciona.
 * O vigia (TelasNucleo.vigiaAoVivo) decide: recarregar o ao vivo ou ir para a reserva (os vídeos guardados).
 */
(function (raiz) {
  'use strict';
  var N = raiz.TelasNucleo;

  function temAvplay() {
    try { return !!(raiz.webapis && raiz.webapis.avplay && typeof raiz.webapis.avplay.open === 'function'); } catch (e) { return false; }
  }

  function temHlsNativo() {
    var v = document.createElement('video');
    return !!(v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL'));
  }

  // ------------------------------------------------------------------ motor AVPlay (Tizen)

  function motorAvplay(camada, log) {
    var av = raiz.webapis.avplay, obj = null, enchendo = false, aberto = false;
    function retangulo(r) {
      // AVPlay usa a resolução base de 1920×1080, qualquer que seja a da página
      var bw = 1920, bh = 1080;
      return [Math.round(r.x * bw / 100), Math.round(r.y * bh / 100), Math.round(r.w * bw / 100), Math.round(r.h * bh / 100)];
    }
    return {
      nome: 'avplay',
      abrir: function (url, r, aoErro) {
        if (!obj) {
          obj = document.createElement('object');
          obj.type = 'application/avplayer';
          obj.className = 'aovivo-el';
          camada.appendChild(obj);
        }
        this.posicionar(r);
        try { av.stop(); } catch (e) { /* nada aberto */ }
        try { av.close(); } catch (e) { /* nada aberto */ }
        enchendo = true;
        try {
          av.open(url);
          aberto = true;
          var q = retangulo(r);
          av.setDisplayRect(q[0], q[1], q[2], q[3]);
          try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { /* modelo antigo */ }
          // buffer curto na partida e na volta: o ao vivo começa antes e volta mais rápido de um soluço da rede
          try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4); } catch (e) { /* opcional */ }
          try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 6); } catch (e) { /* opcional */ }
          av.setListener({
            onbufferingstart: function () { enchendo = true; },
            onbufferingcomplete: function () { enchendo = false; },
            onstreamcompleted: function () { aoErro('o ao vivo terminou'); },
            onerror: function (t) { aoErro('AVPlay: ' + t); },
            onevent: function () {},
            oncurrentplaytime: function () {}
          });
          av.prepareAsync(function () {
            try { av.play(); } catch (e) { aoErro('AVPlay play: ' + e.message); }
          }, function (e) { aoErro('AVPlay prepare: ' + ((e && e.name) || e)); });
        } catch (e) {
          aoErro('AVPlay open: ' + e.message);
        }
      },
      posicionar: function (r) {
        if (obj) { obj.style.left = r.x + '%'; obj.style.top = r.y + '%'; obj.style.width = r.w + '%'; obj.style.height = r.h + '%'; obj.hidden = false; }
        if (aberto) { var q = retangulo(r); try { av.setDisplayRect(q[0], q[1], q[2], q[3]); } catch (e) { /* nada */ } }
      },
      amostra: function () {
        var t = 0;
        try { t = av.getCurrentTime() / 1000; } catch (e) { t = 0; }
        var est = '';
        try { est = av.getState(); } catch (e) { est = ''; }
        return { tempo: t, bufferizando: enchendo || est === 'READY' || est === 'IDLE' };
      },
      fechar: function () {
        try { av.stop(); } catch (e) { /* nada */ }
        try { av.close(); } catch (e) { /* nada */ }
        aberto = false;
        if (obj) obj.hidden = true;
      },
      // a TV escondeu o app (outro app na frente) e voltou
      suspender: function () { try { av.suspend(); } catch (e) { /* nada */ } },
      retomar: function () { try { av.restore(); } catch (e) { /* nada */ } }
    };
  }

  // ------------------------------------------------------------------ motor <video> (webOS e navegador)

  function motorVideo(camada, op) {
    var v = null;
    return {
      nome: 'video',
      abrir: function (url, r, aoErro) {
        if (!v) {
          v = document.createElement('video');
          v.className = 'aovivo-el';
          v.setAttribute('playsinline', '');
          v.autoplay = true;
          camada.appendChild(v);
        }
        v.muted = op.mudo();
        v.volume = Math.max(0, Math.min(1, op.volume() / 100));
        v.onerror = function () { aoErro('vídeo: erro ' + (v.error ? v.error.code : '?')); };
        v.onended = function () { aoErro('o ao vivo terminou'); };
        this.posicionar(r);
        v.src = url;
        var p = v.play();
        if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
      },
      posicionar: function (r) {
        if (!v) return;
        v.style.left = r.x + '%'; v.style.top = r.y + '%'; v.style.width = r.w + '%'; v.style.height = r.h + '%';
        v.hidden = false;
      },
      amostra: function () {
        if (!v) return { tempo: 0, bufferizando: true };
        return { tempo: v.currentTime || 0, bufferizando: v.readyState < 3 || v.seeking };
      },
      fechar: function () {
        if (!v) return;
        v.onerror = null; v.onended = null;
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* nada */ }
        v.hidden = true;
      },
      suspender: function () {}, retomar: function () {}
    };
  }

  // ------------------------------------------------------------------ controlador

  /**
   * @param camada  elemento #aovivo (acima do conteúdo, abaixo das camadas de cadastro e alerta)
   * @param op      { mudo() → bool, volume() → 0..100, agora() → ms, aoErro(msg) }
   */
  function criar(camada, op) {
    var motor = temAvplay() ? motorAvplay(camada) : motorVideo(camada, op);
    var url = null, ret = null, vigia = null, timer = null, aoReserva = null, ativo = false;

    function falha(msg) {
      if (!ativo) return;
      op.aoErro(msg);
      decidir(N.vigiaFalhou(vigia, op.agora()).acao);
    }

    function decidir(acao) {
      if (acao === 'recarregar') { motor.abrir(url, ret, falha); }
      else if (acao === 'reserva') {
        parar();
        if (aoReserva) aoReserva();
      }
    }

    /** Toca `u` no retângulo `r` (% da tela). Já tocando o mesmo endereço: só reposiciona. */
    function tocar(u, r, quandoReserva) {
      aoReserva = quandoReserva;
      if (ativo && u === url) { ret = r; motor.posicionar(r); return; }
      parar();
      url = u; ret = r; ativo = true;
      vigia = N.vigiaNovo(op.agora());
      motor.abrir(u, r, falha);
      timer = setInterval(function () {
        var a = motor.amostra();
        a.agora = op.agora();
        decidir(N.vigiaAoVivo(vigia, a).acao);
      }, 5000);
    }

    function parar() {
      if (timer) { clearInterval(timer); timer = null; }
      if (ativo) motor.fechar();
      ativo = false;
    }

    document.addEventListener('visibilitychange', function () {
      if (!ativo) return;
      if (document.hidden) motor.suspender(); else motor.retomar();
    });

    return {
      motor: motor.nome,
      // HLS precisa do AVPlay ou do HLS nativo do <video>; um vídeo comum (mp4) toca em qualquer um
      suporta: function (u) { return motor.nome === 'avplay' || temHlsNativo() || !/\.m3u8(\?|$)/i.test(String(u || '')); },
      tocar: tocar,
      parar: parar,
      ativo: function () { return ativo; },
      url: function () { return ativo ? url : null; }
    };
  }

  raiz.TelasAoVivo = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
