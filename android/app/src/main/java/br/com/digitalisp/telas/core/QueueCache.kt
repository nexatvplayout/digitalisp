package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * O painel de senha guardado no aparelho (pedido do dono, 14/11: sem internet a tela continua como estava). Guarda só o
 * que a tela já mostra: senha, guichê, prioridade, hora, cor do risco e o nome reduzido (só com `showName`). Nunca o
 * "tipo de problema" nem nada de saúde além da cor. O formato é o mesmo do GET /api/telas/queue: volta pelo
 * [QueueParser.snapshot] e entra pelo [QueueReducer.onSnapshot] (sem anúncio nem destaque).
 */
object QueueCache {
    private fun call(c: QueueCall, showName: Boolean): JSONObject = JSONObject()
        .put("id", c.id)
        .put("ticket", c.ticket)
        .put("desk", c.desk)
        .put("name", if (showName && !c.name.isNullOrBlank()) c.name else JSONObject.NULL)
        .put("priority", c.priority)
        .put("at", c.at)
        .put("risk", c.risk ?: JSONObject.NULL)

    fun toJson(s: QueueState, showName: Boolean): String {
        val o = JSONObject()
        o.put("current", s.current?.let { call(it, showName) } ?: JSONObject.NULL)
        o.put("last", JSONArray().also { a -> s.last.forEach { a.put(call(it, showName)) } })
        s.waiting?.let { w ->
            val wo = JSONObject().put("total", w.total).put("avgWaitMin", w.avgWaitMin ?: JSONObject.NULL)
            wo.put("byRisk", w.byRisk?.let { list -> JSONObject().also { r -> list.forEach { (k, n) -> r.put(k, n) } } } ?: JSONObject.NULL)
            o.put("waiting", wo)
        }
        s.serving?.let { list -> o.put("serving", JSONArray().also { a -> list.forEach { a.put(call(it, showName)) } }) }
        return o.toString()
    }

    /** O estado guardado; null se não há nada (ou o arquivo não confere). */
    fun restore(json: String?, showName: Boolean): QueueState? {
        if (json.isNullOrEmpty()) return null
        val snap = QueueParser.snapshot(json) ?: return null
        val clean = if (showName) snap else QueueSnapshot(
            snap.current?.copy(name = null), snap.last.map { it.copy(name = null) }, snap.waiting, snap.serving?.map { it.copy(name = null) },
        )
        return QueueReducer.onSnapshot(QueueState(), clean)
    }

    /** Vale a pena guardar? (Painel vazio guarda também: a tela vazia é o último estado.) */
    fun same(a: QueueState, b: QueueState): Boolean =
        a.current == b.current && a.last == b.last && a.waiting == b.waiting && a.serving == b.serving
}
