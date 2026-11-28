package br.com.digitalisp.telas.core

/**
 * Girar a tela (os ajustes do aparelho): automático (o de sempre: só o layout em pé numa TV deitada gira, para o lado
 * escolhido em "TV em pé") ou um giro fixo de 0, 90, 180 ou 270 graus, para qualquer layout: a TV pendurada de cabeça
 * para baixo (180) ou de lado (90/270) com a saída do aparelho deitada.
 */
object ScreenTurn {
    const val AUTO = -1
    /** A ordem do botão: automático e depois os giros fixos. */
    val ORDER = listOf(AUTO, 0, 90, 180, 270)

    fun clean(v: Int): Int = if (v in ORDER) v else AUTO

    fun next(v: Int): Int = ORDER[(ORDER.indexOf(clean(v)) + 1) % ORDER.size]

    /**
     * O giro da composição em graus. giro: o dos ajustes; autoSide: o lado do automático (90/270); portraitLayout: o
     * layout é em pé; displayPortrait: a saída do aparelho já é em pé.
     */
    fun angle(giro: Int, autoSide: Int, portraitLayout: Boolean, displayPortrait: Boolean): Int = when (val g = clean(giro)) {
        AUTO -> if (portraitLayout && !displayPortrait) (if (autoSide == 270) 270 else 90) else 0
        else -> g
    }

    /** Com 90 ou 270 a composição troca a largura pela altura. */
    fun swaps(angle: Int): Boolean = angle == 90 || angle == 270

    fun label(giro: Int, autoSide: Int): String = when (val g = clean(giro)) {
        AUTO -> "automático (layout em pé gira ${if (autoSide == 270) 270 else 90}°)"
        0 -> "0° (sem girar)"
        else -> "$g°"
    }
}
