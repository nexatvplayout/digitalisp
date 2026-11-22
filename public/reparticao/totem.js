// NEXA Telas · totem de senhas (server/telas-senha.js, docs/TELAS.md §10). Aberto pelo endereço /reparticao/<token>/totem que a
// recepção (ou a prefeitura) gera; fica numa tela de toque ou num tablet na entrada. O token do totem SÓ emite senha: não vê a
// fila, não chama, não abre a página de controle. Botões grandes por fila, a escolha do atendimento prioritário, a senha
// emitida em destaque por 8 segundos e, se a repartição ligou, o papel pela impressão do navegador (window.print).
import { qrSvg } from '/shared/telas-previa.js'; // §29: o QR do acompanhante no papel

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const SHOW_MS = 8000;
let info = null;
let chosen = null;
let busy = false;
let backTimer = null;

async function api(path, body) {
  const res = await fetch(`/api/totem${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { status: res.status });
  return data;
}
const show = (id) => { for (const s of ['pick', 'prio', 'ticket']) $(s).hidden = s !== id; };
const note = (msg) => { $('note').textContent = msg || ''; };
function button(label, small, onclick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `t-btn ${cls}`.trim();
  const t = document.createElement('b'); t.textContent = label; b.append(t);
  if (small) { const s = document.createElement('small'); s.textContent = small; b.append(s); }
  b.addEventListener('click', onclick);
  return b;
}

function paint() {
  $('office').textContent = info.office;
  document.title = `Senhas · ${info.office}`;
  $('services').replaceChildren(...info.services.map((s) => button(s.name, s.priority ? 'normal ou prioritário' : '', () => pick(s))));
  if (!info.services.length) note('Nenhuma fila aberta agora. Procure a recepção.');
}
function pick(s) {
  if (busy) return;
  chosen = s;
  if (!s.priority) return issue(0);
  $('hPrio').textContent = s.name;
  show('prio');
  clearTimeout(backTimer);
  backTimer = setTimeout(home, 30000); // ninguém escolheu: volta ao começo para a próxima pessoa
}
function home() { clearTimeout(backTimer); chosen = null; show('pick'); }

async function issue(priority) {
  if (busy || !chosen) return;
  busy = true; clearTimeout(backTimer);
  try {
    const t = await api('/tickets', { serviceId: chosen.id, priority });
    $('code').textContent = t.ticket;
    $('service').textContent = `${t.service}${t.priority ? ' · prioritário' : ''}`;
    $('ticket').classList.toggle('prio', t.priority);
    show('ticket');
    // o papel fica pronto sempre (15/11: Ctrl+P ou "Imprimir a senha" sem a impressão automática saía em branco);
    // com "O totem imprime a senha" ligado, a impressão abre sozinha
    fillTicket(t);
    $('reprint').hidden = Boolean(info.print);
    if (info.print) printNow();
    backTimer = setTimeout(home, SHOW_MS);
  } catch (e) {
    home();
    note(e.status === 401 ? 'Totem desligado. Procure a recepção.' : e.message);
    setTimeout(() => note(''), 8000);
    if (e.status === 401) { info = { ...info, services: [] }; paint(); }
  } finally { busy = false; }
}
/** O papel: um layout pequeno só de impressão (totem.css @media print). */
function fillTicket(t) {
  $('pOffice').textContent = t.office;
  $('pCode').textContent = t.ticket;
  $('pService').textContent = `${t.service}${t.priority ? ' · prioritário' : ''}`;
  $('pWhen').textContent = new Date(t.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // o QR do acompanhante (só quando a repartição ligou): a posição, a etapa e a sala da chamada, sem nome; vale só hoje
  const qr = t.follow ? qrSvg(t.follow, 'p-qrc') : null;
  $('pQr').replaceChildren(...(qr ? [qr] : []));
  $('pQrHint').hidden = !qr;
}
const printNow = () => setTimeout(() => { try { window.print(); } catch { /* sem impressora */ } }, 150);
$('reprint').addEventListener('click', () => { clearTimeout(backTimer); printNow(); backTimer = setTimeout(home, SHOW_MS); });

$('prio0').addEventListener('click', () => issue(0));
$('prio1').addEventListener('click', () => issue(1));
$('prio2').addEventListener('click', () => issue(2));
$('back').addEventListener('click', home);
const tick = () => { $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
tick(); setInterval(tick, 15000);

/** As filas mudam pouco: relê a cada minuto (uma fila nova aparece sem recarregar o totem). */
async function load() {
  try { info = await api(''); paint(); if ($('note').textContent.startsWith('Sem conexão')) note(''); } catch (e) {
    if (e.status === 401) { info = { office: info?.office || '', services: [], print: false }; paint(); note('Totem desligado. Peça à recepção um endereço novo.'); } else if (!info) note('Sem conexão com o servidor. Tentando de novo…'); else note('Sem conexão com o servidor. Tentando de novo…');
  }
}
if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) note('Endereço incompleto. Peça à recepção o endereço do totem.');
else { load(); setInterval(() => { if ($('pick').hidden === false) load(); }, 60000); }
