// Erro de LEITURA da entrada no stderr do FFmpeg, sem depender da configuração do servidor: usado por server/ffcaps.js (que
// reexporta) e pela parte pura do QC (server/fileqc-core.js), que o NEXA Scopes para Windows também usa (scopes-app/).

const READ_ERR = /Stream ends prematurely|Input\/output error|Connection reset|Connection timed out|Connection refused|Failed to reconnect|Server returned 5\d\d|Error in the pull function|IO error/i;

/**
 * stderr do FFmpeg com erro de LEITURA da entrada (a saída sai truncada mesmo com código 0). Um erro seguido de "Will
 * reconnect at …" foi vencido: o FFmpeg (com -reconnect) refez o pedido do ponto onde parou e seguiu lendo. Só conta o erro
 * que vem DEPOIS da última reconexão (ou sem nenhuma). 19/11: um original de 11,5 GB pela URL do R2 tem quedas curtas
 * normais em horas de leitura; a mensagem de cada uma, nos últimos 4 000 caracteres do stderr, dava "caiu no meio da
 * conversão (rede)" numa conversão que tinha terminado inteira. Uma leitura que terminou curta mesmo assim é pega depois,
 * pela duração do convertido (spanOf em server/transcode.js).
 */
export const readFailed = (stderr) => {
  let failed = false;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    if (/Will reconnect at/i.test(line)) failed = false; // a linha traz "error=Connection reset…": é a reconexão, não a falha
    else if (READ_ERR.test(line)) failed = true;
  }
  return failed;
};
