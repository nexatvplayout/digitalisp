// Gera a voz própria da chamada de senha do app das telas (20/11, aprovada pelo dono na "versão 3"): vozes da OpenAI
// (gpt-4o-mini-tts: ash e onyx masculinas, coral e nova femininas), um áudio por pedaço, com sotaque brasileiro e a
// entonação certa de cada pedaço. A voz fala listas curtas (o contexto em português evita o sotaque inglês) e o script
// corta cada item nas pausas. Saída em app/src/main/assets/voz/: vocabulario.tsv e <voz>/<token>.ulaw (mu-law 16 kHz mono).
//
// Pedaços: "Senha á" … "Senha zê" (senha_x), "Senha" (senha), letras soltas (l_x), algarismos do meio da senha (dm_d,
// entonação suspensa) e o último (df_d, conclusiva), números 0 a 99 (n_k, conclusivos), as palavras do local e as
// combinações mais comuns inteiras ("Consultório três": c_<palavra>_<k>, 1 a 30).
//
// Uso: node android-telas/voz/gerar.mjs <arquivo da chave> <ffmpeg> [vozes...]
// A chave fica num arquivo fora do repositório e nunca é impressa.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [keyFile, ffmpeg, ...only] = process.argv.slice(2);
if (!keyFile || !ffmpeg) throw new Error('uso: node gerar.mjs <arquivo da chave> <ffmpeg> [vozes]');
const KEY = fs.readFileSync(keyFile, 'utf8').trim();
const VOICES = only.length ? only : ['ash', 'onyx', 'coral', 'nova'];
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/src/main/assets/voz');

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const num = (n) => (n < 20 ? UNITS[n] : n % 10 ? `${TENS[Math.floor(n / 10)]} e ${UNITS[n % 10]}` : TENS[n / 10]);
const LETTERS = { a: 'á', b: 'bê', c: 'cê', d: 'dê', e: 'é', f: 'éfe', g: 'gê', h: 'agá', i: 'í', j: 'jota', k: 'cá', l: 'éle',
  m: 'ême', n: 'êne', o: 'ó', p: 'pê', q: 'quê', r: 'érre', s: 'ésse', t: 'tê', u: 'u', v: 'vê', w: 'dáblio', x: 'xis',
  y: 'ípsilon', z: 'zê' };

// palavras do local: token, como se fala, formas escritas que casam (minúsculas, sem acento)
const WORDS = [
  ['guiche', 'guichê', 'guiche'], ['consultorio', 'consultório', 'consultorio,consult'], ['sala', 'sala', 'sala'], ['salas', 'salas', 'salas'],
  ['mesa', 'mesa', 'mesa'], ['caixa', 'caixa', 'caixa'], ['box', 'box', 'box'], ['baia', 'baia', 'baia'], ['balcao', 'balcão', 'balcao'],
  ['posto', 'posto', 'posto'], ['setor', 'setor', 'setor'], ['triagem', 'triagem', 'triagem'], ['classificacao', 'classificação', 'classificacao'],
  ['risco', 'risco', 'risco'], ['medicacao', 'medicação', 'medicacao'], ['raio_x', 'raio-xis', 'raio-x,raio x,raiox,rx,raio-xis'],
  ['exame', 'exame', 'exame'], ['exames', 'exames', 'exames'], ['reavaliacao', 'reavaliação', 'reavaliacao'], ['recepcao', 'recepção', 'recepcao'],
  ['atendimento', 'atendimento', 'atendimento'], ['cadastro', 'cadastro', 'cadastro'], ['laboratorio', 'laboratório', 'laboratorio,lab'],
  ['coleta', 'coleta', 'coleta'], ['curativo', 'curativo', 'curativo'], ['curativos', 'curativos', 'curativos'], ['sutura', 'sutura', 'sutura'],
  ['vacina', 'vacina', 'vacina'], ['vacinacao', 'vacinação', 'vacinacao'], ['odontologia', 'odontologia', 'odontologia'],
  ['dentista', 'dentista', 'dentista'], ['enfermagem', 'enfermagem', 'enfermagem'], ['emergencia', 'emergência', 'emergencia'],
  ['urgencia', 'urgência', 'urgencia'], ['pediatria', 'pediatria', 'pediatria'], ['ortopedia', 'ortopedia', 'ortopedia'],
  ['ginecologia', 'ginecologia', 'ginecologia'], ['clinica', 'clínica', 'clinica'], ['clinico', 'clínico', 'clinico'], ['geral', 'geral', 'geral'],
  ['medico', 'médico', 'medico'], ['medica', 'médica', 'medica'], ['observacao', 'observação', 'observacao'], ['ultrassom', 'ultrassom', 'ultrassom,ultrasom'],
  ['eletrocardiograma', 'eletrocardiograma', 'eletrocardiograma'], ['ecg', 'é cê gê', 'ecg'], ['tomografia', 'tomografia', 'tomografia'],
  ['farmacia', 'farmácia', 'farmacia'], ['servico', 'serviço', 'servico'], ['social', 'social', 'social'], ['assistente', 'assistente', 'assistente'],
  ['leito', 'leito', 'leito'], ['andar', 'andar', 'andar'], ['terreo', 'térreo', 'terreo'], ['bloco', 'bloco', 'bloco'], ['ala', 'ala', 'ala'],
  ['porta', 'porta', 'porta'], ['entrada', 'entrada', 'entrada'], ['saida', 'saída', 'saida'], ['agendamento', 'agendamento', 'agendamento'],
  ['marcacao', 'marcação', 'marcacao'], ['protocolo', 'protocolo', 'protocolo'], ['tesouraria', 'tesouraria', 'tesouraria'],
  ['ouvidoria', 'ouvidoria', 'ouvidoria'], ['secretaria', 'secretaria', 'secretaria'], ['informacoes', 'informações', 'informacoes'],
  ['informacao', 'informação', 'informacao'], ['acolhimento', 'acolhimento', 'acolhimento'], ['isolamento', 'isolamento', 'isolamento'],
  ['inalacao', 'inalação', 'inalacao'], ['nebulizacao', 'nebulização', 'nebulizacao'], ['hidratacao', 'hidratação', 'hidratacao'],
  ['repouso', 'repouso', 'repouso'], ['procedimento', 'procedimento', 'procedimento'], ['procedimentos', 'procedimentos', 'procedimentos'],
  ['cirurgia', 'cirurgia', 'cirurgia'], ['pequena', 'pequena', 'pequena'], ['pequenas', 'pequenas', 'pequenas'], ['vermelha', 'vermelha', 'vermelha'],
  ['amarela', 'amarela', 'amarela'], ['verde', 'verde', 'verde'], ['azul', 'azul', 'azul'], ['laranja', 'laranja', 'laranja'],
  ['adulto', 'adulto', 'adulto'], ['infantil', 'infantil', 'infantil'], ['preferencial', 'preferencial', 'preferencial'],
  ['numero', 'número', 'numero,nº,n.º,no.'], ['de', 'de', 'de'], ['do', 'do', 'do'], ['da', 'da', 'da'], ['dos', 'dos', 'dos'], ['das', 'das', 'das'],
  ['e', 'e', 'e'], ['ao', 'ao', 'ao'], ['dr', 'doutor', 'dr,dr.'], ['dra', 'doutora', 'dra,dra.'], ['doutor', 'doutor', 'doutor'],
  ['doutora', 'doutora', 'doutora'], ['atendente', 'atendente', 'atendente'], ['psicologia', 'psicologia', 'psicologia'],
  ['nutricao', 'nutrição', 'nutricao'], ['fisioterapia', 'fisioterapia', 'fisioterapia'], ['cardiologia', 'cardiologia', 'cardiologia'],
];
// as combinações que vão inteiras (palavra + número de 1 a 30), com a entonação de frase
const COMBO_WORDS = ['guiche', 'consultorio', 'sala', 'mesa', 'caixa', 'leito'];
const COMBO_MAX = 30;

const BASE = 'Você é um locutor brasileiro de São Paulo, português do Brasil com sotaque brasileiro natural (nunca inglês), ' +
  'voz de chamada de senha em recepção de hospital: firme, acordada, clara e simpática, ritmo natural. ' +
  'Pausa de um segundo inteiro entre cada item. Leia cada item exatamente como está escrito, sem acrescentar nada.';
const STYLE = {
  lista: BASE,
  meio: BASE + ' Cada item é um algarismo NO MEIO de um número: entonação suspensa, de quem vai continuar, sem fechar a frase.',
  fim: BASE + ' Cada item é o ÚLTIMO algarismo ou o número final de uma chamada: entonação conclusiva, que fecha a frase.',
};

function vocab() {
  const rows = []; // [token, texto, formas, estilo]
  rows.push(['senha', 'Senha', '', 'lista']);
  for (const [c, s] of Object.entries(LETTERS)) rows.push([`senha_${c}`, `Senha ${s}`, '', 'lista']);
  for (const [c, s] of Object.entries(LETTERS)) rows.push([`l_${c}`, s, '', 'meio']);
  for (let d = 0; d < 10; d++) rows.push([`dm_${d}`, UNITS[d], '', 'meio']);
  for (let d = 0; d < 10; d++) rows.push([`df_${d}`, UNITS[d], '', 'fim']);
  for (let n = 0; n < 100; n++) rows.push([`n_${n}`, num(n), '', 'fim']);
  for (const [t, s, f] of WORDS) rows.push([t, s, f, 'lista']);
  for (const w of COMBO_WORDS) {
    const said = WORDS.find((x) => x[0] === w)[1];
    for (let n = 1; n <= COMBO_MAX; n++) rows.push([`c_${w}_${n}`, `${said[0].toUpperCase()}${said.slice(1)} ${num(n)}`, '', 'fim']);
  }
  return rows;
}

async function tts(voice, text, style) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: STYLE[style], response_format: 'pcm' }),
      });
      if (r.ok) return new Int16Array(Buffer.from(await r.arrayBuffer()).buffer.slice(0)); // 24 kHz mono
      if (r.status < 500 && r.status !== 429) throw new Error(`OpenAI ${r.status}`);
    } catch (e) { if (i === 3) throw e; }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('OpenAI sem resposta');
}

/** Corta a lista falada nos silêncios (buracos de 200 ms ou mais): n pedaços, ou null se não bater. */
function split(s, n) {
  const win = 240, th = 300; const loud = [];
  for (let i = 0; i + win <= s.length; i += win) { let m = 0; for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs(s[j])); loud.push(m > th); }
  const segs = []; let a = -1, quiet = 0;
  for (let k = 0; k < loud.length; k++) {
    if (loud[k]) { if (a < 0) a = k; quiet = 0; } else if (a >= 0 && ++quiet * 10 >= 200) { segs.push([a, k - quiet + 1]); a = -1; quiet = 0; }
  }
  if (a >= 0) segs.push([a, loud.length]);
  const good = segs.filter(([x, y]) => y - x >= 8);
  // um item só: do 1º ao último trecho com som (a pausa de "Senha … ípsilon" fica dentro)
  if (n === 1 && good.length > 1) good.splice(0, good.length, [good[0][0], good[good.length - 1][1]]);
  if (good.length !== n) return null;
  return good.map(([x, y]) => s.slice(Math.max(0, x * win - 480), Math.min(s.length, y * win + 960)));
}

/** Volume igual (RMS ~ -18 dBFS) e 8 ms de entrada e saída. */
function polish(s) {
  let sum = 0; for (const v of s) sum += v * v; const rms = Math.sqrt(sum / s.length) || 1;
  const g = Math.min(4, 4100 / rms); const f = 192; const o = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) { let v = s[i] * g; if (i < f) v *= i / f; if (s.length - i < f) v *= (s.length - i) / f; o[i] = Math.max(-32767, Math.min(32767, v)); }
  return o;
}

function toUlaw(pcm24) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-ar', '16000', '-f', 'mulaw', 'pipe:1'],
    { input: Buffer.from(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength), maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return r.stdout;
}

async function genVoice(voice, rows) {
  const dir = path.join(OUT, voice);
  fs.mkdirSync(dir, { recursive: true });
  const todo = rows.filter(([t]) => !fs.existsSync(path.join(dir, `${t}.ulaw`))); // retomável: só o que falta
  const byStyle = {};
  for (const r of todo) (byStyle[r[3]] ||= []).push(r);
  let done = 0;
  for (const [style, list] of Object.entries(byStyle)) {
    for (let i = 0; i < list.length; i += 4) {
      const part = list.slice(i, i + 4);
      let got = null;
      for (let t = 0; t < 6 && !got; t++) got = split(await tts(voice, part.map((x) => `${x[1]}.`).join('\n'), style), part.length);
      if (!got) { // não cortou certo: um por vez (sempre dá um pedaço só)
        got = [];
        for (const x of part) { const one = split(await tts(voice, `${x[1]}.`, style), 1); if (!one) throw new Error(`${voice}: ${x[0]}`); got.push(one[0]); }
      }
      part.forEach((x, k) => fs.writeFileSync(path.join(dir, `${x[0]}.ulaw`), toUlaw(polish(got[k]))));
      done += part.length;
    }
  }
  console.log(`${voice}: ${done} novos, ${rows.length} no total`);
}

const rows = vocab();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'vocabulario.tsv'),
  '# token\ttexto falado\tformas escritas que casam (sem acento, minúsculas); gerado por android-telas/voz/gerar.mjs\n' +
  rows.map((r) => r.slice(0, 3).join('\t')).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'LEIA-ME.txt'),
  'Vozes da chamada de senha geradas por inteligência artificial (OpenAI gpt-4o-mini-tts: ash, onyx, coral, nova).\n' +
  'Geradas por android-telas/voz/gerar.mjs. O app avisa em Ajustes que a voz é gerada por IA.\n');
await Promise.all(VOICES.map((v) => genVoice(v, rows)));
