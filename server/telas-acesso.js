/* NEXA Telas: o link e a senha do painel da repartição guardados também CIFRADOS (docs/TELAS.md, "Link e senha do painel").

   O login continua conferindo pelo resumo (link_hash = SHA-256 do link; link_pass = scrypt da senha). Para o Painel da
   Prefeitura poder MOSTRAR o link e a senha depois (o "olho"), os dois ficam também em AES-256-GCM (link_enc e pass_enc em
   telas_offices), no mesmo formato das outras chaves guardadas do projeto ("v1:" + base64 de iv(12) | tag(16) | texto;
   server/youtube-chaves.js, server/weather.js). A chave da cifra sai do SESSION_SECRET do servidor (SHA-256 de
   "nexa-reparticao-acesso:" + segredo); sem SESSION_SECRET (instalação local de desenvolvimento), de um arquivo
   DATA_DIR/telas-acesso.key gerado uma vez. Trocar o SESSION_SECRET deixa o que foi cifrado antes ilegível: o painel mostra
   "senha definida antes; gere uma nova" e o login segue valendo pelo resumo. */
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { config } from './config.js';

let fileSecret = null;
function localSecret() {
  if (fileSecret) return fileSecret;
  const file = path.join(config.dataDir, 'telas-acesso.key');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s.length >= 32) return (fileSecret = s); } catch { /* primeira vez */ }
  const s = randomBytes(32).toString('hex');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return (fileSecret = s);
}
const keyOf = (secret) => createHash('sha256').update(`nexa-reparticao-acesso:${secret}`).digest();

/** secret(): o segredo de onde sai a chave (testes trocam). */
export function createSealer({ secret = () => config.sessionSecret || localSecret() } = {}) {
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', keyOf(secret()), iv);
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
    },
    /** O texto em claro, ou null (nada guardado, formato errado, ou a chave do servidor mudou). */
    unseal(s) {
      if (typeof s !== 'string' || !s.startsWith('v1:')) return null;
      try {
        const b = Buffer.from(s.slice(3), 'base64');
        if (b.length < 29) return null;
        const d = createDecipheriv('aes-256-gcm', keyOf(secret()), b.subarray(0, 12), { authTagLength: 16 });
        d.setAuthTag(b.subarray(12, 28));
        return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
      } catch { return null; }
    },
  };
}

/** Letras e números sem os que se confundem (0/O/o, 1/l/I/i): a senha é lida e ditada por telefone. */
export const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Senha forte e legível para o painel da repartição: 4 blocos de 4 (ex.: "k7pq-xm4t-9wcd-hr2e"), ~79 bits. */
export function newOfficePassword() {
  const blocks = [];
  for (let b = 0; b < 4; b++) { let s = ''; for (let i = 0; i < 4; i++) s += PASS_ALPHABET[randomInt(PASS_ALPHABET.length)]; blocks.push(s); }
  return blocks.join('-');
}
