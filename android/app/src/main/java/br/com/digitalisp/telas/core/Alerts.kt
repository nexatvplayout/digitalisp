package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/** `level`: 0 = info, 1 = warn, 2 = critical. `until` em epoch ms; 0 = sem fim marcado (vale enquanto estiver na lista). */
/**
 * Contrato §9 (opcionais): `header` = a linha de cima do alerta ("" = o cabeçalho de sempre, pelo nível); `category` =
 * o tipo, para o ícone ("" = sem ícone); `test` = teste ou simulação (a palavra TESTE fica na tela o tempo todo).
 */
data class Alert(
    val id: Long, val title: String, val text: String, val level: Int, val sound: Boolean, val until: Long,
    val header: String = "", val category: String = "", val test: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("title", title).put("text", text)
        .put("level", Alerts.LEVELS[level]).put("sound", sound).put("until", until)
        .put("header", header).put("category", category).put("test", test)
}

/** O último alerta que terminou no horário marcado; aparece na coluna lateral por um tempo. */
data class RecentAlert(val alert: Alert, val endedAt: Long)

object Alerts {
    val LEVELS = listOf("info", "warn", "critical")
    const val RECENT_MS = 30 * 60 * 1000L

    val CATEGORIES = setOf("meteorologico", "geologico", "tecnologico", "incendio-ar", "saude", "seguranca", "transito", "teste", "outro")
    private val DEFAULT_HEADERS = listOf("AVISO", "ATENÇÃO", "ALERTA")
    private val PT_BR = java.util.Locale("pt", "BR")

    fun levelOf(raw: String?): Int = LEVELS.indexOf(raw?.trim()?.lowercase()).coerceAtLeast(0)

    /** Só texto de verdade vale (número, lista, objeto, null = como se ausente). Uma linha só, até 60 caracteres. */
    fun headerOf(raw: Any?): String = (raw as? String)?.replace(Regex("\\s+"), " ")?.trim()?.take(60).orEmpty()

    /** Categoria desconhecida ou de tipo errado = sem ícone. */
    fun categoryOf(raw: Any?): String = (raw as? String)?.trim()?.lowercase()?.takeIf { it in CATEGORIES }.orEmpty()

    /** A linha de cima do alerta em tela cheia: o `header` do servidor em caixa alta ou, sem ele, o de sempre pelo nível. */
    fun headerFor(a: Alert): String = if (a.header.isNotEmpty()) a.header.uppercase(PT_BR) else DEFAULT_HEADERS[a.level.coerceIn(0, 2)]

    fun parse(arr: JSONArray?): List<Alert> {
        if (arr == null) return emptyList()
        val out = ArrayList<Alert>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val title = ConfigParser.str(o, "title") ?: ""
            val text = ConfigParser.str(o, "text") ?: ""
            if (title.isEmpty() && text.isEmpty()) continue
            out.add(
                Alert(
                    o.optLong("id", 0L), title, text, levelOf(ConfigParser.str(o, "level")), o.optBoolean("sound", false), o.optLong("until", 0L).coerceAtLeast(0L),
                    header = headerOf(o.opt("header")), category = categoryOf(o.opt("category")), test = o.opt("test") == true,
                ),
            )
        }
        return out
    }

    fun parse(json: String?): List<Alert> = try {
        if (json.isNullOrEmpty()) emptyList() else parse(JSONArray(json))
    } catch (_: Exception) {
        emptyList()
    }

    fun toJson(list: List<Alert>): String = JSONArray().also { a -> list.forEach { a.put(it.toJson()) } }.toString()

    fun active(list: List<Alert>, now: Long): List<Alert> = list.filter { it.until == 0L || it.until > now }

    /** O que vai para a tela cheia: maior nível; no empate, o mais novo (maior id). */
    fun select(list: List<Alert>, now: Long): Alert? =
        active(list, now).maxWithOrNull(compareBy<Alert> { it.level }.thenBy { it.id })

    /**
     * Atualiza o "último aviso" quando chega uma lista nova (ou o tempo passa). Alerta que chegou ao `until`
     * vira o recente; alerta que saiu da lista antes da hora foi encerrado por quem enviou e some de vez.
     */
    fun recentAfter(prev: RecentAlert?, old: List<Alert>, new: List<Alert>, now: Long): RecentAlert? {
        var recent = prev
        val newIds = new.map { it.id }.toSet()
        for (a in old) {
            if (a.until in 1..now) {
                if (recent == null || a.until >= recent.endedAt) recent = RecentAlert(a, a.until)
            } else if (a.id !in newIds && recent?.alert?.id == a.id) {
                recent = null
            }
        }
        if (recent != null && (now - recent.endedAt >= RECENT_MS || recent.endedAt > now)) recent = null
        return recent
    }
}
