// HTTP dos provedores de domínio (Cloudflare, Railway): fetch nativo + timeout + erros em português, sem vazar o token.
// SEM retentativa automática: quem chama decide (criar zona ou domínio duas vezes teria efeito colateral).

export const TIMEOUT_MS = 15000;

/** Remove segredos (tokens) de um texto antes de ele virar mensagem de erro ou log. */
export function scrub(text, secrets = []) {
  let t = String(text ?? '');
  for (const s of secrets) if (s && String(s).length >= 6) t = t.split(String(s)).join('***');
  return t;
}

/**
 * Chama a API e devolve o JSON (ou null). Em erro lança Error com:
 *   .status 502 (resposta de erro) ou 504 (tempo esgotado) — nunca repassa 401/403 do provedor ao navegador;
 *   .upstreamStatus (status real), .codes (códigos de erro do provedor), .provider.
 * @param {object} o
 * @param {string} o.provider   nome para as mensagens ("Cloudflare", "Railway")
 * @param {string} o.url
 * @param {string} [o.method]
 * @param {string} o.token      enviado como Bearer; nunca aparece em mensagens
 * @param {any}    [o.body]     objeto (vira JSON)
 * @param {(json:any)=>{message?:string, codes?:any[]}} [o.parseError]
 */
export async function requestJson({ provider, url, method = 'GET', token, body, parseError, headers = null, bearer = true, timeoutMs = TIMEOUT_MS }) {
  const secrets = [token];
  const where = (() => { try { return `${provider} (${method} ${new URL(url).pathname})`; } catch { return provider; } })();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(bearer ? { authorization: `Bearer ${token}` } : {}), accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    const err = new Error(timeout
      ? `Tempo esgotado (${Math.round(timeoutMs / 1000)} s) ao chamar ${where}.`
      : `Não foi possível conectar a ${where}: ${scrub(e?.cause?.code || e?.message, secrets)}`);
    Object.assign(err, { status: timeout ? 504 : 502, provider, network: true, codes: [] });
    throw err;
  }
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  if (!res.ok || json?.success === false) {
    let info = {};
    try { info = (parseError && parseError(json)) || {}; } catch { info = {}; }
    const msg = info.message || (json ? '' : text.slice(0, 200));
    const hint = res.status === 401 || res.status === 403 ? ' (confira o token e as permissões dele)' : '';
    const err = new Error(`${where} respondeu HTTP ${res.status}${msg ? `: ${scrub(msg, secrets)}` : ''}${hint}`);
    Object.assign(err, { status: 502, upstreamStatus: res.status, provider, codes: info.codes || [], body: json });
    throw err;
  }
  return json;
}
