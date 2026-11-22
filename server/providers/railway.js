// Railway Public API (GraphQL): domínios personalizados do serviço que serve a API, o site, o painel e os apps web.
// Documentação: https://docs.railway.com/integrations/api e https://docs.railway.com/integrations/api/manage-domains
// Variáveis: RAILWAY_API_TOKEN (token de conta/workspace -> Authorization: Bearer; token de PROJETO -> defina também
// RAILWAY_TOKEN_TYPE=project, que usa o cabeçalho Project-Access-Token), RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID,
// RAILWAY_SERVICE_ID; RAILWAY_API_BASE (só testes: servidor falso). Nada aqui foi testado contra o Railway real.
import { requestJson, scrub } from './http.js';

export const ENV = ['RAILWAY_API_TOKEN', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID'];
const conf = () => ({
  token: (process.env.RAILWAY_API_TOKEN || '').trim(),
  project: (process.env.RAILWAY_PROJECT_ID || '').trim(),
  environment: (process.env.RAILWAY_ENVIRONMENT_ID || '').trim(),
  service: (process.env.RAILWAY_SERVICE_ID || '').trim(),
  projectToken: String(process.env.RAILWAY_TOKEN_TYPE || '').trim().toLowerCase() === 'project',
  url: (process.env.RAILWAY_API_BASE || 'https://backboard.railway.com/graphql/v2').trim(),
});
export const missing = () => ENV.filter((k) => !(process.env[k] || '').trim());
export const configured = () => missing().length === 0;
export const tokenKind = () => (conf().projectToken ? 'project' : 'bearer');

/** Campos do status de um domínio personalizado. verificationDnsHost: NÃO CONFIRMADO na documentação oficial (relato no fórum do Railway). */
const STATUS_FIELDS = 'status { verificationToken verificationDnsHost certificateStatus dnsRecords { hostlabel fqdn zone recordType requiredValue currentValue status purpose } }';

/** POST GraphQL. Erros GraphQL (HTTP 200 com "errors") viram exceção em português, sem o token. */
async function gql(query, variables = {}) {
  const c = conf();
  if (!c.token) throw Object.assign(new Error('Railway não configurado: defina RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID e RAILWAY_SERVICE_ID.'), { status: 503 });
  const json = await requestJson({
    provider: 'Railway', url: c.url, method: 'POST', token: c.token, body: { query, variables },
    headers: c.projectToken ? { 'project-access-token': c.token } : null, bearer: !c.projectToken,
    parseError: (j) => ({ message: (j?.errors || []).map((e) => e.message).join('; ') || null }),
  });
  if (Array.isArray(json?.errors) && json.errors.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    const err = new Error(`Railway (GraphQL) respondeu com erro: ${scrub(msg, [c.token])}`);
    Object.assign(err, { status: 502, provider: 'Railway', codes: json.errors.map((e) => e.extensions?.code).filter(Boolean), notFound: /not found|não encontrad|does not exist/i.test(msg), exists: /already|in use|taken|já existe/i.test(msg) }); // textos das mensagens: NÃO CONFIRMADOS
    throw err;
  }
  return json?.data || {};
}

/** Cria o domínio personalizado no serviço. Devolve {id, domain, status:{verificationToken, verificationDnsHost, certificateStatus, dnsRecords[]}}. */
export async function createCustomDomain(domain) {
  const c = conf();
  const d = await gql(`mutation customDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain ${STATUS_FIELDS} } }`,
    { input: { domain, projectId: c.project, environmentId: c.environment, serviceId: c.service } });
  return d.customDomainCreate;
}
export async function getCustomDomain(id) {
  const d = await gql(`query customDomain($id: String!, $projectId: String!) { customDomain(id: $id, projectId: $projectId) { id domain ${STATUS_FIELDS} } }`, { id, projectId: conf().project });
  if (!d.customDomain) throw Object.assign(new Error('Domínio inexistente no Railway.'), { status: 502, notFound: true });
  return d.customDomain;
}
export const deleteCustomDomain = async (id) => (await gql('mutation customDomainDelete($id: String!) { customDomainDelete(id: $id) }', { id })).customDomainDelete;
/** Domínio personalizado já existente NESTE serviço (consulta `domains`: formato NÃO CONFIRMADO na documentação). */
export async function findCustomDomain(domain) {
  const c = conf();
  const d = await gql(`query domains($projectId: String!, $environmentId: String!, $serviceId: String!) { domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) { customDomains { id domain ${STATUS_FIELDS} } } }`,
    { projectId: c.project, environmentId: c.environment, serviceId: c.service });
  return (d.domains?.customDomains || []).find((x) => String(x.domain).toLowerCase() === domain) || null;
}

/** Teste barato: token de conta/workspace -> project(id){name}; token de projeto -> projectToken{projectId}. */
export async function testConnection() {
  const c = conf();
  if (c.projectToken) {
    const d = await gql('query { projectToken { projectId environmentId } }');
    if (d.projectToken?.projectId && d.projectToken.projectId !== c.project) throw Object.assign(new Error('O token de projeto é de outro projeto do Railway (RAILWAY_PROJECT_ID não confere).'), { status: 502 });
    return { name: d.projectToken?.projectId || c.project };
  }
  const d = await gql('query project($id: String!) { project(id: $id) { id name } }', { id: c.project });
  return { name: d.project?.name || d.project?.id || c.project };
}

/**
 * Registros DNS que o Railway pede para o domínio: CNAME (no apex a Cloudflare faz "CNAME flattening") e o TXT de
 * verificação. Os nomes saem como FQDN (hostlabel relativo ganha a zona). Valores de recordType como
 * "DNS_RECORD_TYPE_CNAME": NÃO CONFIRMADO — aceitamos qualquer texto que contenha CNAME/TXT/A.
 */
export function requiredRecords(cd, zoneName) {
  const out = [];
  const fq = (host) => {
    const h = String(host || '').replace(/\.$/, '').toLowerCase();
    if (!h || h === '@') return zoneName;
    return h === zoneName || h.endsWith(`.${zoneName}`) ? h : `${h}.${zoneName}`;
  };
  for (const r of cd?.status?.dnsRecords || []) {
    const t = String(r.recordType || '').toUpperCase();
    const type = /CNAME/.test(t) ? 'CNAME' : /TXT/.test(t) ? 'TXT' : /(^|_)A$/.test(t) ? 'A' : null;
    if (!type || !r.requiredValue) continue;
    out.push({ type, name: r.fqdn ? fq(r.fqdn) : fq(r.hostlabel), content: String(r.requiredValue).replace(/\.$/, '') });
  }
  const tok = cd?.status?.verificationToken;
  if (tok && !out.some((r) => r.type === 'TXT' && r.content === tok)) {
    out.push({ type: 'TXT', name: fq(cd.status.verificationDnsHost || `_railway-verify.${cd.domain}`), content: String(tok) });
  }
  return out;
}

/** Certificado emitido? (PENDING -> ISSUED | FAILED na documentação; o texto exato do enum: NÃO CONFIRMADO) */
export const certificateIssued = (cd) => { const s = String(cd?.status?.certificateStatus || ''); return /ISSUED/i.test(s) || /(^|_)VALID$/i.test(s); };
export const certificateFailed = (cd) => /FAIL/i.test(String(cd?.status?.certificateStatus || ''));
