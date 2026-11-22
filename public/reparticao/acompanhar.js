// NEXA Telas · a página do acompanhante (server/telas-salas.js, docs/TELAS.md §29). Aberta pelo QR do cupom da senha
// (/senha/<token opaco>): a posição aproximada, a etapa e "foi chamada: Consultório 3". Sem nome, sem motivo do
// atendimento; a cor só se a repartição ligou. O token vence no fim do dia. Nada de fora, nada guardado no aparelho.
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const LEVEL = { vermelho: 'Vermelho · Emergência', laranja: 'Laranja · Muito urgente', amarelo: 'Amarelo · Urgente', verde: 'Verde · Pouco urgente', azul: 'Azul · Não urgente' };
let timer = null;

const show = (id, text) => { $(id).textContent = text || ''; $(id).hidden = !text; };
async function load() {
  const res = await fetch('/api/acompanhar', { cache: 'no-store', referrerPolicy: 'no-referrer', headers: { authorization: `Bearer ${token}` } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { show('err', d.error || 'Não foi possível ler a senha agora.'); if (res.status === 401) clearInterval(timer); return; }
  show('err', '');
  document.title = `Senha ${d.code}`;
  $('office').textContent = d.office; $('code').textContent = d.code; $('status').textContent = d.statusLabel;
  show('called', d.calledTo ? `Foi chamada: ${d.calledTo}` : '');
  $('stage').textContent = d.stage?.name ? `Etapa${d.stage.total ? ` ${d.stage.index + 1} de ${d.stage.total}` : ''}: ${d.stage.name}` : '';
  $('position').textContent = d.status === 'waiting' ? d.position || '' : '';
  const r = $('risk'); r.hidden = !d.risk; r.replaceChildren();
  if (d.risk) { const s = document.createElement('span'); s.className = `a-risk rk-${d.risk}`; r.append(s, `Classificação: ${LEVEL[d.risk] || d.risk}`); }
  show('estimate', d.estimate ? [d.estimate.light, d.estimate.text].filter(Boolean).join(' · ') : '');
  if (['done', 'noshow', 'cancelled', 'expired'].includes(d.status)) clearInterval(timer);
}
if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) show('err', 'Endereço incompleto.');
else { load().catch(() => show('err', 'Sem conexão. Tentando de novo…')); timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 15000); }
