// Máscaras dos campos de documento e contato, em TODO o painel: CPF 000.000.000-00, CNPJ 00.000.000/0000-00 (também o
// alfanumérico), telefone (00) 0000-0000 / (00) 00000-0000, CEP 00000-000. Vale enquanto a pessoa digita e para o valor
// que o formulário já traz. O servidor guarda só os dígitos (e as letras do CNPJ novo); a máscara é só para os olhos.
// O campo é reconhecido pelo nome (document, respCpf, phone, whatsapp, zip) ou por data-mask="cpf|cnpj|doc|tel|cep".
const NOMES = { document: 'doc', respCpf: 'cpf', cpf: 'cpf', cnpj: 'cnpj', phone: 'tel', whatsapp: 'tel', telefone: 'tel', zip: 'cep', cep: 'cep' };

const digitos = (v) => String(v || '').replace(/\D/g, '');
const alnum = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function cpf(v) {
  const d = digitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}
function cnpj(v) {
  const d = alnum(v).slice(0, 14); // CNPJ alfanumérico (julho de 2026): 12 letras ou números e 2 dígitos
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 5)}`;
  if (d.length > 5) out += `.${d.slice(5, 8)}`;
  if (d.length > 8) out += `/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12, 14)}`;
  return out;
}
/** CPF até 11 dígitos; passou disso (ou tem letra), CNPJ. */
const doc = (v) => (/[A-Za-z]/.test(String(v)) || digitos(v).length > 11 ? cnpj(v) : cpf(v));
function tel(v) {
  let d = digitos(v);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2); // +55 colado
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const ddd = d.slice(0, 2); const n = d.slice(2);
  if (n.length <= 4) return `(${ddd}) ${n}`;
  return n.length === 9 ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
}
const cep = (v) => { const d = digitos(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const MASCARAS = { cpf, cnpj, doc, tel, cep };

const tipoDe = (i) => i.dataset?.mask || NOMES[i.name] || null;
function aplicar(i) {
  const t = tipoDe(i);
  if (!t || !MASCARAS[t] || i.type === 'hidden') return;
  const antes = i.value;
  const depois = MASCARAS[t](antes);
  if (depois === antes) return;
  // mantém o cursor no lugar certo quando a pessoa digita no meio
  const fim = document.activeElement === i && i.selectionEnd === antes.length;
  i.value = depois;
  if (fim) i.setSelectionRange(depois.length, depois.length);
}
function preparar(raiz) {
  for (const i of raiz.querySelectorAll?.('input') || []) {
    const t = tipoDe(i);
    if (!t) continue;
    if (!i.inputMode) i.inputMode = t === 'tel' ? 'tel' : t === 'doc' || t === 'cnpj' ? 'text' : 'numeric';
    i.maxLength = { cpf: 14, cnpj: 18, doc: 18, tel: 15, cep: 9 }[t];
    aplicar(i);
  }
}

/** Liga as máscaras no painel inteiro: o que já está na tela e o que aparecer depois (formulários abertos depois). */
export function ligarMascaras(raiz = document.body) {
  raiz.addEventListener('input', (e) => { if (e.target?.tagName === 'INPUT') aplicar(e.target); });
  preparar(raiz);
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) preparar(n.tagName === 'INPUT' ? n.parentElement || n : n); })
    .observe(raiz, { childList: true, subtree: true });
}
