/* Municípios do Brasil (lista oficial do IBGE em public/shared/municipios-ibge.json, gerada por scripts/gerar-municipios.mjs):
   a conferência no servidor de UF e município (cadastro de anunciantes; região do canal e "Sua região" do app). Módulo neutro,
   sem depender de nenhuma tela: o painel busca o mesmo arquivo (/shared/municipios-ibge.json, public/shared/uf-city.js).
   Lida do disco na subida (o import) e guardada na memória (~5.570 linhas). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UFS, normalizeUf, placeKey } from '../public/shared/br-docs.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shared', 'municipios-ibge.json');
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

let cache = null;
function load() {
  if (cache) return cache;
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const byCode = new Map();
  const byUf = new Map();
  for (const [code, name, uf] of j.municipios) {
    const m = { code: Number(code), name, uf };
    byCode.set(m.code, m);
    if (!byUf.has(uf)) byUf.set(uf, new Map());
    byUf.get(uf).set(placeKey(name), m);
  }
  cache = { byCode, byUf, generatedAt: j.geradoEm, total: byCode.size };
  return cache;
}
// lida na subida (o import), não na 1ª consulta: as consultas são síncronas e chegam no meio do laço do servidor (21/10). Sem o
// arquivo (instalação quebrada), a 1ª consulta lança como antes
try { load(); } catch { /* a 1ª consulta lança */ }

/** Município pelo código do IBGE (7 dígitos); null se não existe. */
export function municipio(code) {
  const n = Number(code);
  return Number.isInteger(n) ? load().byCode.get(n) || null : null;
}
/** Município pelo nome dentro da UF (sem acento nem caixa: "sao jose dos campos" acha "São José dos Campos"). */
export function municipioByName(uf, name) {
  const u = normalizeUf(uf);
  return u ? load().byUf.get(u)?.get(placeKey(name)) || null : null;
}

/**
 * UF e município de um endereço no Brasil: { uf, city, city_ibge } com o nome oficial e o código do IBGE. Aceita o código
 * (cityIbge, o que o seletor manda) ou só o nome (procurado dentro da UF). Tudo vazio = sem endereço. Lança 400 com a
 * mensagem para a tela: UF que não existe, município sem UF, de outra UF ou fora da lista.
 */
export function cleanBrPlace({ uf, city, cityIbge } = {}) {
  const rawUf = line(uf, 10);
  const rawCity = line(city, 80);
  const code = cityIbge == null || cityIbge === '' ? null : Number(cityIbge);
  if (!rawUf) {
    if (rawCity || code != null) throw fail('Escolha a UF antes do município.');
    return { uf: null, city: null, city_ibge: null };
  }
  const u = normalizeUf(rawUf);
  if (!u) throw fail('UF inválida: escolha um estado da lista.');
  if (code != null) {
    const m = municipio(code);
    if (!m) throw fail('Município não encontrado na lista do IBGE: escolha um da lista.');
    if (m.uf !== u) throw fail(`${m.name} não fica em ${UFS[u]} (${u}): escolha um município de ${u}.`);
    return { uf: u, city: m.name, city_ibge: m.code };
  }
  if (!rawCity) return { uf: u, city: null, city_ibge: null };
  const m = municipioByName(u, rawCity);
  if (!m) throw fail(`Município "${rawCity}" não encontrado em ${UFS[u]} (${u}): escolha um da lista.`);
  return { uf: u, city: m.name, city_ibge: m.code };
}

/** Data em que a lista foi gerada e quantos municípios tem (diagnóstico). */
export const municipiosInfo = () => { const c = load(); return { generatedAt: c.generatedAt, total: c.total }; };
