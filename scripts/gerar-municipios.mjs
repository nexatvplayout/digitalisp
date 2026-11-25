// Gera public/shared/municipios-ibge.json: os municípios do Brasil (código IBGE de 7 dígitos, nome oficial e UF), a
// lista pronta do seletor UF/Município (public/shared/uf-city.js) e da conferência no servidor (server/br-places.js).
//
//   node scripts/gerar-municipios.mjs <municipios.json baixado>
//   node scripts/gerar-municipios.mjs            (baixa de servicodados.ibge.gov.br, o serviço de dados oficial do IBGE)
//
// O arquivo baixado é só DADO: é lido como JSON, conferido campo a campo e reescrito enxuto. Recusa (sem gravar nada) se a
// lista não tiver entre 5.500 e 5.700 municípios, se um código não tiver 7 dígitos, se repetir, ou se os 2 primeiros
// dígitos não forem os da UF do município.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UF_IBGE } from '../public/shared/br-docs.js';

const SOURCE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'shared', 'municipios-ibge.json');
const die = (m) => { console.error(`[municipios] ERRO: ${m}`); process.exitCode = 1; throw new Error(m); };

async function read() {
  const file = process.argv[2];
  if (file) return fs.readFileSync(path.resolve(file), 'utf8');
  const res = await fetch(SOURCE, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) die(`o IBGE respondeu ${res.status}`);
  return res.text();
}

const raw = await read();
let list;
try { list = JSON.parse(raw); } catch { die('o arquivo não é JSON válido'); }
if (!Array.isArray(list)) die('esperava uma lista de municípios');
if (list.length < 5500 || list.length > 5700) die(`${list.length} municípios: fora do esperado (5.500 a 5.700)`);
const seen = new Set();
const rows = [];
for (const m of list) {
  const code = Number(m?.id);
  if (!Number.isInteger(code) || code < 1000000 || code > 9999999) die(`código inválido: ${JSON.stringify(m?.id)}`);
  if (seen.has(code)) die(`código repetido: ${code}`);
  seen.add(code);
  const nome = typeof m?.nome === 'string' ? m.nome.replace(/\s+/g, ' ').trim() : '';
  if (!nome || nome.length > 80 || /[\u0000-\u001f<>]/.test(nome)) die(`nome inválido no código ${code}`);
  // a UF de dois caminhos do próprio IBGE (microrregião e região imediata: os municípios novos podem vir sem a primeira)
  const uf = m?.microrregiao?.mesorregiao?.UF?.sigla || m?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;
  const byCode = UF_IBGE[Math.floor(code / 100000)];
  if (!byCode) die(`código ${code}: prefixo de UF desconhecido`);
  if (uf !== byCode) die(`código ${code} (${nome}): UF ${uf} não bate com o prefixo do código (${byCode})`);
  rows.push([code, nome, uf]);
}
rows.sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1], 'pt-BR'));
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // data de Brasília, AAAA-MM-DD
const head = `{\n  "fonte": "IBGE, ${SOURCE}",\n  "geradoEm": "${today}",\n  "total": ${rows.length},\n  "colunas": ["codigo", "nome", "uf"],\n  "municipios": [\n`;
const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${head}${body}\n  ]\n}\n`);
const perUf = {};
for (const r of rows) perUf[r[2]] = (perUf[r[2]] || 0) + 1;
console.log(`[municipios] ${rows.length} municípios em ${Object.keys(perUf).length} UFs gravados em ${path.relative(root, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB, gerado em ${today})`);
console.log(`[municipios] por UF: ${Object.entries(perUf).map(([u, n]) => `${u} ${n}`).join(', ')}`);
