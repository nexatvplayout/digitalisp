// DIGITAL ISP · o que um QR code da tela pode levar: um endereço https, a rede Wi-Fi (o celular lê e entra na rede) ou um
// cartão de contato (vCard: o celular oferece salvar o contato). Usado pelo painel (montar) e pelo servidor (conferir).
const esc = (v) => String(v ?? '').replace(/([\\;,:"])/g, '\\$1');
const vesc = (v) => String(v ?? '').replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, ' ');

/** WIFI:T:WPA;S:rede;P:senha;H:false;; (T: WPA, WEP ou nopass). */
export function wifiQr({ ssid, password = '', security = 'WPA', hidden = false }) {
  const t = security === 'nopass' || !password ? 'nopass' : security === 'WEP' ? 'WEP' : 'WPA';
  return `WIFI:T:${t};S:${esc(ssid)};${t === 'nopass' ? '' : `P:${esc(password)};`}${hidden ? 'H:true;' : ''};`;
}
/** vCard 3.0 com nome, empresa, telefone, e-mail e site. */
export function vcardQr({ name, org = '', phone = '', email = '', url = '' }) {
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vesc(name)}`, `N:${vesc(name)};;;;`, org ? `ORG:${vesc(org)}` : '', phone ? `TEL;TYPE=CELL:${vesc(phone)}` : '',
    email ? `EMAIL:${vesc(email)}` : '', url ? `URL:${vesc(url)}` : '', 'END:VCARD'].filter(Boolean).join('\n');
}
/** O tipo do conteúdo: 'wifi', 'vcard', 'url' ou null. */
export function qrKind(s) {
  const v = String(s ?? '');
  if (/^WIFI:.*S:[^;]+;.*;$/s.test(v)) return 'wifi';
  if (/^BEGIN:VCARD\n[\s\S]*\nEND:VCARD$/.test(v.replace(/\r\n/g, '\n'))) return 'vcard';
  if (/^https:\/\/\S+$/.test(v)) return 'url';
  return null;
}
/** Para mostrar no painel: "Wi-Fi: rede", "Contato: nome" ou o endereço. */
export function qrLabel(s) {
  const k = qrKind(s);
  if (k === 'wifi') return `Wi-Fi: ${(/S:((?:\\.|[^;])*)/.exec(s)?.[1] || '').replace(/\\(.)/g, '$1')}`;
  if (k === 'vcard') return `Contato: ${(/\nFN:([^\n]*)/.exec(String(s).replace(/\r\n/g, '\n'))?.[1] || '').replace(/\\(.)/g, '$1')}`;
  return String(s ?? '');
}
