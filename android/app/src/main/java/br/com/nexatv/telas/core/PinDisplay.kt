package br.com.nexatv.telas.core

/**
 * A tela do PIN (1.2.4, retorno do dono: "aparece apenas 4 dígitos para a senha, são 6"). O PIN tem de 4 a 8 números
 * (o servidor sorteia 6; a prefeitura pode definir outro tamanho). O hash não diz o tamanho: a tela mostra uma bolinha por
 * número digitado, sem casas fixas, e quem confere é o OK.
 */
object PinDisplay {
    const val MIN = 4
    const val MAX = 8
    const val HINT = "De 4 a 8 números. Depois aperte OK."

    /** "● ● ● ● ● ●" para 6; vazio sem nada digitado (nenhuma casa fixa). */
    fun dots(n: Int): String = List(n.coerceIn(0, MAX)) { "●" }.joinToString(" ")

    /** Menos de 4 números não é um PIN possível: avisa sem contar como erro. */
    fun tooShort(pin: String): Boolean = pin.length < MIN
}
