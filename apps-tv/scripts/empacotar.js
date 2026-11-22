#!/usr/bin/env node
/*
 * Empacota o player de apps-tv/comum para as TVs.
 *
 *   node apps-tv/scripts/empacotar.js tizen|webos|todos [--servidor=https://...] [--perfil=NOME] [--saida=pasta]
 *
 * webOS (LG): gera o .ipk sozinho (ar + tar.gz, o mesmo formato do `ares-package`), pronto para `ares-install`.
 * Tizen (Samsung): monta a pasta do app; o .wgt precisa ser ASSINADO com o certificado de autor e de distribuidor
 *   do dono (Tizen Studio → Certificate Manager). Com --perfil=NOME e o Tizen Studio instalado, chama
 *   `tizen package -t wgt -s NOME` e sai o .wgt assinado; sem isso, a pasta fica pronta para assinar.
 * Ícones neutros (sem marca) são desenhados aqui, sem depender de imagem no repositório.
 * Sem dependências: só Node.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const COMUM = path.join(RAIZ, 'comum');

// ------------------------------------------------------------------ ícone neutro (PNG desenhado em código)

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(w, h, pixel) {
  const linhas = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    linhas[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      linhas[o] = r; linhas[o + 1] = g; linhas[o + 2] = b; linhas[o + 3] = a;
    }
  }
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(linhas, { level: 9 })), pedaco('IEND', Buffer.alloc(0))]);
}

/** Quadrado arredondado escuro com uma "tela" clara e o pé: genérico, sem nome. */
function icone(w, h) {
  const s = Math.min(w, h), ox = (w - s) / 2, oy = (h - s) / 2, r = s * 0.2;
  const dentro = (x, y, x0, y0, x1, y1, rr) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + rr), x1 - rr), cy = Math.min(Math.max(y, y0 + rr), y1 - rr);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
  };
  return png(w, h, (x, y) => {
    const px = x + 0.5, py = y + 0.5;
    if (!dentro(px, py, ox, oy, ox + s, oy + s, r)) return [0, 0, 0, 0];
    const t = (py - oy) / s;
    const fundo = [Math.round(15 + 20 * t), Math.round(23 + 30 * t), Math.round(42 + 60 * t), 255];
    if (dentro(px, py, ox + s * 0.2, oy + s * 0.25, ox + s * 0.8, oy + s * 0.65, s * 0.04)) {
      return dentro(px, py, ox + s * 0.24, oy + s * 0.29, ox + s * 0.76, oy + s * 0.61, s * 0.02) ? [56, 189, 248, 255] : [226, 232, 240, 255];
    }
    if (dentro(px, py, ox + s * 0.46, oy + s * 0.65, ox + s * 0.54, oy + s * 0.73, 0)) return [226, 232, 240, 255];
    if (dentro(px, py, ox + s * 0.36, oy + s * 0.72, ox + s * 0.64, oy + s * 0.76, s * 0.02)) return [226, 232, 240, 255];
    return fundo;
  });
}

// ------------------------------------------------------------------ cópia do player

function copiar(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    const o = path.join(origem, nome), d = path.join(destino, nome);
    if (fs.statSync(o).isDirectory()) copiar(o, d);
    else fs.copyFileSync(o, d);
  }
}

function prepararApp(destino, servidor, plataforma) {
  fs.rmSync(destino, { recursive: true, force: true });
  copiar(COMUM, destino);
  if (servidor) {
    if (!/^https:\/\//.test(servidor)) throw new Error('--servidor precisa ser https://');
    fs.writeFileSync(path.join(destino, 'js', 'config-padrao.js'),
      `/* gerado pelo empacotamento */\nwindow.TELAS_SERVIDOR = ${JSON.stringify(servidor)};\n`);
  }
  if (plataforma === 'tizen') {
    // a biblioteca webapis (DUID, rede, proteção de tela) vem do próprio aparelho
    const idx = path.join(destino, 'index.html');
    const html = fs.readFileSync(idx, 'utf8').replace('<script src="js/config-padrao.js"></script>',
      '<script src="$WEBAPIS/webapis/webapis.js"></script>\n<script src="js/config-padrao.js"></script>');
    fs.writeFileSync(idx, html);
  }
}

// ------------------------------------------------------------------ Tizen

function acharTizen() {
  const candidatos = [process.env.TIZEN_CLI, 'C:/tizen-studio/tools/ide/bin/tizen.bat',
    path.join(process.env.HOME || process.env.USERPROFILE || '', 'tizen-studio/tools/ide/bin/tizen')].filter(Boolean);
  return candidatos.find((c) => fs.existsSync(c)) || null;
}

function tizen(saida, op) {
  const pasta = path.join(saida, 'tizen');
  const app = path.join(pasta, 'app');
  prepararApp(app, op.servidor, 'tizen');
  fs.copyFileSync(path.join(RAIZ, 'tizen', 'config.xml'), path.join(app, 'config.xml'));
  fs.writeFileSync(path.join(app, 'icon.png'), icone(512, 423));
  const versao = /version="([\d.]+)"/.exec(fs.readFileSync(path.join(app, 'config.xml'), 'utf8').split('<widget')[1])[1];
  const cli = acharTizen();
  if (!op.perfil) {
    console.log(`Tizen: pasta pronta em ${app}`);
    console.log('  falta assinar: node apps-tv/scripts/empacotar.js tizen --perfil=<perfil do Certificate Manager>' + (cli ? '' : ' (instale o Tizen Studio)'));
    return { pasta: app, wgt: null };
  }
  if (!cli) throw new Error('Tizen Studio (tizen CLI) não encontrado; defina TIZEN_CLI');
  const args = ['package', '-t', 'wgt', '-s', op.perfil, '--', app];
  execFileSync(cli, args, { stdio: 'inherit', shell: /\.bat$/i.test(cli) });
  const gerado = fs.readdirSync(app).find((f) => f.endsWith('.wgt'));
  if (!gerado) throw new Error('o tizen package não gerou o .wgt');
  const destino = path.join(pasta, `Telas-${versao}.wgt`);
  fs.renameSync(path.join(app, gerado), destino);
  console.log('Tizen: ' + destino);
  return { pasta: app, wgt: destino };
}

// ------------------------------------------------------------------ webOS (.ipk = ar com debian-binary, control.tar.gz, data.tar.gz)

function tarCabecalho(nome, tamanho, tipo, modo) {
  const h = Buffer.alloc(512);
  let prefixo = '';
  if (Buffer.byteLength(nome) > 100) { const i = nome.lastIndexOf('/', 154); prefixo = nome.slice(0, i); nome = nome.slice(i + 1); }
  h.write(nome, 0, 100, 'utf8');
  h.write(modo.toString(8).padStart(7, '0') + '\0', 100);
  h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(tamanho.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148);
  h.write(tipo, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  h.write('root', 265); h.write('root', 297);
  h.write(prefixo, 345, 155, 'utf8');
  let soma = 0;
  for (const b of h) soma += b;
  h.write(soma.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** entradas: [{ nome: './x/y', dados?: Buffer }] (sem dados = pasta) */
function tarGz(entradas) {
  const partes = [];
  for (const e of entradas) {
    if (!e.dados) { partes.push(tarCabecalho(e.nome.replace(/\/?$/, '/'), 0, '5', 0o755)); continue; }
    partes.push(tarCabecalho(e.nome, e.dados.length, '0', 0o644), e.dados);
    const resto = e.dados.length % 512;
    if (resto) partes.push(Buffer.alloc(512 - resto));
  }
  partes.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(partes), { level: 9 });
}

function ar(membros) {
  const partes = [Buffer.from('!<arch>\n')];
  for (const [nome, dados] of membros) {
    const h = (nome + '/').padEnd(16) + String(Math.floor(Date.now() / 1000)).padEnd(12) + '0'.padEnd(6) + '0'.padEnd(6) +
      '100644'.padEnd(8) + String(dados.length).padEnd(10) + '`\n';
    partes.push(Buffer.from(h, 'ascii'), dados);
    if (dados.length % 2) partes.push(Buffer.from('\n'));
  }
  return Buffer.concat(partes);
}

function arquivosDe(pasta, base) {
  const out = [];
  for (const nome of fs.readdirSync(pasta).sort()) {
    const p = path.join(pasta, nome), rel = base + '/' + nome;
    if (fs.statSync(p).isDirectory()) { out.push({ nome: rel }); out.push.apply(out, arquivosDe(p, rel)); }
    else out.push({ nome: rel, dados: fs.readFileSync(p) });
  }
  return out;
}

function webos(saida, op) {
  const pasta = path.join(saida, 'webos');
  const app = path.join(pasta, 'app');
  prepararApp(app, op.servidor, 'webos');
  const info = JSON.parse(fs.readFileSync(path.join(RAIZ, 'webos', 'appinfo.json'), 'utf8'));
  fs.writeFileSync(path.join(app, 'appinfo.json'), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(app, 'icon.png'), icone(80, 80));
  fs.writeFileSync(path.join(app, 'largeIcon.png'), icone(130, 130));

  const id = info.id;
  const pkginfo = Buffer.from(JSON.stringify({ app: id, id, loc_name: info.title, package_format_version: 2, vendor: info.vendor, version: info.version }, null, 2));
  const dados = [
    { nome: '.' }, { nome: './usr' }, { nome: './usr/palm' }, { nome: './usr/palm/applications' },
    { nome: './usr/palm/applications/' + id }
  ].concat(arquivosDe(app, './usr/palm/applications/' + id), [
    { nome: './usr/palm/packages' }, { nome: './usr/palm/packages/' + id },
    { nome: './usr/palm/packages/' + id + '/packageinfo.json', dados: pkginfo }
  ]);
  const kb = Math.ceil(dados.reduce((s, e) => s + (e.dados ? e.dados.length : 0), 0) / 1024);
  const control = Buffer.from([
    'Package: ' + id, 'Version: ' + info.version, 'Section: misc', 'Priority: optional', 'Architecture: all',
    'Installed-Size: ' + kb, 'Maintainer: N/A <nobody@example.com>', 'Description: ' + info.title,
    'webOS-Package-Format-Version: 2', 'webOS-Packager-Version: x.y.x', ''
  ].join('\n'));
  const ipk = ar([
    ['debian-binary', Buffer.from('2.0\n')],
    ['control.tar.gz', tarGz([{ nome: '.' }, { nome: './control', dados: control }])],
    ['data.tar.gz', tarGz(dados)]
  ]);
  const destino = path.join(pasta, `${id}_${info.version}_all.ipk`);
  fs.writeFileSync(destino, ipk);
  console.log('webOS: ' + destino);
  return { pasta: app, ipk: destino };
}

// ------------------------------------------------------------------ linha de comando

function main(argv) {
  const alvo = argv.find((a) => !a.startsWith('--')) || 'todos';
  const op = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const saida = path.resolve(op.saida || path.join(RAIZ, 'dist'));
  const r = {};
  if (alvo === 'tizen' || alvo === 'todos') r.tizen = tizen(saida, op);
  if (alvo === 'webos' || alvo === 'todos') r.webos = webos(saida, op);
  if (!r.tizen && !r.webos) throw new Error('uso: empacotar.js tizen|webos|todos');
  return r;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { main, icone, tarGz, ar };
