// TV Corporativa · aba Configurações (docs/TV-CORPORATIVA.md §3.1 e §6): a logomarca (PNG com fundo transparente, até
// 512×512), as cores do tema, o fuso, a aprovação do que vem das unidades e do celular, o nome dos aniversariantes, as datas
// comemorativas, o PIN de saída padrão, o horário padrão de ligar e desligar e a imagem sem internet.
// Rotas: PUT /api/tvcorp/settings, GET/PUT/DELETE /api/tvcorp/settings/logo (a logomarca crua), PUT /api/tvcorp/rede/defaults,
// GET /api/tvcorp/rede/offline-image e GET/PUT/DELETE /api/tvcorp/rede/offline-image/default/0.
import { el, guard, toast, tapi, tupload, tblob, put, f, opt, label, note, btn, btns, D, T } from './tvcorp-base.js';
import { THEME_COLORS, THEME_MODES, LIMITS as TL } from '../../shared/telas-tipos.js';
import { DATE_LIST, DEFAULT_DATES, WEEK_SHORT, LIMITS } from './tvcorp-catalogo.js';
import { slidePreview } from '../../shared/tvcorp-previa.js';

const TZS = [['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, GO, DF, BA, NE)'], ['America/Manaus', 'Manaus (AM, RR, RO, MT, MS)'], ['America/Cuiaba', 'Cuiabá'], ['America/Belem', 'Belém (PA, AP)'],
  ['America/Fortaleza', 'Fortaleza'], ['America/Recife', 'Recife'], ['America/Rio_Branco', 'Rio Branco (AC)'], ['America/Noronha', 'Fernando de Noronha']];
const OFFLINE_URL = '/api/tvcorp/rede/offline-image/default/0';

export default async function paintConfig(box, ctx) {
  const d = D(); const s = d.settings || {}; const cfg = d.defaults?.config || {};
  const theme = { color: s.theme?.color || THEME_COLORS[0].hex, mode: s.theme?.mode || 'dark' };
  /* logomarca */
  const logoImg = el('img', { class: 'tc-logo', alt: 'Logomarca da empresa', hidden: true });
  if (s.logo) tblob('/api/tvcorp/settings/logo').then((u) => { if (u) { logoImg.src = u; logoImg.hidden = false; } }, () => {});
  const logoFile = el('input', { type: 'file', accept: 'image/png', hidden: true, 'aria-label': 'Escolher a logomarca' });
  logoFile.addEventListener('change', guard(async () => {
    const fl = logoFile.files?.[0]; if (!fl) return;
    if (fl.type !== 'image/png') { logoFile.value = ''; throw new Error('Envie a logomarca em PNG (com fundo transparente).'); }
    if (fl.size > LIMITS.logoBytes) { logoFile.value = ''; throw new Error('A logomarca passa de 5 MB.'); }
    await tupload('/api/tvcorp/settings/logo', fl, { method: 'PUT', type: 'image/png' });
    toast('Logomarca enviada. Aparece nas zonas "Logomarca" em até 1 minuto.'); await ctx.reload();
  }));
  /* tema */
  const pv = el('div', { class: 'tc-theme-pv' });
  const color = el('select', {}, ...THEME_COLORS.map((c) => opt(c.hex, c.label, theme.color === c.hex)));
  const mode = el('select', {}, ...THEME_MODES.map((m) => opt(m.key, m.label, theme.mode === m.key)));
  const paintPv = () => put(pv, slidePreview('comunicado', { title: 'Comunicado de exemplo', text: 'Assim ficam os slides e os blocos com as cores da empresa.' }, { theme: { color: color.value, mode: mode.value } }));
  color.addEventListener('change', paintPv); mode.addEventListener('change', paintPv); paintPv();
  const tz = el('select', {}, ...TZS.map(([k, t]) => opt(k, t, (s.tz || 'America/Sao_Paulo') === k)));
  const approval = el('input', { type: 'checkbox', checked: Boolean(s.approval) });
  const fullNames = el('input', { type: 'checkbox', checked: Boolean(s.fullNames) });
  const dates = new Set(s.dates?.length ? s.dates : DEFAULT_DATES);
  const dateBox = el('div', { class: 'pf-checks tall' }, ...DATE_LIST.map(([k, t]) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: dates.has(k), onchange: (e) => { if (e.target.checked) dates.add(k); else dates.delete(k); } }), el('span', { text: t }))));
  const saveSettings = guard(async () => {
    await tapi('/api/tvcorp/settings', { method: 'PUT', body: { theme: { color: color.value, mode: mode.value }, tz: tz.value, approval: approval.checked, fullNames: fullNames.checked, dates: [...dates] } });
    toast('Configurações salvas. As telas trocam em até 1 minuto.'); await ctx.reload();
  });
  /* rede: PIN e horário padrão */
  const pin = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: String(TL.pinMax), placeholder: cfg.hasPin ? 'PIN definido (digite para trocar)' : `${TL.pinMin} a ${TL.pinMax} dígitos` });
  const sch = cfg.schedule;
  const on = el('input', { type: 'time', value: sch?.tvOn || '' }); const offT = el('input', { type: 'time', value: sch?.tvOff || '' });
  const days = new Set(sch ? sch.days : [1, 2, 3, 4, 5]);
  const saveRede = guard(async () => {
    const config = { schedule: on.value && offT.value ? { tvOn: on.value, tvOff: offT.value, days: [...days] } : null };
    if (pin.value) { if (!/^\d+$/.test(pin.value) || pin.value.length < TL.pinMin || pin.value.length > TL.pinMax) throw new Error(`O PIN tem de ${TL.pinMin} a ${TL.pinMax} números.`); config.pin = pin.value; }
    await tapi('/api/tvcorp/rede/defaults', { method: 'PUT', body: { config } });
    pin.value = ''; toast('Padrão das telas salvo.'); await ctx.reload();
  });
  /* imagem sem internet */
  const offImg = el('img', { class: 'pf-offimg-pic', alt: 'Imagem que as telas mostram sem internet', hidden: true });
  const offNote = note('');
  const offFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Escolher a imagem sem internet' });
  let offCur = null;
  try { const r = await tapi('/api/tvcorp/rede/offline-image'); offCur = (r.images || []).find((x) => x.scope === 'default') || null; } catch { /* sem a rota */ }
  offNote.textContent = offCur ? `Imagem de ${new Date(offCur.createdAt).toLocaleString('pt-BR')}.` : 'Sem imagem: sem vídeo guardado, a tela fica preta quando a internet cai.';
  if (offCur && !T.demo) tblob(OFFLINE_URL).then((u) => { if (u) { offImg.src = u; offImg.hidden = false; } }, () => {});
  offFile.addEventListener('change', guard(async () => {
    const fl = offFile.files?.[0]; if (!fl) return;
    if (fl.size > LIMITS.imageBytes) { offFile.value = ''; throw new Error('A imagem passa de 15 MB.'); }
    await tupload(OFFLINE_URL, fl, { method: 'PUT' }); toast('Imagem enviada. As telas baixam e guardam em até 1 minuto.'); await paintConfig(box, ctx);
  }));
  put(box,
    el('div', { class: 'card tc-sec' }, el('h3', { text: 'Marca da empresa' }),
      el('div', { class: 'tc-two' },
        el('div', { class: 'pf-grid' },
          el('div', {}, label('Logomarca'), logoImg, note(s.logo ? 'Logomarca enviada.' : 'Sem logomarca ainda. PNG com fundo transparente, até 512×512.'), logoFile,
            btns(btn(s.logo ? 'Trocar a logomarca' : 'Enviar a logomarca', () => logoFile.click()), s.logo ? btn('Tirar', guard(async () => { await tapi('/api/tvcorp/settings/logo', { method: 'DELETE' }); toast('Logomarca removida.'); await ctx.reload(); }), 'danger') : null)),
          el('div', { class: 'pf-grid two' }, f('Cor', color), f('Claro ou escuro', mode)), f('Fuso horário', tz, 'Vale para a grade, o relógio e a virada do dia nas telas.')),
        el('div', {}, label('Como fica'), pv))),
    el('div', { class: 'card tc-sec' }, el('h3', { text: 'Publicação' }),
      el('label', { class: 'pf-check' }, approval, el('span', { text: 'Aprovação ligada: o que vem do link das unidades e do celular espera na aba Aprovações' })),
      note('O que é feito neste painel vale na hora, com ou sem aprovação.'),
      el('label', { class: 'pf-check' }, fullNames, el('span', { text: 'Aniversariantes com o nome completo (desligado: primeiro nome e a inicial do sobrenome)' })),
      label('Datas comemorativas que a TV lembra sozinha'), dateBox,
      btns(btn('Salvar', saveSettings, 'primary'))),
    el('div', { class: 'card tc-sec' }, el('h3', { text: 'Padrão das TV box' }),
      f('PIN de saída padrão', pin, 'O PIN destrava o aparelho no local. Só o resumo cifrado fica guardado. Cada unidade pode ter o seu (Unidades e grupos → PIN novo).'),
      label('Horário de ligar e desligar a TV (vazio: sempre ligada)'),
      el('div', { class: 'pf-grid two' }, f('Ligar às', on), f('Desligar às', offT)),
      el('div', { class: 'pf-checks row' }, ...[1, 2, 3, 4, 5, 6, 0].map((n) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); } }), el('span', { text: WEEK_SHORT[n] })))),
      btns(btn('Salvar o padrão das TV box', saveRede, 'primary'))),
    el('div', { class: 'card tc-sec pf-offimg' }, el('h3', { text: 'Imagem sem internet' }),
      note('Quando a internet cai e não há vídeo guardado, a tela mostra esta imagem em vez de ficar preta. Os slides e imagens da grade também ficam guardados no aparelho.'),
      offImg, offNote, offFile,
      btns(btn(offCur ? 'Trocar a imagem' : 'Enviar imagem', () => offFile.click()), offCur ? btn('Remover', guard(async () => { if (!confirm('Remover a imagem sem internet?')) return; await tapi(OFFLINE_URL, { method: 'DELETE' }); toast('Imagem removida.'); await paintConfig(box, ctx); }), 'danger') : null)),
    el('div', { class: 'card tc-sec' }, el('h3', { text: 'Integração por API' }),
      note('Sistemas da empresa (RH, ERP, BI, produção) publicam pela chave de integração de cada unidade (Unidades e grupos → Usuários e link): POST /api/tvcorp-api/posts (comunicado), POST /api/tvcorp-api/kpis/<número>/value (valor de indicador) e POST /api/tvcorp-api/media/image (imagem, por exemplo o painel de BI exportado). Precisa do Acesso por API no plano.')));
}
