// Servidor HTTP FALSO da Cloudflare (API v4: zonas, registros DNS, SSL da zona) e do Railway (API pública GraphQL:
// domínios personalizados do serviço), para os testes. Valida a autorização e guarda cada chamada. Nada real é chamado.
import http from 'node:http';

export const CF_TOKEN = 'cf-token-falso-123';
export const CF_ACCOUNT = 'conta-plataforma';
export const RW_TOKEN = 'railway-token-falso-123';
export const RW_PROJECT = 'proj-nexa';
export const RW_ENV = 'env-producao';
export const RW_SERVICE = 'svc-api';
export const RW_TARGET = 'abc123.up.railway.app';
export const NS = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'];

export async function startFakeProviders() {
  const calls = [];
  const st = {
    zones: new Map(), // id -> zona
    records: new Map(), // zoneId -> [registros]
    zoneSsl: new Map(), // zoneId -> modo SSL
    otherAccount: new Set(), // nomes ativos em OUTRA conta Cloudflare (POST /zones -> 1061)
    railway: new Map(), // id -> domínio personalizado
    issued: new Set(), // domínios com certificado emitido no Railway
    takenElsewhere: new Set(), // domínios em uso em outro projeto do Railway
    failCreate: new Set(), // domínios cujo customDomainCreate falha
    failDelete: false,
    activationChecks: 0,
    seq: 0,
  };
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const cfOk = (res, result, code = 200) => send(res, code, { success: true, errors: [], messages: [], result });
  const cfErr = (res, code, errCode, message) => send(res, code, { success: false, errors: [{ code: errCode, message }], messages: [], result: null });
  const gqlErr = (res, message) => send(res, 200, { data: null, errors: [{ message, extensions: {} }] });
  const status = (d) => ({
    verificationToken: `railway-verify=${d.domain}-tok`,
    verificationDnsHost: `_railway-verify.${d.domain.split('.').length > 2 && d.domain.startsWith('www.') ? 'www' : '@'}`.replace('.@', ''),
    certificateStatus: st.issued.has(d.domain) ? 'CERTIFICATE_STATUS_TYPE_ISSUED' : 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
    dnsRecords: [{
      hostlabel: d.domain.startsWith('www.') ? 'www' : '@', fqdn: d.domain, zone: d.domain.replace(/^www\./, ''), recordType: 'DNS_RECORD_TYPE_CNAME',
      requiredValue: RW_TARGET, currentValue: '', status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE', purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE',
    }],
  });
  const view = (d) => ({ id: d.id, domain: d.domain, status: status(d) });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body });
      const p = u.pathname;
      /* ---------------- Cloudflare ---------------- */
      if (p.startsWith('/cf/client/v4/')) {
        if (req.headers.authorization !== `Bearer ${CF_TOKEN}`) return cfErr(res, 401, 10000, 'Authentication error');
        const r = p.slice('/cf/client/v4'.length);
        let m;
        if (r === '/user/tokens/verify' && req.method === 'GET') return cfOk(res, { id: 'tok1', status: 'active' });
        if (r === '/zones' && req.method === 'GET') {
          return cfOk(res, [...st.zones.values()].filter((z) => z.name === u.searchParams.get('name') && z.account.id === u.searchParams.get('account.id')));
        }
        if (r === '/zones' && req.method === 'POST') {
          if (st.otherAccount.has(body.name)) return cfErr(res, 400, 1061, `${body.name} already exists`);
          const z = { id: `zona${++st.seq}`, name: body.name, status: 'pending', type: body.type, name_servers: [...NS], account: { id: body.account?.id } };
          st.zones.set(z.id, z); st.records.set(z.id, []);
          return cfOk(res, z);
        }
        if ((m = r.match(/^\/zones\/([^/]+)$/))) {
          const z = st.zones.get(m[1]);
          if (!z) return cfErr(res, 404, 7003, 'Could not route to /zones, perhaps your object identifier is invalid?');
          if (req.method === 'GET') return cfOk(res, z);
          if (req.method === 'DELETE') { st.zones.delete(z.id); st.records.delete(z.id); return cfOk(res, { id: z.id }); }
        }
        if ((m = r.match(/^\/zones\/([^/]+)\/settings\/ssl$/)) && req.method === 'PATCH') { st.zoneSsl.set(m[1], body.value); return cfOk(res, { id: 'ssl', value: body.value }); }
        if ((m = r.match(/^\/zones\/([^/]+)\/activation_check$/)) && req.method === 'PUT') { st.activationChecks++; return cfOk(res, { id: m[1] }); }
        if ((m = r.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/))) {
          const list = st.records.get(m[1]);
          if (!list) return cfErr(res, 404, 7003, 'zona inexistente');
          if (req.method === 'GET') return cfOk(res, list.filter((x) => x.name === u.searchParams.get('name')));
          if (req.method === 'POST') { const rec = { id: `rec${++st.seq}`, ...body }; list.push(rec); return cfOk(res, rec); }
          if (req.method === 'DELETE') { const i = list.findIndex((x) => x.id === m[2]); if (i >= 0) list.splice(i, 1); return cfOk(res, { id: m[2] }); }
        }
        return cfErr(res, 404, 7000, 'rota falsa inexistente');
      }
      /* ---------------- Railway (GraphQL) ---------------- */
      if (p === '/rw/graphql/v2' && req.method === 'POST') {
        if (req.headers.authorization !== `Bearer ${RW_TOKEN}`) return send(res, 401, { errors: [{ message: 'Not Authorized' }] });
        const q = String(body?.query || ''); const v = body?.variables || {};
        if (/mutation customDomainCreate/.test(q)) {
          const i = v.input || {};
          if (i.projectId !== RW_PROJECT || i.environmentId !== RW_ENV || i.serviceId !== RW_SERVICE) return gqlErr(res, 'Problem processing request: ids inválidos');
          if (st.failCreate.has(i.domain)) return gqlErr(res, 'Problem processing request (falha simulada)');
          if (st.takenElsewhere.has(i.domain) || [...st.railway.values()].some((d) => d.domain === i.domain)) return gqlErr(res, `Domain ${i.domain} is already in use`);
          const d = { id: `cd${++st.seq}`, domain: i.domain };
          st.railway.set(d.id, d);
          return send(res, 200, { data: { customDomainCreate: view(d) } });
        }
        if (/mutation customDomainDelete/.test(q)) {
          if (st.failDelete) return gqlErr(res, 'Problem processing request (falha simulada ao remover)');
          if (!st.railway.has(v.id)) return gqlErr(res, 'Custom domain not found');
          st.railway.delete(v.id);
          return send(res, 200, { data: { customDomainDelete: true } });
        }
        if (/query customDomain\(/.test(q)) {
          const d = st.railway.get(v.id);
          if (!d || v.projectId !== RW_PROJECT) return gqlErr(res, 'Custom domain not found');
          return send(res, 200, { data: { customDomain: view(d) } });
        }
        if (/query domains\(/.test(q)) return send(res, 200, { data: { domains: { customDomains: [...st.railway.values()].map(view) } } });
        if (/query project\(/.test(q)) return v.id === RW_PROJECT ? send(res, 200, { data: { project: { id: RW_PROJECT, name: 'nexa-tv' } } }) : gqlErr(res, 'Project not found');
        return gqlErr(res, 'consulta falsa desconhecida');
      }
      send(res, 404, { error: 'rota falsa' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, calls, st, server,
    env: {
      CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT, CLOUDFLARE_API_BASE: `${base}/cf/client/v4`,
      RAILWAY_API_TOKEN: RW_TOKEN, RAILWAY_PROJECT_ID: RW_PROJECT, RAILWAY_ENVIRONMENT_ID: RW_ENV, RAILWAY_SERVICE_ID: RW_SERVICE, RAILWAY_API_BASE: `${base}/rw/graphql/v2`,
    },
    /** marca a zona do domínio como ativa (o Registro.br já aponta para a Cloudflare) */
    activate(name) { for (const z of this.st.zones.values()) if (z.name === name) z.status = 'active'; },
    /** o Railway emitiu o certificado do domínio (e do www) */
    issue(name) { this.st.issued.add(name); this.st.issued.add(`www.${name}`); },
    zoneOf(name) { return [...this.st.zones.values()].find((z) => z.name === name) || null; },
    railwayDomains() { return [...this.st.railway.values()].map((d) => d.domain).sort(); },
    gqlCalls(op) { return this.calls.filter((c) => c.path === '/rw/graphql/v2' && String(c.body?.query || '').includes(op)); },
    close: () => new Promise((r) => server.close(r)),
  };
}
