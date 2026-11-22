package br.com.nexatv.telas.core

/**
 * A chave de ativação (contrato §1): 8 caracteres do alfabeto do servidor (`KEY_ALPHABET` em server/telas-core.js), sem
 * 0, 1, I e O para não confundir. Na tela ela aparece sempre em maiúsculas e como XXXX-XXXX, com o hífen automático.
 */
object ActivationKey {
    const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    const val LEN = 8
    const val HINT = "A chave não usa 0, 1, I nem O"

    /** Os caracteres que parecem da chave mas nunca aparecem nela. */
    private const val CONFUSING = "01IO"

    /** O que sobrou do texto digitado/colado (só caracteres da chave, até 8) e se veio algum que confunde (0, 1, I, O). */
    data class Clean(val chars: String, val confusing: Boolean)

    fun clean(raw: CharSequence): Clean {
        val sb = StringBuilder()
        var bad = false
        for (ch in raw.toString().uppercase()) {
            when {
                ch in ALPHABET -> if (sb.length < LEN) sb.append(ch)
                ch in CONFUSING -> bad = true
                // espaço, hífen, ponto e o resto: ignorados
            }
        }
        return Clean(sb.toString(), bad)
    }

    /** "ABCDE" -> "ABCD-E"; "ABCD" -> "ABCD-" (o hífen entra sozinho depois do 4º); "" -> "". */
    fun format(chars: String): String = when {
        chars.length < 4 -> chars
        else -> chars.substring(0, 4) + "-" + chars.substring(4)
    }

    /** Apagar: tira o último caractere da chave (passa por cima do hífen). */
    fun erase(chars: String): String = chars.dropLast(1)

    /** Mais um caractere do teclado da tela (só os da chave; depois de 8, nada). */
    fun append(chars: String, ch: Char): String = if (chars.length < LEN && ch.uppercaseChar() in ALPHABET) chars + ch.uppercaseChar() else chars

    /**
     * O texto do campo mudou (teclado USB, colar): os caracteres que valem. Se o que mudou foi só apagar o hífen
     * automático, apaga também o caractere antes dele (senão o hífen voltaria e o Apagar ficaria preso).
     */
    fun onEdited(previousChars: String, newText: CharSequence): Clean {
        val c = clean(newText)
        val previousFormatted = format(previousChars)
        return if (c.chars == previousChars && newText.length < previousFormatted.length) c.copy(chars = erase(c.chars)) else c
    }

    /** A chave pronta para o servidor ("ABCD-EFGH") ou null se ainda não tem os 8. */
    fun complete(chars: String): String? = if (chars.length == LEN) format(chars) else null

    fun warning(confusing: Boolean): String? = if (confusing) "A chave não tem 0, 1, I nem O: confira o que está no painel." else null
}
