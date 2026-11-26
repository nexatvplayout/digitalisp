// TV Corporativa · aba Mídias (docs/TV-CORPORATIVA.md §2.2 e §6): a biblioteca de imagens e slides. Enviar imagem (botão
// ou arrastar e soltar: o servidor ajusta para 1920×1080 ou 1080×1920, sem os dados escondidos), criar slide a partir de
// um modelo com a prévia ao lado, aprovar ou devolver o que veio das unidades. Os vídeos ficam na biblioteca do canal.
// Rotas: GET/POST/PATCH/DELETE /api/tvcorp/media[/:id], POST /api/tvcorp/media/image (imagem crua), GET /media/:id/file.
// "Nova página": o construtor de páginas e avisos (tvcorp-pagina.js), que grava a página como imagem (com o desenho guardado).
import {
  el, guard, toast, tapi, tupload, tblob, put, f, opt, label, note, empty, btn, btns, chip, dialog, D, T,
  listOf, statusChip, when,
} from './tvcorp-base.js';
import { slidePreview } from '../../shared/tvcorp-previa.js';
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE, LIMITS, ARTS } from './tvcorp-catalogo.js';
import { pageBuilder } from './tvcorp-pagina.js';
import { PAGE_PRESETS } from '../../shared/pagina.js';

const V = { kind: '', status: '', office: '' };
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
// o vídeo próprio (comercial, institucional, treinamento): o servidor converte para MP4 que toda TV toca (server/tvcorp-video.js)
const VIDEO_ACCEPT = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo'];
const VIDEO_MAX = 500 * 1024 * 1024;
const isVideo = (file) => VIDEO_ACCEPT.includes(file.type) || /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file.name || '');
const mmss = (s) => `${Math.floor((Number(s) || 0) / 60)}:${String((Number(s) || 0) % 60).padStart(2, '0')}`;
export const themeOf = () => D()?.settings?.theme || { color: '#1d4ed8', mode: 'dark' };
const officeName = (id) => (id == null ? 'Empresa toda' : D().offices.find((o) => o.id === id)?.name || `unidade #${id}`);

/** Envia as imagens escolhidas (uma por vez) e devolve quantas entraram. */
async function sendImages(files, officeId) {
  let ok = 0;
  for (const file of files) {
    if (isVideo(file)) {
      if (file.size > VIDEO_MAX) { toast(`"${file.name}" passa de 500 MB.`, true); continue; }
      const vt = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, LIMITS.name);
      toast(`Enviando "${file.name}"… vídeo grande pode levar alguns minutos.`);
      await tupload(`/api/tvcorp/media/video?title=${encodeURIComponent(vt)}${officeId ? `&officeId=${officeId}` : ''}`, file, { type: file.type || 'application/octet-stream' });
      ok++;
      continue;
    }
    if (!ACCEPT.includes(file.type)) { toast(`"${file.name}": envie imagem (JPEG, PNG ou WebP) ou vídeo (MP4, MOV, WebM).`, true); continue; }
    if (file.size > LIMITS.imageBytes) { toast(`"${file.name}" passa de 15 MB.`, true); continue; }
    const title = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, LIMITS.name);
    await tupload(`/api/tvcorp/media/image?title=${encodeURIComponent(title)}${officeId ? `&officeId=${officeId}` : ''}`, file);
    ok++;
  }
  return ok;
}

/**
 * O editor do slide: o modelo, os campos dele, a arte de fundo, os segundos e a prévia ao lado (o mesmo desenho do app).
 * m: o slide que já existe (ou null). images: as imagens da biblioteca para os campos de imagem. onSaved(): depois de gravar.
 * template + fields + name: um slide novo já preenchido (a aba Templates: "Usar este template").
 */
export function slideEditor(m, images, onSaved, { template = null, fields = null, name = '' } = {}) {
  const st = { template: m?.template || template || 'comunicado', fields: { ...(m?.fields || fields || SLIDE_TEMPLATE[template || 'comunicado']?.sample || {}) } };
  if (st.fields.image && typeof st.fields.image === 'object') st.fields.image = st.fields.image.id ?? null;
  const title = el('input', { type: 'text', maxlength: String(LIMITS.name), value: m?.title || name || '', placeholder: 'Nome na biblioteca (só no painel)' });
  const seconds = el('input', { type: 'number', min: String(LIMITS.secondsMin), max: String(LIMITS.secondsMax), value: String(m?.seconds ?? 12) });
  const office = el('select', {}, opt('', 'Empresa toda', m?.officeId == null), ...D().offices.map((o) => opt(o.id, o.name, m?.officeId === o.id)));
  const tpl = el('select', {}, ...SLIDE_TEMPLATES.map((t) => opt(t.key, t.label, t.key === st.template)));
  const art = el('select', {}, opt('', 'Sem arte (a cor do tema)', !st.fields.art), ...ARTS.map((a) => opt(a.key, a.label, st.fields.art === a.key)));
  // a cor de destaque: vazio = a cor da empresa
  const accentOn = el('input', { type: 'checkbox', checked: Boolean(st.fields.accent) });
  const accent = el('input', { type: 'color', value: st.fields.accent || '#1d4ed8', 'aria-label': 'Cor de destaque' });
  const fieldsBox = el('div', { class: 'pf-grid' });
  const pv = el('div', { class: 'tc-slide-pv' });
  const imgUrls = new Map();
  const imageUrl = async (id) => { if (!id) return null; if (!imgUrls.has(id)) imgUrls.set(id, await tblob(`/api/tvcorp/media/${id}/file`).catch(() => null)); return imgUrls.get(id); };
  const repaint = async () => { const u = await imageUrl(st.fields.image); put(pv, slidePreview(st.template, { ...st.fields, art: art.value || undefined }, { theme: themeOf(), image: u })); };
  const paintFields = () => {
    const t = SLIDE_TEMPLATE[st.template];
    put(fieldsBox, ...t.fields.map((fd) => {
      let input;
      if (fd.kind === 'textarea') { input = el('textarea', { rows: '3', maxlength: String(fd.max) }); input.value = st.fields[fd.key] || ''; }
      else if (fd.kind === 'image') input = el('select', {}, opt('', images.length ? 'Sem imagem' : 'Nenhuma imagem na biblioteca ainda', !st.fields[fd.key]), ...images.map((i) => opt(i.id, i.title, Number(st.fields[fd.key]) === i.id)));
      // o formato não tem "o da empresa": sem ele, deitado
      else if (fd.kind === 'choice') input = el('select', {}, fd.key === 'orient' ? null : opt('', /Size$/.test(fd.key) ? 'Médio (padrão)' : 'O da empresa (Configurações)', !st.fields[fd.key]), ...(fd.options || []).map((o, i) => opt(o, fd.labels?.[i] || o, st.fields[fd.key] === o || (fd.key === 'orient' && !st.fields[fd.key] && o === 'land'))));
      else input = el('input', { type: { date: 'date', datetime: 'datetime-local', url: 'url' }[fd.kind] || 'text', maxlength: fd.max ? String(fd.max) : null, value: st.fields[fd.key] ?? '', placeholder: fd.kind === 'url' ? 'https://…' : null });
      const read = () => {
        if (fd.kind === 'image') st.fields[fd.key] = input.value ? Number(input.value) : null;
        else st.fields[fd.key] = input.value;
        guard(repaint)();
      };
      input.addEventListener('input', read); input.addEventListener('change', read);
      const hint = fd.kind === 'textarea' ? `Até ${fd.max} letras e ${LIMITS.slideLines} linhas.` : fd.kind === 'url' ? 'O QR code leva a este endereço (só https).' : fd.kind === 'datetime' ? 'Data e hora (a tela conta o tempo que falta).' : null;
      return f(`${fd.label}${fd.required ? ' *' : ''}`, input, hint);
    }));
  };
  tpl.addEventListener('change', () => { st.template = tpl.value; st.fields = { ...(SLIDE_TEMPLATE[st.template].sample || {}), art: st.fields.art }; paintFields(); guard(repaint)(); });
  art.addEventListener('change', () => guard(repaint)());
  paintFields(); guard(repaint)();
  dialog(m ? `Slide · ${m.title}` : 'Novo slide', el('div', { class: 'tc-two' },
    el('div', { class: 'pf-grid' }, f('Modelo', tpl), fieldsBox, f('Arte de fundo', art), el('label', { class: 'pf-check' }, accentOn, el('span', { text: 'Cor de destaque própria' }), accent), el('div', { class: 'pf-grid two' }, f('Segundos na tela', seconds), f('De quem é', office)), f('Nome na biblioteca', title)),
    el('div', {}, label('Como aparece na TV'), pv, note('A cor sai do tema da empresa (Configurações). O aplicativo desenha o slide na própria TV box: a letra fica nítida em qualquer tela. A arte de fundo aparece aqui na prévia; na TV box o fundo é a cor do tema.'))), {
    wide: true,
    save: async () => {
      const t = SLIDE_TEMPLATE[st.template];
      const fields = Object.fromEntries(t.fields.map((fd) => [fd.key, st.fields[fd.key]]).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
      if (art.value) fields.art = art.value;
      if (accentOn.checked) fields.accent = accent.value;
      const miss = t.fields.find((fd) => fd.required && (fields[fd.key] == null || fields[fd.key] === ''));
      if (miss) throw new Error(`Preencha: ${miss.label}.`);
      if (fields.qr && !/^https:\/\//.test(fields.qr)) throw new Error('O endereço do QR code precisa começar com https://');
      if (!fields.title && !fields.image) throw new Error('Escreva o título do slide.');
      const body = { kind: 'slide', title: title.value.trim() || fields.title || fields.caption || t.label, template: st.template, fields, seconds: Number(seconds.value) || 12, officeId: office.value ? Number(office.value) : null };
      if (m) await tapi(`/api/tvcorp/media/${m.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/media', { method: 'POST', body });
      toast(m ? 'Slide salvo. As telas trocam em segundos.' : 'Slide criado. Ponha-o numa playlist para ir às telas.');
      await onSaved?.();
    },
  });
}

function editVideo(m, onSaved) {
  const title = el('input', { type: 'text', maxlength: String(LIMITS.name), value: m.title || '' });
  const sound = el('input', { type: 'checkbox', checked: Boolean(m.fields?.sound) });
  dialog(`Vídeo · ${m.title}`, el('div', { class: 'pf-grid' }, f('Nome', title),
    el('label', { class: 'pf-check' }, sound, el('span', { text: 'Tocar o som do vídeo (o volume é o da tela)' })),
    note(`${m.width || '?'}×${m.height || '?'} · ${mmss(m.seconds)} · ${Math.round((m.bytes || 0) / 1048576)} MB · enviado ${when(m.createdAt)}${m.createdBy ? ` por ${m.createdBy}` : ''}. Na playlist ele toca inteiro.`)), {
    save: async () => { await tapi(`/api/tvcorp/media/${m.id}`, { method: 'PATCH', body: { title: title.value, sound: sound.checked } }); toast('Vídeo salvo.'); await onSaved(); },
  });
}
function editImage(m, onSaved) {
  const title = el('input', { type: 'text', maxlength: String(LIMITS.name), value: m.title || '' });
  const seconds = el('input', { type: 'number', min: String(LIMITS.secondsMin), max: String(LIMITS.secondsMax), value: String(m.seconds ?? 10) });
  dialog(`Imagem · ${m.title}`, el('div', { class: 'pf-grid' }, f('Nome', title), f('Segundos na tela (padrão nas playlists)', seconds),
    note(`${m.width || '?'}×${m.height || '?'} · ${Math.round((m.bytes || 0) / 1024)} KB · enviada ${when(m.createdAt)}${m.createdBy ? ` por ${m.createdBy}` : ''}`)), {
    save: async () => { await tapi(`/api/tvcorp/media/${m.id}`, { method: 'PATCH', body: { title: title.value, seconds: Number(seconds.value) || 10 } }); toast('Imagem salva.'); await onSaved(); },
  });
}
/** Aprovar ou devolver (com o motivo) o que veio das unidades e do celular. */
export const decideMedia = (m, ok, onSaved) => guard(async () => {
  let reason = '';
  if (!ok) { reason = prompt(`Devolver "${m.title}"? Escreva o motivo (quem enviou vê):`, ''); if (reason === null) return; }
  // a decisão é pela fila de aprovação (o pedido tvc-media desta mídia)
  const a = listOf(await tapi('/api/tvcorp/approvals'), 'approvals').find((x) => x.kind === 'tvc-media' && x.refId === m.id && x.status === 'pending');
  if (!a) throw new Error('O pedido desta mídia não está mais na fila de aprovação.');
  await tapi(`/api/tvcorp/approvals/${a.id}/decide`, { method: 'POST', body: { approve: ok, note: reason } });
  toast(ok ? 'Aprovado: entra nas playlists em que estiver.' : 'Devolvido.');
  await onSaved();
});

export default async function paintMidias(box, ctx) {
  const r = await tapi('/api/tvcorp/media');
  const all = listOf(r, 'media');
  const again = async () => { await paintMidias(box, ctx); ctx.refreshBadge(); };
  const images = all.filter((m) => m.kind === 'image' && m.status !== 'rejected');
  const shown = all.filter((m) => (!V.kind || m.kind === V.kind) && (!V.status || (m.status || 'ok') === V.status) && (!V.office || String(m.officeId ?? 'empresa') === V.office));
  const file = el('input', { type: 'file', accept: [...ACCEPT, ...VIDEO_ACCEPT, '.mp4', '.mov', '.webm', '.mkv', '.avi'].join(','), multiple: true, hidden: true, 'aria-label': 'Escolher imagens ou vídeos' });
  // vídeo sendo preparado: confere de novo em 15 s (só enquanto a aba está aberta)
  clearTimeout(paintMidias.again);
  if (all.some((m) => m.status === 'processing')) paintMidias.again = setTimeout(() => { if (box.isConnected) again(); }, 15000);
  const upOffice = el('select', { 'aria-label': 'De quem é a imagem' }, opt('', 'Empresa toda', true), ...D().offices.map((o) => opt(o.id, o.name)));
  const upload = guard(async (files) => { const n = await sendImages([...files], Number(upOffice.value) || null); if (n) { toast(`${n} arquivo(s) enviado(s). Vídeo leva um tempo para ficar pronto; depois ponha numa playlist.`); await again(); } });
  file.addEventListener('change', () => { const fl = file.files; if (fl?.length) upload(fl).finally(() => { file.value = ''; }); });
  const drop = el('div', { class: 'tc-drop', role: 'button', tabindex: '0', 'aria-label': 'Arraste as imagens para cá ou clique para escolher',
    onclick: () => file.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files); } },
  el('b', { text: 'Arraste imagens ou vídeos para cá' }), el('span', { class: 'dim small', text: 'ou clique para escolher. Imagem: JPEG, PNG ou WebP até 15 MB (o servidor ajusta para a tela e tira os dados escondidos). Vídeo: MP4, MOV ou WebM até 500 MB e 10 minutos (o servidor converte para um MP4 que toda TV toca).' }));
  const sel = (key, first, options) => el('select', { 'aria-label': first, onchange: (e) => { V[key] = e.target.value; ctx.repaint(); } }, opt('', first, !V[key]), ...options.map(([v, t]) => opt(v, t, V[key] === String(v))));
  const cards = shown.map((m) => {
    const thumb = el('div', { class: `tc-thumb${m.height > m.width ? ' port' : ''}` });
    if (m.kind === 'slide') {
      put(thumb, slidePreview(m.template, m.fields, { theme: themeOf() }));
      // o slide com foto (boas-vindas, reconhecimento…): a miniatura busca a imagem pela sessão e redesenha com ela
      if (m.fields?.image) tblob(`/api/tvcorp/media/${m.fields.image}/file`).then((u) => { if (u) put(thumb, slidePreview(m.template, m.fields, { theme: themeOf(), image: u })); }, () => {});
    }
    else if (m.kind === 'video') {
      const img = el('img', { alt: m.title || 'Vídeo', hidden: true });
      put(thumb, img, el('span', { class: 'tc-vbadge', text: m.status === 'processing' ? 'Preparando…' : m.status === 'error' ? 'Não converteu' : `▶ ${mmss(m.seconds)}` }));
      if (m.poster) tblob(m.poster).then((u) => { if (u) { img.src = u; img.hidden = false; } }, () => {});
    }
    else {
      const img = el('img', { alt: m.title || 'Imagem', hidden: true });
      put(thumb, img, el('span', { class: 'dim small', text: T.demo ? 'Imagem (exemplo)' : '' }));
      tblob(`/api/tvcorp/media/${m.id}/file`).then((u) => { if (u) { img.src = u; img.hidden = false; } }, () => {});
    }
    return el('div', { class: `tc-mcard${m.status === 'pending' ? ' pending' : ''}` }, thumb,
      el('div', { class: 'tc-mcard-b' },
        el('b', { text: m.title || '—' }),
        el('div', { class: 'dim small', text: m.kind === 'video' ? `Vídeo${m.width ? ` · ${m.width}×${m.height}` : ''} · ${mmss(m.seconds)}${m.fields?.sound ? ' · com som' : ' · sem som'} · ${officeName(m.officeId)}` : `${m.kind === 'slide' ? `Slide · ${SLIDE_TEMPLATE[m.template]?.label || m.template}` : `${m.fields?.page ? 'Página' : 'Imagem'}${m.width ? ` · ${m.width}×${m.height}` : ''}`} · ${m.seconds || 10} s · ${officeName(m.officeId)}` }),
        m.status === 'error' && m.fields?.error ? el('div', { class: 'small tc-err', text: m.fields.error }) : null,
        el('div', {}, statusChip(m.status), m.reason ? el('span', { class: 'dim small', text: ` ${m.reason}` }) : null),
        el('div', { class: 'pf-btns left' },
          m.status === 'pending' ? btn('Aprovar', decideMedia(m, true, again), 'small primary') : null,
          m.status === 'pending' ? btn('Devolver', decideMedia(m, false, again), 'small') : null,
          m.status === 'processing' ? null : btn('Editar', () => (m.kind === 'slide' ? slideEditor(m, images, again) : m.fields?.page ? pageBuilder(m, images, again) : m.kind === 'video' ? editVideo(m, again) : editImage(m, again)), 'small'),
          btn('Apagar', guard(async () => { if (!confirm(`Apagar "${m.title}"? Sai das playlists e das telas.`)) return; await tapi(`/api/tvcorp/media/${m.id}`, { method: 'DELETE' }); toast('Apagado.'); await again(); }), 'small danger'))));
  });
  put(box,
    note('A biblioteca: imagens, vídeos e slides que entram nas playlists. O vídeo da playlist toca inteiro na zona dela; o canal ao vivo continua na zona de vídeo do layout.'),
    el('div', { class: 'tc-two' }, drop,
      el('div', { class: 'pf-grid' }, f('As imagens enviadas são de', upOffice), btns(btn('+ Nova página', () => pageBuilder(null, images, again), 'primary'), btn('+ Novo slide', () => slideEditor(null, images, again))),
        note('Nova página: monte a tela ou o aviso do seu jeito (fundo de cor, degradê ou foto; texto com cor, negrito, itálico, fonte e tamanho; ícone, imagem, logomarca e QR).'),
        note('PDF ou apresentação: exporte as páginas como imagem no seu programa e envie as imagens.'))),
    file,
    el('div', { class: 'pf-bar' }, sel('kind', 'Imagens, vídeos e slides', [['image', 'Só imagens e páginas'], ['video', 'Só vídeos'], ['slide', 'Só slides']]), sel('status', 'Qualquer situação', [['ok', 'Publicados'], ['pending', 'Aguardando aprovação'], ['rejected', 'Devolvidos']]),
      sel('office', 'De todos', [['empresa', 'Empresa toda'], ...D().offices.map((o) => [o.id, o.name])]), el('span', { class: 'dim small', text: `${all.length} de ${r?.max || LIMITS.media}` })),
    label('Páginas e avisos prontos para editar'),
    el('div', { class: 'pf-btns left tc-pg-presets' }, ...PAGE_PRESETS.map((p) => btn(p.label, () => pageBuilder(null, images, again, { preset: p.key }), 'small'))),
    label('Modelos de slide'),
    el('div', { class: 'tc-tpls' }, ...SLIDE_TEMPLATES.map((t) => el('button', { class: 'tc-tpl', type: 'button', title: `Novo slide: ${t.label}`, onclick: () => slideEditor(null, images, again, { template: t.key }) },
      slidePreview(t.key, t.sample, { theme: themeOf() }), el('span', { text: t.label })))),
    label(`Na biblioteca (${shown.length})`),
    cards.length ? el('div', { class: 'tc-mgrid' }, ...cards) : empty(all.length ? 'Nada com esses filtros.' : 'A biblioteca está vazia. Envie uma imagem ou crie um slide a partir de um modelo.'));
}
