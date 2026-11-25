package br.com.digitalisp.telas.core

import org.json.JSONObject

/**
 * A marca da revenda (docs/CONTRATO-APP-MARCA.md). O app é white-label: na abertura, na tela de cadastro e na imagem
 * sem internet aparece a logo da revenda; antes do cadastro (sem marca), nada de marca nenhuma.
 * Um APK só para todas as revendas: a marca chega do servidor (ativação, recuperação e /config) e fica guardada no
 * aparelho para valer sem internet.
 */
data class Brand(
    /** Nome da revenda, só para quando a logo ainda não baixou (ou não veio). "" = sem nome. */
    val name: String = "",
    val logo: BrandLogo? = null,
    /** Cor de fundo da abertura e da imagem sem internet (ARGB, opaca). */
    val background: Int = Brands.DEFAULT_BACKGROUND,
    /** Cor do nome e dos realces nas telas de cadastro (ARGB, opaca). */
    val accent: Int = Brands.DEFAULT_ACCENT,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("nome", name)
        .put("corFundo", Brands.hex(background))
        .put("corDestaque", Brands.hex(accent))
        .apply { logo?.let { put("logoUrl", it.url).put("logoHash", it.sha256).put("logoBytes", it.bytes) } }

    /** Tem alguma coisa da revenda para mostrar? */
    val isEmpty: Boolean get() = name.isEmpty() && logo == null
}

/** O arquivo da logo: só https, SHA-256 conferido e tamanho conhecido. */
data class BrandLogo(val url: String, val sha256: String, val bytes: Long) {
    /** Nome do arquivo na pasta da marca (o formato, PNG, JPEG ou WebP, o Android descobre pelo conteúdo). */
    val fileName: String get() = "$sha256.img"

    fun asItem(): OfflineItem = OfflineItem(url, sha256, bytes)
}

/** O que a resposta do servidor diz da marca. */
sealed class BrandUpdate {
    /** Campo `marca` ausente: fica a guardada (servidor sem a função ou que não mudou nada). */
    object Keep : BrandUpdate()

    /** `marca: null`: volta ao neutro. */
    object Clear : BrandUpdate()

    data class Set(val brand: Brand) : BrandUpdate()
}

object Brands {
    const val FIELD = "marca"
    const val MAX_LOGO_BYTES = 1024L * 1024
    const val MAX_NAME = 60
    const val DEFAULT_BACKGROUND = 0xFF000000.toInt()
    const val DEFAULT_ACCENT = 0xFFFFFFFF.toInt()

    /** Tempo mínimo da abertura (ao abrir o app) e o máximo, se o conteúdo não começar antes. */
    const val SPLASH_MIN_MS = 3_000L
    const val SPLASH_MAX_MS = 15_000L

    private val SHA = Regex("[0-9a-f]{64}")
    private val COLOR = Regex("#[0-9a-fA-F]{6}")

    /** "#RRGGBB" → cor opaca; outro formato = null. */
    fun color(raw: Any?): Int? {
        val s = (raw as? String)?.trim() ?: return null
        if (!COLOR.matches(s)) return null
        return (0xFF000000 or s.substring(1).toLong(16)).toInt()
    }

    fun hex(c: Int): String = "#%06X".format(c and 0xFFFFFF)

    /** O SHA-256 em hex; aceita maiúsculas e o prefixo "sha256:". */
    fun sha(raw: Any?): String? {
        val s = (raw as? String)?.trim()?.lowercase()?.removePrefix("sha256:") ?: return null
        return s.takeIf { SHA.matches(it) }
    }

    /** A logo só vale com https, hash de 64 hex e de 1 byte a 1 MiB; senão, a marca fica sem logo (vale o nome). */
    fun logo(o: JSONObject): BrandLogo? {
        val url = Urls.clean(ConfigParser.str(o, "logoUrl"))?.takeIf { Urls.isHttps(it) } ?: return null
        val sha = sha(o.opt("logoHash")) ?: return null
        val bytes = (o.opt("logoBytes") as? Number)?.toLong() ?: return null
        if (bytes !in 1..MAX_LOGO_BYTES) return null
        return BrandLogo(url, sha, bytes)
    }

    /** Um objeto `marca`. Campo inválido é ignorado sozinho (cor errada = a padrão; logo errada = sem logo). */
    fun parse(o: JSONObject?): Brand? {
        if (o == null) return null
        val name = (o.opt("nome") as? String)?.replace(Regex("\\s+"), " ")?.trim()?.take(MAX_NAME).orEmpty()
        return Brand(
            name = name,
            logo = logo(o),
            background = color(o.opt("corFundo")) ?: DEFAULT_BACKGROUND,
            accent = color(o.opt("corDestaque")) ?: DEFAULT_ACCENT,
        )
    }

    /** Lê o campo `marca` de uma resposta (ativação, recuperação ou /config). */
    fun update(res: JSONObject?): BrandUpdate {
        if (res == null || !res.has(FIELD)) return BrandUpdate.Keep
        if (res.isNull(FIELD)) return BrandUpdate.Clear
        val o = res.opt(FIELD) as? JSONObject ?: return BrandUpdate.Keep // tipo errado: não apaga o que já tem
        return BrandUpdate.Set(parse(o) ?: return BrandUpdate.Keep)
    }

    fun update(body: String?): BrandUpdate = try {
        if (body.isNullOrEmpty()) BrandUpdate.Keep else update(JSONObject(body))
    } catch (_: Exception) {
        BrandUpdate.Keep
    }

    /** A marca que vale depois da resposta. */
    fun apply(current: Brand?, u: BrandUpdate): Brand? = when (u) {
        BrandUpdate.Keep -> current
        BrandUpdate.Clear -> null
        is BrandUpdate.Set -> u.brand.takeUnless { it == Brand() } // `marca: {}` = neutro
    }

    /** O que ficou guardado no aparelho (o mesmo formato do contrato). */
    fun fromStore(json: String?): Brand? = try {
        if (json.isNullOrEmpty()) null else parse(JSONObject(json))
    } catch (_: Exception) {
        null
    }

    data class Plan(val download: BrandLogo?, val delete: List<String>, val show: String?)

    /**
     * Mantém a última logo boa: a nova só substitui a antiga depois de baixada e conferida.
     * @param existing nome → tamanho dos arquivos na pasta da marca (completos e `.part`)
     * - sem logo na marca: apaga tudo (a tela mostra o nome, ou o neutro);
     * - a pedida já está no aparelho: mostra ela e apaga o resto;
     * - falta a pedida: baixa; enquanto isso mostra a anterior (se houver) e só apaga os `.part` de outras.
     */
    fun plan(logo: BrandLogo?, existing: Map<String, Long>): Plan {
        if (logo == null) return Plan(null, existing.keys.sorted(), null)
        val want = logo.fileName
        if (existing[want] == logo.bytes) return Plan(null, existing.keys.filter { it != want }.sorted(), want)
        val part = want + OfflinePlan.PART
        val complete = existing.filterKeys { !it.endsWith(OfflinePlan.PART) && it != want && it.endsWith(".img") }
        val delete = existing.keys.filter { it != part && it !in complete.keys }.sorted()
        return Plan(logo, delete, complete.keys.sorted().firstOrNull())
    }

    /**
     * A abertura (tela cheia com a logo, ou o neutro) ao abrir o app: fica pelo menos [SPLASH_MIN_MS]; depois some quando
     * o conteúdo começa, quando o app ainda não está cadastrado (vai para a tela de cadastro) ou no máximo [SPLASH_MAX_MS].
     */
    fun splashVisible(sinceOpenMs: Long, configured: Boolean, contentPlaying: Boolean): Boolean = when {
        sinceOpenMs < SPLASH_MIN_MS -> true
        !configured || contentPlaying -> false
        else -> sinceOpenMs < SPLASH_MAX_MS
    }
}
