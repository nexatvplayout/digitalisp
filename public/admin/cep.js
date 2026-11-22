// O CEP preenche o endereço (rua, bairro, UF e município) em qualquer formulário do painel. GET /api/cep/:cep consulta o
// ViaCEP pelo servidor (server/enderecos.js). place = o seletor UF + município (public/shared/uf-city.js).
import { api, toast } from './lib.js';

export function ligarCep({ cep, rua, bairro, numero = null, place, onDone = null }) {
  const buscar = async () => {
    const d = cep.value.replace(/\D/g, '');
    if (d.length !== 8) return;
    cep.value = `${d.slice(0, 5)}-${d.slice(5)}`;
    try {
      const r = await api(`/api/cep/${d}`);
      if (r.rua && rua) rua.value = r.rua;
      if (r.bairro && bairro) bairro.value = r.bairro;
      if (r.uf && place) { place.ufSelect.value = r.uf; place.ufSelect.dispatchEvent(new Event('change', { bubbles: true })); }
      if (r.municipio && place) {
        await place.ready;
        place.cityInput.value = r.municipio;
        place.cityInput.dispatchEvent(new Event('input', { bubbles: true }));
        place.cityInput.dispatchEvent(new Event('blur'));
      }
      (numero || rua)?.focus();
      onDone?.(r);
    } catch (e) { toast(e.message, true); }
  };
  cep.setAttribute('inputmode', 'numeric');
  cep.setAttribute('autocomplete', 'postal-code');
  cep.addEventListener('change', buscar);
  cep.addEventListener('input', () => { if (cep.value.replace(/\D/g, '').length === 8) buscar(); });
}
