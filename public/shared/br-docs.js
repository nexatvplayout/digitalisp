// Documentos e contatos de cadastro, iguais no painel, no superadmin e no servidor (sem DOM: o servidor importa este
// arquivo, como faz com public/cg/model.js). CPF e CNPJ (inclusive o CNPJ alfanumérico da Receita, de julho de 2026),
// telefone por país (Brasil sem DDI, com DDD; outros países com o DDI do país, no padrão E.164), e-mail, a lista de
// países com o DDI e as UFs com o código do IBGE. Guardado normalizado (só dígitos, ou letras maiúsculas e dígitos no
// CNPJ) e mostrado formatado.

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/* ------------------------------------------------------------------ UFs (código do IBGE: 2 primeiros dígitos do município) */
export const UFS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
export const UF_IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};
export const IBGE_OF_UF = Object.fromEntries(Object.entries(UF_IBGE).map(([k, v]) => [v, k]));
/** Comparação de nomes de lugar: sem acento, sem caixa, sem pontuação ("Santa Bárbara d'Oeste" = "santa barbara d oeste"). */
export const placeKey = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
/** UF pela sigla (qualquer caixa); null se não existe. */
export const normalizeUf = (v) => { const u = String(v ?? '').trim().toUpperCase(); return UFS[u] ? u : null; };

/* ------------------------------------------------------------------ países (nome em português e DDI) */
// Brasil é o padrão. Países do plano de numeração norte-americano (Estados Unidos, Canadá e Caribe) dividem o +1 e o
// código de área faz parte do número; Rússia e Cazaquistão dividem o +7; Itália e Vaticano, o +39.
const COUNTRY_ROWS = `AF Afeganistão 93|ZA África do Sul 27|AL Albânia 355|DE Alemanha 49|AD Andorra 376|AO Angola 244|AI Anguila 1|AG Antígua e Barbuda 1|SA Arábia Saudita 966|DZ Argélia 213|AR Argentina 54|AM Armênia 374|AW Aruba 297|AU Austrália 61|AT Áustria 43|AZ Azerbaijão 994|BS Bahamas 1|BH Bahrein 973|BD Bangladesh 880|BB Barbados 1|BY Belarus (Bielorrússia) 375|BE Bélgica 32|BZ Belize 501|BJ Benin 229|BM Bermudas 1|BO Bolívia 591|BA Bósnia e Herzegovina 387|BW Botsuana 267|BR Brasil 55|BN Brunei 673|BG Bulgária 359|BF Burkina Faso 226|BI Burundi 257|BT Butão 975|CV Cabo Verde 238|CM Camarões 237|KH Camboja 855|CA Canadá 1|QA Catar 974|KZ Cazaquistão 7|TD Chade 235|CL Chile 56|CN China 86|CY Chipre 357|CO Colômbia 57|KM Comores 269|CG Congo 242|CD Congo (República Democrática) 243|KP Coreia do Norte 850|KR Coreia do Sul 82|CI Costa do Marfim 225|CR Costa Rica 506|HR Croácia 385|CU Cuba 53|CW Curaçao 599|DK Dinamarca 45|DJ Djibuti 253|DM Dominica 1|EG Egito 20|SV El Salvador 503|AE Emirados Árabes Unidos 971|EC Equador 593|ER Eritreia 291|SK Eslováquia 421|SI Eslovênia 386|ES Espanha 34|SZ Essuatíni 268|US Estados Unidos 1|EE Estônia 372|ET Etiópia 251|FJ Fiji 679|PH Filipinas 63|FI Finlândia 358|FR França 33|GA Gabão 241|GM Gâmbia 220|GH Gana 233|GE Geórgia 995|GI Gibraltar 350|GD Granada 1|GR Grécia 30|GL Groenlândia 299|GP Guadalupe 590|GU Guam 1|GT Guatemala 502|GY Guiana 592|GF Guiana Francesa 594|GN Guiné 224|GQ Guiné Equatorial 240|GW Guiné-Bissau 245|HT Haiti 509|HN Honduras 504|HK Hong Kong 852|HU Hungria 36|YE Iêmen 967|KY Ilhas Cayman 1|CK Ilhas Cook 682|FO Ilhas Faroé 298|FK Ilhas Malvinas 500|MH Ilhas Marshall 692|SB Ilhas Salomão 677|VI Ilhas Virgens Americanas 1|VG Ilhas Virgens Britânicas 1|IN Índia 91|ID Indonésia 62|IR Irã 98|IQ Iraque 964|IE Irlanda 353|IS Islândia 354|IL Israel 972|IT Itália 39|JM Jamaica 1|JP Japão 81|JO Jordânia 962|KI Kiribati 686|XK Kosovo 383|KW Kuwait 965|LA Laos 856|LS Lesoto 266|LV Letônia 371|LB Líbano 961|LR Libéria 231|LY Líbia 218|LI Liechtenstein 423|LT Lituânia 370|LU Luxemburgo 352|MO Macau 853|MK Macedônia do Norte 389|MG Madagascar 261|MY Malásia 60|MW Malaui 265|MV Maldivas 960|ML Mali 223|MT Malta 356|MA Marrocos 212|MQ Martinica 596|MU Maurício 230|MR Mauritânia 222|YT Mayotte 262|MX México 52|MM Mianmar 95|FM Micronésia 691|MZ Moçambique 258|MD Moldávia 373|MC Mônaco 377|MN Mongólia 976|ME Montenegro 382|MS Montserrat 1|NA Namíbia 264|NR Nauru 674|NP Nepal 977|NI Nicarágua 505|NE Níger 227|NG Nigéria 234|NO Noruega 47|NC Nova Caledônia 687|NZ Nova Zelândia 64|OM Omã 968|NL Países Baixos (Holanda) 31|PW Palau 680|PS Palestina 970|PA Panamá 507|PG Papua-Nova Guiné 675|PK Paquistão 92|PY Paraguai 595|PE Peru 51|PF Polinésia Francesa 689|PL Polônia 48|PR Porto Rico 1|PT Portugal 351|KE Quênia 254|KG Quirguistão 996|GB Reino Unido 44|CF República Centro-Africana 236|DO República Dominicana 1|RE Reunião 262|RO Romênia 40|RW Ruanda 250|RU Rússia 7|WS Samoa 685|SM San Marino 378|LC Santa Lúcia 1|KN São Cristóvão e Névis 1|ST São Tomé e Príncipe 239|VC São Vicente e Granadinas 1|SN Senegal 221|SL Serra Leoa 232|RS Sérvia 381|SC Seychelles 248|SG Singapura 65|SX Sint Maarten 1|SY Síria 963|SO Somália 252|LK Sri Lanka 94|SD Sudão 249|SS Sudão do Sul 211|SE Suécia 46|CH Suíça 41|SR Suriname 597|TJ Tadjiquistão 992|TH Tailândia 66|TW Taiwan 886|TZ Tanzânia 255|CZ Tchéquia (República Tcheca) 420|TL Timor-Leste 670|TG Togo 228|TO Tonga 676|TT Trinidad e Tobago 1|TN Tunísia 216|TM Turcomenistão 993|TC Turks e Caicos 1|TR Turquia 90|TV Tuvalu 688|UA Ucrânia 380|UG Uganda 256|UY Uruguai 598|UZ Uzbequistão 998|VU Vanuatu 678|VA Vaticano 39|VE Venezuela 58|VN Vietnã 84|ZM Zâmbia 260|ZW Zimbábue 263`;
/** [{ code: 'PT', name: 'Portugal', ddi: '351' }, …] em ordem alfabética (Brasil no meio, onde cai pelo nome). */
export const COUNTRIES = COUNTRY_ROWS.split('|').map((r) => {
  const m = /^([A-Z]{2}) (.+) (\d{1,3})$/.exec(r);
  return { code: m[1], name: m[2], ddi: m[3] };
});
export const COUNTRY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
export const DEFAULT_COUNTRY = 'BR';
/** País pela sigla ISO de 2 letras (vazio = Brasil); null se não está na lista. */
export function normalizeCountry(v) {
  const c = String(v ?? '').trim().toUpperCase();
  if (!c) return DEFAULT_COUNTRY;
  return COUNTRY[c] ? c : null;
}
export const countryName = (code) => COUNTRY[code]?.name || code || '';

/* ------------------------------------------------------------------ CPF e CNPJ */
/** Só letras e dígitos, letras em maiúsculas (pontos, barra, traço e espaços somem). */
export const normalizeDocument = (v) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** CPF pelos dois dígitos verificadores (módulo 11); 111.111.111-11 e outras sequências repetidas são recusadas. */
export function validCpf(v) {
  const d = normalizeDocument(v);
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len) => { let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
/**
 * CNPJ numérico ou alfanumérico (12 posições de 0-9/A-Z + 2 dígitos verificadores numéricos). O valor de cada posição é
 * o código ASCII menos 48 (0 a 9 valem 0 a 9; A vale 17, B 18 … Z 42), com os mesmos pesos e o mesmo módulo 11 do CNPJ
 * numérico: o CNPJ só de dígitos continua valendo igual.
 */
export function validCnpj(v) {
  const d = normalizeDocument(v);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const dv = (w) => { let s = 0; for (let i = 0; i < w.length; i++) s += val(d[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(CNPJ_W1) === Number(d[12]) && dv(CNPJ_W2) === Number(d[13]);
}

/** 'cpf' ou 'cnpj' pelo formato (sem conferir os dígitos verificadores); null se não tem cara de nenhum. */
export function documentKind(v) {
  const d = normalizeDocument(v);
  if (/^\d{11}$/.test(d)) return 'cpf';
  if (/^[0-9A-Z]{12}\d{2}$/.test(d)) return 'cnpj';
  return null;
}

/**
 * Lê um CPF ou CNPJ digitado (com ou sem pontuação). Vazio = sem documento.
 * Devolve { value, kind, error }: value normalizado (null se vazio ou inválido) e error com a mensagem para a tela.
 */
export function parseDocument(v) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null, kind: null, error: null };
  const no = (error) => ({ value: null, kind: null, error });
  if (/[^0-9A-Za-z.\-/\s]/.test(s)) return no('CPF/CNPJ: use só números (e letras, no CNPJ alfanumérico), com ou sem pontos, barra e traço.');
  const d = normalizeDocument(s);
  if (/^\d{11}$/.test(d)) return validCpf(d) ? { value: d, kind: 'cpf', error: null } : no('CPF inválido: confira os dígitos.');
  if (/^[0-9A-Z]{12}\d{2}$/.test(d)) return validCnpj(d) ? { value: d, kind: 'cnpj', error: null } : no('CNPJ inválido: confira os dígitos.');
  if (d.length === 14) return no('CNPJ inválido: os dois últimos caracteres são os dígitos verificadores (números).');
  if (/[A-Z]/.test(d)) return no(d.length < 14 ? 'CNPJ incompleto: são 14 caracteres (12 letras ou números e 2 dígitos).' : 'CNPJ com caracteres demais: são 14.');
  if (d.length < 11) return no('CPF incompleto: são 11 dígitos.');
  if (d.length < 14) return no('CNPJ incompleto: são 14 dígitos.');
  return no('Documento com dígitos demais: o CPF tem 11 e o CNPJ, 14.');
}
export const documentError = (v) => parseDocument(v).error;

const groups = (s, sizes, seps) => {
  let out = ''; let i = 0;
  sizes.forEach((n, k) => { if (i >= s.length) return; if (k) out += seps[k - 1]; out += s.slice(i, i + n); i += n; });
  return out;
};
/** 000.000.000-00, 00.000.000/0000-00 ou AA.AAA.AAA/AAAA-00; o que não tem formato de CPF/CNPJ volta como está. */
export function formatDocument(v) {
  const d = normalizeDocument(v);
  if (/^\d{11}$/.test(d)) return groups(d, [3, 3, 3, 2], ['.', '.', '-']);
  if (/^[0-9A-Z]{12}\d{2}$/.test(d)) return groups(d, [2, 3, 3, 4, 2], ['.', '.', '/', '-']);
  return String(v ?? '').trim();
}
/** Máscara durante a digitação: CPF até 11 dígitos; com o 12º caractere (ou uma letra), CNPJ. */
export function maskDocument(v) {
  const d = normalizeDocument(v).slice(0, 14);
  if (d.length <= 11 && !/[A-Z]/.test(d)) return groups(d, [3, 3, 3, 2], ['.', '.', '-']);
  return groups(d, [2, 3, 3, 4, 2], ['.', '.', '/', '-']);
}

/* ------------------------------------------------------------------ telefone */
/** DDDs em uso no Brasil (Anatel). */
export const DDDS = new Set(('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 '
  + '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' '));
const PHONE_CHARS = /[^\d\s()+.\-/]/;
const E164_MAX = 15;

function parseBrPhone(s) {
  const no = (error) => ({ value: null, error });
  let d = onlyDigits(s);
  if (s.startsWith('+')) {
    if (!d.startsWith('55')) return no('Esse número tem o código de outro país: escolha o país no cadastro.');
    d = d.slice(2);
  } else if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2); // colado com o 55 sem o +
  if (/^0(300|500|800|900)/.test(d)) return no('Números 0800, 0300, 0500 e 0900 não são aceitos: informe um telefone com DDD.');
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1); // o 0 da discagem interurbana antes do DDD
  if (d.length < 10) return no('Telefone incompleto: informe o DDD e o número (10 ou 11 dígitos).');
  if (d.length > 11) return no('Telefone com dígitos demais: DDD e número somam 10 ou 11 dígitos.');
  if (!DDDS.has(d.slice(0, 2))) return no(`DDD ${d.slice(0, 2)} não existe.`);
  if (d.length === 11 && d[2] !== '9') return no('Celular com 11 dígitos tem o 9 logo depois do DDD.');
  if (d.length === 10 && !/[2-5]/.test(d[2])) return no('Telefone fixo começa com 2, 3, 4 ou 5 depois do DDD (o celular tem 9 dígitos, começando por 9).');
  return { value: d, error: null };
}

function parseIntlPhone(s, c) {
  const no = (error) => ({ value: null, error });
  let d = onlyDigits(s);
  if (s.startsWith('+') || d.startsWith('00')) { // veio com o código do país: tem de ser o do país escolhido
    const full = s.startsWith('+') ? d : d.slice(2);
    if (!full.startsWith(c.ddi)) return no(`Esse número não começa com +${c.ddi} (${c.name}): troque o país ou digite o número sem o código do país.`);
    d = full.slice(c.ddi.length);
  }
  if (d.length < 4) return no('Telefone incompleto.');
  if (c.ddi.length + d.length > E164_MAX) return no(`Telefone longo demais: com o +${c.ddi}, são no máximo ${E164_MAX} dígitos (padrão internacional E.164).`);
  return { value: c.ddi + d, error: null };
}

/**
 * Lê um telefone do país (sigla ISO; Brasil por padrão). Brasil: DDD válido + 8 dígitos (fixo) ou 9 (celular), sem DDI;
 * um +55 colado é aceito e retirado; 0800/0300 recusados. Outro país: só números, guardado com o DDI na frente (E.164
 * sem o +, até 15 dígitos). Devolve { value, error } (value null se vazio ou inválido).
 */
export function parsePhone(v, country = DEFAULT_COUNTRY) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null, error: null };
  if (PHONE_CHARS.test(s)) return { value: null, error: 'Telefone: use só números.' };
  const c = COUNTRY[normalizeCountry(country) || ''];
  if (!c) return { value: null, error: 'Escolha o país do telefone.' };
  return c.code === 'BR' ? parseBrPhone(s) : parseIntlPhone(s, c);
}
export const phoneError = (v, country) => parsePhone(v, country).error;

/** O valor guardado (o que parsePhone devolveu) ainda é um telefone válido do país? Para avisar dos registros antigos. */
export function validStoredPhone(value, country = DEFAULT_COUNTRY) {
  const s = String(value ?? '');
  const c = COUNTRY[normalizeCountry(country) || ''];
  if (!c || !/^\d+$/.test(s)) return false;
  if (c.code === 'BR') return parseBrPhone(s).value === s;
  return s.startsWith(c.ddi) && s.length - c.ddi.length >= 4 && s.length <= E164_MAX;
}

const brFormat = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);
/** O número guardado sem o DDI do país (o que vai no campo, com o +DDI fixo ao lado). */
export function nationalPhone(value, country = DEFAULT_COUNTRY) {
  const d = onlyDigits(value);
  const c = COUNTRY[normalizeCountry(country) || ''];
  if (!c || c.code === 'BR') return d;
  return d.startsWith(c.ddi) ? d.slice(c.ddi.length) : d;
}
/** (11) 98765-4321 no Brasil; +351 912345678 nos outros países. O que não tem o formato esperado volta como está. */
export function formatPhone(value, country = DEFAULT_COUNTRY) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const d = onlyDigits(raw);
  const c = COUNTRY[normalizeCountry(country) || ''];
  if (c && c.code === 'BR') return /^\d{10,11}$/.test(d) && d === raw.replace(/[\s()-]/g, '') ? brFormat(d) : raw;
  if (c && /^\d+$/.test(raw) && raw.startsWith(c.ddi)) return `+${c.ddi} ${raw.slice(c.ddi.length)}`;
  return raw;
}
/** Máscara durante a digitação: Brasil (00) 0000-0000 / (00) 00000-0000 (um +55 colado sai); outros países, só números. */
export function maskPhone(v, country = DEFAULT_COUNTRY) {
  const s = String(v ?? '');
  let d = onlyDigits(s);
  const c = COUNTRY[normalizeCountry(country) || ''] || COUNTRY.BR;
  if (c.code !== 'BR') {
    if (s.trim().startsWith('+') && d.startsWith(c.ddi)) d = d.slice(c.ddi.length);
    return d.slice(0, E164_MAX - c.ddi.length);
  }
  if (s.trim().startsWith('+55') || (d.length > 11 && d.startsWith('55'))) d = d.slice(2);
  if (d.startsWith('0')) return d.slice(0, 12); // 0800 e afins ficam como digitados (a conferência explica)
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
/** Link tel: com o número internacional (+55… ou +DDI…); '' se não der. */
export function phoneHref(value, country = DEFAULT_COUNTRY) {
  const d = onlyDigits(value);
  if (!d) return '';
  const c = COUNTRY[normalizeCountry(country) || ''];
  if (String(value).trim().startsWith('+')) return `tel:+${d}`;
  if (!c || c.code === 'BR') return /^\d{10,11}$/.test(d) ? `tel:+55${d}` : '';
  return `tel:+${d}`;
}

/**
 * Telefone sem campo de país (cadastro da emissora, pedidos do app, perfil do espectador): começando com + e outro código,
 * é internacional (guardado como +dígitos, até 15); senão segue as regras do Brasil (DDD, sem DDI, sem 0800).
 */
export function parsePhoneAny(v) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null, error: null };
  if (PHONE_CHARS.test(s)) return { value: null, error: 'Telefone: use só números.' };
  const d = onlyDigits(s);
  if ((s.startsWith('+') && !d.startsWith('55')) || (s.startsWith('00') && !d.startsWith('0055'))) {
    const full = s.startsWith('+') ? d : d.slice(2);
    if (full.length < 8) return { value: null, error: 'Telefone internacional incompleto: + código do país e número.' };
    if (full.length > E164_MAX) return { value: null, error: `Telefone longo demais: no máximo ${E164_MAX} dígitos com o código do país.` };
    return { value: `+${full}`, error: null };
  }
  return parseBrPhone(s.startsWith('00') ? `+${d.slice(2)}` : s);
}
/** Formata o que parsePhoneAny guardou (e os valores antigos, digitados à mão, que já tinham formato). */
export function formatPhoneAny(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) {
    const d = onlyDigits(raw);
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return brFormat(d.slice(2));
    return `+${d}`;
  }
  const d = onlyDigits(raw);
  return /^\d{10,11}$/.test(d) && DDDS.has(d.slice(0, 2)) ? brFormat(d) : raw;
}
/** Máscara sem campo de país: + no começo deixa digitar o internacional; senão a do Brasil. */
export function maskPhoneAny(v) {
  const s = String(v ?? '').trim();
  if (!s.startsWith('+')) return maskPhone(s, 'BR');
  const d = onlyDigits(s);
  if (d.startsWith('55') && d.length > 2) return maskPhone(s, 'BR'); // +55 colado: vira o número do Brasil
  return `+${d.slice(0, E164_MAX)}`;
}

/* ------------------------------------------------------------------ e-mail */
export const EMAIL_MAX = 120;
// prático, não a RFC inteira: algo@domínio.tld, sem espaços nem caracteres que quebram endereço; domínio com letras
// (acentuadas também), números e hífen, e um final de 2+ letras
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,}$/u;
/** Lê um e-mail: { value, error }. O domínio vai em minúsculas. Vazio = sem e-mail. */
export function parseEmail(v) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null, error: null };
  if (s.length > EMAIL_MAX) return { value: null, error: `E-mail longo demais (até ${EMAIL_MAX} caracteres).` };
  if (!EMAIL_RE.test(s)) return { value: null, error: 'E-mail inválido: use o formato nome@empresa.com.br.' };
  const at = s.lastIndexOf('@');
  return { value: `${s.slice(0, at)}@${s.slice(at + 1).toLowerCase()}`, error: null };
}
export const emailError = (v) => parseEmail(v).error;
