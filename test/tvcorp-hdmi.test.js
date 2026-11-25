// A zona "Entrada HDMI da TV" (DIGITAL ISP): a imagem de uma entrada HDMI no lugar do ao vivo, escolhida no menu do app
// Samsung. Uma por layout, nunca junto com o vídeo do canal, nunca por cima; os layouts prontos com ela passam no servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/shared/tvcorp-tipos.js';
import * as K from '../server/tvcorp-core.js';
import { checkZones } from '../public/admin/views/tvcorp-catalogo.js';

const Z = (id, kind, x, y, w, h, extra = {}) => ({ id, kind, x, y, w, h, ...extra });

test('a zona HDMI está no catálogo e os layouts prontos com ela passam', () => {
  assert.ok(T.TVC_ZONE_KEYS.includes('hdmi'));
  assert.ok(!T.TVC_PLAYLIST_ZONES.includes('hdmi'), 'a entrada HDMI não recebe playlist');
  const prontos = T.TVC_LAYOUT_MODELS.filter((m) => m.zones.some((z) => z.kind === 'hdmi'));
  assert.equal(prontos.length, 8);
  for (const m of prontos) {
    assert.equal(T.layoutMainOf(m), 'hdmi', m.key);
    assert.doesNotThrow(() => K.cleanZones(m.zones), m.key);
    assert.equal(checkZones(m.zones.map((z) => ({ ...z }))), null, m.key);
  }
});

test('uma HDMI por layout, sem o vídeo do canal e sem ficar por cima', () => {
  assert.deepEqual(K.cleanZone(Z('main', 'hdmi', 0, 0, 75, 100, { fit: 'cover', playlist: 3 })), Z('main', 'hdmi', 0, 0, 75, 100));
  assert.throws(() => K.cleanZones([Z('a', 'hdmi', 0, 0, 50, 100), Z('b', 'hdmi', 50, 0, 50, 100)]), /No máximo uma zona de entrada HDMI/);
  assert.throws(() => K.cleanZones([Z('a', 'hdmi', 0, 0, 50, 100), Z('b', 'video', 50, 0, 50, 100)]), /não ficam no mesmo layout/);
  assert.throws(() => K.cleanZone(Z('a', 'hdmi', 0, 0, 50, 50, { overlay: true })), /não pode ficar por cima/);
  assert.match(checkZones([Z('a', 'hdmi', 0, 0, 50, 100), Z('b', 'video', 50, 0, 50, 100)]), /não ficam no mesmo layout/);
});
