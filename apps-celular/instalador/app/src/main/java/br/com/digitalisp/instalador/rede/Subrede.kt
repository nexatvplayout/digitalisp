package br.com.digitalisp.instalador.rede

/** Contas da sub-rede IPv4 do Wi-Fi, sem nada de Android (testável na JVM). */
object Subrede {
    /** Maior quantidade de endereços varridos: uma /24. Redes maiores varrem só a /24 em volta do celular. */
    const val MAX_HOSTS = 254

    fun paraInt(ip: String): Int {
        val partes = ip.trim().split('.')
        require(partes.size == 4) { "IP inválido: $ip" }
        var v = 0
        for (p in partes) {
            val n = if (p.isNotEmpty() && p.all { it.isDigit() } && p.length <= 3) p.toInt() else -1
            require(n in 0..255) { "IP inválido: $ip" }
            v = (v shl 8) or n
        }
        return v
    }

    fun paraTexto(v: Int): String = "${(v ushr 24) and 255}.${(v ushr 16) and 255}.${(v ushr 8) and 255}.${v and 255}"

    fun ipValido(ip: String): Boolean = runCatching { paraInt(ip) }.isSuccess

    /** Chave para ordenar IPs em ordem numérica (sem sinal). */
    fun ordenacaoIp(ip: String): Long = runCatching { paraInt(ip).toLong() and 0xFFFFFFFFL }.getOrDefault(Long.MAX_VALUE)

    /**
     * Endereços a varrer na rede do celular, sem o endereço da rede, o de broadcast e o do próprio celular.
     * Prefixo menor que /24 (rede grande) é reduzido à /24 do celular. Prefixo /31 ou /32 não tem vizinhos.
     */
    fun hosts(ipCelular: String, prefixo: Int): List<String> {
        require(prefixo in 0..32) { "prefixo inválido: $prefixo" }
        val p = maxOf(prefixo, 24)
        if (p >= 31) return emptyList()
        val ip = paraInt(ipCelular)
        val mascara = -1 shl (32 - p)
        val rede = ip and mascara
        val broadcast = rede or mascara.inv()
        val saida = ArrayList<String>()
        var h = rede + 1
        while (h < broadcast && saida.size < MAX_HOSTS) {
            if (h != ip) saida.add(paraTexto(h))
            h++
        }
        return saida
    }
}
