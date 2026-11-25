package br.com.digitalisp.instalador.rede

/** Serviços mDNS que o ADB anuncia, e como cada um vira informação de um aparelho. Sem Android (testável). */
object ServicosAdb {
    const val CONEXAO_TLS = "_adb-tls-connect._tcp"
    const val PAREAMENTO = "_adb-tls-pairing._tcp"
    const val ADB = "_adb._tcp"
    val TODOS = listOf(CONEXAO_TLS, PAREAMENTO, ADB)

    /** O NsdManager devolve o tipo com ou sem ponto no começo/fim e às vezes com ".local"; normaliza. */
    fun normalizar(tipo: String): String = tipo.trim().trim('.').removeSuffix(".local").trim('.')

    /**
     * Converte um serviço resolvido em [TvEncontrada]. Tipo desconhecido, host vazio ou porta fora da faixa: null.
     */
    fun paraTv(tipo: String, nomeServico: String, host: String, porta: Int): TvEncontrada? {
        if (porta !in 1..65535 || host.isBlank()) return null
        val nome = nomeAmigavel(nomeServico)
        return when (normalizar(tipo)) {
            CONEXAO_TLS -> TvEncontrada(host, Plataforma.ANDROID, nome = nome, portaTls = porta)
            PAREAMENTO -> TvEncontrada(host, Plataforma.ANDROID, nome = nome, portaPareamento = porta)
            ADB -> TvEncontrada(host, Plataforma.ANDROID, nome = nome, portaAdb = porta)
            else -> null
        }
    }

    /** O nome do serviço é do tipo "adb-SERIAL-xYz123"; mostramos o SERIAL. Outro formato fica como veio. */
    fun nomeAmigavel(nomeServico: String): String? {
        val n = nomeServico.trim()
        if (n.isEmpty()) return null
        val m = Regex("^adb-(.+)-[A-Za-z0-9]{6}$").find(n)
        return m?.groupValues?.get(1) ?: n
    }
}
