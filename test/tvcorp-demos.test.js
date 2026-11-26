// Os layouts de demonstração (public/shared/tvcorp-demos.js): 20 prontos, todos passam na validação do servidor, cada
// zona de playlist acha os slides premium dela (que também passam), e os segmentos pedidos estão lá.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../server/tvcorp-core.js';
import { DEMO_LAYOUTS, DEMO_SEGMENTS, demoZones, demoItens } from '../public/shared/tvcorp-demos.js';
import { TVC_ART } from '../public/shared/tvcorp-tipos.js';
import { templateCatalog } from '../public/shared/templates-catalogo.js';

const CAT = templateCatalog();

test('64 layouts de demonstração (5 com senha, 10 de datas comemorativas), válidos, com playlists de slides premium', () => {
  assert.equal(DEMO_LAYOUTS.length, 64);
  assert.ok(DEMO_LAYOUTS.filter((d) => d.zones.some((z) => z.kind === 'queue')).length >= 5, 'layouts de senha');
  assert.equal(new Set(DEMO_LAYOUTS.map((d) => d.key)).size, 64, 'chaves únicas');
  const segs = new Set(DEMO_SEGMENTS.map(([k]) => k));
  for (const k of ['provedor', 'padaria', 'lanchonete', 'farmacia', 'mercado']) assert.ok(DEMO_LAYOUTS.filter((d) => d.segment === k).length >= 2, `${k}: pelo menos 2`);
  for (const d of DEMO_LAYOUTS) {
    assert.ok(segs.has(d.segment), `${d.key}: segmento`);
    const zones = demoZones(d, (id) => 100 + id.length, d.video ? 7 : null);
    const ok = K.cleanZones(zones);
    assert.equal(ok.length, d.zones.length, d.key);
    assert.equal(Boolean(d.video), zones.some((z) => z.kind === 'video'), `${d.key}: vídeo`);
    if (d.video) assert.equal(ok.find((z) => z.kind === 'video').channel, 7, `${d.key}: o canal vai na zona de vídeo`);
    const pls = d.zones.filter((z) => z.pl);
    assert.ok(pls.length >= 1 || d.senha, `${d.key}: tem playlist`);
    const itens = demoItens(d, CAT);
    for (const z of pls) {
      const list = itens[z.id] || [];
      assert.ok(list.length >= 1 && list.every(Boolean), `${d.key}/${z.id}: slides`);
      for (const t of list) {
        assert.ok(/^foto-(pm|tm)-/.test(t.fields.art) && TVC_ART[t.fields.art]?.photo, `${d.key}: foto registrada (${t.fields.art})`);
        if (t.template === 'data-comemorativa') assert.match(String(t.fields.date), /^\d{4}-\d{2}-\d{2}$/, `${d.key}: a data`);
        assert.doesNotThrow(() => K.cleanSlide(t.template, t.fields), `${d.key}: ${t.id}`);
      }
      assert.equal(ok.find((x) => x.id === z.id).playlist, 100 + z.id.length, `${d.key}/${z.id}: a playlist vai na zona`);
    }
    for (const z of d.zones.filter((x) => x.kind === 'text')) assert.ok(z.text && z.text.length <= 45, `${d.key}: frase curta`);
  }
});

test('as frases de cada negócio entram na primeira playlist, como slides válidos com foto', async () => {
  const { DEMO_FRASES, demoItens } = await import('../public/shared/tvcorp-demos.js');
  const cat = templateCatalog();
  for (const d of DEMO_LAYOUTS) {
    const fr = DEMO_FRASES[d.key];
    assert.ok(Array.isArray(fr) && fr.length >= 3, `${d.key}: 3 frases`);
    const it = demoItens(d, cat);
    const primeira = it[d.zones.find((z) => z.pl).id];
    const frases = primeira.filter((t) => /-frase-/.test(t.id));
    assert.equal(frases.length, Math.min(fr.length, primeira.length - frases.length), `${d.key}: frases intercaladas`);
    for (const t of primeira) {
      assert.doesNotThrow(() => K.cleanSlide(t.template, t.fields), `${d.key}: ${t.id}`);
      assert.ok(/^foto-(pm|tm)-/.test(t.fields.art), `${d.key}: ${t.id} com foto`);
      assert.ok(t.name.length <= 60, `${d.key}: nome curto`);
    }
    assert.ok(!/whatsapp|instagram|facebook/i.test(JSON.stringify(fr)), `${d.key}: sem marca de terceiros`);
  }
});
