/*
 * O que muda de uma TV para outra: identidade do aparelho, modelo, teclas do controle, proteção de tela e rede.
 *   - Tizen (Samsung): objetos `tizen` e `webapis` (webapis.js vem do próprio aparelho, em $WEBAPIS/webapis/webapis.js);
 *   - webOS (LG): os serviços luna pela PalmServiceBridge do próprio aparelho;
 *   - navegador: computador ou monitor, para teste.
 * Tudo é opcional: o que a TV não oferecer volta vazio e o app segue.
 */
(function (raiz) {
  'use strict';
  var Sha = raiz.TelasSha256;
  var ID_APP = 'br.com.digitalisp.telas';

  function qual() {
    if (typeof raiz.tizen !== 'undefined') return 'tizen';
    if (typeof raiz.PalmSystem !== 'undefined' || typeof raiz.PalmServiceBridge !== 'undefined' || /Web0S|webOS/i.test(navigator.userAgent)) return 'webos';
    return 'browser';
  }

  var nome = qual();

  function tentar(fn, padrao) { try { var v = fn(); return v === undefined || v === null ? padrao : v; } catch (e) { return padrao; } }

  /**
   * Chamada a um serviço do webOS (luna://…) pela ponte que o próprio runtime do webOS oferece (PalmServiceBridge),
   * sem empacotar a webOSTV.js da LG. Serviço que não existe ou não é permitido: null.
   */
  function luna(uri, params) {
    return new Promise(function (ok) {
      var feito = false;
      var fim = function (v) { if (!feito) { feito = true; ok(v); } };
      setTimeout(function () { fim(null); }, 4000);
      try {
        if (typeof raiz.PalmServiceBridge === 'undefined') return fim(null);
        var ponte = new raiz.PalmServiceBridge();
        ponte.onservicecallback = function (msg) {
          try { var r = JSON.parse(msg); fim(r && r.returnValue !== false ? r : null); } catch (e) { fim(null); }
        };
        ponte.call(uri, JSON.stringify(params || {}));
      } catch (e) { fim(null); }
    });
  }

  /** Identidade do aparelho para a recuperação sem novo cadastro (como o `hwid` do Android). Só o hash sai daqui. */
  function hwid() {
    if (nome === 'tizen') {
      var duid = tentar(function () { return raiz.webapis.productinfo.getDuid(); }, '');
      return Promise.resolve(duid ? Sha.de(duid + '|' + ID_APP) : null);
    }
    if (nome === 'webos') {
      return luna('luna://com.webos.service.sm/deviceid/getIDs', { idType: ['LGUDID'] }).then(function (r) {
        var id = r && r.idList && r.idList[0] && r.idList[0].idValue;
        return id ? Sha.de(id + '|' + ID_APP) : null;
      });
    }
    return Promise.resolve(null); // navegador: sem identidade estável, não há recuperação automática
  }

  function modelo() {
    if (nome === 'tizen') {
      var m = tentar(function () { return raiz.webapis.productinfo.getRealModel() || raiz.webapis.productinfo.getModel(); }, 'Samsung');
      return Promise.resolve('Samsung ' + m);
    }
    if (nome === 'webos') {
      return luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName'] }).then(function (r) {
        return 'LG ' + ((r && r.modelName) || 'webOS');
      });
    }
    return Promise.resolve('Navegador');
  }

  function sistema() {
    if (nome === 'tizen') return 'Tizen ' + tentar(function () { return raiz.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); }, '');
    if (nome === 'webos') { var m = /Web0S[\/ ]?([\d.]*)/i.exec(navigator.userAgent); return 'webOS ' + (m ? m[1] : ''); }
    return navigator.userAgent.slice(0, 80);
  }

  /** wifi | ethernet | none (os valores do contrato). */
  function rede() {
    if (!navigator.onLine) return 'none';
    if (nome === 'tizen') {
      var t = tentar(function () { return raiz.webapis.network.getActiveConnectionType(); }, -1);
      if (t === 0) return 'none';
      if (t === 3) return 'ethernet';
      return 'wifi';
    }
    return 'wifi';
  }

  /** TV sempre acesa enquanto o app está na frente; teclas do controle que o app usa. */
  function preparar() {
    if (nome === 'tizen') {
      tentar(function () { raiz.webapis.appcommon.setScreenSaver(raiz.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF); });
      ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', 'Info'].forEach(function (k) {
        tentar(function () { raiz.tizen.tvinputdevice.registerKey(k); });
      });
    }
    if (nome === 'webos') {
      // o app com vídeo na frente já segura a proteção de tela; este pedido cobre a tela só de imagens
      luna('luna://com.webos.service.tvpower/power/turnOnScreen', {});
    }
  }

  /** Teclas do controle → nome usado pelo app. */
  function tecla(ev) {
    var k = ev.keyCode;
    if (k === 38) return 'UP';
    if (k === 40) return 'DOWN';
    if (k === 37) return 'LEFT';
    if (k === 39) return 'RIGHT';
    if (k === 13) return 'OK';
    if (k === 10009 || k === 461 || k === 8 || k === 27) return 'BACK'; // Tizen, webOS, teclado
    if (k === 403) return 'RED';
    if (k === 404) return 'GREEN';
    if (k === 457 || k === 73) return 'INFO';
    return null;
  }

  /** "Reiniciar o app": recarrega a página (nenhuma das duas TVs deixa um app comum reiniciar o aparelho). */
  function reiniciarApp() { location.reload(); }

  raiz.TelasPlataforma = {
    nome: nome, hwid: hwid, modelo: modelo, sistema: sistema, rede: rede, preparar: preparar, tecla: tecla,
    reiniciarApp: reiniciarApp, podeReiniciarAparelho: false, podeCapturar: false
  };
})(typeof self !== 'undefined' ? self : this);
