// Relógio simulado para os testes que dependem da hora de Brasília (a virada do dia, o horário de um programa…):
// FAKE_BRT=HH:MM[:SS] desloca Date.now() e new Date() para essa hora de Brasília, no dia de hoje (Brasília), ou no dia
// FAKE_BRT_DIA=AAAA-MM-DD. O relógio continua andando a partir dali. Carregado antes de tudo com NODE_OPTIONS, vale no
// processo do teste e no servidor que o teste sobe (test/helpers/srv.js herda o ambiente):
//   FAKE_BRT=00:05 NODE_OPTIONS=--import=./test/helpers/relogio.mjs node --test test/comercial-api.test.js
// Brasília sem horário de verão (UTC−3 desde 2019). Cada processo calcula o deslocamento quando sobe: o servidor fica
// alguns instantes atrás do teste (o tempo de subir). Sem FAKE_BRT não faz nada.
const target = process.env.FAKE_BRT;
if (target) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(target);
  if (!m) throw new Error(`FAKE_BRT inválido: "${target}" (use HH:MM ou HH:MM:SS)`);
  const RealDate = Date;
  const real = RealDate.now();
  const BRT = 3 * 3600000;
  const dia = process.env.FAKE_BRT_DIA;
  if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`FAKE_BRT_DIA inválido: "${dia}" (use AAAA-MM-DD)`);
  const day = dia ? RealDate.parse(`${dia}T00:00:00Z`) / 86400000 : Math.floor((real - BRT) / 86400000); // dia de Brasília
  const want = day * 86400000 + BRT + ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3] || 0)) * 1000;
  const offset = want - real;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = FakeDate;
}
