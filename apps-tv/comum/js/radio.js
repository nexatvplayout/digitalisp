/*
 * A rádio de fundo do layout (layout.audio, só nos layouts sem zona de vídeo): um <audio> só, que sobrevive aos
 * redesenhos da tela. Toca enquanto o layout estiver no ar, no volume da tela × o da rádio, respeitando o mudo da tela;
 * troca quando a rádio muda, para quando o layout não tem rádio e reconecta sozinho quando o stream cai (3, 6, 12… até
 * 60 s). MP3/AAC pelo próprio <audio>; HLS (.m3u8) quando a TV toca HLS no elemento de mídia.
 *
 *   TelasRadio.criar({ mudo() → bool, volume() → 0..100, aoErro(msg) }) → { tocar(audio), parar(), abafar(bool), atual() }
 */
(function (raiz) {
  'use strict';

  var N = raiz.TelasNucleo;

  function criar(op) {
    var el = null, atual = null, rodada = 0, timer = null, vigia = null, ultimoTempo = -1, parado = 0, abafada = false, calada = false;

    function aplicarVolume() {
      if (!el || !atual) return;
      var tela = Math.max(0, Math.min(100, Number(op.volume()) || 0));
      // na chamada da senha, 90% mais baixa (abaixada)
      el.volume = Math.max(0, Math.min(1, (tela / 100) * (atual.volume / 100) * (abaixada ? 0.1 : 1)));
      el.muted = !!op.mudo() || tela === 0 || abafada || calada;
    }

    function limparTimers() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (vigia) { clearInterval(vigia); vigia = null; }
    }

    function soltar() {
      if (!el) return;
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { /* nada */ }
    }

    function reconectar(motivo) {
      if (!atual) return;
      if (motivo && op.aoErro) op.aoErro('rádio ' + (atual.nome || '') + ': ' + motivo);
      limparTimers();
      soltar();
      timer = setTimeout(abrir, N.esperaRadio(rodada++) * 1000);
    }

    function abrir() {
      if (!atual) return;
      limparTimers();
      if (!el) {
        el = document.createElement('audio');
        el.preload = 'none';
        el.onerror = function () { reconectar('erro ' + (el.error ? el.error.code : '?')); };
        el.onended = function () { reconectar('o stream terminou'); };
        el.onplaying = function () { rodada = 0; };
      }
      aplicarVolume();
      el.src = atual.url;
      var p = el.play();
      if (p && p.catch) p.catch(function (e) { reconectar('não tocou (' + ((e && e.name) || e) + ')'); });
      // stream que para de andar sem dar erro (rede caiu no meio): 30 s sem o tempo andar → reconecta
      ultimoTempo = -1; parado = 0;
      vigia = setInterval(function () {
        if (!el || el.paused) return;
        var t = el.currentTime;
        if (t === ultimoTempo) { parado += 10; if (parado >= 30) reconectar('sem áudio há 30 s'); }
        else { parado = 0; ultimoTempo = t; }
      }, 10000);
    }

    /** Toca a rádio do layout; a mesma que já toca só acerta o volume (os redesenhos não interrompem). */
    function tocar(audio) {
      if (!audio || !audio.url) return parar();
      if (atual && atual.url === audio.url) { atual = audio; aplicarVolume(); return; }
      parar();
      atual = audio; rodada = 0;
      abrir();
    }

    function parar() {
      limparTimers();
      soltar();
      atual = null;
    }

    /** Abafa a rádio enquanto um vídeo da playlist toca com som (os dois juntos embolam). */
    function abafar(sim) { abafada = !!sim; aplicarVolume(); }

    var abaixada = false;
    /** A chamada da senha (voz ou bipe): a rádio cai 90% e depois volta. */
    function abaixar(sim) { abaixada = !!sim; aplicarVolume(); }

    /** Alerta na tela: a rádio fica muda até ele sair. */
    function calar(sim) { calada = !!sim; aplicarVolume(); }

    return { tocar: tocar, parar: parar, abafar: abafar, abaixar: abaixar, calar: calar, volume: aplicarVolume, atual: function () { return atual; } };
  }

  raiz.TelasRadio = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
