// TV Corporativa · aba Comandos (docs/TV-CORPORATIVA.md §2.1 e §6): o histórico dos comandos enviados às telas
// (recarregar, reiniciar o app, reiniciar o aparelho, captura), com quem mandou, quando e o resultado; filtro por tela e
// período (a rede guarda 30 dias). Também manda um comando novo.
// Rotas: GET /api/tvcorp/commands?deviceId=&from=&to=, POST /api/tvcorp/rede/devices/:id/commands.
import { el, guard, toast, tapi, put, f, opt, table, note, empty, btn, chip, D, listOf, when, isoDay, active, officeOf } from './tvcorp-base.js';
import { COMMANDS } from '../../shared/telas-tipos.js';

const V = { device: '', from: null, to: null };
const RESULT = { pending: 'Esperando a tela', sent: 'Entregue à tela', done: 'Feito', failed: 'Falhou', expired: 'Venceu sem a tela ligar' };
const cmdLabel = (k) => COMMANDS.find((c) => c.key === k)?.label || k;

export default async function paintComandos(box, ctx) {
  V.from ??= isoDay(6); V.to ??= isoDay(0);
  const dev = el('select', { 'aria-label': 'Tela' }, opt('', 'Todas as telas', !V.device), ...D().devices.map((x) => opt(x.id, `${x.name} · ${officeOf(x.officeId)?.name || ''}`, V.device === String(x.id))));
  const from = el('input', { type: 'date', value: V.from }); const to = el('input', { type: 'date', value: V.to });
  const out = el('div', {});
  const load = guard(async () => {
    V.device = dev.value; V.from = from.value; V.to = to.value;
    const qs = new URLSearchParams({ ...(V.device ? { deviceId: V.device } : {}), from: V.from, to: V.to });
    const items = listOf(await tapi(`/api/tvcorp/commands?${qs}`), 'commands');
    put(out, items.length ? table(['Quando', 'Tela', 'Comando', 'Quem mandou', 'Resultado'], items.map((c) => el('tr', {},
      el('td', { text: when(c.at ?? c.createdAt) }), el('td', { text: c.device || D().devices.find((x) => x.id === c.deviceId)?.name || `#${c.deviceId}` }),
      el('td', {}, chip(cmdLabel(c.type))), el('td', { text: c.by || c.createdBy || '—' }),
      el('td', {}, c.result || RESULT[c.status] || '—', c.doneAt ? el('div', { class: 'dim small', text: when(c.doneAt) }) : null, c.ok === false && c.detail ? el('div', { class: 'pf-err small', text: c.detail }) : null))))
      : empty('Nenhum comando neste período.'));
  });
  const sendDev = el('select', { 'aria-label': 'Tela do comando' }, ...active().map((x) => opt(x.id, x.name)));
  const sendCmd = el('select', { 'aria-label': 'Comando' }, ...COMMANDS.map((c) => opt(c.key, c.label)));
  const send = guard(async () => {
    const d = active().find((x) => x.id === Number(sendDev.value)); if (!d) throw new Error('Escolha a tela.');
    if (sendCmd.value === 'reboot' && !confirm(`Reiniciar o aparelho "${d.name}"? A tela fica sem imagem por 1 a 2 minutos.`)) return;
    await tapi(`/api/tvcorp/rede/devices/${d.id}/commands`, { method: 'POST', body: { type: sendCmd.value } });
    toast(`${cmdLabel(sendCmd.value)}: a tela "${d.name}" recebe no próximo sinal de vida (até 30 s).`); await load();
  });
  put(box,
    note('Cada comando fica registrado com quem mandou e quando. A tela recebe no próximo sinal de vida (até 30 segundos); desligada, recebe quando ligar.'),
    el('div', { class: 'pf-bar' }, f('Tela', sendDev), f('Comando', sendCmd), btn('Enviar', send, 'primary')),
    el('div', { class: 'pf-bar' }, f('Tela', dev), f('De', from), f('Até', to), btn('Ver', load)),
    out);
  await load();
}
