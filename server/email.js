// DIGITAL ISP · envio de e-mail (recuperação de senha; depois, os avisos).
//
// SMTP_URL   o serviço de envio, num endereço só: smtps://usuario:senha@smtp.exemplo.com:465 (ou smtp://...:587, que
//            sobe para TLS com STARTTLS). Serve qualquer provedor com SMTP: Amazon SES, Resend, Brevo, Mailgun, Zoho, Google.
// MAIL_FROM  quem envia, ex.: "DIGITAL ISP <nao-responda@digitalisp.com.br>" (o domínio precisa estar liberado no provedor)
// MAIL_OUTBOX=1  (desenvolvimento e testes) não envia: grava cada e-mail em DATA_DIR/caixa-de-saida/*.json
//
// Sem SMTP_URL (e sem MAIL_OUTBOX), o e-mail fica desligado e a recuperação de senha some da tela de login.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const smtpUrl = () => (process.env.SMTP_URL || '').trim();
const outbox = () => process.env.MAIL_OUTBOX === '1' && !config.production;
export const OUTBOX_DIR = () => path.join(config.dataDir, 'caixa-de-saida');
export const mailFrom = () => (process.env.MAIL_FROM || 'DIGITAL ISP <nao-responda@digitalisp.com.br>').trim();

/** Há como enviar e-mail. */
export const emailLigado = () => Boolean(smtpUrl()) || outbox();

/** O estado para a tela de Integrações (sem usuário nem senha do SMTP). */
export function emailEstado() {
  const u = smtpUrl();
  if (u) { try { return { ligado: true, servidor: new URL(u).hostname, remetente: mailFrom() }; } catch { return { ligado: false, erro: 'SMTP_URL inválida' }; } }
  return { ligado: outbox(), servidor: outbox() ? 'caixa de saída local (MAIL_OUTBOX=1)' : null, remetente: mailFrom() };
}

let transport = null;
async function smtp() {
  if (!transport) {
    const { default: nodemailer } = await import('nodemailer');
    transport = nodemailer.createTransport(smtpUrl(), { from: mailFrom() });
  }
  return transport;
}

/** Envia { to, subject, text, html }. Lança se o serviço recusar. */
export async function enviarEmail(msg) {
  if (smtpUrl()) return (await smtp()).sendMail({ from: mailFrom(), ...msg });
  if (outbox()) {
    fs.mkdirSync(OUTBOX_DIR(), { recursive: true });
    const f = path.join(OUTBOX_DIR(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(f, JSON.stringify({ from: mailFrom(), ...msg, at: new Date().toISOString() }, null, 2));
    return { outbox: f };
  }
  throw new Error('e-mail desligado (defina SMTP_URL)');
}

/** Confere o login no SMTP agora (botão "Testar" das Integrações). */
export async function testarEmail() {
  if (!smtpUrl()) return outbox() ? 'Caixa de saída local (MAIL_OUTBOX=1): os e-mails ficam em arquivo.' : null;
  await (await smtp()).verify();
  return `O servidor ${new URL(smtpUrl()).hostname} aceitou o login.`;
}
