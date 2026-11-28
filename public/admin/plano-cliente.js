// DIGITAL ISP · o que o PLANO DO CLIENTE FINAL desliga some do painel dele: a revenda escolhe os módulos de cada plano
// (Planos, no painel da revenda) e a conta do cliente recebe só o que o plano liga (server/contas.js planoDoCliente).
// Vale só para o cliente final (o plano "cliente-…"): a revenda e as contas diretas seguem como sempre.
// O servidor recusa as mesmas rotas (clienteRoutes em public/shared/funcionalidades.js).
import { state } from './lib.js';

/** A aba da TV Corporativa -> a função do catálogo que a libera. */
export const TAB_FEATURE = Object.freeze({
  templates: 'templates', aovivo: 'aoVivo', dados: 'dados', gadgets: 'dados', indicadores: 'indicadores', rh: 'rh',
  alertas: 'alertas', aprovacoes: 'aprovacao', celular: 'celular',
});

/** É o painel de um cliente final (o plano vem da revenda)? */
export const ehClienteFinal = () => String(state.me?.plan?.code || '').startsWith('cliente-');

/** A função está liberada para quem está logado? (fora do cliente final, sempre). */
export const liberado = (key) => !key || !ehClienteFinal() || state.me?.planFeatures?.[key] !== false;

/** A aba da TV Corporativa aparece? */
export const abaLiberada = (tabId) => liberado(TAB_FEATURE[tabId]);
