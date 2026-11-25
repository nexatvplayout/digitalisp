// O município da prefeitura (modo órgão público, docs/PREFEITURA.md). O Painel da Prefeitura define uma vez e ele fica
// travado; trocar ou tirar é de quem está acima: a revenda (no cadastro do cliente final) e a plataforma (no cadastro da
// revenda). base: /api/revenda/clientes/<id>/telas-municipio ou /api/platform/tenants/<id>/telas-municipio (server/prefeitura.js).
import { el, api, toast, guard } from '../lib.js';
import { ufCityPicker } from '../../shared/uf-city.js';

/** Devolve o cartão (fieldset) que se desenha sozinho com o município atual e os botões Trocar/Definir e Tirar. */
export function municipioCard(base, { idPrefix = 'pfm' } = {}) {
  const box = el('div', { class: 'rv-grid2' });
  const card = el('fieldset', { class: 'rv-sec' }, el('legend', { text: 'Município da prefeitura' }), box);
  const draw = guard(async () => {
    box.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
    const { municipio: m } = await api(base);
    box.replaceChildren(
      el('div', {},
        el('p', {}, m ? el('b', { text: `${m.name}/${m.uf}` }) : 'Ainda não definido.',
          m ? el('span', { class: 'dim small', text: ` · IBGE ${m.ibge} · contorno ${m.outline?.status === 'ok' ? 'guardado' : 'indisponível agora'}` }) : null),
        el('p', { class: 'dim small', text: 'A prefeitura escolhe o município uma vez, no Painel da Prefeitura, e ele fica travado. Trocar ou tirar é só por aqui. As repartições e as telas não mudam.' }),
        el('div', { class: 'rv-btns' },
          el('button', { type: 'button', class: 'small', text: m ? 'Trocar o município' : 'Definir o município', onclick: () => editar(m) }),
          m ? el('button', { type: 'button', class: 'small', text: 'Tirar', onclick: guard(async () => {
            if (!confirm(`Tirar ${m.name}/${m.uf}? O Painel da Prefeitura volta a pedir a escolha, e quem escolher trava de novo.`)) return;
            await api(base, { method: 'DELETE' });
            toast('Município removido.'); draw();
          }) }) : null)));
  });
  function editar(m) {
    const place = ufCityPicker({ uf: m?.uf || '', cityIbge: m?.ibge ?? null, city: m?.name || '', idPrefix });
    box.replaceChildren(place.ufField, place.cityField,
      el('div', { class: 'rv-btns' },
        el('button', { type: 'button', class: 'small primary', text: 'Salvar o município', onclick: guard(async () => {
          const v = place.value();
          if (!v.uf || !v.cityIbge) throw new Error('Escolha a UF e o município da lista.');
          const r = await api(base, { method: 'PUT', body: { uf: v.uf, ibge: v.cityIbge } });
          toast(`Município: ${r.municipio.name}/${r.municipio.uf}.`); draw();
        }) }),
        el('button', { type: 'button', class: 'small', text: 'Cancelar', onclick: () => draw() })));
  }
  draw();
  return card;
}
