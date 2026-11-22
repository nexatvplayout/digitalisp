/* Cliente ZeroMQ mínimo (ZMTP 3.0, mecanismo NULL, socket REQ) para mandar comandos ao filtro zmq do FFmpeg.

   O mixer da mesa (docs/MESA.md) recebe comandos em tempo real: troca de fonte, opacidade da transição, volume. Pelo stdin
   o FFmpeg lê no máximo um comando a cada 100 ms (a MIX de 1 s sairia em degraus de 8 passos); o filtro zmq lê a cada
   quadro. Sem dependência nativa: o protocolo do REQ é pequeno (saudação de 64 bytes, comando READY, quadros curtos).
   REQ é estrito: um pedido por vez, espera a resposta. Os comandos ficam numa fila; o mais novo do mesmo alvo e comando
   substitui o que ainda não saiu (arrastar a alavanca da transição manda só a última posição). */
import net from 'node:net';
import { EventEmitter } from 'node:events';

const greeting = () => {
  const b = Buffer.alloc(64);
  b[0] = 0xff; b[9] = 0x7f; // assinatura
  b[10] = 3; b[11] = 0; // versão 3.0
  b.write('NULL', 12, 'ascii'); // mecanismo (20 bytes, completa com zeros)
  b[32] = 0; // as-server: não
  return b;
};

/** Quadro ZMTP: flags (bit 0 = MORE, bit 1 = LONG, bit 2 = COMMAND) + tamanho + corpo. */
function frame(body, { more = false, command = false } = {}) {
  const long = body.length > 255;
  const head = Buffer.alloc(long ? 9 : 2);
  head[0] = (more ? 1 : 0) | (long ? 2 : 0) | (command ? 4 : 0);
  if (long) head.writeBigUInt64BE(BigInt(body.length), 1); else head[1] = body.length;
  return Buffer.concat([head, body]);
}

function readyCommand() {
  const name = Buffer.from('READY');
  const key = Buffer.from('Socket-Type');
  const val = Buffer.from('REQ');
  const len = Buffer.alloc(4); len.writeUInt32BE(val.length);
  return frame(Buffer.concat([Buffer.from([name.length]), name, Buffer.from([key.length]), key, len, val]), { command: true });
}

export class ZmqReq extends EventEmitter {
  /**
   * endpoint: a porta TCP em que o filtro zmq do FFmpeg escuta (bind_address=tcp://127.0.0.1:port), ou { port }, ou
   * { path } = o socket ipc (bind_address=ipc://path) da pasta privada do servidor (server/zmq-endpoint.js).
   */
  constructor(endpoint, { host = '127.0.0.1', timeoutMs = 2000 } = {}) {
    super();
    const ep = endpoint && typeof endpoint === 'object' ? endpoint : { port: endpoint };
    this.port = ep.port ?? null; this.path = ep.path ?? null; this.host = host; this.timeoutMs = timeoutMs;
    this.sock = null; this.ready = false; this.buf = Buffer.alloc(0); this.stage = 'greeting';
    this.q = []; this.inflight = null; this.closed = false; this.timer = null; this.parts = [];
  }

  connect() {
    if (this.closed || this.sock) return;
    const s = this.path ? net.connect({ path: this.path }) : net.connect(this.port, this.host);
    this.sock = s; this.stage = 'greeting'; this.buf = Buffer.alloc(0); this.ready = false;
    s.setNoDelay(true);
    s.on('connect', () => s.write(greeting()));
    s.on('data', (d) => this.#onData(d));
    s.on('error', () => {});
    s.on('close', () => {
      this.sock = null; this.ready = false;
      if (this.inflight) { this.inflight.reject(new Error('conexão com o mixer caiu')); this.inflight = null; }
      clearTimeout(this.timer);
      // o FFmpeg pode ainda não ter aberto a porta: tenta de novo
      if (!this.closed) setTimeout(() => this.connect(), 300);
    });
  }

  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.stage === 'greeting') {
        if (this.buf.length < 64) return;
        if (this.buf[0] !== 0xff || this.buf[9] !== 0x7f) { this.sock?.destroy(); return; }
        this.buf = this.buf.subarray(64);
        this.sock.write(readyCommand());
        this.stage = 'frames';
        continue;
      }
      if (this.buf.length < 2) return;
      const flags = this.buf[0];
      const long = Boolean(flags & 2);
      const headLen = long ? 9 : 2;
      if (this.buf.length < headLen) return;
      const size = long ? Number(this.buf.readBigUInt64BE(1)) : this.buf[1];
      if (this.buf.length < headLen + size) return;
      const body = this.buf.subarray(headLen, headLen + size);
      this.buf = this.buf.subarray(headLen + size);
      if (flags & 4) { // comando (READY do outro lado)
        if (!this.ready) { this.ready = true; this.emit('ready'); this.#pump(); }
        continue;
      }
      this.parts.push(body);
      if (!(flags & 1)) { // último quadro da mensagem: [vazio, resposta]
        const reply = this.parts.filter((p) => p.length).map((p) => p.toString()).join('');
        this.parts = [];
        this.#settle(reply);
      }
    }
  }

  #settle(reply) {
    clearTimeout(this.timer);
    const job = this.inflight; this.inflight = null;
    if (job) {
      // resposta do filtro: "<código> <mensagem>", 0 = feito (o código de erro vem positivo, ex.: "40 Function not implemented")
      const code = Number.parseInt(reply, 10);
      if (code !== 0) job.reject(Object.assign(new Error(`comando recusado (${reply.trim()}): ${job.cmd}`), { code })); else job.resolve(reply);
    }
    this.#pump();
  }

  /**
   * Manda "<alvo> <comando> <valor>" (sintaxe do filtro zmq). key: comandos com a mesma chave ainda na fila são
   * substituídos pelo novo (só a posição mais recente da alavanca importa).
   */
  send(cmd, { key = null } = {}) {
    return new Promise((resolve, reject) => {
      if (key) {
        const i = this.q.findIndex((j) => j.key === key);
        if (i >= 0) { this.q[i].resolve('substituído'); this.q.splice(i, 1); }
      }
      this.q.push({ cmd, key, resolve, reject });
      this.#pump();
    });
  }

  #pump() {
    if (!this.ready || this.inflight || !this.q.length || !this.sock) return;
    const job = this.q.shift();
    this.inflight = job;
    this.sock.write(Buffer.concat([frame(Buffer.alloc(0), { more: true }), frame(Buffer.from(job.cmd))]));
    // sem resposta (mixer travado ou parado): libera a fila e reconecta
    this.timer = setTimeout(() => { if (this.inflight === job) { this.inflight = null; job.reject(new Error(`sem resposta do mixer: ${job.cmd}`)); this.sock?.destroy(); } }, this.timeoutMs);
  }

  close() {
    this.closed = true; clearTimeout(this.timer);
    for (const j of this.q) j.reject(new Error('mixer encerrado'));
    this.q = [];
    if (this.inflight) { this.inflight.reject(new Error('mixer encerrado')); this.inflight = null; }
    this.sock?.destroy(); this.sock = null;
  }
}
