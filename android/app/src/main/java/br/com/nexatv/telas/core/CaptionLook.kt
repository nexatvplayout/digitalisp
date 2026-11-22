package br.com.nexatv.telas.core

/** Medidas da caixa da legenda em pixels, para uma área de vídeo de `w`×`h`. */
data class CaptionBox(
    val textPx: Float,
    val lineExtraPx: Float,
    val padH: Int,
    val padV: Int,
    val radiusPx: Float,
    val bottomPx: Int,
    val maxWidthPx: Int,
    val shadowRadiusPx: Float,
    val shadowDyPx: Float,
)

/**
 * A legenda igual à do app da TV Samsung (tv/web/style.css `#p-cc-box`, desenhada para 1920×1080), pedido do dono
 * (15/11): texto branco em sans-serif medium (peso 500), 50 px com linhas de 68 px, UMA caixa rgba(8,8,8,0,78) com cantos
 * de 6 px e folga de 4 × 22 px, sombra 0 2 px 4 px preta a 60 %, centralizada a 72 px da base do vídeo e no máximo 1536 px
 * de largura. Tudo proporcional à altura da área do vídeo (não segue a escala de fonte do Android). Sem Android dentro.
 */
object CaptionLook {
    /** rgba(8, 8, 8, 0.78). */
    const val BOX_COLOR = 0xC7080808.toInt()
    const val TEXT_COLOR = 0xFFFFFFFF.toInt()
    const val SHADOW_COLOR = 0x99000000.toInt()

    private const val REF_H = 1080f
    private const val REF_W = 1920f

    fun box(w: Int, h: Int): CaptionBox {
        val k = (if (h > 0) h else 1) / REF_H
        val text = 50f * k
        return CaptionBox(
            textPx = text,
            lineExtraPx = (68f - 50f * 1.17f).coerceAtLeast(0f) * k, // altura de linha 68 px (a fonte já ocupa ~1,17 × o tamanho)
            padH = Math.round(22f * k),
            padV = Math.round(4f * k),
            radiusPx = 6f * k,
            bottomPx = Math.round(72f * k),
            maxWidthPx = Math.round(w * (1536f / REF_W)),
            shadowRadiusPx = 4f * k,
            shadowDyPx = 2f * k,
        )
    }
}
