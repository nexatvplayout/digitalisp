package br.com.digitalisp.telas.core

/** Um evento do `text/event-stream`. Sem `event:` o nome é "message". */
data class SseEvent(val event: String, val data: String)

/**
 * Leitor de Server-Sent Events, alimentado com pedaços de texto de qualquer tamanho (um evento pode chegar partido
 * em vários pedaços). Linhas terminam em \n, \r\n ou \r; linha que começa com ":" é comentário (o `: ping`);
 * várias linhas `data:` se juntam com \n; a linha em branco fecha o evento. Evento sem `data` é descartado.
 */
class SseParser {
    private val line = StringBuilder()
    private val data = StringBuilder()
    private var hasData = false
    private var event = ""
    private var skipLf = false

    /** Quantos comentários (pings) já passaram: serve para saber que a conexão está viva. */
    var comments = 0
        private set

    fun feed(chunk: String): List<SseEvent> {
        var out: ArrayList<SseEvent>? = null
        for (c in chunk) {
            if (skipLf) {
                skipLf = false
                if (c == '\n') continue
            }
            if (c == '\n' || c == '\r') {
                if (c == '\r') skipLf = true
                endLine()?.let { ev -> (out ?: ArrayList<SseEvent>().also { out = it }).add(ev) }
            } else {
                line.append(c)
            }
        }
        return out ?: emptyList()
    }

    private fun endLine(): SseEvent? {
        val l = line.toString()
        line.setLength(0)
        if (l.isEmpty()) {
            val ev = if (hasData) SseEvent(event.ifEmpty { "message" }, data.toString()) else null
            data.setLength(0)
            hasData = false
            event = ""
            return ev
        }
        if (l[0] == ':') {
            comments++
            return null
        }
        val i = l.indexOf(':')
        val field = if (i < 0) l else l.substring(0, i)
        var value = if (i < 0) "" else l.substring(i + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "event" -> event = value
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
            // "id" e "retry": o app não usa (ao reconectar ele pede o estado inteiro)
        }
        return null
    }
}
