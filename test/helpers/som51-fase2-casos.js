// Casos fixos dos argumentos do FFmpeg da mesa (pontes, mixer, câmera do app) para conferir que, com o som 5.1 desligado, a
// fase 2 do 5.1 (docs/SOM-51.md) não mudou nada: test/fixtures/som51-fase2-antes.json foi gravado com estes mesmos casos no
// código de antes (98c8cf1f, a 0.5.138), e test/som51.test.js compara com o de agora.
export function cases({ urlBridgeArgs, mixerArgs, mesaDefaults, bridgeArgs }) {
  const f720 = { width: 1280, height: 720, fps: 30 };
  const f1080 = { width: 1920, height: 1080, fps: 30 };
  const d = mesaDefaults();
  const state = { A: 2, B: 5, pvw: 5, opacity: 1, ftb: false, master: -3, fader: [1, 0, 0.5, 0, 0, 1, 0, 0] };
  const slots = d.slots.map((s, i) => ({ ...s, audio: { ...s.audio, gain: i - 3 } }));
  const ports = [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008];
  return {
    ponteSrt: urlBridgeArgs('srt://encoder.exemplo:9000?mode=caller', { fmt: f720 }),
    ponteHls: urlBridgeArgs('https://cdn.exemplo/live/index.m3u8', { fmt: f720, input: 'pipe', netErr: true }),
    ponteRtmpSemAudio: urlBridgeArgs('rtmp://127.0.0.1:1935/live/abc', { audio: false, fmt: f1080, vertical: 'bars' }),
    ponteUdp: urlBridgeArgs('udp://239.0.0.1:5000', { fmt: f1080 }),
    mixerStdin: mixerArgs({ ports, state, slots, dsk: d.dsk, font: 'C:/fontes/Inter.ttf', solo: true, mv: true, fmt: f720 }),
    mixerZmq: mixerArgs({ ports, zmqBind: 'tcp://127.0.0.1:5599', state, slots, dsk: d.dsk, font: null, solo: false, mv: false, fmt: f1080 }),
    cameraWebm: bridgeArgs({ mime: 'video/webm;codecs=vp8,opus', audio: true }),
    cameraMp4SemAudio: bridgeArgs({ mime: 'video/mp4', audio: false, vertical: 'bars' }),
  };
}
