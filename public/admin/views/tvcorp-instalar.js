// Aba "Aplicativos" (DIGITAL ISP): todos os aplicativos para baixar, separados por aparelho, cada um com o instalador e o
// passo a passo. As versões vêm do próprio servidor na hora (/telas/app, /telas/tv e /instalador latest.json): quando sai
// uma versão nova, ela aparece aqui sozinha, e os aparelhos já instalados se atualizam sozinhos.
import { el, put, label, note, btn, btns } from './tvcorp-base.js';
import { copyText } from '../lib.js';
import { qrSvg } from '../../shared/telas-previa.js';
import { newKey } from './tvcorp-telas.js';

/** O endereço do servidor da API (o painel pode estar hospedado em outro endereço). */
const base = () => globalThis.window?.NEXA?.apiBase || globalThis.location?.origin || '';
/** O endereço do APK das TV box e do Fire TV. */
export const apkUrl = () => `${base()}/telas/app/latest.apk`;
const lerJson = (p) => fetch(`${base()}${p}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const mb = (b) => (b ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : '');

/** Um arquivo para baixar: o botão, o endereço para copiar e, se pedir, o QR code (para baixar pelo celular ou pela TV). */
function arquivo({ nome, url, desc, qr = false }) {
  return el('div', { class: 'ap-arq' },
    qr ? qrSvg(url, 'ap-qr') : null,
    el('div', { class: 'ap-arq-b' },
      el('b', { text: nome }),
      desc ? el('div', { class: 'dim small', text: desc }) : null,
      el('div', { class: 'pf-url small', text: url }),
      btns(el('a', { class: 'btn small primary', href: url, download: '', text: 'Baixar' }), btn('Copiar o endereço', () => copyText(url), 'small'))));
}
/** Uma categoria: o aparelho, a versão publicada, os arquivos e o passo a passo. */
function categoria({ titulo, versao, arquivos, passos, aviso }) {
  return el('section', { class: 'ap-cat' },
    el('div', { class: 'ap-cab' }, el('h3', { text: titulo }), el('span', { class: `ap-ver${versao ? '' : ' off'}`, text: versao ? `Versão ${versao}` : 'Ainda não publicado' })),
    el('div', { class: 'ap-arqs' }, ...arquivos.map(arquivo)),
    passos?.length ? el('details', { class: 'ap-passos' }, el('summary', { text: 'Como instalar' }), el('ol', {}, ...passos.map((p) => el('li', { text: p })))) : null,
    aviso ? note(aviso, 'small') : null);
}

export default async function paintInstalar(box, ctx) {
  put(box, note('Carregando os aplicativos…'));
  const [app, tv, inst] = await Promise.all([lerJson('/telas/app/latest.json'), lerJson('/telas/tv/latest.json'), lerJson('/instalador/latest.json')]);
  const B = base();
  put(box,
    note('Todos os aplicativos do DIGITAL ISP, sempre na última versão publicada. Quando sai uma versão nova, ela aparece aqui sozinha, e as telas já instaladas se atualizam sozinhas.'),
    btns(btn('+ TV box: gerar a chave', () => newKey(ctx.reload), 'primary'), btn('Ver as telas', () => ctx.go('telas'))),
    categoria({
      titulo: 'TV box Android e Amazon Fire TV',
      versao: app?.versionName || app?.versionCode || null,
      arquivos: [
        { nome: 'Aplicativo DIGITAL ISP (APK)', url: apkUrl(), desc: `Para TV box com Android 7 ou mais novo e Fire TV. ${mb(app?.bytes)}`.trim(), qr: true },
        { nome: 'Instalador pelo computador (Windows)', url: `${B}/instaladores/tv-box.zip`, desc: 'Instala no Fire TV ou na TV box ligada ao computador pelo cabo USB, ou pela rede. Baixa sozinho a versão mais nova do app.' },
      ],
      passos: [
        'Gere a chave aqui no painel (Telas → + TV box) e anote: vale 24 horas, para uma tela.',
        'TV box: no navegador dela, abra o endereço do APK (ou leia o QR code) e instale. Se o Android pedir, permita instalar desta origem.',
        'Fire TV: em Configurações → Minha Fire TV → Sobre, clique 7 vezes no nome do aparelho; depois ligue a Depuração ADB em Opções do desenvolvedor. No computador, extraia o ZIP do instalador e clique em INSTALAR.bat.',
        'Abra o app, digite a chave e pronto: a tela aparece em Telas. O menu do aparelho abre com ↑ ↑ ↓ ↓ OK e a senha do menu.',
      ],
    }),
    categoria({
      titulo: 'TV Philips (Android TV / Google TV)',
      versao: app?.versionName || app?.versionCode || null,
      arquivos: [
        { nome: 'Kit do pendrive para Philips (ZIP)', url: `${B}/telas/app/philips-pendrive.zip`, desc: `O app mais novo, o passo a passo e o INSTALAR.bat (Windows): ele copia o app para o pendrive ou instala direto na TV pela rede. Android 9 até 14. ${mb(app?.bytes)}`.trim() },
        { nome: 'Aplicativo DIGITAL ISP (APK)', url: apkUrl(), desc: 'O mesmo app, para baixar direto na TV pelo navegador ou pelo app Downloader.', qr: true },
      ],
      passos: [
        'No computador, extraia o ZIP e clique duas vezes em INSTALAR.bat: escolha 1 para copiar o app para o pendrive, ou 2 para instalar direto na TV pela rede (com a depuração ligada nas Opções do desenvolvedor da TV).',
        'Na TV, uma vez só: Configurações → Sistema → Sobre, clique 7 vezes em "Build do SO Android TV" para ligar o modo desenvolvedor.',
        'Na Google Play da TV, instale um gerenciador de arquivos (por exemplo File Commander ou X-plore) e libere para ele: Configurações → Apps → Segurança e restrições → Fontes desconhecidas.',
        'Ligue o pendrive na USB da TV, abra o gerenciador, escolha DIGITAL-ISP-Telas.apk e instale. Se o Play Protect avisar, use "Mais detalhes" → "Instalar mesmo assim".',
        'Abra o app, digite a chave da tela e pronto. Para abrir sozinho ao ligar, no menu do app (↑ ↑ ↓ ↓ OK) escolha o app como tela inicial e libere "Sobrepor a outros apps".',
      ],
      aviso: 'Só nas Philips com Android TV ou Google TV (com a Google Play). As Philips com Titan OS ou Saphi não aceitam apps de fora da loja.',
    }),
    categoria({
      titulo: 'TV Samsung (Tizen)',
      versao: tv?.tizen?.version || null,
      arquivos: [
        { nome: 'Aplicativo DIGITAL ISP para Samsung (.wgt)', url: `${B}/telas/tv/latest.wgt`, desc: `Pacote assinado. ${mb(tv?.tizen?.bytes)}`.trim() },
        { nome: 'Instalador pelo celular (Android)', url: `${B}/instalador/latest.apk`, desc: 'Instala o app na TV pela rede, do celular do técnico.', qr: true },
      ],
      passos: [
        'Na TV, ligue o modo desenvolvedor (Apps → digite 1 2 3 4 5) e informe o IP do celular com o instalador.',
        'No celular, abra o Instalador DIGITAL ISP, escolha Samsung e a TV na rede: ele baixa o pacote mais novo e instala.',
        'Abra o app na TV, digite a chave da tela e pronto. O menu abre com ↑ ↑ ↓ ↓ OK (ou a tecla verde) e a senha do menu.',
      ],
      aviso: 'A TV Samsung só aceita o pacote se ela estiver no certificado do DIGITAL ISP. TV nova: avise o suporte para incluí-la.',
    }),
    categoria({
      titulo: 'TV LG (webOS)',
      versao: tv?.webos?.version || null,
      arquivos: [
        { nome: 'Aplicativo DIGITAL ISP para LG (.ipk)', url: `${B}/telas/tv/latest.ipk`, desc: mb(tv?.webos?.bytes) },
        { nome: 'Instalador pelo celular (Android)', url: `${B}/instalador/latest.apk`, desc: 'Instala o app na TV pela rede, do celular do técnico.', qr: true },
      ],
      passos: [
        'Na TV, instale o Developer Mode pela loja da LG, entre com a conta de desenvolvedor e ligue o Key Server.',
        'No celular, abra o Instalador DIGITAL ISP, escolha LG e a TV na rede: ele baixa o pacote mais novo e instala.',
        'Abra o app na TV, digite a chave da tela e pronto. O menu abre com ↑ ↑ ↓ ↓ OK (ou a tecla verde) e a senha do menu.',
      ],
    }),
    categoria({
      titulo: 'Celular do técnico',
      versao: inst?.versionName || inst?.versionCode || null,
      arquivos: [{ nome: 'Instalador DIGITAL ISP (Android)', url: `${B}/instalador/latest.apk`, desc: `Instala o app nas TVs Samsung e LG pela rede. ${mb(inst?.bytes)}`.trim(), qr: true }],
      passos: ['Leia o QR code com o celular, baixe e instale (permita instalar desta origem, se o Android pedir).'],
    }));
}
