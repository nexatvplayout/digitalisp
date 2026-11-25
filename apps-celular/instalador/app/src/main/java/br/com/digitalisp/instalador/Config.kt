package br.com.digitalisp.instalador

/** Endereços e nomes fixos do instalador. */
object Config {
    /** O servidor DIGITAL ISP, de onde vem o app de tela de cada marca (/telas/app e /telas/tv). Só https. */
    const val SERVIDOR_PADRAO = "https://www.digitalisp.com.br"

    /** Pacote do app de tela Android, usado só se não der para ler o pacote do próprio APK. */
    const val PACOTE_APP_TELA_PADRAO = "br.com.digitalisp.telas"

    /** Ids do app de tela nas TVs, usados se o servidor não mandar (apps-tv/tizen/config.xml e webos/appinfo.json). */
    const val APP_ID_SAMSUNG_PADRAO = "DgIspTela1.Telas"
    const val APP_ID_LG_PADRAO = "br.com.digitalisp.telas"

    /** Caminho temporário do APK na TV box durante a instalação. */
    const val DESTINO_NA_TV = "/data/local/tmp/digitalisp-telas.apk"

    /** Nome com que o celular aparece na TV ("Permitir depuração de ... ?"). */
    const val NOME_NO_ADB = "DIGITAL ISP Instalador"

    /** Servidor da LG que renova a sessão do modo desenvolvedor (o mesmo do botão "Extend" do app Developer Mode). */
    const val LG_RENOVAR = "https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken="
    const val LG_CONSULTAR = "https://developer.lge.com/secure/CheckDevModeSession.dev?sessionToken="

    fun servidorValido(url: String): Boolean = Regex("^https://[A-Za-z0-9.-]+(:\\d+)?/?$").matches(url.trim())
}
