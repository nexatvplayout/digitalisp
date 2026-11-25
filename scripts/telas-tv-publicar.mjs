// Põe os pacotes das TVs Samsung (.wgt) e LG (.ipk) no servidor (server/assets/telas-tv/), para o instalador pelo celular
// baixar (server/telas-tv.js). Rodar depois do empacotamento dos apps de TV (apps-tv/LEIAME.md):
//   node scripts/telas-tv-publicar.mjs [pasta tv-<versão>]
// Padrão: a versão mais nova em C:\Projetos\digital-isp-pacotes\tv-* que tenha os dois pacotes. O .wgt já vem assinado
// (perfil Samsung do dono): só as TVs cujo DUID está no certificado aceitam. appId e versão vêm dos manifestos do pacote.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACOTES = process.env.DIGITALISP_PACOTES || 'C:\\Projetos\\digital-isp-pacotes';

const versao = (s) => s.replace(/^tv-/, '').split('.').map(Number);
const maior = (a, b) => { const x = versao(a), y = versao(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const achar = (dir, ext) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f))[0] || null; } catch { return null; } };

let pasta = process.argv[2];
if (!pasta) {
  const todas = fs.readdirSync(PACOTES).filter((d) => /^tv-\d+\.\d+\.\d+$/.test(d)).sort(maior).reverse();
  const boa = todas.find((d) => achar(path.join(PACOTES, d, 'tizen'), '.wgt') && achar(path.join(PACOTES, d, 'webos'), '.ipk'));
  if (!boa) throw new Error(`nenhuma pasta tv-* com .wgt e .ipk em ${PACOTES}`);
  pasta = path.join(PACOTES, boa);
}
const wgt = achar(path.join(pasta, 'tizen'), '.wgt');
const ipk = achar(path.join(pasta, 'webos'), '.ipk');
if (!wgt || !ipk) throw new Error(`faltam o .wgt e/ou o .ipk em ${pasta}`);

// manifestos: apps-tv/tizen/config.xml e apps-tv/webos/appinfo.json, copiados para tizen/app e webos/app
const configXml = fs.readFileSync(path.join(pasta, 'tizen', 'app', 'config.xml'), 'utf8');
const tizenId = /<tizen:application[^>]*\bid="([^"]+)"/.exec(configXml)?.[1];
const tizenVer = /<widget[^>]*\bversion="([^"]+)"/.exec(configXml)?.[1];
const appinfo = JSON.parse(fs.readFileSync(path.join(pasta, 'webos', 'app', 'appinfo.json'), 'utf8'));
if (!tizenId || !tizenVer || !appinfo.id || !appinfo.version) throw new Error('não achei id/versão nos manifestos');

const dir = path.join(root, 'server/assets/telas-tv');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f)); // só a versão atual fica no repositório
function copiar(origem) {
  const buf = fs.readFileSync(origem);
  const nome = path.basename(origem).replace(/[^A-Za-z0-9_.-]/g, '_');
  fs.writeFileSync(path.join(dir, nome), buf);
  return { file: nome, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
const meta = {
  tizen: { version: tizenVer, appId: tizenId, ...copiar(wgt) },
  webos: { version: appinfo.version, appId: appinfo.id, ...copiar(ipk) },
};
fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Samsung ${tizenVer} (${tizenId}) e LG ${appinfo.version} (${appinfo.id}) em server/assets/telas-tv/, de ${pasta}`);
