// Prefeitura (modo órgão público, docs/PREFEITURA.md): o que fica fora do módulo das telas (server/telas.js).
// O município da prefeitura é travado no primeiro cadastro pelo próprio painel (PUT /api/prefeitura/municipio). Trocar ou
// tirar é de quem está acima dela:
//   plataforma  GET, PUT e DELETE /api/platform/tenants/:id/telas-municipio   (qualquer conta: revenda ou cliente final)
//   revenda     GET, PUT e DELETE /api/revenda/clientes/:id/telas-municipio   (só os clientes finais dela)
import express from 'express';
import * as T from './tenancy.js';
import { contaOf, ehDaRevenda } from './contas.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const noStore = (res) => res.set('Cache-Control', 'no-store');

export function mountMunicipio(app, { telas, needs, needsPlatform, ah }) {
  const tenantOf = async (req) => {
    const id = Number(req.params.id);
    const t = Number.isInteger(id) && id > 0 ? await T.getTenant(id) : null;
    if (!t) throw fail(404, 'Conta inexistente.');
    return t;
  };
  /** As três rotas (ver, trocar, tirar) sobre a conta que pick(req) devolve; g: as guardas de ver e de mudar; who: quem trocou. */
  const rotas = (r, base, g, pick, who) => {
    r.get(base, g.ver, ah(async (req, res) => {
      const t = await pick(req);
      noStore(res).json({ municipio: await telas.municipio.get(t.id) });
    }));
    r.put(base, g.mudar, ah(async (req, res) => {
      const t = await pick(req);
      const out = await telas.municipio.set(t.id, req.body || {}, who(req));
      res.locals.audit = `conta ${t.id} (${t.name}): município da prefeitura trocado para ${out.place.city}/${out.place.uf} (${out.ok ? 'contorno guardado' : 'contorno indisponível agora'})`;
      noStore(res).json({ municipio: out.municipio });
    }));
    r.delete(base, g.mudar, ah(async (req, res) => {
      const t = await pick(req);
      const cur = await telas.municipio.clear(t.id);
      if (cur) res.locals.audit = `conta ${t.id} (${t.name}): município da prefeitura removido (${cur.name}/${cur.uf}); o painel volta a pedir a escolha`;
      res.json({ ok: true });
    }));
  };

  // plataforma: a equipe do DIGITAL ISP (ver: platform.view; trocar e tirar: platform.tenants)
  const p = express.Router();
  rotas(p, '/tenants/:id/telas-municipio', { ver: needsPlatform('platform.view'), mudar: needsPlatform('platform.tenants') }, tenantOf, (req) => `Plataforma: ${req.user.username}`);
  app.use('/api/platform', p);

  // revenda: só sobre os clientes finais dela, com a permissão de administrar (a mesma das outras rotas de clientes)
  const soRevenda = ah(async (req, _res, next) => {
    if ((await contaOf(req.tenantId)).tipo !== 'revenda') throw fail(403, 'Esta área é da revenda.');
    next();
  });
  const doCliente = async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || !(await ehDaRevenda(req.tenantId, id))) throw fail(404, 'Cliente inexistente.');
    return T.getTenant(id);
  };
  const r = express.Router();
  const R = [needs('users.manage'), soRevenda];
  rotas(r, '/clientes/:id/telas-municipio', { ver: R, mudar: R }, doCliente, (req) => `Revenda: ${req.user.username}`);
  app.use('/api/revenda', r);
}
