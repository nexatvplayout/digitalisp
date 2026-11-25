package br.com.digitalisp.instalador.rede

/** Marca/plataforma do aparelho achado na rede. */
enum class Plataforma { ANDROID, SAMSUNG, LG }

/**
 * Um aparelho achado na rede (por mDNS, pela varredura de portas ou digitado à mão).
 *
 * @property portaAdb porta do ADB por TCP puro (normalmente 5555).
 * @property portaTls porta anunciada em `_adb-tls-connect._tcp` (depuração por Wi-Fi do Android 11+).
 * @property portaPareamento porta anunciada em `_adb-tls-pairing._tcp` (só enquanto a TV mostra o código).
 * @property portaDev Samsung 26101 (sdb) ou LG 9922 (SSH) aberta: o modo desenvolvedor da TV está ligado.
 */
data class TvEncontrada(
    val host: String,
    val plataforma: Plataforma,
    val nome: String? = null,
    val portaAdb: Int? = null,
    val portaTls: Int? = null,
    val portaPareamento: Int? = null,
    val portaDev: Int? = null,
) {
    /** Android, Samsung e LG instalam pelo celular. */
    val instalavel: Boolean get() = true

    /** Porta para conectar o ADB: a da depuração por Wi-Fi tem prioridade, depois a 5555. */
    val portaConexao: Int? get() = portaTls ?: portaAdb

    /** Só dá para entrar depois de parear (Android 11+ sem a 5555 aberta). */
    val precisaParear: Boolean get() = plataforma == Plataforma.ANDROID && portaConexao == null && portaPareamento != null

    val titulo: String
        get() = when (plataforma) {
            Plataforma.ANDROID -> "TV box Android"
            Plataforma.SAMSUNG -> "TV Samsung"
            Plataforma.LG -> "TV LG"
        }

    val detalhe: String
        get() = buildString {
            append(host)
            if (!nome.isNullOrBlank()) append(" · ").append(nome)
            when {
                plataforma != Plataforma.ANDROID && portaDev != null -> append(" · modo desenvolvedor ligado")
                plataforma != Plataforma.ANDROID -> append(" · ligue o modo desenvolvedor na TV")
                portaConexao != null -> append(" · pronta para instalar")
                portaPareamento != null -> append(" · precisa do código de pareamento")
            }
        }

    /** Junta duas informações do mesmo aparelho (mesmo IP). O que já se sabe não é apagado. */
    fun juntar(outra: TvEncontrada): TvEncontrada {
        require(outra.host == host) { "hosts diferentes" }
        // Android ganha: a 5555 aberta ou o mDNS do ADB é prova mais forte do que uma porta "parecida" com Samsung/LG.
        val plat = if (plataforma == Plataforma.ANDROID || outra.plataforma == Plataforma.ANDROID) Plataforma.ANDROID else plataforma
        return TvEncontrada(
            host = host,
            plataforma = plat,
            nome = outra.nome?.takeIf { it.isNotBlank() } ?: nome,
            portaAdb = outra.portaAdb ?: portaAdb,
            portaTls = outra.portaTls ?: portaTls,
            portaPareamento = outra.portaPareamento ?: portaPareamento,
            portaDev = outra.portaDev ?: portaDev,
        )
    }
}

/** Lista de aparelhos achados, um por IP, sem repetição. Segura para várias threads. */
class Catalogo {
    private val porHost = LinkedHashMap<String, TvEncontrada>()

    /** Devolve true se a lista mudou. */
    @Synchronized
    fun adicionar(tv: TvEncontrada): Boolean {
        val antes = porHost[tv.host]
        val depois = antes?.juntar(tv) ?: tv
        porHost[tv.host] = depois
        return antes != depois
    }

    @Synchronized
    fun obter(host: String): TvEncontrada? = porHost[host]

    /** Android primeiro (é o que instala), depois por IP em ordem numérica. */
    @Synchronized
    fun lista(): List<TvEncontrada> = porHost.values.sortedWith(
        compareBy<TvEncontrada> { it.plataforma.ordinal }.thenBy { Subrede.ordenacaoIp(it.host) }
    )

    @Synchronized
    fun limpar() = porHost.clear()
}
