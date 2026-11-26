/*
 * Cliente da API do aparelho: o mesmo contrato do app Android (/api/telas/*), com o token em
 * `Authorization: Bearer`. O token nunca vai para a tela nem para log.
 *
 * O app da TV roda fora do domínio do servidor (file:// no Tizen e no webOS): o servidor precisa responder CORS
 * (Access-Control-Allow-Origin, Allow-Headers: Authorization, Content-Type, If-None-Match, Range; Expose-Headers:
 * Date, ETag). A hora do servidor vem do cabeçalho Date ou, se o servidor mandar, do campo `now` da resposta.
 */
(function (raiz) {
  'use strict';
  var N = raiz.TelasNucleo;

  function criar(base, token, teste) {
    var origem = N.origem(base);
    if (!origem || !N.urlPermitida(origem + '/', teste)) throw new Error('O endereço do servidor precisa ser https://');

    function chamar(metodo, caminho, corpo, extras) {
      return new Promise(function (ok, falha) {
        var x = new XMLHttpRequest();
        x.open(metodo, origem + caminho, true);
        x.timeout = 20000;
        x.setRequestHeader('Accept', 'application/json');
        if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
        Object.keys(extras || {}).forEach(function (k) { x.setRequestHeader(k, extras[k]); });
        if (corpo !== undefined && corpo !== null) x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        x.onload = function () {
          var json = null;
          try { json = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) { json = null; }
          var data = Date.parse(x.getResponseHeader('Date') || '');
          if (json && typeof json.now === 'number') data = json.now;
          ok({ status: x.status, json: json, texto: String(x.responseText || '').slice(0, 200), horaServidor: isFinite(data) ? data : null });
        };
        x.onerror = function () { var e = new Error('sem conexão com o servidor'); e.semRede = true; falha(e); };
        x.ontimeout = function () { var e = new Error('o servidor não respondeu'); e.semRede = true; falha(e); };
        x.send(corpo === undefined || corpo === null ? null : JSON.stringify(corpo));
      });
    }

    function exigir(r, aceitos) {
      if (aceitos.indexOf(r.status) >= 0) return r;
      // a mensagem inteira: o `error` do JSON ou, sem JSON, o começo do corpo (página de erro de proxy etc.)
      var e = new Error((r.json && r.json.error) || (r.texto ? r.texto.replace(/\s+/g, ' ').trim() : '') || ('Erro ' + r.status));
      e.status = r.status;
      e.codigo = r.json && r.json.code;
      throw e;
    }

    return {
      origem: origem,
      /** Proposta (docs: apps-tv/LEIAME.md, "Cadastro"): a TV pede um código e o mostra; alguém digita no painel. */
      parear: function (aparelho) { return chamar('POST', '/api/telas/pair', { device: aparelho }); },
      consultarPar: function (id) { return chamar('GET', '/api/telas/pair/' + encodeURIComponent(id)); },
      /** Contrato atual: a chave gerada no painel, digitada na TV. → { deviceId, token, channel, name } */
      ativar: function (chave, aparelho) {
        return chamar('POST', '/api/telas/activate', { key: chave, device: aparelho }).then(function (r) { return exigir(r, [200]); });
      },
      recuperar: function (hwid, aparelho) { return chamar('POST', '/api/telas/recover', { hwid: hwid, device: aparelho }); },
      /** null = 304 (nada mudou). */
      config: function (rev) {
        return chamar('GET', '/api/telas/config', null, rev ? { 'If-None-Match': rev } : {}).then(function (r) {
          if (r.status === 304) return { naoMudou: true, horaServidor: r.horaServidor };
          return exigir(r, [200]);
        });
      },
      /** A chamada de senha da unidade (§10): { current, last, waiting, serving, byService }. */
      fila: function () { return chamar('GET', '/api/telas/queue').then(function (r) { return exigir(r, [200]); }); },
      sinal: function (corpo) { return chamar('POST', '/api/telas/heartbeat', corpo).then(function (r) { return exigir(r, [200]); }); },
      comandoFeito: function (id, okk, detalhe) {
        return chamar('POST', '/api/telas/commands/' + encodeURIComponent(id) + '/done', { ok: !!okk, detail: String(detalhe || '').slice(0, 200) })
          .catch(function () { /* o servidor vence o comando sozinho */ });
      }
    };
  }

  raiz.TelasRede = { criar: criar };
})(typeof self !== 'undefined' ? self : this);
