package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Os painéis de senha do §15 do contrato (15/11, pedido do dono). Todos chegam como `layout` "queue-*" e o app os trata como
 * [Layout.QUEUE] (sem a chamada de senha ligada o servidor manda "full"); o desenho de cada um sai daqui. Com a TV em pé,
 * todos caem no painel "queue" de sempre ([CLASSIC]).
 */
enum class QueueLayout(val key: String, val video: Boolean, val ticker: Boolean) {
    CLASSIC("queue", true, false),
    TABLE("queue-table", true, true), // A: vídeo + tabela SENHA | GUICHÊ + texto rolante e relógio
    BIG("queue-big", false, false), // B (com o H): senha e guichê gigantes + tabela das anteriores, sem vídeo
    CARDS("queue-cards", true, false), // C: cabeçalho, vídeo + senha atual, cartões das últimas
    HEADER("queue-header", true, false), // D: cabeçalho com hora e data, cartão grande, lista e o canal
    INFO("queue-info", true, false), // E: faixas SENHA / ATENDIMENTO / LOCAL, coluna com o nome e o canal
    MOSAIC("queue-mosaic", true, false), // F: senha grande + canal, 3 cartões, rodapé com setor e relógio
    DUO("queue-duo", false, false), // G: duas filas lado a lado, sem vídeo
    GRID("queue-grid", true, false), // I: vídeo + grade com a última senha de cada fila
    LIST("queue-list", true, true); // J: coluna das últimas chamadas, chamada atual + vídeo, texto rolante

    companion object {
        /** As chaves novas (sem o "queue" de sempre). */
        val KEYS: Set<String> = values().filter { it != CLASSIC }.map { it.key }.toSet()
        const val MAX_SERVICES = 12
        const val GRID_MAX = 8

        fun of(raw: String?): QueueLayout = values().firstOrNull { it.key == raw?.trim()?.lowercase() } ?: CLASSIC

        /** O desenho para esta tela: só com a senha ligada e deitada; em pé, o painel de sempre. */
        fun forScreen(c: TelaConfig, portraitStage: Boolean): QueueLayout =
            if (portraitStage || c.effectiveLayout != Layout.QUEUE) CLASSIC else of(c.layoutRaw)

        /** `queue.pair`: até 2 ids positivos distintos. */
        fun pair(a: JSONArray?): List<Long> {
            if (a == null) return emptyList()
            val out = ArrayList<Long>()
            for (i in 0 until a.length()) {
                val n = a.optLong(i, 0L)
                if (n > 0 && n !in out) out.add(n)
                if (out.size == 2) break
            }
            return out
        }

        /** As cores das filas (as mesmas do servidor, por posição) para quando a cor não vem ou não se lê. */
        val SERVICE_COLORS = intArrayOf(
            0xFF2563EB.toInt(), 0xFF16A34A.toInt(), 0xFFD97706.toInt(), 0xFF9333EA.toInt(),
            0xFFDC2626.toInt(), 0xFF0891B2.toInt(), 0xFFDB2777.toInt(), 0xFF4D7C0F.toInt(),
        )

        /** "#rrggbb" -> ARGB opaco; inválido = a cor da posição. */
        fun color(hex: String?, index: Int): Int = parseHex(hex) ?: SERVICE_COLORS[((index % SERVICE_COLORS.size) + SERVICE_COLORS.size) % SERVICE_COLORS.size]

        fun parseHex(hex: String?): Int? {
            val h = hex?.trim()?.removePrefix("#") ?: return null
            if (!h.matches(Regex("[0-9a-fA-F]{6}"))) return null
            return (0xFF000000 or h.toLong(16)).toInt()
        }

        /** As duas filas do queue-duo: as escolhidas (`pair`, na ordem) e, faltando, as primeiras da lista. */
        fun duo(services: List<QueueServiceRow>?, pair: List<Long>): List<QueueServiceRow> {
            val list = services.orEmpty()
            val chosen = pair.mapNotNull { id -> list.firstOrNull { it.id == id } }
            return (chosen + list.filter { it !in chosen }).take(2)
        }

        /** A grade (queue-grid): até [GRID_MAX] filas; com mais, as de chamada mais recente, mostradas na ordem do painel. */
        fun grid(services: List<QueueServiceRow>?, max: Int = GRID_MAX): List<QueueServiceRow> {
            val list = services.orEmpty()
            if (list.size <= max) return list
            val keep = list.sortedByDescending { it.current?.at ?: 0L }.take(max).toSet()
            return list.filter { it in keep }
        }

        /** As senhas anteriores (sem a atual), a mais nova primeiro, até n. */
        fun previous(s: QueueState, n: Int): List<QueueCall> = s.last.filter { it.id != s.current?.id }.take(n)

        /** O tipo da senha em palavras: o nível do risco (§13, nunca o motivo), PREFERENCIAL ou o texto de quando não há. */
        fun kind(call: QueueCall?, fallback: String = "NORMAL"): String = when {
            call == null -> fallback
            call.risk != null -> RiskColors.words(call.risk)?.substringBefore(" ·") ?: fallback
            call.priority -> "PREFERENCIAL"
            else -> fallback
        }

        /** A linha de quem é chamado: a senha, ou "senha · nome" só com `showName` (o nome já vem reduzido do servidor). */
        fun who(call: QueueCall, showName: Boolean): String =
            if (showName && !call.name.isNullOrBlank()) "${call.ticket} · ${call.name.trim()}" else call.ticket

        /** "14:32" da hora da chamada (epoch ms) no fuso do aparelho; 0 = "". */
        fun hhmm(at: Long, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
            if (at <= 0L) return ""
            val cal = java.util.Calendar.getInstance(zone).apply { timeInMillis = at }
            return "%02d:%02d".format(cal.get(java.util.Calendar.HOUR_OF_DAY), cal.get(java.util.Calendar.MINUTE))
        }
    }
}

/** Tema dos painéis de senha do §15: a cor principal e o claro/escuro. */
data class ThemeCfg(val color: Int = DEFAULT_COLOR, val light: Boolean = false) {
    /** Fundo, painel, texto, texto apagado e linha; a cor principal com o texto que se lê sobre ela. */
    val bg: Int get() = if (light) 0xFFEEF2F7.toInt() else 0xFF0A0E16.toInt()
    val panel: Int get() = if (light) 0xFFFFFFFF.toInt() else 0xFF131A27.toInt()
    val text: Int get() = if (light) 0xFF111827.toInt() else 0xFFF2F5FA.toInt()
    val dim: Int get() = if (light) 0xFF4B5563.toInt() else 0xFF9FB0C8.toInt()
    val line: Int get() = if (light) 0xFFCBD5E1.toInt() else 0xFF263146.toInt()
    val onColor: Int get() = RiskColors.textOn(color)

    companion object {
        const val DEFAULT_COLOR = 0xFF1D4ED8.toInt()
        fun parse(o: JSONObject?): ThemeCfg {
            if (o == null) return ThemeCfg()
            return ThemeCfg(QueueLayout.parseHex(ConfigParser.str(o, "color")) ?: DEFAULT_COLOR, ConfigParser.str(o, "mode") == "light")
        }
    }
}
