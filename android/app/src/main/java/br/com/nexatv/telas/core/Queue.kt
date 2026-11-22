package br.com.nexatv.telas.core

import org.json.JSONObject

/** Uma chamada de senha. `repeat` só vem no evento `call` que repete uma chamada já feita. */
data class QueueCall(
    val id: Long,
    val ticket: String,
    val desk: String,
    val name: String?,
    val priority: Boolean,
    val at: Long,
    val repeat: Boolean = false,
    /** Cor da classificação de risco (contrato §13): vermelho, laranja, amarelo, verde, azul; null sem classificação. */
    val risk: String? = null,
    /** Nome da fila (serviço) da senha (contrato §15); null = servidor antigo ou sem fila. */
    val service: String? = null,
)

/** Uma fila da repartição com a cor e a última chamada do dia (contrato §15, `byService`). */
data class QueueServiceRow(val id: Long, val name: String, val color: Int, val current: QueueCall?, val waiting: Int)

/** Quem está esperando. `byRisk` (na ordem em que veio) só existe onde há classificação de risco. */
data class QueueWaiting(val total: Int, val byRisk: List<Pair<String, Int>>?, val avgWaitMin: Int?)

/** O objeto inteiro do GET /api/telas/queue (e do evento `state`). */
/** `serving` (contrato §12): as senhas ainda em atendimento, sem a atual, a mais nova primeiro; null = servidor sem o campo. */
data class QueueSnapshot(val current: QueueCall?, val last: List<QueueCall>, val waiting: QueueWaiting?, val serving: List<QueueCall>? = null, val byService: List<QueueServiceRow>? = null)

/** O que o painel de senha mostra agora. */
data class QueueState(
    val current: QueueCall? = null,
    val last: List<QueueCall> = emptyList(),
    val waiting: QueueWaiting? = null,
    val highlightUntil: Long = 0L,
    /** Em atendimento (§12); null = o servidor não manda (a tela mostra as últimas chamadas como antes). */
    val serving: List<QueueCall>? = null,
    /** As filas com a última senha de cada uma (§15); null = o servidor não manda. */
    val byService: List<QueueServiceRow>? = null,
)

/** Estado novo e, se for o caso, a chamada a anunciar (toque + voz). */
data class QueueReduced(val state: QueueState, val announce: QueueCall?)

object QueueParser {
    val RISK_ORDER = listOf("vermelho", "laranja", "amarelo", "verde", "azul")

    fun call(o: JSONObject?): QueueCall? {
        if (o == null) return null
        val ticket = ConfigParser.str(o, "ticket") ?: return null
        return QueueCall(
            id = o.optLong("id", 0L),
            ticket = ticket.take(16),
            desk = (ConfigParser.str(o, "desk") ?: "").take(40),
            name = ConfigParser.str(o, "name")?.take(40),
            priority = o.optBoolean("priority", false),
            at = o.optLong("at", 0L),
            repeat = o.optBoolean("repeat", false),
            risk = ConfigParser.str(o, "risk")?.lowercase()?.takeIf { it in RISK_ORDER },
            service = ConfigParser.str(o, "service")?.take(40),
        )
    }

    fun call(json: String): QueueCall? = try { call(JSONObject(json)) } catch (_: Exception) { null }

    fun snapshot(json: String): QueueSnapshot? = try { snapshot(JSONObject(json)) } catch (_: Exception) { null }

    fun snapshot(o: JSONObject): QueueSnapshot {
        val last = ArrayList<QueueCall>()
        o.optJSONArray("last")?.let { a ->
            for (i in 0 until a.length()) call(a.optJSONObject(i))?.let(last::add)
        }
        val w = o.optJSONObject("waiting")
        val waiting = w?.let {
            val risk = it.optJSONObject("byRisk")?.let { r ->
                val known = RISK_ORDER.filter { k -> r.has(k) && !r.isNull(k) }
                val extra = r.keys().asSequence().filter { k -> k !in RISK_ORDER && !r.isNull(k) }.sorted().toList()
                (known + extra).map { k -> k to r.optInt(k, 0).coerceAtLeast(0) }
            }
            QueueWaiting(
                total = it.optInt("total", 0).coerceAtLeast(0),
                byRisk = risk,
                avgWaitMin = if (it.has("avgWaitMin") && !it.isNull("avgWaitMin")) it.optInt("avgWaitMin", 0).coerceAtLeast(0) else null,
            )
        }
        val serving = o.optJSONArray("serving")?.let { a -> (0 until a.length()).mapNotNull { call(a.optJSONObject(it)) } }
        val byService = o.optJSONArray("byService")?.let { a ->
            (0 until a.length()).mapNotNull { i ->
                val x = a.optJSONObject(i) ?: return@mapNotNull null
                val name = ConfigParser.str(x, "name")?.take(40) ?: return@mapNotNull null
                QueueServiceRow(x.optLong("id", 0L), name, QueueLayout.color(ConfigParser.str(x, "color"), i), call(x.optJSONObject("current")), x.optInt("waiting", 0).coerceAtLeast(0))
            }.take(QueueLayout.MAX_SERVICES)
        }
        return QueueSnapshot(call(o.optJSONObject("current")), last, waiting, serving, byService)
    }
}

object QueueReducer {
    const val HIGHLIGHT_MS = 10_000L
    const val MAX_LAST = 12
    const val MAX_SERVING = 4

    /**
     * Evento `call`.
     * - senha nova: vira a atual, a anterior desce para as últimas, destaque de 10 s e anúncio;
     * - mesma senha com `repeat`: destaque e anúncio de novo, sem mexer na lista;
     * - mesma senha sem `repeat` (entrega repetida depois de reconectar): nada a anunciar.
     */
    fun onCall(s: QueueState, call: QueueCall, now: Long): QueueReduced {
        if (s.current?.id == call.id) {
            return if (call.repeat) QueueReduced(s.copy(highlightUntil = now + HIGHLIGHT_MS), call) else QueueReduced(s, null)
        }
        val last = (listOfNotNull(s.current) + s.last).filter { it.id != call.id }.distinctBy { it.id }.take(MAX_LAST)
        return QueueReduced(QueueState(call.copy(repeat = false), last, s.waiting, now + HIGHLIGHT_MS, servingAfterCall(s, call), servicesAfterCall(s.byService, call)), call)
    }

    /**
     * Em atendimento logo depois de uma chamada nova, até o `state` do servidor chegar: a senha anterior desce para a
     * lista (se o guichê for outro: o servidor encerra a do MESMO guichê ao chamar a próxima) e a chamada nova sai dela.
     */
    private fun servingAfterCall(s: QueueState, call: QueueCall): List<QueueCall>? {
        val list = s.serving ?: return null
        return (listOfNotNull(s.current) + list).filter { it.ticket != call.ticket && it.desk != call.desk }.distinctBy { it.ticket }
    }

    /** A fila da chamada nova passa a mostrar essa senha já (até o `state` do servidor chegar). */
    private fun servicesAfterCall(list: List<QueueServiceRow>?, call: QueueCall): List<QueueServiceRow>? =
        list?.map { if (call.service != null && it.name == call.service) it.copy(current = call.copy(repeat = false)) else it }

    /** Evento `state` ou o GET ao (re)conectar: vale o que o servidor mandou; não anuncia nada. */
    fun onSnapshot(s: QueueState, snap: QueueSnapshot): QueueState {
        val keepHighlight = snap.current != null && snap.current.id == s.current?.id
        return QueueState(
            current = snap.current,
            last = mergeLast(s, snap),
            waiting = snap.waiting,
            highlightUntil = if (keepHighlight) s.highlightUntil else 0L,
            serving = snap.serving?.filter { it.ticket != snap.current?.ticket }?.distinctBy { it.ticket },
            byService = snap.byService,
        )
    }

    /**
     * As últimas chamadas depois de um `state` (20/11, do dono: "os demais vão sumindo"): as que o servidor mandou e, abaixo
     * delas, as que a tela já tinha e o servidor não mandou mais (servidor que manda só 5), até MAX_LAST, só do mesmo dia da
     * chamada mais nova. Servidor sem nenhuma chamada (dia novo, fila zerada) limpa a lista.
     */
    fun mergeLast(s: QueueState, snap: QueueSnapshot): List<QueueCall> {
        val fresh = snap.last.filter { it.id != snap.current?.id }.distinctBy { it.id }
        val newest = listOfNotNull(snap.current) + fresh
        if (newest.isEmpty()) return emptyList()
        val day = dayOf(newest.maxOf { it.at })
        val seen = newest.map { it.id }.toHashSet()
        val older = (listOfNotNull(s.current) + s.last).filter { it.id !in seen && it.at > 0 && dayOf(it.at) == day }
            .distinctBy { it.id }.sortedByDescending { it.at }
        return (fresh + older).take(MAX_LAST)
    }

    private fun dayOf(ms: Long): Long = Math.floorDiv(ms + java.util.TimeZone.getDefault().getOffset(ms), 86_400_000L)

    fun highlighted(s: QueueState, now: Long): Boolean = s.current != null && now < s.highlightUntil

    /** O que a tela lista abaixo da senha atual: até 4 em atendimento (§12). */
    fun servingShown(s: QueueState): List<QueueCall> = s.serving.orEmpty().take(MAX_SERVING)
}

/** O texto que a voz fala na chamada. */
object SpeechText {
    private val UNITS = listOf(
        "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
        "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
    )
    private val TENS = listOf("", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa")

    /** 0 a 99 por extenso; maior que isso, algarismo por algarismo. */
    fun number(digits: String): String {
        val n = digits.toIntOrNull()
        if (n == null || digits.length > 2) return digits.map { UNITS[it - '0'] }.joinToString(" ")
        if (n < 20) return UNITS[n]
        val u = n % 10
        return if (u == 0) TENS[n / 10] else TENS[n / 10] + " e " + UNITS[u]
    }

    /** O nome de cada letra em português (a voz lê "pê", não "p" engolido; "B" e "D" não se confundem com "pê" e "tê"). */
    private val LETTERS = mapOf(
        'A' to "á", 'B' to "bê", 'C' to "cê", 'D' to "dê", 'E' to "é", 'F' to "efe", 'G' to "gê", 'H' to "agá", 'I' to "i",
        'J' to "jota", 'K' to "cá", 'L' to "ele", 'M' to "eme", 'N' to "ene", 'O' to "ó", 'P' to "pê", 'Q' to "quê", 'R' to "erre",
        'S' to "esse", 'T' to "tê", 'U' to "u", 'V' to "vê", 'W' to "dáblio", 'X' to "xis", 'Y' to "ípsilon", 'Z' to "zê",
    )

    /** "P012" → "pê zero um dois": letra por letra (pelo nome) e algarismo por algarismo, para ninguém confundir. */
    fun ticket(ticket: String): String =
        ticket.uppercase().mapNotNull { c ->
            when {
                c in '0'..'9' -> UNITS[c - '0']
                c.isLetter() -> LETTERS[c] ?: c.toString()
                else -> null
            }
        }.joinToString(" ")

    /** "Guichê 3" → "guichê três"; "Sala 12" → "sala doze". */
    fun desk(desk: String): String =
        Regex("""\d+""").replace(desk.trim()) { number(it.value) }.replaceFirstChar { it.lowercase() }

    /** "Senha P zero um dois, guichê três"; com `showName` e nome, o nome no lugar da senha. */
    fun build(call: QueueCall, showName: Boolean): String {
        val who = if (showName && !call.name.isNullOrBlank()) call.name.trim() else "Senha " + ticket(call.ticket)
        val where = desk(call.desk)
        return if (where.isEmpty()) who else "$who, $where"
    }
}

/** Revezamento dos cartões de informação: cada um fica os seus `seconds` e a lista recomeça. */
object CardRotation {
    /** Qual cartão está na tela depois de `elapsedMs`? -1 se não há cartões. */
    fun indexAt(cards: List<CardCfg>, elapsedMs: Long): Int {
        if (cards.isEmpty()) return -1
        val total = cards.sumOf { it.seconds * 1000L }
        if (total <= 0L) return 0
        var t = ((elapsedMs % total) + total) % total
        for ((i, c) in cards.withIndex()) {
            val d = c.seconds * 1000L
            if (t < d) return i
            t -= d
        }
        return cards.size - 1
    }
}

/** Espera entre reconexões do tempo real: 1 s, 2 s, 4 s … até 30 s. */
object Backoff {
    const val FIRST_MS = 1000L
    const val MAX_MS = 30_000L
    fun next(currentMs: Long): Long = (currentMs * 2).coerceIn(FIRST_MS, MAX_MS)
}
