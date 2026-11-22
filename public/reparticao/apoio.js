// NEXA Telas · a página do apoio (server/telas-salas.js, docs/TELAS.md §28): o celular do setor de apoio (maqueiro, limpeza,
// segurança, enfermagem) vê os pedidos das salas, aceita ("a caminho") e conclui. Aberta pelo endereço
// /reparticao/<token>/apoio que o gestor gera. O nome de quem aceita fica guardado só neste aparelho.
import { minText } from '/shared/telas-salas.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const WHO_KEY = 'nexa.apoio.quem';
let D = null; let okTimer = null; let seen = new Set();

async function api(path, body) {
  const res = await fetch(`/api/apoio${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
const show = (id, msg) => { $(id).textContent = msg || ''; $(id).hidden = !msg; };
const ok = (msg) => { show('err', ''); show('ok', msg); clearTimeout(okTimer); okTimer = setTimeout(() => show('ok', ''), 5000); };
const err = (msg) => { show('ok', ''); show('err', msg); };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const hm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const who = () => $('who').value.trim();
const run = (fn, msg) => async () => { try { await fn(); ok(msg); await load(); } catch (x) { err(x.message); } };

function paint() {
  $('office').textContent = D.office; document.title = `Apoio · ${D.office}`;
  const open = D.requests.filter((x) => x.status === 'open');
  $('count').textContent = open.length ? `${open.length} ${open.length === 1 ? 'pedido aberto' : 'pedidos abertos'}` : 'nenhum pedido aberto';
  $('empty').hidden = D.requests.length > 0;
  $('list').replaceChildren(...D.requests.map((x) => {
    const li = el('li', x.status === 'open' && !seen.has(x.id) ? 'r-late' : '');
    li.append(el('span', `r-tag${x.status === 'open' ? ' live' : ''}`, x.statusLabel));
    const mid = el('span'); mid.append(el('b', '', `${x.kind} · ${x.room}`), el('small', '', `pedido às ${hm(x.createdAt)} (${minText((D.serverTime - x.createdAt) / 60000)})${x.acceptedBy ? ` · aceito por ${x.acceptedBy} em ${minText(x.waitMin)}` : ''}${x.doneAt ? ` · concluído às ${hm(x.doneAt)}` : ''}`));
    li.append(mid);
    const b = (text, path, msg) => { const n = el('button', 'r-btn small', text); n.type = 'button'; n.addEventListener('click', run(async () => { if (!who()) { $('who').focus(); throw new Error('Escreva o seu nome antes.'); } seen.add(x.id); await api(`/${x.id}/${path}`, { who: who() }); }, msg)); return n; };
    if (x.status === 'open') li.append(b('Aceitar', 'accept', 'Pedido aceito: a sala vê que você está a caminho.'));
    if (x.status === 'open' || x.status === 'accepted') li.append(b('Concluir', 'done', 'Pedido concluído.'));
    return li;
  }));
}
async function load() { D = await api(''); paint(); }
$('who').addEventListener('change', () => { try { localStorage.setItem(WHO_KEY, who()); } catch { /* sem armazenamento */ } });
try { $('who').value = localStorage.getItem(WHO_KEY) || ''; } catch { /* sem armazenamento */ }
const clock = () => { $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
clock(); setInterval(clock, 20000);
if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) err('Endereço incompleto. Peça o endereço do apoio ao responsável da repartição.');
else { load().catch((x) => err(x.message)); setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5000); }
