// Gera os tons do app em app/src/main/res/raw/: alerta.wav (dois bipes, 880 Hz e 660 Hz) e chamada.wav (o toque
// suave da chamada de senha, 659 Hz e 880 Hz subindo). 22,05 kHz, mono, 16 bits. Rodar da pasta android-telas: node scripts/gerar-tom-alerta.cjs
const fs = require('fs');
const path = require('path');

const rate = 22050;

function tone(file, parts, level, fade) {
  const samples = [];
  for (const [freq, dur] of parts) {
    const n = Math.round(rate * dur);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 300, (n - i) / fade);
      samples.push(freq ? Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * level * env * 32767) : 0);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  const out = path.join(__dirname, '..', 'app', 'src', 'main', 'res', 'raw', file);
  fs.writeFileSync(out, Buffer.concat([h, data]));
  console.log(out, 44 + data.length, 'bytes');
}

tone('alerta.wav', [[880, 0.22], [0, 0.08], [660, 0.32]], 0.6, 300);
tone('chamada.wav', [[659.25, 0.22], [880, 0.5]], 0.45, 6000);
