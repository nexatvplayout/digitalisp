// DIGITAL ISP · Integrações (superadmin, /api/platform/integracoes): de onde vêm os dados que as telas mostram e o estado
// de cada fonte, num lugar só. O clima tem fonte escolhida aqui (INMET sem chave, Open-Meteo comercial com chave cifrada
// no servidor: server/weather.js); as outras são fontes abertas fixas, com o botão de testar. Nenhuma chave volta ao navegador.
//
// GET  /api/platform/integracoes            o estado de todas
// PUT  /api/platform/integracoes/clima      { provider?, key?, keyFor? } (platform.settings)
// POST /api/platform/integracoes/:id/testar  testa a fonte agora (clima, cotacoes, cep, mapa, noticias, radios)
import express from 'express';
import { weatherConfig, setWeatherConfig, testWeather } from './weather.js';
import { safeFetch } from './web/net.js';
import { config } from './config.js';
import { RADIOS_FILE } from './radios.js';
import fs from 'node:fs';

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** As fontes fixas (abertas, sem chave) e o que cada uma alimenta. */
const FIXAS = [
  { id: 'cotacoes', nome: 'Cotações (dólar, euro, bitcoin)', fonte: 'AwesomeAPI e Banco Central (PTAX)', usa: 'Gadget e zona de cotações', chave: false,
    teste: { url: 'https://economia.awesomeapi.com.br/json/last/USD-BRL', ok: (j) => (j?.USDBRL?.bid ? `Dólar agora: R$ ${Number(j.USDBRL.bid).toFixed(2).replace('.', ',')}` : null) } },
  { id: 'noticias', nome: 'Notícias (agências públicas)', fonte: 'Agência Brasil, Agência Senado, Agência Câmara e gov.br (RSS)', usa: 'Notícias na playlist, na zona e na faixa', chave: false,
    teste: { url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', ok: (_j, t) => ((t.match(/<item>/g) || []).length ? `Agência Brasil respondeu: ${(t.match(/<item>/g) || []).length} notícias` : null), text: true } },
  { id: 'cep', nome: 'CEP', fonte: 'ViaCEP', usa: 'Endereço automático no cadastro de revendas, clientes e unidades', chave: false,
    teste: { url: 'https://viacep.com.br/ws/01001000/json/', ok: (j) => (j?.logradouro ? `01001-000: ${j.logradouro}, ${j.localidade}/${j.uf}` : null) } },
  { id: 'mapa', nome: 'Mapa e coordenadas', fonte: 'OpenStreetMap (Nominatim)', usa: 'Latitude e longitude das unidades e o mapa do Brasil', chave: false,
    teste: { url: 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Pra%C3%A7a+da+S%C3%A9,+S%C3%A3o+Paulo', ok: (j) => (Array.isArray(j) && j[0] ? `Praça da Sé: ${Number(j[0].lat).toFixed(4)}, ${Number(j[0].lon).toFixed(4)}` : null), headers: { 'user-agent': 'DIGITAL-ISP (+https://www.digitalisp.com.br)' } } },
  { id: 'radios', nome: 'Rádios do Brasil', fonte: 'Radio Browser (base aberta)', usa: 'Rádio de fundo dos layouts sem vídeo', chave: false },
  { id: 'agenda', nome: 'Agendas e planilhas', fonte: 'Endereço .ics (Google Agenda, Outlook) e planilha do Google, colados pelo cliente', usa: 'Gadget de agenda e cardápio/tabela de preços', chave: false },
];
/** O que ainda depende de contrato ou de conta do dono (aparece como "a contratar"). */
const PENDENTES = [
  { id: 'cobranca', nome: 'Boleto e Pix', usa: 'Cobrança automática das revendas e dos clientes finais', nota: 'Escolher o provedor (Asaas, Efí, Mercado Pago, banco) e criar a conta. Hoje a cobrança é marcada à mão ("por fora").' },
  { id: 'whatsapp', nome: 'WhatsApp', usa: 'Avisos de tela fora do ar e de cobrança', nota: 'Precisa de uma conta do WhatsApp Business (API oficial da Meta ou um provedor).' },
  { id: 'email', nome: 'E-mail', usa: 'Recuperar senha e avisos por e-mail', nota: 'Precisa de um serviço de envio (SMTP) com o domínio digitalisp.com.br.' },
];

function radiosInfo() {
  try { const j = JSON.parse(fs.readFileSync(RADIOS_FILE, 'utf8')); return { total: (j.stations || []).length, updatedAt: j.updatedAt || null }; } catch { return { total: 0, updatedAt: null }; }
}

export function mountIntegracoes(app, { needsPlatform }) {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));
  const V = needsPlatform('platform.view'); const S = needsPlatform('platform.settings');
  r.get('/', V, ah(async (_req, res) => {
    const rad = radiosInfo();
    res.set('Cache-Control', 'no-store').json({
      clima: await weatherConfig(),
      fixas: FIXAS.map(({ teste, ...f }) => ({ ...f, testavel: Boolean(teste) || f.id === 'radios', ...(f.id === 'radios' ? { info: `${rad.total} rádios${rad.updatedAt ? ` · lista de ${new Date(rad.updatedAt).toLocaleDateString('pt-BR')}` : ''}` } : {}) })),
      pendentes: PENDENTES,
      armazenamento: { driver: config.storage?.driver || 'local', nota: config.storage?.driver === 'r2' ? 'Cloudflare R2' : 'No disco do servidor (o R2 da Cloudflare entra quando o bucket for criado)' },
    });
  }));
  r.put('/clima', S, ah(async (req, res) => {
    const out = await setWeatherConfig(req.body || {});
    res.locals.audit = `integrações: clima ${out.providerChanged ? `→ ${out.provider}` : out.provider}${out.keyChange ? ` (chave ${out.keyChange === 'set' ? 'definida' : 'apagada'})` : ''}`;
    res.json({ ok: true, ...(await weatherConfig()) });
  }));
  r.post('/:id/testar', V, ah(async (req, res) => {
    const id = String(req.params.id);
    if (id === 'clima') return res.json(await testWeather());
    if (id === 'radios') { const x = radiosInfo(); return res.json({ ok: x.total > 0, message: x.total ? `${x.total} rádios na lista` : 'A lista de rádios não foi encontrada no servidor.' }); }
    const f = FIXAS.find((x) => x.id === id && x.teste);
    if (!f) return res.status(404).json({ error: 'Integração sem teste.' });
    const t0 = Date.now();
    try {
      const resp = await safeFetch(f.teste.url, { timeout: 8000, redirects: 3, maxBytes: 2 * 1024 * 1024, headers: { 'user-agent': 'DIGITAL-ISP (+https://www.digitalisp.com.br)', ...(f.teste.headers || {}) } });
      const text = resp.text();
      let j = null; if (!f.teste.text) { try { j = JSON.parse(text); } catch { /* não é JSON */ } }
      const msg = resp.status >= 200 && resp.status < 300 ? f.teste.ok(j, text) : null;
      res.json(msg ? { ok: true, message: msg, latencyMs: Date.now() - t0 } : { ok: false, message: `${f.fonte} respondeu ${resp.status} sem o dado esperado.`, latencyMs: Date.now() - t0 });
    } catch (e) { res.json({ ok: false, message: `${f.fonte} não respondeu (${String(e.message || e).slice(0, 100)}).`, latencyMs: Date.now() - t0 }); }
  }));
  app.use('/api/platform/integracoes', r);
}
