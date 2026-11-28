// DIGITAL ISP · a página da zona de vídeo com o YouTube ao vivo (youtube.html). Toca sozinha, sem controles, no volume da
// tela; volta a tocar se parar; sem a live no ar (ou o vídeo que não deixa tocar fora do YouTube), um aviso e nova tentativa
// em 1 minuto. O app muda o volume por telasVolume(vol, mudo) ou por postMessage({ telasVolume: vol, mudo }).
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var v = /^[A-Za-z0-9_-]{11}$/.test(q.get('v') || '') ? q.get('v') : null;
  var c = /^UC[A-Za-z0-9_-]{22}$/.test(q.get('c') || '') ? q.get('c') : null;
  var vol = Math.max(0, Math.min(100, Number(q.get('vol') || 100)));
  var mudo = q.get('mute') === '1' || vol === 0;
  var player = null; var tentativa = null;
  var aviso = document.getElementById('aviso');
  function avisar(t) { aviso.textContent = t || ''; aviso.style.display = t ? 'flex' : 'none'; }
  function aplicarVolume() {
    if (!player || !player.setVolume) return;
    try { player.setVolume(vol); if (mudo) player.mute(); else player.unMute(); } catch (e) { /* o player ainda não está pronto */ }
  }
  window.telasVolume = function (nv, nm) { vol = Math.max(0, Math.min(100, Number(nv))); mudo = !!nm || vol === 0; aplicarVolume(); };
  // a LEGENDA (cc=1, cclang=en): a do vídeo no idioma escolhido; se o vídeo não tem esse idioma, a legenda dele traduzida
  // pelo próprio YouTube. O app troca na hora por telasLegenda(on, lang) ou postMessage({ telasLegenda: on, lang }).
  var LANG = /^[a-z]{2}(-[A-Za-z]{2})?$/;
  var cc = q.get('cc') === '1';
  var ccLang = LANG.test(q.get('cclang') || '') ? q.get('cclang') : null;
  var legendaTimers = [];
  var base = function (code) { return String(code || '').split('-')[0].toLowerCase(); };
  function aplicarLegenda() {
    if (!player || !player.setOption) return;
    try {
      if (!cc) { if (player.unloadModule) player.unloadModule('captions'); return; }
      if (player.loadModule) player.loadModule('captions');
      var lista = player.getOption('captions', 'tracklist') || [];
      if (!lista.length) return; // a lista chega depois de começar a tocar: as novas tentativas pegam
      var igual = ccLang ? lista.filter(function (t) { return base(t.languageCode) === base(ccLang); })[0] : null;
      var orig = igual || lista.filter(function (t) { return t.kind !== 'asr'; })[0] || lista[0];
      var track = { languageCode: orig.languageCode };
      if (ccLang && !igual) track.translationLanguage = { languageCode: ccLang }; // a tradução automática do YouTube
      player.setOption('captions', 'track', track);
      player.setOption('captions', 'fontSize', 1);
    } catch (e) { /* o player ainda não aceita: as novas tentativas pegam */ }
  }
  function legendaLogo() {
    legendaTimers.forEach(clearTimeout);
    legendaTimers = [500, 2500, 6000, 15000].map(function (ms) { return setTimeout(aplicarLegenda, ms); });
  }
  window.telasLegenda = function (on, lang) { cc = !!on; ccLang = LANG.test(lang || '') ? lang : null; legendaLogo(); };
  window.addEventListener('message', function (e) { var d = e.data; if (d && typeof d === 'object' && 'telasVolume' in d) window.telasVolume(d.telasVolume, d.mudo); });
  window.addEventListener('message', function (e) { var d = e.data; if (d && typeof d === 'object' && 'telasLegenda' in d) window.telasLegenda(d.telasLegenda, d.lang); });
  function deNovo(ms) { clearTimeout(tentativa); tentativa = setTimeout(function () { location.reload(); }, ms); }
  if (!v && !c) { avisar('Link do YouTube inválido.'); return; }
  window.onYouTubeIframeAPIReady = function () {
    var vars = { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, mute: mudo ? 1 : 0 };
    if (c) vars.channel = c;
    if (cc) { vars.cc_load_policy = 1; vars.cc_lang_pref = ccLang || 'pt'; vars.hl = ccLang || 'pt'; }
    player = new YT.Player('p', {
      width: '100%', height: '100%', videoId: c ? 'live_stream' : v, playerVars: vars,
      events: {
        onReady: function (e) { avisar(''); aplicarVolume(); try { e.target.playVideo(); } catch (x) { /* nada */ } },
        onApiChange: function () { if (cc) aplicarLegenda(); }, // o módulo da legenda carregou
        onStateChange: function (e) {
          if (e.data === 1) { avisar(''); if (cc) legendaLogo(); } // tocando: a lista de legendas já pode vir
          if (e.data === 0) { try { e.target.playVideo(); } catch (x) { deNovo(5000); } } // acabou: de novo (o vídeo gravado vira laço)
        },
        onError: function (e) {
          // 100: não existe ou é privado; 101/150: o dono não deixa tocar fora do YouTube; 2/5: link ou player
          avisar(e.data === 101 || e.data === 150 ? 'Este vídeo do YouTube não está disponível aqui: a transmissão acabou, é privada ou o dono não deixa tocar fora do YouTube. Tentando de novo em 1 minuto…' : 'O vídeo ao vivo não está no ar agora. Tentando de novo em 1 minuto…');
          deNovo(60000);
        }
      }
    });
  };
  // a API do YouTube não carregou (sem internet ou bloqueada): tenta de novo
  setTimeout(function () { if (!window.YT || !window.YT.Player) { avisar('Sem conexão com o YouTube. Tentando de novo…'); deNovo(30000); } }, 15000);
})();
