package br.com.digitalisp.instalador

/**
 * Valores que dependem do dono. Tudo o que estiver com SERVIDOR_A_DEFINIR precisa do endereço real do servidor do
 * DIGITAL ISP antes de ir para os técnicos. O endereço do APK também pode ser trocado na tela de ajustes do app.
 */
object Config {
    /** Onde o instalador baixa o app de tela (APK de release). Só https. */
    const val URL_APK_PADRAO = "https://SERVIDOR_A_DEFINIR/app/telas.apk"

    /** Marcador que indica que o endereço ainda não foi definido. */
    const val MARCADOR = "SERVIDOR_A_DEFINIR"

    /** Pacote do app de tela, usado só se não der para ler o pacote do próprio APK. */
    const val PACOTE_APP_TELA_PADRAO = "br.com.digitalisp.telas"

    /** Caminho temporário do APK na TV durante a instalação. */
    const val DESTINO_NA_TV = "/data/local/tmp/digitalisp-telas.apk"

    /** Nome com que o celular aparece na TV ("Permitir depuração de ... ?"). */
    const val NOME_NO_ADB = "DIGITAL ISP Instalador"

    /** Diz se o endereço ainda é o marcador (o app avisa e pede um APK local ou o endereço certo). */
    fun urlIndefinida(url: String): Boolean = url.isBlank() || url.contains(MARCADOR)
}
