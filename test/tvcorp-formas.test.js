// DIGITAL ISP · formatos especiais de zona (recorte e filete): as contas comuns (public/shared/tvcorp-formas.js), a
// validação do servidor e o pacote de modelos "Formatos especiais".
import { test } from 'node:test';
import assert from 'node:assert/strict';

const F = await import('../public/shared/tvcorp-formas.js');
const T = await import('../public/shared/tvcorp-tipos.js');
const K = await import('../server/tvcorp-core.js');

test('todo formato dá um caminho fechado dentro do retângulo e um filete; o desconhecido devolve null', () => {
  assert.ok(F.ZONE_SHAPE_KEYS.length >= 10);
  for (const key of F.ZONE_SHAPE_KEYS) {
    const c = F.shapeCommands(key, 400, 300, 10, 20);
    assert.equal(c[0][0], 'M', key); assert.equal(c[c.length - 1][0], 'Z', key);
    for (const [cmd, ...p] of c) for (let i = 0; i < p.length; i += 2) {
      if (cmd === 'C' && i < 4) continue; // os pontos de controle da curva podem sair um pouco
      assert.ok(p[i] >= 10 - 1e-9 && p[i] <= 410 + 1e-9 && p[i + 1] >= 20 - 1e-9 && p[i + 1] <= 320 + 1e-9, `${key}: ${cmd} ${p}`);
    }
    assert.ok(F.edgeCommands(key, 400, 300).length >= 2, key);
    const poly = F.shapePolygon(key, 400, 300);
    assert.ok(poly.length >= 4, key);
    for (const [x, y] of poly) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, key);
    assert.match(F.toPathD(c), /^M[\d. ]+ /);
  }
  assert.equal(F.shapeCommands('estrela', 10, 10), null);
  assert.equal(F.shapePolygon('estrela', 10, 10), null);
});

test('servidor: formato e filete validados; a zona recortada pode entrar na vizinha e é desenhada depois', () => {
  const z = K.cleanZone({ id: 'main', kind: 'playlist', x: 40, y: 0, w: 60, h: 100, shape: 'onda-esq', edge: { color: '#29D3E5', width: 1.23 } });
  assert.equal(z.shape, 'onda-esq'); assert.deepEqual(z.edge, { color: '#29d3e5', width: 1.2 });
  assert.equal(K.cleanZone({ id: 'a', kind: 'clock', x: 0, y: 0, w: 20, h: 20, edge: { color: '#ffffff', width: 1 } }).edge, undefined, 'filete só com formato');
  assert.throws(() => K.cleanZone({ id: 'a', kind: 'clock', x: 0, y: 0, w: 20, h: 20, shape: 'estrela' }), /formato/);
  assert.throws(() => K.cleanZone({ id: 'a', kind: 'clock', x: 0, y: 0, w: 20, h: 20, shape: 'pilula', edge: { color: 'azul', width: 1 } }), /#rrggbb/);
  assert.throws(() => K.cleanZone({ id: 'a', kind: 'clock', x: 0, y: 0, w: 20, h: 20, shape: 'pilula', edge: { color: '#ffffff', width: 9 } }), /espessura/);
  const zs = K.cleanZones([{ id: 'main', kind: 'playlist', x: 40, y: 0, w: 60, h: 100, shape: 'onda-esq' }, { id: 'title', kind: 'text', x: 0, y: 0, w: 48, h: 50, title: 'Oi' }]);
  assert.deepEqual(zs.map((x) => x.id), ['title', 'main'], 'o retângulo primeiro, o formato depois');
  assert.throws(() => K.cleanZones([{ id: 'a', kind: 'playlist', x: 0, y: 0, w: 60, h: 100 }, { id: 'b', kind: 'clock', x: 50, y: 0, w: 50, h: 50 }]), /uma por cima da outra/, 'sem formato continua proibido');
});

test('pacote "Formatos especiais": 20 ou mais, vários formatos, deitados e em pé, com playlist e com vídeo ao vivo', () => {
  const fx = T.TVC_LAYOUT_MODELS.filter((m) => m.special);
  assert.ok(fx.length >= 20, `só ${fx.length}`);
  const shapes = new Set(fx.flatMap((m) => m.zones.map((z) => z.shape).filter(Boolean)));
  assert.ok(shapes.size >= 10, `formatos usados: ${[...shapes]}`);
  assert.ok(fx.some((m) => m.orientation === 'port') && fx.some((m) => m.orientation === 'land'));
  assert.ok(fx.filter((m) => T.layoutMainOf(m) === 'video').length >= 4, 'com vídeo ao vivo');
  assert.ok(fx.some((m) => m.zones.some((z) => z.edge)), 'com filete');
  assert.ok(new Set(fx.map((m) => m.segment)).size >= 10, 'vários segmentos');
  for (const m of fx) {
    const l = K.cleanLayout({ factoryKey: m.key });
    assert.ok(l.zones.some((z) => z.shape), `${m.key}: tem formato`);
  }
  // o da imagem do cliente: texto e clima à esquerda, a foto em onda à direita com filete ciano
  const bv = T.TVC_LAYOUT_MODEL['fx-boas-vindas-onda'];
  assert.equal(bv.zones.find((z) => z.id === 'main').shape, 'onda-esq');
  assert.ok(bv.zones.some((z) => z.kind === 'weather') && bv.zones.some((z) => z.kind === 'text'));
});
