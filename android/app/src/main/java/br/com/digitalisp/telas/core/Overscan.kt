package br.com.digitalisp.telas.core

/** Margens em pixels de cada borda. */
data class Insets(val left: Int, val top: Int, val right: Int, val bottom: Int)

/**
 * Margem de segurança da tela (overscan): muita TV corta as bordas da imagem. O vídeo vai até a borda; o que é TEXTO
 * (coluna, painel de senha, faixa, cartão da chamada, relógio, alertas) fica dentro da margem.
 * Ajustada no aparelho (Ajustes e diagnóstico → "Margem da tela (overscan)"); o contrato não tem campo para isso.
 */
object Overscan {
    // DIGITAL ISP (26/11/2026): a TV de hoje (e o Fire TV) mostra a imagem inteira: o padrão é 0, e o ajuste vai de 1 em 1
    val CHOICES = listOf(0, 1, 2, 3, 4, 5, 6, 7, 8)
    const val DEFAULT = 0

    /** Valor guardado → um dos permitidos (desconhecido = o padrão). */
    fun clean(pct: Int): Int = if (pct in CHOICES) pct else DEFAULT

    /** O próximo da lista (o botão dos ajustes anda em círculo). */
    fun next(pct: Int): Int = CHOICES[(CHOICES.indexOf(clean(pct)) + 1) % CHOICES.size]

    /** As margens de uma tela w × h: a porcentagem da largura nos lados e da altura em cima e embaixo. */
    fun insets(w: Int, h: Int, pct: Int): Insets {
        val p = clean(pct)
        if (w <= 0 || h <= 0 || p == 0) return Insets(0, 0, 0, 0)
        val x = Math.round(w * p / 100f)
        val y = Math.round(h * p / 100f)
        return Insets(x, y, x, y)
    }
}
