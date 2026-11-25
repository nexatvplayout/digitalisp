/*
 * Fila de download do pacote de conteúdo. Não sabe de rede nem de banco: recebe as funções de quem a usa
 * (no app, as de armazem.js; nos testes, falsas). Regras:
 *   - um arquivo por sha256 (o mesmo arquivo em dois itens baixa uma vez);
 *   - poucos ao mesmo tempo (padrão 2: TV tem pouca memória e Wi-Fi fraco);
 *   - conferência obrigatória: tamanho e sha256 têm de bater; o que não bate é descartado e baixado de novo do zero;
 *   - erro de rede espera e tenta de novo (5 s, 10 s, 20 s…); sem rede (`erro.semRede`) para a fila inteira de uma vez,
 *     sem gastar as tentativas: volta quando a rede voltar;
 *   - o arquivo só passa a "pronto" depois de `aceitar` (gravado como definitivo);
 *   - `baixar` recebe o número da tentativa: da 2ª em diante o download passa por cima do cache HTTP (um arquivo trocado
 *     no mesmo endereço viria velho do cache e nunca conferiria).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TelasFila = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function criarFila(op) {
    var baixar = op.baixar, aceitar = op.aceitar, descartar = op.descartar || function () { return Promise.resolve(); };
    var concorrencia = Math.max(1, op.concorrencia || 2);
    var tentativas = Math.max(1, op.tentativas || 3);
    var esperar = op.esperar || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var aoMudar = op.aoMudar || function () {};

    var lista = [], porSha = {}, cancelada = false, rodando = null;
    var st = { total: 0, prontos: 0, bytesTotal: 0, bytesFeitos: 0, atuais: {} };

    function adicionar(arquivos) {
      arquivos.forEach(function (f) {
        if (porSha[f.sha256]) return;
        porSha[f.sha256] = { arquivo: f, situacao: 'esperando', tentativa: 0, motivo: null, feitos: 0 };
        lista.push(porSha[f.sha256]);
        st.total++;
        st.bytesTotal += f.bytes;
      });
    }

    function estado() {
      var em = 0;
      Object.keys(st.atuais).forEach(function (k) { em += st.atuais[k]; });
      return { total: st.total, prontos: st.prontos, bytesTotal: st.bytesTotal, bytesFeitos: st.bytesFeitos + em };
    }

    function umArquivo(e) {
      var f = e.arquivo;
      e.situacao = 'baixando';
      e.tentativa++;
      return baixar(f, function (feitos) { st.atuais[f.sha256] = Math.min(feitos, f.bytes); aoMudar(estado()); }, e.tentativa)
        .then(function (r) {
          delete st.atuais[f.sha256];
          if (!r || r.bytes !== f.bytes || String(r.sha256).toLowerCase() !== f.sha256) {
            var err = new Error(r && r.bytes !== f.bytes ? 'tamanho não confere' : 'sha256 não confere');
            err.conferencia = true;
            throw err;
          }
          return aceitar(f).then(function () {
            e.situacao = 'pronto';
            st.prontos++;
            st.bytesFeitos += f.bytes;
            aoMudar(estado());
          });
        })
        .catch(function (err) {
          delete st.atuais[f.sha256];
          if (err && err.semRede) { e.situacao = 'esperando'; e.tentativa--; throw err; }
          e.motivo = (err && err.message) || String(err);
          // o que chegou errado ou pela metade não serve para continuar: apaga e recomeça do zero
          var limpeza = err && err.conferencia ? descartar(f) : Promise.resolve();
          return limpeza.then(function () {
            if (e.tentativa >= tentativas || cancelada) { e.situacao = 'falhou'; aoMudar(estado()); return; }
            e.situacao = 'esperando';
            return esperar(1000 * Math.min(300, 5 * Math.pow(2, e.tentativa - 1))).then(function () {
              return cancelada ? null : umArquivo(e);
            });
          });
        });
    }

    /** Roda até acabar: { prontos: [sha], falharam: [{ sha256, motivo }], semRede: bool }. */
    function executar() {
      if (rodando) return rodando;
      cancelada = false;
      var semRede = false;
      var fila = lista.filter(function (e) { return e.situacao === 'esperando' || e.situacao === 'falhou'; });
      fila.forEach(function (e) { if (e.situacao === 'falhou') { e.situacao = 'esperando'; e.tentativa = 0; } });
      var i = 0;
      function trabalhador() {
        if (cancelada || semRede || i >= fila.length) return Promise.resolve();
        var e = fila[i++];
        return umArquivo(e).then(trabalhador, function (err) {
          if (err && err.semRede) { semRede = true; return; }
          return trabalhador();
        });
      }
      var ts = [];
      for (var k = 0; k < concorrencia; k++) ts.push(trabalhador());
      rodando = Promise.all(ts).then(function () {
        rodando = null;
        return {
          prontos: lista.filter(function (e) { return e.situacao === 'pronto'; }).map(function (e) { return e.arquivo.sha256; }),
          falharam: lista.filter(function (e) { return e.situacao === 'falhou'; }).map(function (e) { return { sha256: e.arquivo.sha256, motivo: e.motivo }; }),
          semRede: semRede
        };
      });
      return rodando;
    }

    function cancelar() { cancelada = true; }

    return { adicionar: adicionar, executar: executar, estado: estado, cancelar: cancelar };
  }

  return { criarFila: criarFila };
});
