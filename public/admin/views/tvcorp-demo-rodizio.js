// DIGITAL ISP · o botão DEMONSTRAÇÃO da aba Telas (só nas contas com a demonstração ligada: /api/me demoLayouts).
// Ligado, as telas escolhidas (ou todas) trocam de layout sozinhas, na ordem da lista, a cada intervalo escolhido aqui.
// O servidor faz a troca (server/tvcorp-demo-rodizio.js): continua com o painel fechado. Rotas: GET/PUT /api/tvcorp/demo-rodizio.
import { el, guard, toast, tapi, put, f, opt, note, btn, btns, dialog, D } from './tvcorp-base.js';
import { DEMO_LAYOUTS, ehLayoutDemo } from '../../shared/tvcorp-demos.js';
import { usarDemo } from './tvcorp-demos.js';

const TEMPOS = [[10, '10 segundos'], [15, '15 segundos'], [20, '20 segundos'], [30, '30 segundos'], [45, '45 segundos'], [60, '1 minuto'], [120, '2 minutos'], [300, '5 minutos'], [600, '10 minutos'], [1800, '30 minutos'], [3600, '1 hora']];
const tempoTexto = (s) => TEMPOS.find(([v]) => v === s)?.[1] || (s % 60 ? `${s} segundos` : `${s / 60} minutos`);

/** O botão (com a situação: ligada ou não). */
export function botaoDemonstracao(ctx) {
  const b = btn('DEMONSTRAÇÃO', () => abrir(ctx, b), 'small');
  tapi('/api/tvcorp/demo-rodizio').then((r) => { if (r?.on) { b.textContent = `DEMONSTRAÇÃO · ligada (${tempoTexto(r.seconds)})`; b.classList.add('primary'); } }).catch(() => {});
  return b;
}

async function abrir(ctx, botao) {
  const atual = await tapi('/api/tvcorp/demo-rodizio');
  const d = D();
  // o intervalo
  const pre = TEMPOS.some(([v]) => v === atual.seconds);
  const outro = el('input', { type: 'number', min: '10', max: '3600', step: '1', value: String(atual.seconds), hidden: pre, 'aria-label': 'Intervalo em segundos' });
  const tempo = el('select', { onchange: () => { outro.hidden = tempo.value !== 'outro'; } },
    ...TEMPOS.map(([v, t]) => opt(v, t, pre && v === atual.seconds)), opt('outro', 'Outro (em segundos)', !pre));
  const segundos = () => Number(tempo.value === 'outro' ? outro.value : tempo.value);
  // as telas
  const telas = (d.devices || []).filter((x) => !x.revokedAt);
  const todas = el('input', { type: 'checkbox', checked: !atual.devices.length });
  const telaBox = el('div', { class: 'tc-demo-lista' });
  const marcaTela = new Map(telas.map((x) => [x.id, el('input', { type: 'checkbox', checked: atual.devices.includes(x.id) })]));
  const pintaTelas = () => { telaBox.hidden = todas.checked; };
  todas.addEventListener('change', pintaTelas);
  put(telaBox, ...telas.map((x) => el('label', { class: 'tc-demo-op' }, marcaTela.get(x.id), ` ${x.name}`)));
  pintaTelas();
  // os layouts, em dois grupos: os meus (os que a pessoa fez) e os de demonstração; na ordem da aba Layouts
  const layBox = el('div', {});
  const conta = note('', 'small');
  let marcados = new Set(atual.layoutIds.length ? atual.layoutIds : (d.layouts || []).map((l) => l.id));
  const pintaLayouts = () => {
    const ls = D().layouts || [];
    const caixa = (l) => el('label', { class: 'tc-demo-op' },
      el('input', { type: 'checkbox', checked: marcados.has(l.id), onchange: (e) => { if (e.target.checked) marcados.add(l.id); else marcados.delete(l.id); contar(); } }), ` ${l.name}`);
    const grupo = (titulo, lista, vazio) => {
      const so = (sim) => () => { for (const l of lista) { if (sim) marcados.add(l.id); else marcados.delete(l.id); } pintaLayouts(); };
      return el('div', { class: 'tc-demo-grupo' },
        el('div', { class: 'tc-demo-grupo-cab' }, `${titulo} (${lista.length})`,
          lista.length ? btn('Marcar estes', so(true), 'small') : null, lista.length ? btn('Desmarcar estes', so(false), 'small') : null),
        lista.length ? el('div', { class: 'tc-demo-lista' }, ...lista.map(caixa)) : note(vazio, 'small'));
    };
    put(layBox,
      grupo('Meus layouts', ls.filter((l) => !ehLayoutDemo(l)), 'Nenhum layout seu ainda: os que você fizer na aba Layouts aparecem aqui.'),
      grupo('Layouts de demonstração', ls.filter(ehLayoutDemo), 'Nenhum layout de demonstração nesta conta: use o botão abaixo para criar.'));
    contar();
  };
  const contar = () => {
    const n = (D().layouts || []).filter((l) => marcados.has(l.id)).length;
    conta.textContent = n ? `${n} layout(s) no rodízio: cada um fica ${tempoTexto(segundos())} na tela; a volta completa leva ${tempoTexto(n * segundos())}.` : 'Nenhum layout marcado.';
  };
  tempo.addEventListener('change', contar); outro.addEventListener('input', contar);
  pintaLayouts();
  // os de demonstração que ainda não existem nesta conta
  const faltam = () => { const nomes = new Set((D().layouts || []).map((l) => l.name)); return DEMO_LAYOUTS.filter((x) => !nomes.has(x.label)); };
  const progresso = note('', 'small');
  const criar = btn(`Criar os layouts de demonstração que faltam (${faltam().length})`, guard(async (e) => {
    const b = e?.currentTarget; const lista = faltam();
    if (!lista.length) { toast('Todos os layouts de demonstração já existem nesta conta.'); return; }
    if (!confirm(`Criar ${lista.length} layouts de demonstração (com as playlists e os slides de cada um)? Leva alguns minutos.`)) return;
    if (b) b.disabled = true;
    try {
      let i = 0;
      for (const x of lista) {
        i += 1; progresso.textContent = `Criando ${i} de ${lista.length}: ${x.label}…`;
        const l = await usarDemo(x); if (l?.id) marcados.add(l.id);
      }
      await ctx.reload?.();
      progresso.textContent = `Pronto: ${lista.length} layouts criados e marcados no rodízio.`;
      pintaLayouts();
    } finally { if (b) { b.disabled = false; b.textContent = `Criar os layouts de demonstração que faltam (${faltam().length})`; } }
  }), 'small');
  const marcarTodos = btn('Marcar todos', () => { marcados = new Set((D().layouts || []).map((l) => l.id)); pintaLayouts(); }, 'small');
  const desmarcar = btn('Desmarcar todos', () => { marcados = new Set(); pintaLayouts(); }, 'small');

  const corpo = el('div', { class: 'tc-demo-corpo' },
    note(atual.on ? `A demonstração está LIGADA: troca a cada ${tempoTexto(atual.seconds)}.` : 'Ligada, a tela troca de layout sozinha, na ordem da lista, a cada intervalo. Continua com o painel fechado. Ao desligar, cada tela volta ao que passava antes.'),
    f('Trocar de layout a cada', el('div', { class: 'tc-demo-tempo' }, tempo, outro)),
    f('Em quais telas', el('div', {}, el('label', { class: 'tc-demo-op' }, todas, ' Todas as telas'), telaBox)),
    f('Layouts do rodízio', el('div', {}, btns(marcarTodos, desmarcar), layBox, conta)),
    el('div', {}, btns(criar), progresso));
  const { close } = dialog('DEMONSTRAÇÃO: os layouts em rodízio', corpo, {
    saveLabel: atual.on ? 'Salvar e recomeçar' : 'Ligar a demonstração', wide: true,
    save: async () => {
      const s = segundos();
      if (!Number.isFinite(s) || s < 10 || s > 3600) { toast('O intervalo vai de 10 segundos a 1 hora.', true); return false; }
      const layoutIds = (D().layouts || []).filter((l) => marcados.has(l.id)).map((l) => l.id);
      if (layoutIds.length < 2) { toast('Marque pelo menos 2 layouts.', true); return false; }
      const devices = todas.checked ? [] : telas.filter((x) => marcaTela.get(x.id).checked).map((x) => x.id);
      if (!todas.checked && !devices.length) { toast('Escolha pelo menos uma tela (ou marque Todas as telas).', true); return false; }
      const r = await tapi('/api/tvcorp/demo-rodizio', { method: 'PUT', body: { on: true, seconds: s, layoutIds, devices } });
      toast(`Demonstração ligada: ${r.layoutIds.length} layouts, trocando a cada ${tempoTexto(r.seconds)} em ${r.devices.length ? `${r.devices.length} tela(s)` : 'todas as telas'}. A primeira troca chega em até 10 s.`);
      botao.textContent = `DEMONSTRAÇÃO · ligada (${tempoTexto(r.seconds)})`; botao.classList.add('primary');
      return true;
    },
  });
  if (atual.on) {
    corpo.append(btns(btn('Desligar a demonstração', guard(async () => {
      await tapi('/api/tvcorp/demo-rodizio', { method: 'PUT', body: { ...atual, on: false } });
      toast('Demonstração desligada: cada tela volta ao que passava antes (em até 10 s).');
      botao.textContent = 'DEMONSTRAÇÃO'; botao.classList.remove('primary');
      close();
    }), 'danger')));
  }
}
