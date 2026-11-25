// TV Corporativa · aba QR Codes (gerenciador): QR dinâmico (o destino muda sem trocar o código impresso ou na tela), para
// um link, uma mídia ou uma playlist (a mesma das telas, numa página para o celular), com as leituras por dia, as cores e a
// logomarca da empresa no meio, o download em SVG e PNG e a criação em massa. Rotas: /api/qrcodes (server/qrcodes.js).
import { el, guard, toast, tapi, tblob, put, f, opt, label, note, empty, btn, btns, dialog, listOf, when } from './tvcorp-base.js';
import { encodeQr } from '../../shared/qr.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); for (const k of kids) if (k) n.append(k); return n; };
let LOGO = undefined; // a logomarca da empresa (blob), buscada uma vez

/** O QR em SVG, com as cores (por atributo) e, se pedido, a logomarca no meio (com correção de erro alta para caber). */
export function qrDesenho(texto, { cor = '#000000', fundo = '#ffffff', logo = null } = {}) {
  let qr; try { qr = encodeQr(String(texto), { ecl: logo ? 'H' : 'M' }); } catch { return null; }
  const pad = 4; const side = qr.size + pad * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.get(x, y)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  const svg = sv('svg', { xmlns: NS, viewBox: `0 0 ${side} ${side}`, class: 'qr-svg', role: 'img', 'aria-label': 'QR code', 'shape-rendering': 'crispEdges' },
    sv('rect', { width: side, height: side, fill: fundo }), sv('path', { d, fill: cor }));
  if (logo) {
    const s = Math.round(qr.size * 0.22); const o = (side - s) / 2;
    svg.append(sv('rect', { x: o - 1, y: o - 1, width: s + 2, height: s + 2, fill: fundo, rx: 1 }), sv('image', { href: logo, x: o, y: o, width: s, height: s, preserveAspectRatio: 'xMidYMid meet' }));
  }
  return svg;
}

const baixar = (blob, nome) => { const a = el('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const nomeArquivo = (q) => `qr-${String(q.nome || q.codigo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}`;
function baixarSvg(q, svg) { baixar(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), `${nomeArquivo(q)}.svg`); }
function baixarPng(q, svg) {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 1024, 1024); c.toBlob((b) => b && baixar(b, `${nomeArquivo(q)}.png`), 'image/png'); };
  img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
}

/** As leituras dos últimos 30 dias em barras (SVG). */
function grafico(dias) {
  const mapa = new Map(dias.map((x) => [x.dia, x.n]));
  const lista = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - 3 * 3600_000 - i * 86400_000).toISOString().slice(0, 10); lista.push([d, mapa.get(d) || 0]); }
  const max = Math.max(1, ...lista.map(([, n]) => n));
  return sv('svg', { viewBox: '0 0 300 40', class: 'qr-graf', role: 'img', 'aria-label': `Leituras nos últimos 30 dias: ${lista.reduce((a, [, n]) => a + n, 0)}` },
    ...lista.map(([dia, n], i) => sv('rect', { x: i * 10 + 1, y: 40 - Math.max(1, (n / max) * 38), width: 8, height: Math.max(1, (n / max) * 38), rx: 1, fill: n ? '#2ec5d3' : '#24324a' }, sv('title', {}, document.createTextNode(`${dia.split('-').reverse().join('/')}: ${n}`)))));
}

async function fontes() {
  const [m, p] = await Promise.all([tapi('/api/tvcorp/media').catch(() => null), tapi('/api/tvcorp/playlists').catch(() => null)]);
  return { midias: listOf(m, 'media').filter((x) => x.status === 'ok'), playlists: listOf(p, 'playlists') };
}

/** Criar ou editar um QR: nome, destino (link, mídia ou playlist) e o estilo, com a prévia ao lado. */
async function editor(q, src, again) {
  const nome = el('input', { type: 'text', maxlength: '80', value: q?.nome || '', placeholder: 'Ex.: Cardápio da mesa, Promoção de Natal' });
  const tipo = el('select', {}, opt('link', 'Um link (site, WhatsApp, formulário, rede social)', (q?.tipo || 'link') === 'link'), opt('midia', 'Uma mídia da biblioteca (imagem, vídeo ou slide)', q?.tipo === 'midia'), opt('playlist', 'Uma playlist (as mídias dela, no celular)', q?.tipo === 'playlist'));
  const link = el('input', { type: 'url', value: q?.tipo === 'link' ? q.alvo : '', placeholder: 'https://…' });
  const midia = el('select', {}, ...src.midias.map((m) => opt(m.id, `${m.kind === 'video' ? 'Vídeo' : m.kind === 'slide' ? 'Slide' : 'Imagem'}: ${m.title}`, q?.tipo === 'midia' && String(q.alvo) === String(m.id))));
  const playlist = el('select', {}, ...src.playlists.map((p) => opt(p.id, p.name, q?.tipo === 'playlist' && String(q.alvo) === String(p.id))));
  const cor = el('input', { type: 'color', value: q?.estilo?.cor || '#000000' }); const fundo = el('input', { type: 'color', value: q?.estilo?.fundo || '#ffffff' });
  const logo = el('input', { type: 'checkbox', checked: Boolean(q?.estilo?.logo) });
  const pv = el('div', { class: 'qr-pv' });
  const campoLink = f('Link', link); const campoMidia = f('Mídia', midia); const campoPl = f('Playlist', playlist);
  const paint = () => {
    campoLink.hidden = tipo.value !== 'link'; campoMidia.hidden = tipo.value !== 'midia'; campoPl.hidden = tipo.value !== 'playlist';
    put(pv, qrDesenho(q?.link || `${location.origin}/q/exemplo`, { cor: cor.value, fundo: fundo.value, logo: logo.checked ? LOGO : null }), note(q ? 'O código não muda quando você troca o destino.' : 'O endereço curto é criado ao salvar.'));
  };
  for (const n of [tipo, cor, fundo, logo]) n.addEventListener('input', paint);
  tipo.addEventListener('change', paint);
  paint();
  dialog(q ? `QR code · ${q.nome}` : 'Novo QR code', el('div', { class: 'tc-two' },
    el('div', { class: 'pf-grid' }, f('Nome (só no painel)', nome), f('Ao ler, abre', tipo), campoLink, campoMidia, campoPl,
      el('div', { class: 'pf-grid two' }, f('Cor do código', cor), f('Cor do fundo', fundo)),
      el('label', { class: 'pf-check' }, logo, el('span', { text: LOGO ? 'Logomarca da empresa no meio' : 'Logomarca no meio (envie a logo em Configurações)' })),
      note('Contraste: código escuro em fundo claro lê melhor. A logo usa a correção de erro alta do QR, que continua lendo.')),
    el('div', {}, label('Prévia'), pv)), {
    save: async () => {
      const alvo = tipo.value === 'link' ? link.value.trim() : tipo.value === 'midia' ? midia.value : playlist.value;
      const body = { nome: nome.value.trim(), tipo: tipo.value, alvo, estilo: { cor: cor.value, fundo: fundo.value, logo: logo.checked } };
      if (q) await tapi(`/api/qrcodes/${q.id}`, { method: 'PATCH', body }); else await tapi('/api/qrcodes', { method: 'POST', body });
      toast(q ? 'QR code salvo. O código impresso continua valendo.' : 'QR code criado.'); await again();
    },
  });
}

function emMassa(again) {
  const area = el('textarea', { rows: '10', placeholder: 'Um por linha: nome ; link\nMesa 1 ; https://exemplo.com.br/cardapio?mesa=1\nMesa 2 ; https://exemplo.com.br/cardapio?mesa=2' });
  dialog('QR codes em massa', el('div', { class: 'pf-grid' }, f('Lista (até 200 por vez)', area), note('Cada linha vira um QR dinâmico com o seu link. Depois, baixe a lista em CSV com os endereços curtos ou cada QR em SVG/PNG.')), {
    save: async () => {
      const itens = area.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, ...r] = l.split(';'); return { nome: n.trim(), alvo: r.join(';').trim() }; });
      const r = await tapi('/api/qrcodes/lote', { method: 'POST', body: { itens } });
      toast(`${r.criados} QR code(s) criado(s).${r.erros.length ? ` ${r.erros.length} com erro: ${r.erros.slice(0, 2).join(' · ')}` : ''}`, Boolean(r.erros.length));
      await again();
    },
  });
}

export default async function paintQrcodes(box) {
  const r = await tapi('/api/qrcodes');
  const lista = listOf(r, 'qrcodes');
  const again = () => paintQrcodes(box);
  if (LOGO === undefined) LOGO = await tblob('/api/tvcorp/settings/logo').catch(() => null);
  let src = null; const fontesUma = async () => (src ||= await fontes());
  const csv = () => baixar(new Blob([`﻿nome;endereco;leituras\n${lista.map((q) => `${String(q.nome).replace(/;/g, ',')};${q.link};${q.leituras}`).join('\n')}`], { type: 'text/csv' }), 'qr-codes.csv');
  const cards = lista.map((q) => {
    const svg = qrDesenho(q.link, { cor: q.estilo.cor, fundo: q.estilo.fundo, logo: q.estilo.logo ? LOGO : null });
    const destino = q.tipo === 'link' ? q.alvo : q.tipo === 'midia' ? 'Uma mídia da biblioteca' : 'Uma playlist';
    return el('div', { class: `card qr-card${q.ativo ? '' : ' off'}` },
      el('div', { class: 'qr-img' }, svg),
      el('div', { class: 'qr-b' },
        el('b', { text: q.nome }),
        el('div', { class: 'small' }, el('code', { text: q.link }), ' ', btn('Copiar', () => navigator.clipboard?.writeText(q.link).then(() => toast('Copiado.'), () => {}), 'small')),
        el('div', { class: 'dim small', text: `Abre: ${destino}` }),
        el('div', { class: 'small', text: `${q.leituras} leitura(s)${q.ultimaLeitura ? ` · a última ${when(q.ultimaLeitura)}` : ''}${q.ativo ? '' : ' · desligado'}` }),
        grafico(q.dias),
        btns(btn('Editar', guard(async () => editor(q, await fontesUma(), again)), 'small'), btn('SVG', () => baixarSvg(q, svg), 'small'), btn('PNG', () => baixarPng(q, svg), 'small'),
          btn(q.ativo ? 'Desligar' : 'Ligar', guard(async () => { await tapi(`/api/qrcodes/${q.id}`, { method: 'PATCH', body: { ativo: !q.ativo } }); await again(); }), 'small'),
          btn('Apagar', guard(async () => { if (!confirm(`Apagar "${q.nome}"? Quem ler o código impresso vai ver "QR code não encontrado".`)) return; await tapi(`/api/qrcodes/${q.id}`, { method: 'DELETE' }); await again(); }), 'small danger'))));
  });
  const total = lista.reduce((a, q) => a + q.leituras, 0);
  put(box,
    note('Um conteúdo, dois canais: o QR dinâmico abre um link, uma mídia ou uma playlist das suas telas no celular de quem lê. O destino muda sem trocar o código impresso ou na tela, e cada leitura é contada (sem guardar quem leu). Use o endereço curto numa zona "QR code" do layout ou num slide.'),
    btns(btn('+ Novo QR code', guard(async () => editor(null, await fontesUma(), again)), 'primary'), btn('Em massa', () => emMassa(again)), lista.length ? btn('Baixar lista (CSV)', csv) : null,
      el('span', { class: 'dim small', text: `${lista.length} de ${r?.max || 500} · ${total} leitura(s) no total` })),
    lista.length ? el('div', { class: 'qr-grid' }, ...cards) : empty('Nenhum QR code ainda. Crie o primeiro: um cardápio, uma promoção, o WhatsApp da loja ou uma playlist.'));
}
