// TV Corporativa · aba Instalar o aplicativo (docs/TV-CORPORATIVA.md §2.1 e §6): o roteiro para pôr uma TV box na rede
// (Android 7 ou mais novo), o endereço e o QR code do aplicativo NEXA Telas (/telas/app/latest.apk, servido pelo próprio
// servidor) e a versão disponível. Depois de instalado, o app se atualiza sozinho.
import { el, put, label, note, btn, btns, D } from './tvcorp-base.js';
import { copyText } from '../lib.js';
import { qrSvg } from '../../shared/telas-previa.js';
import { newKey } from './tvcorp-telas.js';

/** O endereço do APK: o do servidor da API (o painel pode estar hospedado em outro endereço). */
export const apkUrl = () => `${globalThis.window?.NEXA?.apiBase || globalThis.location?.origin || ''}/telas/app/latest.apk`;

export default async function paintInstalar(box, ctx) {
  const v = D().appLatest; const url = apkUrl();
  const step = (title, text) => el('li', {}, el('b', { text: title }), el('div', { class: 'dim', text }));
  put(box,
    el('div', { class: 'tc-two' },
      el('div', {},
        label('Passo a passo'),
        el('ol', { class: 'tc-steps' },
          step('Prepare a TV box', 'Uma TV box com Android 7 ou mais novo, ligada na TV pelo HDMI e na internet (de preferência por cabo).'),
          step('Gere a chave', 'Aqui no painel, em Telas, clique em "+ TV box", escolha a unidade e anote a chave (vale 24 horas, para uma tela).'),
          step('Baixe o aplicativo', 'No navegador da TV box, digite o endereço ao lado. Ou leia o QR code com o celular e passe o arquivo por um pen drive.'),
          step('Instale', 'Abra o arquivo baixado. Se o Android pedir, permita instalar aplicativos desta origem (só para o navegador usado).'),
          step('Abra e digite a chave', 'Abra o NEXA Telas, digite a chave e confirme. Em segundos a tela aparece na aba Telas, já com a grade da unidade.'),
          step('Pronto', 'O aplicativo abre sozinho quando a TV box liga, trava a saída com o PIN e se atualiza sozinho. Se for reinstalado, volta sozinho para a mesma tela.')),
        btns(btn('+ TV box: gerar a chave', () => newKey(ctx.reload), 'primary'), btn('Ver as telas', () => ctx.go('telas')))),
      el('div', { class: 'tc-apk' },
        label('Aplicativo NEXA Telas'),
        note(v ? `Versão disponível: ${v.versionName || v.versionCode}${v.versionCode ? ` (código ${v.versionCode})` : ''}.` : 'A versão disponível aparece quando o servidor tiver o aplicativo publicado.', 'small'),
        qrSvg(url, 'tc-qr-big'),
        el('div', { class: 'pf-url', text: url }),
        btns(btn('Copiar o endereço', () => copyText(url), 'small')))),
    note('Dica: anote o PIN de saída da unidade (Unidades e grupos → PIN novo) antes de ir até a TV box. Ele destrava o aparelho no local, depois da sequência de teclas do controle remoto.'));
}
