package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Relatório de exibição da TV Corporativa (docs/TV-CORPORATIVA.md §4.3): quantas vezes e por quanto tempo cada item
 * apareceu, por dia. Vai no sinal de vida como `plays` + `playsDay` e só é descontado depois do 200 (sem rede, a conta
 * continua guardada e sai na volta). Sem Android aqui dentro.
 *
 * Um sinal de vida leva um dia só (o mais antigo pendente) e no máximo [MAX_PER_BEAT] itens; o resto sai nos próximos.
 */
class PlayLog {
    data class Entry(val ref: String, val n: Int, val sec: Long)
    data class Batch(val day: String, val entries: List<Entry>)

    private class Acc(var n: Int = 0, var ms: Long = 0L)

    /** dia → item → conta; dias em ordem (YYYY-MM-DD ordena como texto). */
    private val days = java.util.TreeMap<String, LinkedHashMap<String, Acc>>()

    /** Mudou desde a última gravação no disco? */
    @Volatile var dirty = false
        private set

    /** O item [ref] entrou na tela (conta uma exibição). */
    @Synchronized fun shown(day: String, ref: String) {
        if (!valid(day, ref)) return
        acc(day, ref).n++
        dirty = true
    }

    /** O item [ref] ficou [ms] na tela (somado ao tempo em exibição do dia). */
    @Synchronized fun addTime(day: String, ref: String, ms: Long) {
        if (!valid(day, ref) || ms <= 0) return
        acc(day, ref).ms += ms.coerceAtMost(MAX_MS_PER_CALL)
        dirty = true
    }

    private fun valid(day: String, ref: String) = DAY.matches(day) && ref.isNotEmpty() && ref.length <= 64

    private fun acc(day: String, ref: String): Acc {
        val m = days.getOrPut(day) { LinkedHashMap() }
        val a = m.getOrPut(ref) { Acc() }
        prune()
        return a
    }

    /** Guarda no máximo [KEEP_DAYS] dias e [MAX_REFS_PER_DAY] itens por dia (o aparelho meses sem rede não enche o disco). */
    private fun prune() {
        while (days.size > KEEP_DAYS) days.pollFirstEntry()
        for (m in days.values) while (m.size > MAX_REFS_PER_DAY) m.remove(m.keys.first())
    }

    /** O que mandar agora: o dia mais antigo, até [MAX_PER_BEAT] itens. Nada pendente = null. */
    @Synchronized fun pending(): Batch? {
        for ((day, m) in days) {
            val list = m.entries.asSequence()
                .map { (ref, a) -> Entry(ref, a.n, a.ms / 1000) }
                .filter { it.n > 0 || it.sec > 0 }
                .take(MAX_PER_BEAT).toList()
            if (list.isNotEmpty()) return Batch(day, list)
        }
        return null
    }

    /** O servidor aceitou (200): desconta o que foi mandado; o que entrou durante o envio fica para o próximo. */
    @Synchronized fun commit(b: Batch) {
        val m = days[b.day] ?: return
        for (e in b.entries) {
            val a = m[e.ref] ?: continue
            a.n = (a.n - e.n).coerceAtLeast(0)
            a.ms = (a.ms - e.sec * 1000).coerceAtLeast(0L)
            if (a.n == 0 && a.ms == 0L) m.remove(e.ref) // o que sobrou (menos de 1 s) fica para somar depois
        }
        if (m.isEmpty()) days.remove(b.day)
        dirty = true
    }

    @Synchronized fun isEmpty(): Boolean = days.isEmpty()

    // ---- no disco (o app reinicia sem perder a conta) ----

    @Synchronized fun toJson(): String {
        val o = JSONObject()
        for ((day, m) in days) {
            val d = JSONObject()
            for ((ref, a) in m) d.put(ref, JSONArray().put(a.n).put(a.ms))
            o.put(day, d)
        }
        dirty = false
        return o.toString()
    }

    @Synchronized fun load(json: String?) {
        days.clear()
        if (json.isNullOrBlank()) return
        try {
            val o = JSONObject(json)
            for (day in o.keys()) {
                val d = o.optJSONObject(day) ?: continue
                for (ref in d.keys()) {
                    val a = d.optJSONArray(ref) ?: continue
                    if (!valid(day, ref)) continue
                    val acc = acc(day, ref)
                    acc.n = a.optInt(0, 0).coerceAtLeast(0)
                    acc.ms = a.optLong(1, 0L).coerceAtLeast(0L)
                }
            }
        } catch (_: Exception) {
            days.clear()
        }
        dirty = false
    }

    companion object {
        const val MAX_PER_BEAT = 100
        const val KEEP_DAYS = 31
        const val MAX_REFS_PER_DAY = 500
        /** Um pedaço de tempo só não conta mais que 10 min (o item fica no máximo 5 min; o resto é relógio pulando). */
        const val MAX_MS_PER_CALL = 10 * 60_000L
        private val DAY = Regex("""\d{4}-\d{2}-\d{2}""")

        /** O pedaço do sinal de vida: `[ { ref, n, sec } ]`. */
        fun wire(b: Batch): JSONArray = JSONArray().apply {
            for (e in b.entries) put(JSONObject().put("ref", e.ref).put("n", e.n).put("sec", e.sec))
        }
    }
}
