/*
 * O app de tela: abertura → cadastro → baixa o pacote → toca, com ou sem internet.
 *
 * Ciclo (a cada 30 s com rede; sem rede, tenta de novo com espera crescente):
 *   sinal de vida → `rev` diferente do que a tela tem? → busca a configuração → guarda como "a que está chegando"
 *   → baixa e confere o que falta → só então troca a programação → apaga o que saiu.
 * A grade é reavaliada a cada 15 s pelo relógio corrigido (hora do servidor guardada), então muda de bloco no
 * horário mesmo sem rede.
 */
(function (raiz) {
  'use strict';
  var N = raiz.TelasNucleo, A = raiz.TelasArmazem, P = raiz.TelasPlataforma, F = raiz.TelasFila;

  var params = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) {
    if (!p) return;
    var kv = p.split('=');
    params[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
  });

  var ligadoEm = Date.now();
  var servidor = params.servidor || A.ler('servidor', null) || raiz.TELAS_SERVIDOR || '';
  var teste = params.teste === '1' || /^http:\/\//i.test(servidor);
  // regra da casa: teste no navegador é sem som (para ouvir, ?som=1)
  var mudoForcado = params.mudo === '1' || (P.nome === 'browser' && params.som !== '1');
  if (params.servidor) A.gravar('servidor', params.servidor);

  var est = {
    token: A.ler('token', null),
    marca: A.ler('marca', null),
    difRelogio: A.ler('difRelogio', 0) || 0,
    log: A.ler('exibicao', null),
    online: navigator.onLine,
    erro: null,
    atual: null,   // programação na tela
    nova: null,    // programação chegando
    cfgAtual: A.ler('cfgAtual', null),
    cfgNova: A.ler('cfgNova', null),
    bloco: undefined,
    ligada: true,
    alerta: null,
    baixando: null,
    falhasSinal: 0,
    semEspaco: false,
    aparelho: null,
    hwid: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var conteudo, telaObj;
  var ctxTela = {
    url: function (sha) { return A.url(sha); }, agora: function () { return agora(); },
    online: function () { return est.online; }, mudo: mudoForcado, volume: 100,
    aoExibir: function (ref, seg) {
      est.log = N.contarExibicao(est.log, ref, seg, N.horaLocal(agora(), est.atual ? est.atual.tz : 'America/Sao_Paulo').data);
      A.gravar('exibicao', est.log);
    }
  };

  /** Volume e mudo do servidor (stream.volume/muted); no navegador de teste, sempre mudo. */
  function somDa(prog) {
    ctxTela.mudo = mudoForcado || prog.stream.mudo;
    ctxTela.volume = prog.stream.volume;
  }

  function agora() { return Date.now() + est.difRelogio; }

  function hora(h) {
    var d = N.diferencaRelogio(h, Date.now());
    if (d !== null) { est.difRelogio = d; A.gravar('difRelogio', d); }
  }

  // ------------------------------------------------------------------ camadas (abertura, cadastro, sem internet)

  function camada(id) {
    ['abertura', 'cadastro', 'espera', 'semrede'].forEach(function (c) { $(c).hidden = c !== id; });
    if (id) aplicarMarca();
    if (id === 'cadastro') diag();
  }

  /** Guarda o último erro e atualiza a linha de diagnóstico do cadastro. */
  function erro(msg) {
    est.erro = msg ? String(msg).slice(0, 300) : null;
    diag();
  }

  /** Linha fixa embaixo da tela de cadastro: versão, servidor, plataforma, modo e o último erro. */
  function diag() {
    var el = $('cad-diag');
    if (el) el.textContent = N.linhaDiagnostico({ servidor: servidor, plataforma: P.nome, modo: est.modoCadastro, erro: est.erro });
  }

  function aplicarMarca() {
    var m = est.marca || {};
    document.body.style.background = m.fundo || '#000';
    Array.prototype.forEach.call(document.querySelectorAll('.camada'), function (c) { c.style.background = m.fundo || '#000'; });
    if (m.cor) document.documentElement.style.setProperty('--cor', m.cor);
    var imgs = document.querySelectorAll('.logo-revenda');
    var pronto = function (u) {
      Array.prototype.forEach.call(imgs, function (i) { if (u) { i.src = u; i.hidden = false; } else i.hidden = true; });
    };
    if (m.logo) A.url(m.logo.sha256).then(function (u) { pronto(u || (est.online ? m.logo.url : null)); });
    else pronto(m.logoUrl && est.online ? m.logoUrl : null);
  }

  // ------------------------------------------------------------------ cadastro

  function aparelho() {
    if (est.aparelho) return Promise.resolve(est.aparelho);
    return Promise.all([P.modelo(), P.hwid()]).then(function (r) {
      est.hwid = r[1];
      est.aparelho = { model: r[0], android: P.sistema().slice(0, 40), appVersion: N.VERSAO, platform: P.nome };
      if (est.hwid) est.aparelho.hwid = est.hwid;
      return est.aparelho;
    });
  }

  function api() { return raiz.TelasRede.criar(servidor, est.token, teste); }

  function ativado(r) {
    est.token = r.token;
    A.gravar('token', r.token);
    A.gravar('tela', { id: r.deviceId, nome: r.name || '' });
    if (r.brand) { A.gravar('marcaAtivacao', r.brand); est.marca = N.lerMarca([r.brand], teste); A.gravar('marca', est.marca); }
    camada('espera');
    $('espera-texto').textContent = 'Preparando a tela…';
    ciclo();
  }

  function cadastrar() {
    if (!servidor) { camada('cadastro'); $('cad-codigo').textContent = '—'; $('cad-texto').textContent = 'Endereço do servidor não configurado.'; return; }
    camada('cadastro');
    $('cad-codigo').textContent = '····-····';
    $('cad-texto').textContent = 'Buscando um código…';
    aparelho().then(function (dev) {
      var a = api();
      // 1º: a TV já foi desta tela? (reinstalação)
      var rec = est.hwid ? a.recuperar(est.hwid, dev).then(function (r) { return r.status === 200 && r.json && r.json.token ? r.json : null; }, function () { return null; }) : Promise.resolve(null);
      return rec.then(function (r) {
        if (r) return ativado(r);
        return a.parear(dev).then(function (r2) {
          if (r2.status === 200 && r2.json && r2.json.code && r2.json.pairId) { est.modoCadastro = 'código'; return aguardarPar(a, r2.json); }
          if ([404, 405, 501].indexOf(r2.status) >= 0) { est.modoCadastro = 'chave (pair ' + r2.status + ')'; return chaveDigitada(a, dev); } // servidor sem o código na TV
          throw new Error((r2.json && r2.json.error) || 'Erro ' + r2.status);
        });
      });
    }).catch(function (e) {
      erro((e.semRede ? 'sem conexão: ' : '') + e.message);
      $('cad-texto').textContent = e.semRede ? 'Sem internet. Tentando de novo…' : 'Não foi possível cadastrar agora (' + e.message + '). Tentando de novo…';
      setTimeout(cadastrar, 15000);
    });
  }

  function aguardarPar(a, p) {
    $('cad-codigo').textContent = N.normalizarChave(p.code) || p.code;
    $('cad-texto').textContent = 'No painel, abra Telas › Cadastrar tela e digite este código.';
    $('cad-chave').hidden = true;
    diag();
    var vence = typeof p.expiresAt === 'number' ? p.expiresAt : Date.now() + 10 * 60000;
    var passo = Math.max(2, Math.min(30, p.pollSec || 5)) * 1000;
    function consultar() {
      if (Date.now() > vence) return cadastrar(); // código vencido: pede outro
      a.consultarPar(p.pairId).then(function (r) {
        if (r.status === 200 && r.json && r.json.token) return ativado(r.json);
        if (r.status === 404 || r.status === 410) return cadastrar();
        setTimeout(consultar, passo);
      }, function () { setTimeout(consultar, passo * 2); });
    }
    setTimeout(consultar, passo);
  }

  /** Servidor que ainda não tem o código na TV: a chave do painel, digitada (o teclado da TV abre no campo). */
  function chaveDigitada(a, dev) {
    $('cad-codigo').textContent = '';
    $('cad-texto').textContent = 'Digite a chave de ativação que aparece no painel (XXXX-XXXX).';
    diag();
    var campo = $('cad-chave');
    var chars = '', enviando = false, ultimaEnviada = null;
    campo.hidden = false;
    campo.value = '';
    campo.focus();

    // traço automático, maiúsculas, só o alfabeto da chave, até 8 (o teclado da TV pode mandar espaço, minúscula…)
    campo.oninput = function () {
      var r = N.editarChave(chars, campo.value);
      chars = r.chars;
      if (campo.value !== r.texto) {
        campo.value = r.texto;
        try { campo.setSelectionRange(r.texto.length, r.texto.length); } catch (e) { /* TV sem seleção */ }
      }
      $('cad-texto').textContent = r.confuso ? 'A chave não usa 0, 1, I nem O: confira o que está no painel.'
        : (chars.length === 8 ? 'Conferindo…' : 'Digite a chave de ativação que aparece no painel (XXXX-XXXX).');
      // com os 8 caracteres a chave vai sozinha: não depende do Enter/Concluído de cada teclado
      if (chars.length === 8 && chars !== ultimaEnviada) enviar();
    };
    campo.onkeydown = function (ev) {
      // Enter, o "Concluído" do teclado da Samsung (65376) e o OK do controle
      if (ev.keyCode === 13 || ev.keyCode === 65376) enviar(true);
    };
    campo.onchange = function () { if (chars.length === 8 && chars !== ultimaEnviada) enviar(); };

    function enviar(pedido) {
      if (enviando) return;
      var k = N.normalizarChave(chars);
      if (!k) {
        if (pedido) $('cad-texto').textContent = 'A chave tem 8 caracteres (faltam ' + (8 - chars.length) + ').';
        return;
      }
      enviando = true;
      ultimaEnviada = chars;
      $('cad-texto').textContent = 'Conferindo ' + k + '…';
      a.ativar(k, dev).then(function (r) {
        if (!r.json || !r.json.token) throw new Error('resposta 200 sem token: ' + (r.texto || '').slice(0, 120));
        campo.hidden = true;
        erro(null);
        ativado(r.json);
      }).catch(function (e) {
        enviando = false;
        erro('ativar ' + k + ': ' + (e.status ? 'HTTP ' + e.status + (e.codigo ? ' [' + e.codigo + ']' : '') + ' ' : (e.semRede ? 'sem conexão ' : '')) + e.message);
        $('cad-texto').textContent = e.status === 404 ? 'Chave ' + k + ' inexistente, usada ou vencida.'
          : e.status === 429 ? 'Muitas tentativas. Espere alguns minutos.' : (e.semRede ? 'Sem internet.' : e.message);
        campo.focus();
      });
    }
  }

  // ------------------------------------------------------------------ ciclo com o servidor

  var timerCiclo = null;

  function ciclo() {
    clearTimeout(timerCiclo);
    if (!est.token) return cadastrar();
    var a = api();
    Promise.all([A.espaco(), aparelho()]).then(function (r) {
      var lote = N.loteExibicao(est.log);
      var corpo = N.corpoSinal({
        rev: est.atual ? est.atual.rev : '',
        estado: estadoTela(), fonte: est.fonte || 'offline', ligadoSeg: (Date.now() - ligadoEm) / 1000,
        rede: P.rede(), erro: est.erro, plataforma: P.nome, modelo: r[1].model, hwid: est.hwid,
        pendente: est.baixando, armazenamento: r[0], lote: lote
      });
      return a.sinal(corpo).then(function (res) {
        online(true);
        est.falhasSinal = 0;
        hora(res.horaServidor);
        if (lote) { est.log = N.baixarLote(est.log, lote); A.gravar('exibicao', est.log); }
        var j = res.json || {};
        alertas(j.alerts);
        comandos(a, j.commands);
        var revServidor = typeof j.rev === 'string' ? j.rev : null;
        var revTem = est.nova ? est.nova.rev : (est.atual ? est.atual.rev : '');
        if (revServidor === null || revServidor !== revTem || (!est.atual && !est.nova)) return buscarConfig(a);
        // programação chegando com arquivo que falhou: tenta de novo a cada ciclo (a fila não roda duas vezes)
        if (est.nova && !fila) reconciliar();
      });
    }).then(function () {
      timerCiclo = setTimeout(ciclo, 30000);
    }, function (e) {
      if (e && e.status === 401) { // tela revogada no painel: para o conteúdo e volta ao cadastro
        est.token = null; A.gravar('token', null);
        est.atual = est.nova = est.cfgAtual = est.cfgNova = null;
        A.gravar('cfgAtual', null); A.gravar('cfgNova', null);
        if (fila) fila.cancelar();
        telaObj.limpar(); est.bloco = undefined;
        return cadastrar();
      }
      if (e && e.semRede) online(false);
      else erro(e && e.message);
      est.falhasSinal++;
      timerCiclo = setTimeout(ciclo, N.espera(est.falhasSinal - 1) * 1000);
    });
  }

  function online(sim) {
    if (est.online === sim) return;
    est.online = sim;
    document.body.classList.toggle('sem-rede', !sim);
    // com programação, nada é redesenhado: uma falha do sinal de vida não pode derrubar o ao vivo (o vigia do
    // player decide se ele travou de verdade e vai para os vídeos guardados)
    if (!est.atual) mostrarSemConteudo();
  }

  function buscarConfig(a) {
    return a.config(est.nova ? est.nova.rev : (est.atual ? est.atual.rev : '')).then(function (r) {
      hora(r.horaServidor);
      if (r.naoMudou) return;
      est.cfgNova = r.json;
      A.gravar('cfgNova', r.json);
      est.nova = N.lerConfig(r.json, { teste: teste, marcaAtivacao: A.ler('marcaAtivacao', null) });
      return reconciliar();
    }, function (e) {
      if (e && e.status === 403 && e.codigo === 'unavailable') return; // plano sem o módulo: segue com o que tem
      throw e;
    });
  }

  // ------------------------------------------------------------------ pacote e troca

  var fila = null;

  function reconciliar() {
    if (!est.nova) return Promise.resolve();
    return A.presentes().then(function (pres) {
      var d = N.decidirTroca(est.atual, est.nova, pres);
      if (d.acao === 'manter') { est.nova = null; A.gravar('cfgNova', null); est.baixando = null; return; }
      if (d.acao === 'trocar') return trocar();
      return A.espaco().then(function (esp) {
        est.baixando = { rev: est.nova.rev, files: d.faltam.length, bytes: d.bytesFaltando };
        if (!N.cabe(d.bytesFaltando, esp && esp.free)) {
          est.semEspaco = true;
          est.erro = 'Sem espaço no aparelho para a programação nova (faltam ' + Math.ceil(d.bytesFaltando / 1048576) + ' MB).';
          return;
        }
        est.semEspaco = false;
        return baixar(d.faltam);
      });
    });
  }

  function baixar(lista) {
    if (fila) return Promise.resolve(); // já está baixando: o próximo ciclo confere de novo
    if (!est.atual) { camada('espera'); progresso({ total: lista.length, prontos: 0, bytesTotal: N.bytesDe(lista), bytesFeitos: 0 }); }
    fila = F.criarFila({
      baixar: A.baixar, aceitar: A.aceitar, descartar: A.descartar, concorrencia: 2, tentativas: 3,
      aoMudar: function (s) { if (!est.atual) progresso(s); }
    });
    fila.adicionar(lista);
    return fila.executar().then(function (r) {
      fila = null;
      if (r.semRede) online(false);
      if (r.falharam.length) est.erro = r.falharam.length + ' arquivo(s) não conferiram ou não baixaram: ' + r.falharam[0].motivo;
      return reconciliar();
    });
  }

  function progresso(s) {
    var pct = s.bytesTotal ? Math.floor(100 * s.bytesFeitos / s.bytesTotal) : 0;
    $('espera-texto').textContent = 'Preparando a tela… ' + pct + '%';
    $('espera-barra').style.width = pct + '%';
  }

  function trocar() {
    est.atual = est.nova;
    est.cfgAtual = est.cfgNova;
    A.gravar('cfgAtual', est.cfgAtual);
    est.nova = null; est.cfgNova = null; A.gravar('cfgNova', null);
    est.baixando = null;
    est.erro = null;
    est.marca = est.atual.marca;
    A.gravar('marca', est.marca);
    somDa(est.atual);
    desenhar(true);
    // limpa o que nenhuma programação cita mais
    return A.guardados().then(function (g) {
      var sai = N.paraApagar(g, [est.atual]);
      var manter = {};
      N.arquivosDoPacote(est.atual).forEach(function (f) { manter[f.sha256] = true; });
      return Promise.all(sai.map(A.apagar)).then(function () { return A.limparPartes(manter); });
    });
  }

  // ------------------------------------------------------------------ tela

  function estadoTela() {
    if (!est.atual) return est.online ? 'buffering' : 'idle';
    if (!est.ligada) return 'idle';
    return est.online ? 'playing' : 'offline-content';
  }

  function mostrarSemConteudo() {
    var c = N.camadaSemConteudo({ atual: est.atual, token: est.token, online: est.online, baixando: !!fila });
    if (!c) return;
    // o cadastro tem os próprios textos e o campo da chave: só garante que está visível, sem refazer nada
    if (c === 'cadastro') { if ($('cadastro').hidden) camada('cadastro'); return; }
    camada(c);
  }

  function desenhar(forcar) {
    if (!est.atual) return mostrarSemConteudo();
    camada(null);
    var l = N.horaLocal(agora(), est.atual.tz);
    var ligada = N.telaLigada(est.atual.horario, l);
    if (ligada !== est.ligada) { est.ligada = ligada; forcar = true; }
    $('desligada').hidden = ligada;
    if (!ligada) { telaObj.limpar(); est.bloco = undefined; return; }
    var b = N.escolherBloco(est.atual, agora());
    var id = b ? b.id : null;
    if (!forcar && id === est.bloco) return;
    est.bloco = id;
    est.fonte = est.atual.stream.hls && est.online ? 'hls' : 'offline';
    telaObj.mostrar(est.atual, b);
  }

  function alertas(lista) {
    var agoraMs = agora();
    var validos = (Array.isArray(lista) ? lista : []).filter(function (a) { return a && (a.title || a.text) && (!a.until || a.until > agoraMs); });
    validos.sort(function (x, y) { return (y.level || 0) - (x.level || 0) || (y.id || 0) - (x.id || 0); });
    var a = validos[0] || null;
    est.alerta = a;
    A.gravar('alerta', a);
    mostrarAlerta();
  }

  function mostrarAlerta() {
    var a = est.alerta, c = $('alerta');
    if (a && a.until && a.until <= agora()) a = est.alerta = null;
    c.hidden = !a;
    if (!a) return;
    c.className = 'nivel-' + Math.max(0, Math.min(2, a.level || 0));
    $('alerta-titulo').textContent = String(a.title || '').slice(0, 80);
    $('alerta-texto').textContent = String(a.text || '').slice(0, 400);
  }

  function comandos(a, lista) {
    (Array.isArray(lista) ? lista : []).forEach(function (c) {
      var t = c && c.type;
      if (t === 'reload') { a.comandoFeito(c.id, true, 'recarregado'); desenhar(true); }
      else if (t === 'restart-app') a.comandoFeito(c.id, true, 'reiniciando o app').then(P.reiniciarApp);
      else if (t === 'clear-content' || t === 'clear-cache') {
        A.guardados().then(function (g) { return Promise.all(g.map(A.apagar)); }).then(function () {
          a.comandoFeito(c.id, true, 'conteúdo apagado; baixando de novo');
          est.nova = est.atual; est.cfgNova = est.cfgAtual; est.atual = null; telaObj.limpar(); reconciliar();
        });
      }
      else if (t === 'reboot') a.comandoFeito(c.id, false, 'esta TV não deixa o app reiniciar o aparelho');
      else if (t === 'screenshot') a.comandoFeito(c.id, false, 'captura de tela indisponível no app da TV');
      else if (c && c.id) a.comandoFeito(c.id, false, 'comando desconhecido');
    });
  }

  // ------------------------------------------------------------------ ajustes escondidos (↑ ↑ ↓ ↓ OK)

  var seq = [];
  function teclas(ev) {
    var k = P.tecla(ev);
    // dentro do campo da chave, Backspace/Esc são do campo (apagar), não o "Voltar" do app
    if (ev.target && ev.target.tagName === 'INPUT' && (ev.keyCode === 8 || ev.keyCode === 27 || ev.keyCode === 13 || ev.keyCode === 65376)) return;
    if (k === 'BACK') { ev.preventDefault(); if (!$('diag').hidden) $('diag').hidden = true; return; } // não sai do app
    if (!k) return;
    // tela da chave: OK no controle traz o teclado da TV de volta para o campo
    var campo = $('cad-chave');
    if (k === 'OK' && !$('cadastro').hidden && !campo.hidden && document.activeElement !== campo) { campo.focus(); return; }
    seq.push(k); seq = seq.slice(-5);
    if (seq.join(' ') === 'UP UP DOWN DOWN OK' || k === 'INFO') { seq = []; diagnostico(); }
  }

  function diagnostico() {
    var d = $('diag');
    var tela = A.ler('tela', {}) || {};
    A.espaco().then(function (esp) {
      var linhas = [
        ['Tela', tela.nome || '—'],
        ['Plataforma', P.nome + ' · ' + P.sistema()],
        ['Versão', N.VERSAO],
        ['Servidor', servidor || '—'],
        ['Internet', est.online ? 'sim' : 'não'],
        ['Programação', est.atual ? est.atual.rev : '—'],
        ['Chegando', est.baixando ? est.baixando.files + ' arquivo(s), ' + Math.ceil(est.baixando.bytes / 1048576) + ' MB' : '—'],
        ['Bloco agora', est.bloco || '(padrão)'],
        ['Ao vivo', ctxTela.aoVivo ? ctxTela.aoVivo.motor + (ctxTela.aoVivo.ativo() ? ' · tocando ' + ctxTela.aoVivo.url() : ' · parado') : '—'],
        ['Espaço', esp ? Math.round(esp.used / 1048576) + ' MB usados, ' + Math.round(esp.free / 1048576) + ' MB livres' : 'a TV não informa'],
        ['Hora', new Date(agora()).toLocaleString('pt-BR')],
        ['Último erro', est.erro || '—']
      ];
      $('diag-lista').innerHTML = '';
      linhas.forEach(function (l) {
        var li = document.createElement('div');
        li.innerHTML = '<b></b> <span></span>';
        li.firstChild.textContent = l[0];
        li.lastChild.textContent = l[1];
        $('diag-lista').appendChild(li);
      });
      d.hidden = false;
      clearTimeout(diagnostico.t);
      diagnostico.t = setTimeout(function () { d.hidden = true; }, 30000);
    });
  }

  // ------------------------------------------------------------------ partida

  function iniciar() {
    // erro de JS não pode sumir calado: vai para a linha de diagnóstico e para o sinal de vida
    window.addEventListener('error', function (ev) { erro('js: ' + (ev.message || 'erro') + (ev.lineno ? ' (' + String(ev.filename || '').split('/').pop() + ':' + ev.lineno + ')' : '')); });
    window.addEventListener('unhandledrejection', function (ev) { erro('js: ' + ((ev.reason && ev.reason.message) || ev.reason)); });
    P.preparar();
    A.persistir();
    conteudo = $('conteudo');
    ctxTela.aoVivo = raiz.TelasAoVivo.criar($('aovivo'), {
      mudo: function () { return ctxTela.mudo; },
      volume: function () { return ctxTela.volume; },
      agora: function () { return Date.now(); },
      aoErro: function (m) { erro('ao vivo (' + ctxTela.aoVivo.motor + '): ' + m); }
    });
    telaObj = raiz.TelasTela.criar(conteudo, ctxTela);
    document.addEventListener('keydown', teclas);
    window.addEventListener('online', function () { ciclo(); });
    window.addEventListener('offline', function () { online(false); });
    document.body.classList.toggle('sem-rede', !est.online);

    // abertura com a logo da revenda (se a tela já conhece a marca)
    camada('abertura');
    est.alerta = A.ler('alerta', null);
    A.abrir().then(function () {
      if (est.cfgAtual) {
        est.atual = N.lerConfig(est.cfgAtual, { teste: teste, marcaAtivacao: A.ler('marcaAtivacao', null) });
        somDa(est.atual);
      }
      if (est.cfgNova) est.nova = N.lerConfig(est.cfgNova, { teste: teste, marcaAtivacao: A.ler('marcaAtivacao', null) });
      setTimeout(function () {
        if (est.atual) desenhar(true);
        else mostrarSemConteudo();
        mostrarAlerta();
        if (est.nova) reconciliar(); // continua o download que parou ao desligar
        ciclo();
      }, est.atual ? 1500 : 800);
    }, function (e) {
      erro('armazenamento indisponível: ' + (e && e.message));
      ciclo();
    });

    // grade e horário pelo relógio, sem depender da rede
    setInterval(function () { desenhar(false); mostrarAlerta(); }, 15000);
  }

  raiz.TelasApp = { iniciar: iniciar, _estado: est };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
