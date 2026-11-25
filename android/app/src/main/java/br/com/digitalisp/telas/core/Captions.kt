package br.com.digitalisp.telas.core

import org.json.JSONObject

/** Legendas da programação (contrato §14): o que o painel define. lang null = o idioma do canal (a legenda do ar). */
data class CaptionsCfg(val on: Boolean = false, val lang: String? = null)

/** A escolha feita no aparelho e a configuração do painel que valia quando ela foi feita (`basis`). */
data class LocalCaptions(val on: Boolean, val lang: String?, val basis: CaptionsCfg)

object CaptionsPolicy {
    /** Os idiomas que o painel pode mandar (server/telas-core.js CAPTION_LANGS). */
    val LANGS = listOf("pt", "en", "es", "fr", "de", "it", "zh-CN", "ja", "ko", "ru", "ar")

    fun parse(o: JSONObject?): CaptionsCfg {
        if (o == null) return CaptionsCfg()
        val lang = ConfigParser.str(o, "lang")?.takeIf { it in LANGS }
        return CaptionsCfg(o.optBoolean("on", false), lang)
    }

    /**
     * O que vale: a escolha do aparelho, enquanto o painel não mudou desde que ela foi feita; mudou o painel, vale o
     * painel (e a escolha do aparelho é esquecida). Assim o cliente não depende de quem mexe no aparelho, e o técnico
     * no local ainda pode ligar/trocar na hora.
     */
    fun effective(panel: CaptionsCfg, local: LocalCaptions?): CaptionsCfg =
        if (local != null && local.basis == panel) CaptionsCfg(local.on, local.lang) else panel

    /** A escolha do aparelho ficou velha (o painel mudou depois dela)? */
    fun stale(panel: CaptionsCfg, local: LocalCaptions?): Boolean = local != null && local.basis != panel

    /** Nome do idioma em português. null/"und" = o do canal. */
    fun name(code: String?): String = when (code?.substringBefore('-')?.lowercase()) {
        null, "", "und" -> "do canal"
        "pt" -> "português"
        "en" -> "inglês"
        "es" -> "espanhol"
        "fr" -> "francês"
        "de" -> "alemão"
        "it" -> "italiano"
        "zh" -> "chinês"
        "ja" -> "japonês"
        "ko" -> "coreano"
        "ru" -> "russo"
        "ar" -> "árabe"
        else -> code
    }

    /** O próximo idioma no botão dos ajustes: "do canal" e depois os que o fluxo oferece (sem repetir), em círculo. */
    fun nextLang(current: String?, available: List<String?>): String? {
        val list = listOf<String?>(null) + available.filterNotNull().filter { it != "und" }.distinct()
        val i = list.indexOf(current)
        return list[(i + 1).mod(list.size)]
    }

    /** Guardar no aparelho: "on|lang|basisOn|basisLang" (lang vazia = do canal). */
    fun encode(l: LocalCaptions?): String = if (l == null) "" else listOf(l.on, l.lang ?: "", l.basis.on, l.basis.lang ?: "").joinToString("|")

    fun decode(s: String?): LocalCaptions? {
        val p = s?.split('|') ?: return null
        if (p.size != 4) return null
        return LocalCaptions(p[0] == "true", p[1].ifEmpty { null }, CaptionsCfg(p[2] == "true", p[3].ifEmpty { null }))
    }
}
