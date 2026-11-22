package br.com.nexatv.telas.core

import java.text.Normalizer

/**
 * Voz própria da chamada (20/11): o app traz um áudio por palavra (assets/voz/<voz>/<token>.ulaw, gerados por
 * android-telas/voz/gerar.mjs com as vozes da OpenAI ash, onyx, coral e nova) e junta os pedaços na hora. Não depende da voz do
 * Android, que muitas TV box não têm. Aqui fica só a parte sem Android: o vocabulário e a lista de pedaços de uma chamada.
 */
class VoiceVocab(private val forms: Map<String, String>, val tokens: Set<String>) {
    /** O token de uma forma escrita já normalizada (minúsculas, sem acento), ou null. */
    fun token(form: String): String? = forms[form]

    companion object {
        /** Lê o vocabulario.tsv (token, texto falado, formas separadas por vírgula; # = comentário). */
        fun parse(tsv: String): VoiceVocab {
            val forms = HashMap<String, String>()
            val tokens = HashSet<String>()
            for (raw in tsv.lineSequence()) {
                val line = raw.trimEnd('\r')
                if (line.isBlank() || line.startsWith("#")) continue
                val cols = line.split('\t')
                val tok = cols[0].trim()
                if (tok.isEmpty()) continue
                tokens += tok
                cols.getOrNull(2)?.split(',')?.map { VoicePlan.norm(it) }?.filter { it.isNotEmpty() }?.forEach { forms[it] = tok }
            }
            return VoiceVocab(forms, tokens)
        }
    }
}

/** Os pedaços de uma chamada; PAUSE é uma pausa curta (a vírgula). `unknown`: palavras do local sem áudio (ficam de fora). */
data class VoicePlan(val tokens: List<String>, val unknown: List<String>, val nameSkipped: Boolean) {
    companion object {
        const val PAUSE = ","
        private val WORD = Regex("""\d+|[\p{L}º°.]+(?:-[\p{L}]+)?""")

        /** Minúsculas e sem acento ("Consultório" → "consultorio"). */
        fun norm(s: String): String =
            Normalizer.normalize(s.trim().lowercase(), Normalizer.Form.NFD).replace(Regex("""\p{Mn}+"""), "")

        /** 0 a 99 num pedaço só ("doze", "vinte e três", entonação de fim); maior, algarismo por algarismo. */
        fun number(digits: String): List<String> {
            val n = digits.toIntOrNull()
            return if (n == null || digits.length > 2) digitRun(digits) else listOf("n_$n")
        }

        /** Algarismos ditos um a um: os do meio com a entonação suspensa (dm_), o último com a que fecha (df_). */
        fun digitRun(digits: String): List<String> = digits.mapIndexed { i, d -> if (i == digits.length - 1) "df_$d" else "dm_$d" }

        /**
         * "Senha A002, consultório 3" → [senha_a, dm_0, dm_0, df_2, ",", c_consultorio_3]. A 1ª letra vai junto de "Senha"
         * ("Senha á", um áudio só); a senha vai algarismo por algarismo; no local, palavra + número até 30 das palavras
         * mais comuns sai num áudio só ("Consultório três"), e os outros números até 99 inteiros. Palavra sem áudio sai da
         * fala (e fica em `unknown`). O nome da pessoa não tem áudio pronto: com `showName`, fala a senha e marca `nameSkipped`.
         */
        fun build(call: QueueCall, showName: Boolean, vocab: VoiceVocab): VoicePlan {
            val out = ArrayList<String>()
            val chars = call.ticket.lowercase().filter { it in '0'..'9' || it in 'a'..'z' }
            var rest = chars
            if (chars.isNotEmpty() && chars[0] in 'a'..'z') {
                out += "senha_${chars[0]}"; rest = chars.substring(1)
            } else out += "senha"
            var i = 0
            while (i < rest.length) {
                if (rest[i] in 'a'..'z') { out += "l_${rest[i]}"; i++; continue }
                var j = i
                while (j < rest.length && rest[j] in '0'..'9') j++
                out += digitRun(rest.substring(i, j)); i = j
            }
            val unknown = ArrayList<String>()
            val words = WORD.findAll(call.desk).map { it.value }.toList()
            val place = ArrayList<String>()
            i = 0
            while (i < words.size) {
                val w = words[i]
                if (w.all { it.isDigit() }) {
                    place += number(w); i++; continue
                }
                // duas palavras juntas primeiro ("raio x"), depois a palavra sozinha (sem o ponto do fim: "Dr." → "dr")
                val pair = words.getOrNull(i + 1)?.let { vocab.token(norm("$w $it")) }
                if (pair != null) {
                    place += pair; i += 2; continue
                }
                val one = vocab.token(norm(w)) ?: vocab.token(norm(w).trimEnd('.'))
                if (one != null) place += one else if (norm(w).trimEnd('.').isNotEmpty()) unknown += w
                i++
            }
            // palavra + número numa fala só, quando existe ("Consultório três")
            val joined = ArrayList<String>()
            i = 0
            while (i < place.size) {
                val combo = place.getOrNull(i + 1)?.takeIf { it.startsWith("n_") }?.let { "c_${place[i]}_${it.removePrefix("n_")}" }
                if (combo != null && combo in vocab.tokens) { joined += combo; i += 2 } else { joined += place[i]; i++ }
            }
            if (joined.isNotEmpty()) {
                out += PAUSE
                out += joined
            }
            return VoicePlan(out, unknown, showName && !call.name.isNullOrBlank())
        }
    }
}

/** G.711 mu-law → PCM 16 bits (os áudios da voz própria ficam em mu-law: metade do tamanho). */
object MuLaw {
    private val TABLE = ShortArray(256) { i ->
        val u = i.inv() and 0xFF
        val sign = u and 0x80
        val exp = (u shr 4) and 0x07
        val man = u and 0x0F
        var s = ((man shl 3) + 0x84) shl exp
        s -= 0x84
        (if (sign != 0) -s else s).toShort()
    }

    fun decode(b: ByteArray): ShortArray = ShortArray(b.size) { TABLE[b[it].toInt() and 0xFF] }
}
