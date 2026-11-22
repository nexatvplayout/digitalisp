/*
 * Onde a tela guarda o pacote de conteúdo: IndexedDB (existe no navegador, no Tizen e no webOS, sem permissão extra).
 *   - `arquivos`: sha256 → { sha256, bytes, tipo, blob }: só arquivo inteiro e conferido;
 *   - `partes`:   "sha256:n" → pedaço de 4 MB ainda chegando (o download continua de onde parou, com Range).
 * O estado pequeno (token, configuração atual e a que está chegando, marca, contagem de exibição) fica no
 * localStorage. Limites de espaço por plataforma: apps-tv/LEIAME.md.
 */
(function (raiz) {
  'use strict';
  var Sha = raiz.TelasSha256;
  var BANCO = 'telas', VERSAO_BANCO = 1, PEDACO = 4 * 1024 * 1024;
  var db = null, urls = {};

  function req(r) {
    return new Promise(function (ok, falha) {
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { falha(r.error || new Error('IndexedDB')); };
    });
  }

  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise(function (ok, falha) {
      var r = indexedDB.open(BANCO, VERSAO_BANCO);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('arquivos')) d.createObjectStore('arquivos', { keyPath: 'sha256' });
        if (!d.objectStoreNames.contains('partes')) d.createObjectStore('partes');
      };
      r.onsuccess = function () { db = r.result; ok(db); };
      r.onerror = function () { falha(r.error || new Error('IndexedDB indisponível')); };
    });
  }

  function loja(nome, modo) { return db.transaction(nome, modo || 'readonly').objectStore(nome); }

  function chaves(nome) {
    return abrir().then(function () {
      var s = loja(nome);
      if (s.getAllKeys) return req(s.getAllKeys());
      return new Promise(function (ok) { // Chromium antigo sem getAllKeys
        var out = [], c = s.openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { out.push(cur.key); cur.continue(); } else ok(out); };
      });
    });
  }

  /** Os sha256 dos arquivos inteiros guardados. */
  function guardados() { return chaves('arquivos'); }

  function presentes() {
    return guardados().then(function (l) { var m = {}; l.forEach(function (s) { m[s] = true; }); return m; });
  }

  /** Endereço local (blob:) do arquivo guardado, para <img> e <video>. */
  function url(sha) {
    if (urls[sha]) return Promise.resolve(urls[sha]);
    return abrir().then(function () { return req(loja('arquivos').get(sha)); }).then(function (r) {
      if (!r) return null;
      urls[sha] = URL.createObjectURL(r.blob);
      return urls[sha];
    });
  }

  function partesDe(sha) {
    return chaves('partes').then(function (ks) {
      return ks.filter(function (k) { return String(k).indexOf(sha + ':') === 0; })
        .map(function (k) { return +String(k).split(':')[1]; }).sort(function (a, b) { return a - b; });
    });
  }

  function lerParte(sha, n) { return abrir().then(function () { return req(loja('partes').get(sha + ':' + n)); }); }

  function gravarParte(sha, n, buf) {
    return abrir().then(function () { return req(loja('partes', 'readwrite').put(new Blob([buf]), sha + ':' + n)); });
  }

  function bytesDoBlob(b) {
    return new Promise(function (ok, falha) {
      var fr = new FileReader();
      fr.onload = function () { ok(new Uint8Array(fr.result)); };
      fr.onerror = function () { falha(fr.error); };
      fr.readAsArrayBuffer(b);
    });
  }

  function erroRede(msg, xhr) {
    var e = new Error(msg);
    e.semRede = !xhr || xhr.status === 0;
    return e;
  }

  function pedir(u, inicio, fim, aoProgresso, semCache) {
    return new Promise(function (ok, falha) {
      var x = new XMLHttpRequest();
      x.open('GET', u, true);
      x.responseType = 'arraybuffer';
      x.timeout = 120000;
      if (inicio !== null) x.setRequestHeader('Range', 'bytes=' + inicio + '-' + fim);
      if (semCache) { x.setRequestHeader('Cache-Control', 'no-cache'); x.setRequestHeader('Pragma', 'no-cache'); }
      x.onprogress = function (ev) { aoProgresso(ev.loaded); };
      x.onload = function () {
        if (x.status === 206 || x.status === 200) ok({ status: x.status, buf: new Uint8Array(x.response) });
        else falha(erroRede('HTTP ' + x.status, x));
      };
      x.onerror = function () { falha(erroRede('sem conexão', x)); };
      x.ontimeout = function () { falha(erroRede('tempo esgotado', null)); };
      x.send();
    });
  }

  /**
   * Baixa o arquivo em pedaços (continuando do que já tem) e confere enquanto chega.
   * Resolve com { bytes, sha256 } do que chegou; quem decide se aceita é a fila.
   */
  function baixar(f, aoProgresso, tentativa) {
    var semCache = (tentativa || 1) > 1;
    var h = Sha.criar(), feitos = 0;
    return abrir().then(function () { return partesDe(f.sha256); }).then(function (ns) {
      // pedaços já guardados: confere a sequência (0, 1, 2…) e passa pelo hash
      var seq = Promise.resolve(), n = 0;
      ns.forEach(function (k) {
        seq = seq.then(function () {
          if (k !== n) return;
          return lerParte(f.sha256, k).then(bytesDoBlob).then(function (b) { h.update(b); feitos += b.length; n++; });
        });
      });
      return seq.then(function () { return n; });
    }).then(function (proximo) {
      aoProgresso(feitos);
      function seguinte(n) {
        if (feitos >= f.bytes) return Promise.resolve();
        var fim = Math.min(f.bytes, feitos + PEDACO) - 1;
        return pedir(f.url, feitos, fim, function (l) { aoProgresso(feitos + l); }, semCache).then(function (r) {
          if (r.status === 200) {
            // o servidor ignorou o Range: veio tudo. Recomeça o hash do zero com o arquivo inteiro.
            h = Sha.criar(); feitos = 0;
            var grava = Promise.resolve(), k = 0;
            for (var o = 0; o < r.buf.length; o += PEDACO) {
              (function (pedaco, idx) { grava = grava.then(function () { return gravarParte(f.sha256, idx, pedaco); }); })(r.buf.subarray(o, o + PEDACO), k++);
            }
            h.update(r.buf); feitos = r.buf.length;
            return grava;
          }
          h.update(r.buf);
          feitos += r.buf.length;
          return gravarParte(f.sha256, n, r.buf).then(function () {
            if (r.buf.length === 0) throw erroRede('resposta vazia', { status: 1 });
            return seguinte(n + 1);
          });
        });
      }
      return seguinte(proximo);
    }).then(function () {
      aoProgresso(feitos);
      return { bytes: feitos, sha256: h.hex() };
    });
  }

  /** Junta os pedaços num arquivo definitivo (só depois da conferência) e apaga os pedaços. */
  function aceitar(f) {
    return partesDe(f.sha256).then(function (ns) {
      return Promise.all(ns.map(function (n) { return lerParte(f.sha256, n); }));
    }).then(function (blobs) {
      var blob = new Blob(blobs, { type: f.tipo || 'application/octet-stream' });
      return req(loja('arquivos', 'readwrite').put({ sha256: f.sha256, bytes: f.bytes, tipo: f.tipo, blob: blob, em: Date.now() }));
    }).then(function () { return descartar(f); });
  }

  /** Apaga os pedaços (download que não conferiu ou que saiu da programação). */
  function descartar(f) {
    return partesDe(f.sha256).then(function (ns) {
      var s = loja('partes', 'readwrite');
      return Promise.all(ns.map(function (n) { return req(s.delete(f.sha256 + ':' + n)); }));
    });
  }

  function apagar(sha) {
    if (urls[sha]) { URL.revokeObjectURL(urls[sha]); delete urls[sha]; }
    return abrir().then(function () { return req(loja('arquivos', 'readwrite').delete(sha)); })
      .then(function () { return descartar({ sha256: sha }); });
  }

  /** Pedaços de arquivos que ninguém mais quer (download largado no meio de uma programação que mudou). */
  function limparPartes(manter) {
    return chaves('partes').then(function (ks) {
      var s = loja('partes', 'readwrite');
      return Promise.all(ks.filter(function (k) { return !manter[String(k).split(':')[0]]; }).map(function (k) { return req(s.delete(k)); }));
    });
  }

  /** Espaço: { used, free } em bytes, ou null se a plataforma não informa. */
  function espaco() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().then(function (e) {
      return { used: e.usage || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)) };
    }, function () { return null; });
  }

  /** Pede ao navegador para não apagar o banco quando faltar espaço (vale no Chromium novo; nas TVs é ignorado). */
  function persistir() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  // ---- estado pequeno
  var PREFIXO = 'telas:';
  function ler(k, padrao) {
    try { var v = localStorage.getItem(PREFIXO + k); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function gravar(k, v) {
    try { if (v === null || v === undefined) localStorage.removeItem(PREFIXO + k); else localStorage.setItem(PREFIXO + k, JSON.stringify(v)); } catch (e) { /* cheio: segue */ }
  }

  /** Apagar tudo (comando do painel ou ajuste no aparelho). */
  function zerar() {
    Object.keys(urls).forEach(function (k) { URL.revokeObjectURL(urls[k]); });
    urls = {};
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(PREFIXO) === 0) localStorage.removeItem(k); });
    } catch (e) { /* nada */ }
    if (db) { db.close(); db = null; }
    return req(indexedDB.deleteDatabase(BANCO)).catch(function () {});
  }

  raiz.TelasArmazem = {
    abrir: abrir, guardados: guardados, presentes: presentes, url: url, baixar: baixar, aceitar: aceitar,
    descartar: descartar, apagar: apagar, limparPartes: limparPartes, espaco: espaco, persistir: persistir,
    ler: ler, gravar: gravar, zerar: zerar
  };
})(typeof self !== 'undefined' ? self : this);
