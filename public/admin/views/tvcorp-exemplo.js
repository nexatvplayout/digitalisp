// TV Corporativa · os dados de exemplo (modo de exemplo do painel e o teste test/tvcorp-painel.test.js). Uma empresa
// inventada com quatro unidades e sete TV box. Os formatos são os que o painel espera das rotas do docs/TV-CORPORATIVA.md
// §5.2 (pacotes A e B) e das rotas da rede (/api/tvcorp/rede/*, as mesmas da Prefeitura). Nada aqui vai ao servidor.
import { FACTORY_LAYOUT } from './tvcorp-catalogo.js';

const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const day = (offset) => { const d = new Date(Date.now() - offset * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Monta tudo de novo a cada chamada (os horários "há 3 min" acompanham o relógio). */
export function sample(t = Date.now()) {
  const offices = [
    { id: 1, name: 'Matriz São Paulo', type: 'matriz', address: 'Av. Paulista, 1000, São Paulo', lat: -23.5614, lng: -46.6559, regionId: null, modules: { avisos: true }, config: {}, link: { on: true, at: t - 20 * DAY }, respName: 'Carla Mendes', respContact: 'comunicacao@exemplo.com.br' },
    { id: 2, name: 'Fábrica Campinas', type: 'fabrica', address: 'Rod. Anhanguera, km 98, Campinas', lat: -22.9056, lng: -47.0608, regionId: null, modules: { avisos: true, interna: true }, config: {}, link: { on: false } },
    { id: 3, name: 'Loja Centro', type: 'loja', address: 'Rua Direita, 50, São Paulo', lat: -23.5489, lng: -46.6340, regionId: null, modules: { avisos: true }, config: {}, link: { on: false } },
    { id: 4, name: 'Recepção da fábrica', type: 'recepcao', address: 'Rod. Anhanguera, km 98, Campinas', lat: -22.9061, lng: -47.0612, regionId: null, modules: { avisos: true, senha: true, panico: true }, config: {}, link: { on: false } },
  ];
  const dev = (id, name, officeId, seenAgo, extra = {}) => ({ id, name, officeId, groups: [], config: {}, lastSeen: seenAgo == null ? null : t - seenAgo, onlineSince: seenAgo == null ? null : t - 3 * DAY, state: 'playing', source: 'canal', net: 'wifi', appVersion: '1.3.0', model: 'TV box X96', android: '11', shotAt: null, revokedAt: null, ...extra });
  const devices = [
    dev(11, 'Hall de entrada', 1, 20000, { groups: [1] }),
    dev(12, 'Copa do 3º andar', 1, 15000, { groups: [1] }),
    dev(13, 'Linha de montagem A', 2, 25000, { groups: [2] }),
    dev(14, 'Refeitório', 2, 9 * HOUR, { groups: [2] }),
    dev(15, 'Vitrine', 3, 40000, { state: 'error', lastError: 'Sem imagem do canal há 2 min' }),
    dev(16, 'Totem do balcão', 3, null),
    dev(17, 'Recepção', 4, 30000, { config: { volume: 40 } }),
  ];
  const groups = [
    { id: 1, name: 'Escritórios', description: 'Telas das áreas administrativas', color: '#4f8fd6', officeType: null, sort: 0, config: {}, deviceIds: [11, 12] },
    { id: 2, name: 'Produção', description: 'Chão de fábrica e refeitório', color: '#f5b31c', officeType: null, sort: 1, config: {}, deviceIds: [13, 14] },
    { id: 3, name: 'Todas as lojas', description: '', color: null, officeType: 'loja', sort: 2, config: {} },
  ];
  const layouts = [
    { id: 1, name: 'Recepção com senha', orientation: 'land', zones: FACTORY_LAYOUT.recepcao.zones, background: '#0b1220', factoryKey: 'recepcao', updatedAt: t - 2 * DAY },
    { id: 2, name: 'Fábrica: indicadores', orientation: 'land', zones: FACTORY_LAYOUT['chao-de-fabrica'].zones, background: '#0b1220', factoryKey: 'chao-de-fabrica', updatedAt: t - 5 * DAY },
    { id: 3, name: 'Escritório em L', orientation: 'land', zones: FACTORY_LAYOUT['video-lateral-barra'].zones, background: '#0b1220', factoryKey: 'video-lateral-barra', updatedAt: t - 9 * DAY },
  ];
  const media = [
    { id: 45, kind: 'image', title: 'Campanha de vacinação', officeId: null, width: 1920, height: 1080, bytes: 210000, status: 'ok', seconds: 10, createdBy: 'carla', createdAt: t - 3 * DAY },
    { id: 46, kind: 'slide', title: 'Horário de fim de ano', template: 'comunicado', fields: { title: 'Horário de fim de ano', text: 'Nos dias 24 e 31 o expediente vai até as 14h.' }, officeId: null, status: 'ok', seconds: 12, createdBy: 'carla', createdAt: t - 2 * DAY },
    { id: 47, kind: 'slide', title: 'Use o EPI', template: 'seguranca', fields: { title: 'Use o EPI', text: 'Capacete, óculos e protetor auricular na área de produção.', lines: ['Confira o equipamento antes do turno', 'Avise o líder se faltar algo'] }, officeId: 2, status: 'ok', seconds: 12, createdBy: 'joao', createdAt: t - DAY },
    { id: 48, kind: 'slide', title: 'SIPAT 2026', template: 'evento', fields: { title: 'SIPAT 2026', text: 'Palestras no auditório, das 9h às 11h.', date: day(-12) }, officeId: 2, status: 'pending', seconds: 12, createdBy: 'unidade: Fábrica Campinas', createdAt: t - 3 * HOUR },
  ];
  const playlists = [
    { id: 1, name: 'Institucional', description: 'Comunicados da empresa', officeId: null, shuffle: false, itemCount: 4, seconds: 46, updatedAt: t - DAY },
    { id: 2, name: 'Fábrica', description: 'Indicadores e segurança', officeId: 2, shuffle: false, itemCount: 3, seconds: 34, updatedAt: t - 2 * DAY },
  ];
  const items = {
    1: [
      { id: 101, refKind: 'media', refId: 46, seconds: 12, params: {}, validFrom: null, validTo: day(-40), days: '', timeFrom: null, timeTo: null },
      { id: 102, refKind: 'media', refId: 45, seconds: 10, params: {}, validFrom: null, validTo: null, days: '1,2,3,4,5', timeFrom: null, timeTo: null },
      { id: 103, refKind: 'birthdays', refId: null, seconds: 12, params: { range: 'week' }, validFrom: null, validTo: null, days: '', timeFrom: null, timeTo: null },
      { id: 104, refKind: 'news', refId: 1, seconds: 12, params: {}, validFrom: null, validTo: null, days: '', timeFrom: 420, timeTo: 1080 },
    ],
    2: [
      { id: 201, refKind: 'kpi', refId: 1, seconds: 10, params: {}, validFrom: null, validTo: null, days: '', timeFrom: null, timeTo: null },
      { id: 202, refKind: 'media', refId: 47, seconds: 12, params: {}, validFrom: null, validTo: null, days: '', timeFrom: null, timeTo: null },
      { id: 203, refKind: 'widget', refId: 2, seconds: 12, params: {}, validFrom: null, validTo: null, days: '', timeFrom: null, timeTo: null },
    ],
  };
  const schedules = [
    { id: 1, name: 'Empresa toda: horário comercial', layoutId: 3, zonePlaylists: { right: 1 }, scope: 'all', scopeData: {}, days: '1,2,3,4,5', timeFrom: 420, timeTo: 1140, dateFrom: null, dateTo: null, priority: 10, status: 'ok', createdBy: 'carla' },
    { id: 2, name: 'Fábrica: turnos', layoutId: 2, zonePlaylists: { kpi: 2 }, scope: 'offices', scopeData: { offices: [2] }, days: '', timeFrom: 360, timeTo: 1320, dateFrom: null, dateTo: null, priority: 20, status: 'ok', createdBy: 'joao' },
    { id: 3, name: 'Recepção', layoutId: 1, zonePlaylists: {}, scope: 'offices', scopeData: { offices: [4] }, days: '1,2,3,4,5,6', timeFrom: 480, timeTo: 1080, dateFrom: day(30), dateTo: null, priority: 30, status: 'ok', createdBy: 'carla' },
  ];
  const settings = { theme: { color: '#1d4ed8', mode: 'dark' }, tz: 'America/Sao_Paulo', approval: true, dates: ['trabalho', 'natal', 'sipat'], hasLogo: false, fullNames: false, tickerFeeds: [1] };
  const defaults = { config: { layout: 'full', tickerItems: ['Bem-vindo à Empresa Exemplo', 'Use o crachá em todas as áreas'], widgets: ['clock', 'weather'], hasPin: true, schedule: { tvOn: '07:00', tvOff: '20:00', days: [1, 2, 3, 4, 5] } }, update: null, approval: true };
  const appLatest = { versionName: '1.3.0', versionCode: 30 };
  const main = { serverTime: t, settings, offices, groups, devices, keys: [{ id: 5, officeId: 3, deviceName: 'Totem do balcão', expiresAt: t + 20 * HOUR, createdBy: 'carla' }], regions: [], defaults, layouts, playlists, schedules, appLatest, channels: [] };
  const feeds = [
    { id: 1, kind: 'rss', name: 'Agência Brasil', config: { preset: 'agencia-brasil' }, refreshMin: 30, fetchedAt: t - 12 * MIN, lastError: null, enabled: true, count: 20 },
    { id: 2, kind: 'quotes', name: 'Dólar e euro', config: { pairs: ['USD-BRL', 'EUR-BRL'] }, refreshMin: 60, fetchedAt: t - 30 * MIN, lastError: null, enabled: true, count: 2 },
    { id: 3, kind: 'weather', name: 'Clima por unidade', config: { offices: [] }, refreshMin: 60, fetchedAt: t - 40 * MIN, lastError: null, enabled: true, count: 4 },
    { id: 4, kind: 'rss', name: 'Notícias internas', config: { url: 'https://intranet.exemplo.com.br/feed' }, refreshMin: 60, fetchedAt: t - 2 * HOUR, lastError: 'O endereço respondeu 404', enabled: false, count: 0 },
  ];
  const people = [
    { id: 1, name: 'Ana Souza', sector: 'Financeiro', officeId: 1, bdayDay: new Date(t).getDate(), bdayMonth: new Date(t).getMonth() + 1, hireDate: '2019-03-11', photoConsent: false, hasPhoto: false, active: true },
    { id: 2, name: 'Bruno Carvalho', sector: 'Vendas', officeId: 3, bdayDay: 2, bdayMonth: 12, hireDate: day(10), photoConsent: true, hasPhoto: true, active: true },
    { id: 3, name: 'Carla Mendes', sector: 'Comunicação', officeId: 1, bdayDay: 15, bdayMonth: 4, hireDate: '2015-08-01', photoConsent: false, hasPhoto: false, active: true },
    { id: 4, name: 'Diego Lima', sector: 'Produção', officeId: 2, bdayDay: 28, bdayMonth: 11, hireDate: '2022-01-17', photoConsent: false, hasPhoto: false, active: false },
  ];
  const posts = [
    { id: 7, category: 'comunicado', title: 'Horário de fim de ano', body: 'Nos dias 24 e 31 o expediente vai até as 14h.', officeId: null, scope: 'all', scopeData: {}, validFrom: day(0), validTo: day(-40), needsAck: true, acks: 38, status: 'ok', createdBy: 'carla', createdAt: t - 2 * DAY },
    { id: 8, category: 'vaga', title: 'Vaga: analista de compras', body: 'Inscrições até sexta pelo QR code.', qrUrl: 'https://exemplo.com.br/vagas', officeId: null, scope: 'all', scopeData: {}, validFrom: day(0), validTo: day(-5), needsAck: false, acks: 0, status: 'ok', createdBy: 'rh', createdAt: t - DAY },
    { id: 9, category: 'seguranca', title: 'Simulado de evacuação', body: 'Quinta, às 10h. Siga o brigadista do seu setor.', officeId: 2, scope: 'offices', scopeData: { offices: [2] }, validFrom: day(0), validTo: day(-3), needsAck: true, acks: 4, status: 'pending', createdBy: 'unidade: Fábrica Campinas', createdAt: t - 2 * HOUR },
  ];
  const kpis = [
    { id: 1, name: 'Produção do mês', unit: '%', value: 82, target: 100, direction: 'up', bands: [], source: 'manual', sourceCfg: {}, refreshMin: 60, officeId: 2, updatedAt: t - 3 * HOUR, lastError: null },
    { id: 2, name: 'Refugo da linha A', unit: '%', value: 1.8, target: 2, direction: 'down', bands: [], source: 'csv', sourceCfg: { url: 'https://planilhas.exemplo.com.br/refugo.csv', cell: 'B2' }, refreshMin: 30, officeId: 2, updatedAt: t - 25 * MIN, lastError: null },
    { id: 3, name: 'Satisfação dos clientes', unit: 'pontos', value: 71, target: 75, direction: 'up', bands: [], source: 'api', sourceCfg: {}, refreshMin: 60, officeId: null, updatedAt: t - DAY, lastError: null },
  ];
  const widgets = [
    { id: 1, kind: 'countdown', name: 'SIPAT', data: { title: 'Faltam para a SIPAT', target: day(-12), text: 'Palestras no auditório' }, updatedAt: t - DAY },
    { id: 2, kind: 'safety', name: 'Fábrica Campinas', data: { since: day(146), record: 410, goal: 365 }, updatedAt: t - 5 * DAY },
    { id: 3, kind: 'worldclock', name: 'Filiais no mundo', data: { title: 'Nossas filiais', clocks: [{ label: 'Brasília', tz: 'America/Sao_Paulo' }, { label: 'Lisboa', tz: 'Europe/Lisbon' }, { label: 'Nova York', tz: 'America/New_York' }] }, updatedAt: t - 9 * DAY },
    { id: 4, kind: 'menu', name: 'Refeitório', data: { title: 'Cardápio do refeitório', week: { 1: [{ name: 'Arroz e feijão' }, { name: 'Frango grelhado' }, 'Salada verde'], 2: ['Macarrão ao sugo', 'Carne de panela'], 3: ['Peixe assado', 'Purê'], 4: ['Estrogonofe', 'Batata palha'], 5: ['Feijoada leve', 'Couve e laranja'], 6: [], 0: [] } }, updatedAt: t - 2 * DAY },
  ];
  const mobile = [{ id: 1, name: 'Empresa toda', officeId: null, createdAt: t - 10 * DAY, revokedAt: null }];
  const suggestions = [
    { id: 1, kind: 'sugestao', text: 'Bebedouro novo no 2º andar, por favor.', who: '', officeId: 1, status: 'nova', createdAt: t - 5 * HOUR },
    { id: 2, kind: 'conteudo', text: 'Foto da confraternização da equipe de vendas.', who: 'Bruno C.', officeId: 3, status: 'nova', hasMedia: true, createdAt: t - DAY },
  ];
  return { t, main, feeds, people, posts, kpis, widgets, mobile, suggestions, media, items };
}

const pathOf = (p) => String(p).split('?')[0];
const paramsOf = (p) => new URLSearchParams(String(p).split('?')[1] || '');

/** A resposta de exemplo para cada rota (GET). Escritas devolvem { ok: true } e o que a tela precisa mostrar. */
export function demoApi(path, { method = 'GET', body } = {}) {
  const S = sample(); const t = S.t; const p = pathOf(path); const q = paramsOf(path);
  if (method !== 'GET') {
    if (p === '/api/tvcorp/rede/keys') return { id: 9, key: 'K7PX-2QMA', expiresAt: t + 24 * HOUR };
    if (p === '/api/tvcorp/mobile') return { id: 9, url: `${globalThis.location?.origin || ''}/tvc/exemplo-endereco-do-celular` };
    if (p === '/api/tvcorp/schedules/preview') return { total: 4, online: 3, devices: S.main.devices.slice(0, 4).map((d) => ({ id: d.id, name: d.name, office: S.main.offices.find((o) => o.id === d.officeId)?.name, showing: 'esta grade' })) };
    if (p === '/api/tvcorp/rede/alerts/preview') return { total: 6, offices: 4, online: 5 };
    if (/^\/api\/tvcorp\/feeds\/\d+\/test$/.test(p)) return { ok: true, items: [{ title: 'Exemplo de manchete de agência pública', source: 'Agência Brasil', at: t - 20 * MIN }, { title: 'Outra manchete de exemplo', source: 'Agência Brasil', at: t - 50 * MIN }] };
    if (p === '/api/tvcorp/people/import') return { ok: true, added: 0, updated: 0, skipped: 0, droppedYear: 0 };
    if (/^\/api\/tvcorp\/rede\/offices\/\d+\/link$/.test(p)) return { ok: true, url: `${globalThis.location?.origin || ''}/reparticao/#exemplo`, password: 'senha-de-exemplo', office: { link: { on: true, at: t } } };
    if (/^\/api\/tvcorp\/rede\/offices\/\d+\/pin$/.test(p)) return { ok: true, pin: '482913' };
    return { ok: true, id: 9999 };
  }
  if (p === '/api/tvcorp') return S.main;
  if (p === '/api/tvcorp/rede') return { ...S.main, municipio: null };
  if (p === '/api/tvcorp/rede/status') return { serverTime: t, devices: S.main.devices.map(({ id, lastSeen, state, onlineSince }) => ({ id, lastSeen, state, onlineSince })) };
  if (p === '/api/tvcorp/rede/availability') return { devices: S.main.devices.map((d, i) => ({ id: d.id, d7: [99.2, 97.5, 100, 81.4, 92, null, 98.1][i], d30: [98.7, 96.1, 99.4, 85.2, 90.3, null, 97.7][i], status: d.lastSeen ? 'on' : 'never', since: d.onlineSince })) };
  if (p === '/api/tvcorp/summary') {
    return { serverTime: t, devices: { on: 4, warn: 1, off: 1, never: 1, total: 7 }, nowItems: 9, hours: { today: 41 * 3600, d7: 302 * 3600, d30: 1288 * 3600 }, pending: 2,
      offline: [{ id: 14, name: 'Refeitório', office: 'Fábrica Campinas', since: t - 9 * HOUR }, { id: 16, name: 'Totem do balcão', office: 'Loja Centro', since: null }],
      top: [{ ref: 'm46', title: 'Horário de fim de ano', plays: 412, seconds: 4944 }, { ref: 'k1', title: 'Produção do mês', plays: 288, seconds: 2880 }] };
  }
  if (p === '/api/tvcorp/media') return { items: S.media, max: 2000 };
  const pl = /^\/api\/tvcorp\/playlists\/(\d+)$/.exec(p);
  if (pl) { const x = S.main.playlists.find((y) => y.id === Number(pl[1])); return { ...x, items: S.items[x?.id] || [] }; }
  if (/^\/api\/tvcorp\/devices\/\d+\/now$/.test(p)) return { schedule: { id: 1, name: 'Empresa toda: horário comercial' }, layout: { id: 3, name: 'Escritório em L' }, items: [{ zone: 'right', ref: 'm46', title: 'Horário de fim de ano', kind: 'slide' }], at: t - 40000 };
  if (p === '/api/tvcorp/commands') {
    const all = [
      { id: 1, deviceId: 15, device: 'Vitrine', type: 'restart-app', createdBy: 'carla', createdAt: t - 50 * MIN, status: 'done', doneAt: t - 49 * MIN, result: 'ok' },
      { id: 2, deviceId: 11, device: 'Hall de entrada', type: 'screenshot', createdBy: 'carla', createdAt: t - 3 * HOUR, status: 'done', doneAt: t - 3 * HOUR + 20000, result: 'ok' },
      { id: 3, deviceId: 14, device: 'Refeitório', type: 'reload', createdBy: 'joao', createdAt: t - 9 * HOUR - 5 * MIN, status: 'pending', doneAt: null, result: null },
    ];
    const dv = Number(q.get('deviceId')) || null;
    return { items: dv ? all.filter((c) => c.deviceId === dv) : all };
  }
  if (p === '/api/tvcorp/reports/plays') {
    const by = q.get('by') || 'item';
    const rows = by === 'device' ? S.main.devices.slice(0, 5).map((d, i) => ({ key: `d${d.id}`, label: d.name, office: S.main.offices.find((o) => o.id === d.officeId)?.name, plays: 300 - i * 40, seconds: (300 - i * 40) * 11, items: 6 - i }))
      : by === 'office' ? S.main.offices.map((o, i) => ({ key: `o${o.id}`, label: o.name, plays: 700 - i * 150, seconds: (700 - i * 150) * 11, devices: 2 }))
        : [{ key: 'm46', label: 'Horário de fim de ano', kind: 'slide', plays: 412, seconds: 4944, devices: 5 }, { key: 'k1', label: 'Produção do mês', kind: 'kpi', plays: 288, seconds: 2880, devices: 2 }, { key: 'm45', label: 'Campanha de vacinação', kind: 'image', plays: 260, seconds: 2600, devices: 5 }, { key: 'w:birthdays', label: 'Aniversariantes', kind: 'birthdays', plays: 199, seconds: 2388, devices: 5 }];
    return { from: q.get('from'), to: q.get('to'), by, rows };
  }
  if (p === '/api/tvcorp/reports/hours') return { rows: S.main.devices.map((d, i) => ({ deviceId: d.id, device: d.name, office: S.main.offices.find((o) => o.id === d.officeId)?.name, seconds: [43, 41, 60, 22, 38, 0, 40][i] * 3600, days: 7 })) };
  if (p === '/api/tvcorp/feeds') return { items: S.feeds };
  if (p === '/api/tvcorp/people') return { items: S.people, total: S.people.length };
  if (p === '/api/tvcorp/posts') return { items: S.posts };
  if (/^\/api\/tvcorp\/posts\/\d+\/acks$/.test(p)) return { items: [{ who: 'Ana S.', at: t - 3 * HOUR }, { who: 'Matrícula 4471', at: t - 5 * HOUR }], total: 2 };
  if (p === '/api/tvcorp/kpis') return { items: S.kpis };
  const kp = /^\/api\/tvcorp\/kpis\/(\d+)$/.exec(p);
  if (kp) { const k = S.kpis.find((x) => x.id === Number(kp[1])); return { ...k, points: Array.from({ length: 14 }, (_, i) => ({ at: t - (13 - i) * DAY, value: Math.round((k.value * (0.8 + 0.2 * Math.sin(i / 2) + i / 70)) * 10) / 10 })) }; }
  if (p === '/api/tvcorp/widgets') return { items: S.widgets };
  if (p === '/api/tvcorp/mobile') return { items: S.mobile };
  if (p === '/api/tvcorp/suggestions') return { items: S.suggestions };
  if (p === '/api/tvcorp/rede/alerts') {
    return { active: [], history: [{ id: 3, title: 'Simulado de evacuação', text: 'Siga o brigadista do seu setor até o ponto de encontro.', level: 'warn', class: 'utilidade', scope: { kind: 'office', office: 2 }, startsAt: t - 6 * DAY, until: t - 6 * DAY + 30 * MIN, status: 'encerrado', delivered: 3, createdBy: 'carla' }] };
  }
  if (p === '/api/tvcorp/rede/approvals') {
    return { enabled: true, pending: [
      { id: 21, kind: 'tvc-media', officeId: 2, office: 'Fábrica Campinas', requestedBy: 'joao', requestedAt: t - 3 * HOUR, refId: 48, payload: { kind: 'slide', title: 'SIPAT 2026', template: 'evento', fields: S.media[3].fields } },
      { id: 22, kind: 'tvc-post', officeId: 2, office: 'Fábrica Campinas', requestedBy: 'joao', requestedAt: t - 2 * HOUR, refId: 9, payload: { category: 'seguranca', title: 'Simulado de evacuação', body: 'Quinta, às 10h. Siga o brigadista do seu setor.' } },
    ], history: [{ id: 20, kind: 'tvc-post', officeId: 1, office: 'Matriz São Paulo', requestedBy: 'carla', requestedAt: t - 3 * DAY, status: 'approved', decidedBy: 'admin', decidedAt: t - 3 * DAY + HOUR, payload: { category: 'comunicado', title: 'Horário de fim de ano', body: '' } }] };
  }
  const us = /^\/api\/tvcorp\/rede\/offices\/(\d+)\/users$/.exec(p);
  if (us) return { office: { id: Number(us[1]), link: { on: Number(us[1]) === 1, at: t - 20 * DAY } }, users: Number(us[1]) === 1 ? [{ id: 1, username: 'carla.mendes', name: 'Carla Mendes', role: 'gestor', active: true, lastLogin: t - DAY }] : [], max: 20 };
  return {};
}
