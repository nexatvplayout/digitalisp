// TV Corporativa · aba Indicadores (docs/TV-CORPORATIVA.md §2.3 e §3.2): os indicadores com meta, as faixas de cor (verde,
// amarelo, vermelho), a fonte do valor (manual, planilha CSV, endereço JSON ou integração por API) e o gráfico dos últimos
// valores. Nunca dado individual de funcionário: ranking só por equipe, unidade ou turno.
// Rotas: GET/POST/PATCH/DELETE /api/tvcorp/kpis[/:id], POST /api/tvcorp/kpis/:id/value.
import { el, guard, toast, tapi, put, f, opt, table, note, empty, btn, btns, chip, dialog, D, listOf, when, ago, now } from './tvcorp-base.js';
import { itemPreview } from '../../shared/tvcorp-previa.js';
import { KPI_SOURCES, LIMITS, kpiBand } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); return n; };
const BAND_LABEL = { ok: 'na meta', warn: 'perto da meta', bad: 'longe da meta', none: 'sem meta' };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');
const toNum = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(',', '.')));

/** O gráfico: a linha dos valores e a linha tracejada da meta, num SVG só com atributos. */
export function kpiChart(points, target) {
  const W = 600; const H = 180; const pad = 28;
  const svg = sv('svg', { class: 'tc-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gráfico dos últimos valores do indicador' });
  const vals = points.map((p) => Number(p.value)).filter(Number.isFinite);
  if (!vals.length) return svg;
  const lo = Math.min(...vals, Number.isFinite(target) ? target : Infinity); const hi = Math.max(...vals, Number.isFinite(target) ? target : -Infinity);
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1); const y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
  svg.append(sv('line', { class: 'tc-axis', x1: pad, y1: H - pad, x2: W - pad, y2: H - pad }));
  if (Number.isFinite(target)) svg.append(sv('line', { class: 'tc-target', x1: pad, y1: y(target), x2: W - pad, y2: y(target) }));
  svg.append(sv('polyline', { class: 'tc-line', points: points.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.value)).toFixed(1)}`).join(' ') }));
  points.forEach((p, i) => { const c = sv('circle', { class: 'tc-pt', cx: x(i).toFixed(1), cy: y(Number(p.value)).toFixed(1), r: 3 }); const t = sv('title', {}); t.textContent = `${new Date(p.at).toLocaleDateString('pt-BR')}: ${num(p.value)}`; c.append(t); svg.append(c); });
  return svg;
}

function chartDialog(k) {
  const body = el('div', {}, note('Carregando…'));
  dialog(`Gráfico · ${k.name}`, body, { wide: true });
  guard(async () => {
    const r = await tapi(`/api/tvcorp/kpis/${k.id}`);
    const pts = (r.points || []).slice(-60);
    put(body, pts.length ? kpiChart(pts, Number(r.target)) : empty('Ainda sem histórico de valores.'), note(`Linha tracejada: a meta (${num(r.target)} ${r.unit || ''}). Guardamos os valores por 400 dias.`));
  })();
}
function valueDialog(k, reload) {
  const v = el('input', { type: 'text', inputmode: 'decimal', value: k.value ?? '' });
  dialog(`Valor · ${k.name}`, el('div', { class: 'pf-grid' }, f(`Valor agora${k.unit ? ` (${k.unit})` : ''}`, v), note(`Meta: ${num(k.target)} ${k.unit || ''}`)), {
    save: async () => { const n = toNum(v.value); if (!Number.isFinite(n)) throw new Error('Digite um número.'); await tapi(`/api/tvcorp/kpis/${k.id}/value`, { method: 'POST', body: { value: n } }); toast('Valor salvo. As telas mostram em até 1 minuto.'); await reload(); },
  });
}
function editKpi(k, reload) {
  const name = el('input', { type: 'text', maxlength: '60', value: k?.name || '', placeholder: 'Ex.: Produção do mês' });
  const unit = el('input', { type: 'text', maxlength: '12', value: k?.unit || '', placeholder: '%, R$, un, pontos' });
  const value = el('input', { type: 'text', inputmode: 'decimal', value: k?.value ?? '' });
  const target = el('input', { type: 'text', inputmode: 'decimal', value: k?.target ?? '' });
  const dir = el('select', {}, opt('up', 'Quanto maior, melhor', (k?.direction || 'up') === 'up'), opt('down', 'Quanto menor, melhor (refugo, acidentes)', k?.direction === 'down'));
  const office = el('select', {}, opt('', 'Empresa toda', k?.officeId == null), ...D().offices.map((o) => opt(o.id, o.name, k?.officeId === o.id)));
  const bands = k?.bands || [];
  const okFrom = el('input', { type: 'text', inputmode: 'decimal', value: bands.find((b) => b.band === 'ok')?.from ?? '', placeholder: 'automático: 100' });
  const warnFrom = el('input', { type: 'text', inputmode: 'decimal', value: bands.find((b) => b.band === 'warn')?.from ?? '', placeholder: 'automático: 80' });
  const source = el('select', {}, ...KPI_SOURCES.map((s) => opt(s.key, s.label, (k?.source || 'manual') === s.key)));
  const url = el('input', { type: 'url', maxlength: '500', value: k?.sourceCfg?.url || '', placeholder: 'https://…' });
  const path = el('input', { type: 'text', maxlength: '80', value: k?.sourceCfg?.cell || k?.sourceCfg?.path || '', placeholder: 'B2 (planilha) ou dados.total (JSON)' });
  const refresh = el('input', { type: 'number', min: String(LIMITS.feedRefreshMin), max: String(LIMITS.feedRefreshMax), value: String(k?.refreshMin ?? 60) });
  const srcBox = el('div', { class: 'pf-grid' });
  const pv = el('div', {});
  const paintSrc = () => {
    const s = source.value;
    put(srcBox, s === 'csv' || s === 'json' ? [f('Endereço (https)', url, s === 'csv' ? 'A planilha publicada na internet como CSV.' : 'Um endereço que devolve JSON.'), f(s === 'csv' ? 'Célula' : 'Caminho do valor', path), f('Buscar a cada (minutos)', refresh)]
      : s === 'api' ? note('O sistema da empresa (ERP, BI, produção) manda o valor pela chave de integração: POST /api/tvcorp-api/kpis/<número do indicador>/value com { "value": 82 }. A chave se gera em Unidades e grupos → Usuários e link.')
        : f('Valor agora', value));
  };
  const paintPv = () => { const draft = { value: toNum(source.value === 'manual' ? value.value : k?.value), target: toNum(target.value), direction: dir.value, bands: [toNum(okFrom.value) != null ? { band: 'ok', from: toNum(okFrom.value) } : null, toNum(warnFrom.value) != null ? { band: 'warn', from: toNum(warnFrom.value) } : null, toNum(okFrom.value) != null || toNum(warnFrom.value) != null ? { band: 'bad', from: 0 } : null].filter(Boolean) }; put(pv, itemPreview({ kind: 'kpi', name: name.value || 'Indicador', value: draft.value, target: draft.target, unit: unit.value, band: kpiBand(draft), direction: dir.value }, { theme: themeOf() })); };
  source.addEventListener('change', paintSrc);
  for (const n of [name, unit, value, target, dir]) n.addEventListener('input', paintPv);
  paintSrc(); paintPv();
  dialog(k ? `Indicador · ${k.name}` : 'Novo indicador', el('div', { class: 'tc-two' },
    el('div', { class: 'pf-grid' }, f('Nome', name), el('div', { class: 'pf-grid two' }, f('Unidade de medida', unit), f('Meta', target)), f('Sentido', dir), f('De quem é', office),
      el('div', { class: 'pf-grid two' }, f('Verde a partir de (% da meta)', okFrom), f('Amarelo a partir de (% da meta)', warnFrom)), note('Abaixo do amarelo: vermelho. Em branco: verde na meta, amarelo a partir de 80% dela (no "menor é melhor", verde até a meta).'),
      f('De onde vem o valor', source), srcBox),
    el('div', {}, el('div', { class: 'label', text: 'Como aparece na TV' }), pv, note('Nunca um dado de uma pessoa: compare equipes, turnos ou unidades.', 'pf-note'))), {
    wide: true,
    save: async () => {
      if (!name.value.trim()) throw new Error('Dê um nome ao indicador.');
      const s = source.value;
      if ((s === 'csv' || s === 'json') && !/^https:\/\//.test(url.value.trim())) throw new Error('O endereço precisa começar com https://');
      const bandsOut = [toNum(okFrom.value) != null ? { band: 'ok', from: toNum(okFrom.value) } : null, toNum(warnFrom.value) != null ? { band: 'warn', from: toNum(warnFrom.value) } : null].filter(Boolean);
      if (bandsOut.length) bandsOut.push({ band: 'bad', from: 0 });
      const body = { name: name.value.trim(), unit: unit.value.trim(), target: toNum(target.value), direction: dir.value, bands: bandsOut, officeId: office.value ? Number(office.value) : null, source: s,
        sourceCfg: s === 'csv' ? { url: url.value.trim(), cell: path.value.trim() } : s === 'json' ? { url: url.value.trim(), path: path.value.trim() } : {}, refreshMin: Number(refresh.value) || 60,
        ...(s === 'manual' && toNum(value.value) != null ? { value: toNum(value.value) } : {}) };
      if (k) await tapi(`/api/tvcorp/kpis/${k.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/kpis', { method: 'POST', body });
      toast('Indicador salvo.'); await reload();
    },
  });
}

export default async function paintIndicadores(box, ctx) {
  const list = listOf(await tapi('/api/tvcorp/kpis'), 'kpis');
  const again = () => paintIndicadores(box, ctx);
  const rows = list.map((k) => { const b = kpiBand(k); return el('tr', {},
    el('td', {}, el('b', { text: k.name }), el('div', { class: 'dim small', text: k.officeId == null ? 'Empresa toda' : D().offices.find((o) => o.id === k.officeId)?.name || '' })),
    el('td', {}, el('b', { text: `${num(k.value)} ${k.unit || ''}` }), el('div', { class: 'dim small', text: `meta ${num(k.target)} ${k.unit || ''}${k.direction === 'down' ? ' (menor é melhor)' : ''}` })),
    el('td', {}, chip(BAND_LABEL[b], `tc-band b-${b}`)),
    el('td', { text: KPI_SOURCES.find((s) => s.key === k.source)?.label.split(' (')[0] || k.source }),
    el('td', {}, k.updatedAt ? ago(now() - k.updatedAt) : '—', k.lastError ? el('div', { class: 'pf-err small', text: k.lastError }) : null),
    el('td', { class: 'pf-actions' }, k.source === 'manual' ? btn('Valor', () => valueDialog(k, again), 'small primary') : null, btn('Gráfico', () => chartDialog(k), 'small'), btn('Editar', () => editKpi(k, again), 'small'),
      btn('Apagar', guard(async () => { if (!confirm(`Apagar o indicador "${k.name}" e o histórico dele?`)) return; await tapi(`/api/tvcorp/kpis/${k.id}`, { method: 'DELETE' }); await again(); }), 'small danger'))); });
  put(box,
    note('Indicadores e metas para o chão de fábrica, a loja e o escritório: o número grande, a barra da meta e a cor pela faixa. Ponha o indicador numa playlist para ir às telas.'),
    el('p', { class: 'pf-note', role: 'note', text: 'Lei de proteção de dados: nunca mostre o resultado de uma pessoa. Ranking só por equipe, turno ou unidade.' }),
    btns(btn('+ Novo indicador', () => editKpi(null, again), 'primary'), el('span', { class: 'dim small', text: `${list.length} de ${LIMITS.kpis}` })),
    rows.length ? table(['Indicador', 'Valor', 'Faixa', 'Fonte', 'Atualizado', ''], rows) : empty('Nenhum indicador ainda.'),
    list.length ? note(`Última leitura: ${when(Math.max(...list.map((k) => k.updatedAt || 0)))}`) : null);
}
