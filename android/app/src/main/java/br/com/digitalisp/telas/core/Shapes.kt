package br.com.digitalisp.telas.core

/**
 * Formatos especiais de zona (recorte não retangular) e o filete na borda: a mesma conta de public/shared/tvcorp-formas.js
 * (contrato `zone.shape` e `zone.edge`). Sem Android aqui: a tela monta o `Path` com os comandos.
 */
sealed class ShapeCmd {
    data class M(val x: Float, val y: Float) : ShapeCmd()
    data class L(val x: Float, val y: Float) : ShapeCmd()
    data class C(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val x: Float, val y: Float) : ShapeCmd()
    object Z : ShapeCmd()
}

object Shapes {
    private const val K = 0.5523f
    val KEYS = listOf(
        "onda-esq", "onda-dir", "onda-topo", "onda-base", "diagonal-esq", "diagonal-dir", "arco", "circulo", "pilula",
        "cantos", "losango", "gota",
    )
    const val EDGE_MIN = 0.2f
    const val EDGE_MAX = 3f

    private fun ellipse(x: Float, y: Float, w: Float, h: Float): List<ShapeCmd> {
        val rx = w / 2; val ry = h / 2; val cx = x + rx; val cy = y + ry
        return listOf(
            ShapeCmd.M(cx, y),
            ShapeCmd.C(cx + rx * K, y, x + w, cy - ry * K, x + w, cy),
            ShapeCmd.C(x + w, cy + ry * K, cx + rx * K, y + h, cx, y + h),
            ShapeCmd.C(cx - rx * K, y + h, x, cy + ry * K, x, cy),
            ShapeCmd.C(x, cy - ry * K, cx - rx * K, y, cx, y),
            ShapeCmd.Z,
        )
    }

    /** Cantos arredondados: raios na ordem cima-esq, cima-dir, baixo-dir, baixo-esq. */
    private fun rounded(w: Float, h: Float, a: Float, b: Float, c: Float, d: Float): List<ShapeCmd> = listOf(
        ShapeCmd.M(a, 0f), ShapeCmd.L(w - b, 0f), ShapeCmd.C(w - b + b * K, 0f, w, b - b * K, w, b),
        ShapeCmd.L(w, h - c), ShapeCmd.C(w, h - c + c * K, w - c + c * K, h, w - c, h),
        ShapeCmd.L(d, h), ShapeCmd.C(d - d * K, h, 0f, h - d + d * K, 0f, h - d),
        ShapeCmd.L(0f, a), ShapeCmd.C(0f, a - a * K, a - a * K, 0f, a, 0f), ShapeCmd.Z,
    )

    private fun map(cmds: List<ShapeCmd>, fx: (Float) -> Float, fy: (Float) -> Float): List<ShapeCmd> = cmds.map {
        when (it) {
            is ShapeCmd.M -> ShapeCmd.M(fx(it.x), fy(it.y))
            is ShapeCmd.L -> ShapeCmd.L(fx(it.x), fy(it.y))
            is ShapeCmd.C -> ShapeCmd.C(fx(it.x1), fy(it.y1), fx(it.x2), fy(it.y2), fx(it.x), fy(it.y))
            ShapeCmd.Z -> ShapeCmd.Z
        }
    }

    private fun mirrorX(w: Float, c: List<ShapeCmd>) = map(c, { w - it }, { it })
    private fun mirrorY(h: Float, c: List<ShapeCmd>) = map(c, { it }, { h - it })

    private fun waveLeft(w: Float, h: Float) = listOf(ShapeCmd.M(0.05f * w, h), ShapeCmd.C(0.26f * w, 0.7f * h, -0.04f * w, 0.32f * h, 0.16f * w, 0f))
    private fun waveTop(w: Float, h: Float) = listOf(ShapeCmd.M(0f, 0.16f * h), ShapeCmd.C(0.32f * w, -0.04f * h, 0.7f * w, 0.26f * h, w, 0.05f * h))

    private fun path(key: String, w: Float, h: Float): List<ShapeCmd>? = when (key) {
        "onda-esq" -> {
            val wl = waveLeft(w, h)
            listOf(ShapeCmd.M(0.16f * w, 0f), ShapeCmd.L(w, 0f), ShapeCmd.L(w, h), ShapeCmd.L(0.05f * w, h), wl[1], ShapeCmd.Z)
        }
        "onda-dir" -> mirrorX(w, path("onda-esq", w, h)!!)
        "onda-topo" -> waveTop(w, h) + listOf(ShapeCmd.L(w, h), ShapeCmd.L(0f, h), ShapeCmd.Z)
        "onda-base" -> mirrorY(h, path("onda-topo", w, h)!!)
        "diagonal-esq" -> listOf(ShapeCmd.M(0.2f * w, 0f), ShapeCmd.L(w, 0f), ShapeCmd.L(w, h), ShapeCmd.L(0f, h), ShapeCmd.Z)
        "diagonal-dir" -> listOf(ShapeCmd.M(0f, 0f), ShapeCmd.L(w, 0f), ShapeCmd.L(0.8f * w, h), ShapeCmd.L(0f, h), ShapeCmd.Z)
        "arco" -> listOf(ShapeCmd.M(0f, 0.3f * h), ShapeCmd.C(0.3f * w, -0.06f * h, 0.7f * w, -0.06f * h, w, 0.3f * h), ShapeCmd.L(w, h), ShapeCmd.L(0f, h), ShapeCmd.Z)
        "circulo" -> ellipse(0f, 0f, w, h)
        "pilula" -> { val r = minOf(w, h) / 2; rounded(w, h, r, r, r, r) }
        "cantos" -> { val r = minOf(w, h) * 0.12f; rounded(w, h, r, r, r, r) }
        "losango" -> listOf(ShapeCmd.M(w / 2, 0f), ShapeCmd.L(w, h / 2), ShapeCmd.L(w / 2, h), ShapeCmd.L(0f, h / 2), ShapeCmd.Z)
        "gota" -> { val r = minOf(w, h) * 0.45f; rounded(w, h, 0f, r, r, r) }
        else -> null
    }

    private fun edge(key: String, w: Float, h: Float): List<ShapeCmd>? = when (key) {
        "onda-esq" -> waveLeft(w, h)
        "onda-dir" -> mirrorX(w, waveLeft(w, h))
        "onda-topo" -> waveTop(w, h)
        "onda-base" -> mirrorY(h, waveTop(w, h))
        "diagonal-esq" -> listOf(ShapeCmd.M(0f, h), ShapeCmd.L(0.2f * w, 0f))
        "diagonal-dir" -> listOf(ShapeCmd.M(0.8f * w, h), ShapeCmd.L(w, 0f))
        "arco" -> listOf(ShapeCmd.M(0f, 0.3f * h), ShapeCmd.C(0.3f * w, -0.06f * h, 0.7f * w, -0.06f * h, w, 0.3f * h))
        else -> path(key, w, h)
    }

    /** O caminho fechado do formato no retângulo W×H (origem no canto de cima, à esquerda); null = retângulo. */
    fun commands(key: String, w: Float, h: Float): List<ShapeCmd>? = if (key in KEYS) path(key, w, h) else null

    /** O caminho do filete (só a borda recortada nas ondas, diagonais e no arco; o contorno inteiro nos outros). */
    fun edgeCommands(key: String, w: Float, h: Float): List<ShapeCmd>? = if (key in KEYS) edge(key, w, h) else null
}
