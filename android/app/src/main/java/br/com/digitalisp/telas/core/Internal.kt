package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Comunicação interna (contrato §17): só a tela marcada como interna no painel recebe `internal` no /config (os avisos da
 * direção, a escala, treinamentos, protocolos, aniversariantes) e `codes` no sinal de vida e no tempo real
 * (/api/telas/internal/stream). A tela pública não recebe nada disso: sem a chave, nada aparece.
 */
data class InternalNotice(val id: Long, val kind: String, val header: String, val title: String, val text: String, val seconds: Int, val until: Long)

data class InternalCfg(val sector: String?, val notices: List<InternalNotice>)

/** Um código de emergência hospitalar em vigor. `color`/`textColor` em ARGB; `until` 0 = até alguém encerrar. */
data class EmergencyCode(
    val id: Long, val code: String, val label: String, val meaning: String, val color: Int, val textColor: Int,
    val place: String, val firedAt: Long, val until: Long,
)

object Internal {
    const val MAX_NOTICES = 12

    /** `internal` do /config; ausente ou de tipo errado = tela pública (null). */
    fun parse(o: JSONObject?): InternalCfg? {
        if (o == null) return null
        val out = ArrayList<InternalNotice>()
        o.optJSONArray("notices")?.let { arr ->
            for (i in 0 until arr.length()) {
                if (out.size >= MAX_NOTICES) break
                val n = arr.optJSONObject(i) ?: continue
                val title = (ConfigParser.str(n, "title") ?: "").take(80)
                val text = (ConfigParser.str(n, "text") ?: "").take(600)
                if (title.isEmpty() && text.isEmpty()) continue
                val sec = n.optInt("seconds", 15).let { if (it <= 0) 15 else it.coerceIn(5, 120) }
                out.add(InternalNotice(n.optLong("id", 0L), ConfigParser.str(n, "kind") ?: "aviso", (ConfigParser.str(n, "header") ?: "AVISO INTERNO").take(40), title, text, sec, n.optLong("until", 0L).coerceAtLeast(0L)))
            }
        }
        return InternalCfg(ConfigParser.str(o, "sector")?.take(60), out)
    }

    /**
     * Os avisos internos entram no revezamento dos cartões (antes dos do cliente): a linha de cima e o título viram o
     * título do cartão; o texto vira as linhas (até 8, de até 90 letras, cortadas em palavras).
     */
    fun asCards(cfg: InternalCfg?): List<CardCfg> = cfg?.notices.orEmpty().map { n ->
        val title = listOf(n.header, n.title).filter { it.isNotEmpty() }.joinToString(" · ").take(60)
        CardCfg("int-${n.id}", title, wrap(n.text, 90).take(8), n.seconds)
    }

    /** Quebra o texto nas linhas que já tem e, nas longas, em palavras até `width`. */
    fun wrap(text: String, width: Int): List<String> {
        val out = ArrayList<String>()
        for (raw in text.split('\n')) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            var cur = StringBuilder()
            for (w in line.split(Regex("\\s+"))) {
                if (cur.isNotEmpty() && cur.length + 1 + w.length > width) { out.add(cur.toString()); cur = StringBuilder() }
                if (cur.isNotEmpty()) cur.append(' ')
                cur.append(if (w.length > width) w.take(width) else w)
            }
            if (cur.isNotEmpty()) out.add(cur.toString())
        }
        return out
    }

    /** "#rrggbb" -> ARGB opaco; fora do formato, null. */
    fun color(raw: String?): Int? {
        val s = raw?.trim() ?: return null
        if (!Regex("#[0-9a-fA-F]{6}").matches(s)) return null
        return (0xFF000000L or s.substring(1).toLong(16)).toInt()
    }

    /** Os códigos do sinal de vida e do evento `codes`; os sem nome ou sem cor válida são ignorados. */
    fun codes(arr: JSONArray?): List<EmergencyCode> {
        if (arr == null) return emptyList()
        val out = ArrayList<EmergencyCode>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val label = (ConfigParser.str(o, "label") ?: "").take(40)
            val bg = color(ConfigParser.str(o, "color")) ?: continue
            if (label.isEmpty()) continue
            val fg = color(ConfigParser.str(o, "textColor")) ?: if (luminance(bg) > 0.4) 0xFF1A1A1A.toInt() else 0xFFFFFFFF.toInt()
            out.add(
                EmergencyCode(
                    o.optLong("id", 0L), ConfigParser.str(o, "code") ?: "", label, (ConfigParser.str(o, "meaning") ?: "").take(80), bg, fg,
                    (ConfigParser.str(o, "place") ?: "").take(80), o.optLong("firedAt", 0L), if (o.isNull("until")) 0L else o.optLong("until", 0L).coerceAtLeast(0L),
                ),
            )
        }
        return out
    }

    /** O evento `codes` do tempo real: `{ "codes": [...] }`. Quebrado = null (fica o que estava). */
    fun codesEvent(data: String?): List<EmergencyCode>? = try {
        if (data.isNullOrEmpty()) null else JSONObject(data).optJSONArray("codes")?.let { codes(it) }
    } catch (_: Exception) {
        null
    }

    fun active(list: List<EmergencyCode>, now: Long): List<EmergencyCode> = list.filter { it.until == 0L || it.until > now }

    /** O que vai para a tela cheia: o mais novo em vigor (maior id). */
    fun select(list: List<EmergencyCode>, now: Long): EmergencyCode? = active(list, now).maxByOrNull { it.id }

    private fun luminance(argb: Int): Double {
        fun ch(v: Int): Double { val c = v / 255.0; return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * ch((argb shr 16) and 255) + 0.7152 * ch((argb shr 8) and 255) + 0.0722 * ch(argb and 255)
    }
}

/** O som da chamada de senha (contrato §16). */
enum class CallSoundMode(val key: String, val label: String) {
    BEEP("beep", "Bipe"), VOICE("voice", "Falada"), BOTH("both", "Bipe + falada");

    val beep: Boolean get() = this != VOICE
    val voice: Boolean get() = this != BEEP

    companion object {
        fun of(raw: String?): CallSoundMode? = values().firstOrNull { it.key == raw?.trim()?.lowercase() }
    }
}

/** `callSound` do /config: `mode` null = o painel não definiu. */
data class CallSoundCfg(val mode: CallSoundMode?, val volume: Int)

/** O que vale agora e de onde veio (para o diagnóstico). */
data class CallSoundChoice(val mode: CallSoundMode, val volume: Int, val source: String)

object CallSound {
    const val FROM_PANEL = "painel"
    const val FROM_DEVICE = "aparelho"
    const val FROM_DEFAULT = "padrão"
    const val FROM_LEGACY = "servidor sem o campo (voz do painel)"

    fun parse(o: JSONObject?): CallSoundCfg? {
        if (o == null) return null
        return CallSoundCfg(CallSoundMode.of(ConfigParser.str(o, "mode")), o.optInt("volume", 100).coerceIn(0, 100))
    }

    /**
     * Precedência: o painel (/config) > o escolhido no aparelho (Ajustes) > "Bipe + falada". Servidor antigo (sem
     * `callSound`): o escolhido no aparelho ou, sem ele, o `queue.voice` do painel (voz ligada = bipe + falada).
     */
    fun resolve(panel: CallSoundCfg?, local: CallSoundMode?, legacyVoice: Boolean): CallSoundChoice {
        val vol = panel?.volume ?: 100
        return when {
            panel?.mode != null -> CallSoundChoice(panel.mode, vol, FROM_PANEL)
            local != null -> CallSoundChoice(local, vol, FROM_DEVICE)
            panel == null -> CallSoundChoice(if (legacyVoice) CallSoundMode.BOTH else CallSoundMode.BEEP, vol, FROM_LEGACY)
            else -> CallSoundChoice(CallSoundMode.BOTH, vol, FROM_DEFAULT)
        }
    }
}
