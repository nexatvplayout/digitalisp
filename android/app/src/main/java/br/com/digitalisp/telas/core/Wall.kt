package br.com.digitalisp.telas.core

import org.json.JSONObject

/**
 * Conjunto de telas (`signage.wall`, contrato em public/shared/tvcorp-wall.js): cardápio por tela com a troca dos itens
 * sincronizada pelo relógio (`menu`) ou videowall (`wall`: um layout do tamanho do conjunto, cada TV mostra a sua janela).
 */
data class WallCfg(
    val id: Long,
    val name: String,
    val videowall: Boolean,
    val cols: Int,
    val rows: Int,
    val pos: Int,
    val col: Int,
    val row: Int,
    val bezelX: Float,
    val bezelY: Float,
    val sync: Boolean,
    val epoch: Long,
)

/** A janela desta TV: o quadro com [scaleX]% × [scaleY]% da tela, deslocado em [offsetX]% e [offsetY]% (negativos). */
data class WallWindow(val scaleX: Float, val scaleY: Float, val offsetX: Float, val offsetY: Float)

/** Onde a playlist sincronizada está agora: o item, quanto já passou dele e quanto falta. */
data class SyncPos(val index: Int, val offset: Long, val remaining: Long)

object Wall {
    const val MAX_SCREENS = 9
    const val MAX_BEZEL = 20f

    fun parse(o: JSONObject?): WallCfg? {
        if (o == null) return null
        val cols = (o.opt("cols") as? Number)?.toInt() ?: return null
        val rows = (o.opt("rows") as? Number)?.toInt() ?: return null
        if (cols !in 1..6 || rows !in 1..3 || cols * rows !in 2..MAX_SCREENS) return null
        val pos = ((o.opt("pos") as? Number)?.toInt() ?: return null).takeIf { it in 1..cols * rows } ?: return null
        // col e row: os do servidor, se baterem com a grade; senão, pela posição (a linha da esquerda para a direita)
        val col = (o.opt("col") as? Number)?.toInt()?.takeIf { it in 0 until cols } ?: ((pos - 1) % cols)
        val row = (o.opt("row") as? Number)?.toInt()?.takeIf { it in 0 until rows } ?: ((pos - 1) / cols)
        val b = o.optJSONObject("bezel")
        fun bz(k: String) = ((b?.opt(k) as? Number)?.toFloat() ?: 0f).let { if (it.isNaN()) 0f else it.coerceIn(0f, MAX_BEZEL) }
        val mode = ConfigParser.str(o, "mode")?.lowercase()
        return WallCfg(
            id = (o.opt("id") as? Number)?.toLong() ?: 0L,
            name = (ConfigParser.str(o, "name") ?: "").replace('\n', ' ').take(60),
            videowall = mode == "wall",
            cols = cols, rows = rows, pos = pos, col = col, row = row,
            bezelX = bz("x"), bezelY = bz("y"),
            sync = if (o.has("sync")) o.opt("sync") == true else true,
            epoch = (o.opt("epoch") as? Number)?.toLong() ?: 0L,
        )
    }

    private fun r(v: Float) = Math.round(v * 10000f) / 10000f

    fun window(w: WallCfg): WallWindow {
        val bx = w.bezelX / 100f
        val by = w.bezelY / 100f
        val canvasW = w.cols + (w.cols - 1) * bx
        val canvasH = w.rows + (w.rows - 1) * by
        val left = w.col * (1 + bx)
        val top = w.row * (1 + by)
        return WallWindow(r(canvasW * 100), r(canvasH * 100), r(-left * 100), r(-top * 100))
    }

    /** A mesma conta em todas as TVs, com o mesmo relógio e o mesmo epoch; null = playlist vazia ou sem tempo. */
    fun syncPosition(durations: List<Long>, epoch: Long, now: Long): SyncPos? {
        val list = durations.map { it.coerceAtLeast(0L) }
        val total = list.sum()
        if (list.isEmpty() || total <= 0L) return null
        var t = (now - epoch) % total
        if (t < 0) t += total
        for (i in list.indices) {
            if (t < list[i]) return SyncPos(i, t, list[i] - t)
            t -= list[i]
        }
        return SyncPos(list.size - 1, list.last(), 0L)
    }
}
