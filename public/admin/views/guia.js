// Configuração guiada (primeiros passos): os passos em ordem, o obrigatório trava os seguintes, e o que já existe no banco
// marca o passo como feito (server/guia.js). Na revenda, o passo 1 (dados cadastrais) é preenchido aqui mesmo; os outros
// levam à aba certa do painel, e a faixa do topo (main.js) traz de volta para o próximo passo.
import { el, api, toast, guard } from '../lib.js';
import { ufCityPicker } from '../../shared/uf-city.js';
import { ligarCep } from '../cep.js';

const fmtDoc = (d) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d || '');
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : p || ''; };
const field = (label, input, full = false) => el('label', { class: `rv-f${full ? ' full' : ''}` }, el('span', { text: label }), input);
const inp = (name, value = '', attrs = {}) => el('input', { name, value: value ?? '', ...attrs });

export const guiaUrl = (kind) => (kind === 'plataforma' ? '/api/platform/guia' : '/api/guia');

export async function paintGuia(root, kind, { onChange } = {}) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const g = await api(guiaUrl(kind));
  const pct = Math.round((g.feitos / Math.max(1, g.total)) * 100);
  const atual = g.steps.find((s) => s.obrigatorio && !s.feito) || null;
  const head = el('div', { class: 'card gd-head' },
    el('div', {}, el('h3', { text: g.completo ? 'Tudo pronto' : 'Configuração inicial' }),
      el('p', { class: 'dim', text: g.completo
        ? 'Os passos obrigatórios estão feitos. Os opcionais ficam aqui para quando quiser.'
        : `Siga os passos em ordem. Os obrigatórios liberam o seguinte. ${g.feitos} de ${g.total} feitos.` })),
    el('div', { class: 'gd-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progresso da configuração' },
      el('span', { style: `width:${pct}%` })));
  const list = el('ol', { class: 'gd-list' }, ...g.steps.map((s, i) => step(s, i, s === atual)));
  root.replaceChildren(head, list);

  function step(s, i, isAtual) {
    const estado = s.feito ? 'feito' : !s.liberado ? 'travado' : isAtual ? 'atual' : 'aberto';
    const tag = s.feito ? 'Feito' : !s.liberado ? 'Bloqueado' : s.obrigatorio ? 'Obrigatório' : 'Opcional';
    const li = el('li', { class: `gd-step ${estado}` },
      el('div', { class: 'gd-num', 'aria-hidden': 'true', text: s.feito ? '✓' : String(i + 1) }),
      el('div', { class: 'gd-body' },
        el('div', { class: 'gd-title' }, el('b', { text: s.titulo }), el('span', { class: `gd-tag ${estado}`, text: tag }),
          s.conta ? el('span', { class: 'dim small', text: ` · ${s.conta}` }) : null),
        el('p', { class: 'dim', text: s.texto }),
        !s.feito && s.falta?.length ? el('p', { class: 'gd-falta', text: `Falta: ${s.falta.join(', ')}.` }) : null,
        !s.liberado ? el('p', { class: 'dim small', text: 'Termine os passos obrigatórios anteriores para liberar este.' }) : null));
    const body = li.querySelector('.gd-body');
    if (s.liberado && s.id === 'dados' && kind === 'revenda' && (isAtual || !s.feito)) {
      body.append(dadosForm(async () => { await paintGuia(root, kind, { onChange }); onChange?.(); }));
    } else if (s.liberado && s.id === 'dados' && kind === 'revenda') {
      const box = el('div');
      body.append(el('button', { type: 'button', class: 'small', text: 'Revisar os dados', onclick: () => box.replaceChildren(dadosForm(async () => { await paintGuia(root, kind, { onChange }); onChange?.(); })) }), box);
    } else if (s.liberado && s.ir) {
      body.append(el('div', { class: 'gd-acts' }, el('a', { class: `btn${isAtual ? ' primary' : ''}`, href: s.ir, text: s.feito ? 'Ver' : isAtual ? 'Fazer agora' : 'Abrir' })));
    }
    return li;
  }
}

/** O passo 1 da revenda: os dados cadastrais completos. */
function dadosForm(done) {
  const f = el('form', { class: 'gd-form' }, el('p', { class: 'dim', text: 'Carregando os dados…' }));
  api('/api/minha-revenda').then((t) => {
    const a = t.address || {};
    const place = ufCityPicker({ uf: t.uf || '', cityIbge: t.municipioIbge ?? null, city: t.municipio || '', idPrefix: 'gd' });
    f.replaceChildren(
      el('div', { class: 'rv-grid2' },
        field('Razão social', inp('name', t.name, { disabled: true, title: 'Para mudar a razão social, fale com a DIGITAL ISP.' })),
        field('Nome fantasia', inp('fantasia', t.fantasia, { maxlength: 80 })),
        field('CNPJ *', inp('document', fmtDoc(t.document), { required: true, inputmode: 'numeric', placeholder: '00.000.000/0000-00' })),
        field('Responsável *', inp('contactName', t.contactName, { required: true, maxlength: 80 })),
        field('E-mail *', inp('contactEmail', t.contactEmail, { type: 'email', required: true })),
        field('Telefone', inp('phone', fmtPhone(t.phone), { inputmode: 'tel', placeholder: '(21) 3333-4444' })),
        field('WhatsApp', inp('whatsapp', fmtPhone(t.whatsapp), { inputmode: 'tel', placeholder: '(21) 99999-8888' })),
        field('Site', inp('site', t.site)),
        field('CEP', inp('zip', a.zip, { inputmode: 'numeric', maxlength: 9 })),
        field('Rua *', inp('street', a.street, { required: true, maxlength: 120 })),
        field('Número *', inp('number', a.number, { required: true, maxlength: 20 })),
        field('Complemento', inp('complement', a.complement, { maxlength: 60 })),
        field('Bairro', inp('district', a.district, { maxlength: 80 })),
        place.ufField, place.cityField),
      el('p', { class: 'dim small', text: '* obrigatório. Telefone ou WhatsApp: pelo menos um.' }),
      el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: 'Salvar e continuar' })));
    ligarCep({ cep: f.elements.zip, rua: f.elements.street, bairro: f.elements.district, numero: f.elements.number, place });
    f.onsubmit = guard(async (e) => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const v = Object.fromEntries(new FormData(f));
      const p = place.value();
      if (!p.uf || !p.cityIbge) { place.setCityError?.('Escolha o estado e o município da lista.'); return; }
      if (!v.phone && !v.whatsapp) { toast('Informe o telefone ou o WhatsApp.', true); return; }
      await api('/api/minha-revenda', { method: 'PUT', body: {
        fantasia: v.fantasia, document: v.document, contactName: v.contactName, contactEmail: v.contactEmail, phone: v.phone, whatsapp: v.whatsapp, site: v.site,
        address: { zip: v.zip, street: v.street, number: v.number, complement: v.complement, district: v.district, city: p.city || '', state: p.uf || '' },
        uf: p.uf, municipio: p.city, municipioIbge: p.cityIbge,
      } });
      toast('Dados salvos.');
      await done();
    });
  }).catch((err) => f.replaceChildren(el('p', { class: 'err', text: err.message })));
  return f;
}
