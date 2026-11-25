/*
 * A entrada HDMI da TV numa zona do layout (zona kind 'hdmi'), só na Samsung (Tizen): a janela de TV (tizen.tvwindow,
 * 'MAIN') com a fonte HDMI escolhida no menu do app, no retângulo da zona, ATRÁS da página (a página fica transparente
 * ali; o resto do layout segue por cima ou ao lado). Em outra TV ou no navegador, disponivel() é false e a zona mostra um
 * aviso discreto.
 *
 *   TelasHdmi.criar() → {
 *     disponivel(),
 *     entradas(cb)            cb([{ n, conectada }]) — as HDMI da TV (systeminfo VIDEOSOURCE; sem ela, 1 a 4),
 *     mostrar(n, rect%, cb)   cb({ ok, conectada, motivo }),
 *     esconder()
 *   }
 */
(function (raiz) {
  'use strict';

  var N = raiz.TelasNucleo;

  function criar() {
    var tz = raiz.tizen;
    var tw = tz && tz.tvwindow;
    var aberta = false;

    function disponivel() { return !!(tw && typeof tw.show === 'function' && typeof tw.setSource === 'function'); }

    function fontes(cb) {
      try {
        tz.systeminfo.getPropertyValue('VIDEOSOURCE', function (vs) { cb(vs); }, function () { cb(null); });
      } catch (e) { cb(null); }
    }

    function entradas(cb) {
      if (!disponivel()) return cb(N.entradasHdmi(null));
      fontes(function (vs) { cb(N.entradasHdmi(vs)); });
    }

    function mostrar(n, r, cb) {
      if (!disponivel()) return cb({ ok: false, conectada: null, motivo: 'esta TV não mostra a entrada HDMI pelo app' });
      fontes(function (vs) {
        var todas = vs ? (vs.connected || []).concat(vs.disconnected || []) : [];
        var fonte = null, conectada = null;
        todas.forEach(function (s) { if (s && s.type === 'HDMI' && s.number === n && !fonte) fonte = s; });
        if (vs) conectada = (vs.connected || []).some(function (s) { return s && s.type === 'HDMI' && s.number === n; });
        if (!fonte) fonte = { type: 'HDMI', number: n }; // sem a lista: tenta assim mesmo
        var ret = N.retanguloJanela(r);
        var falhou = function (onde) { return function (e) { cb({ ok: false, conectada: conectada, motivo: onde + ': ' + ((e && (e.message || e.name)) || e) }); }; };
        try {
          tw.setSource(fonte, function () {
            var pronto = function () { aberta = true; cb({ ok: true, conectada: conectada }); };
            try {
              // atrás da página (a página é transparente no retângulo da zona); modelo sem o zPosition: sem ele
              tw.show(pronto, function () {
                try { tw.show(pronto, falhou('show'), ret, 'MAIN'); } catch (e2) { falhou('show')(e2); }
              }, ret, 'MAIN', 'BEHIND');
            } catch (e) {
              try { tw.show(pronto, falhou('show'), ret, 'MAIN'); } catch (e2) { falhou('show')(e2); }
            }
          }, falhou('setSource'), 'MAIN');
        } catch (e) { falhou('setSource')(e); }
      });
    }

    function esconder() {
      if (!disponivel() || !aberta) return;
      aberta = false;
      try { tw.hide(function () {}, function () {}, 'MAIN'); } catch (e) { /* nada */ }
    }

    return { disponivel: disponivel, entradas: entradas, mostrar: mostrar, esconder: esconder, aberta: function () { return aberta; } };
  }

  raiz.TelasHdmi = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
