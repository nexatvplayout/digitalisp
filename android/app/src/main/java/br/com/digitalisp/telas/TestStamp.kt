package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View

/**
 * Alerta de teste ou simulação (contrato §9, `test: true`): a palavra TESTE fica na tela o alerta inteiro, para ninguém
 * tomar por real: atravessada em diagonal por cima do texto e num selo cheio em cada canto de cima.
 */
class TestStamp(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT_BOLD }
    private val box = RectF()

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val base = minOf(w, h)

        // diagonal, grande e vazada (deixa ler o texto do alerta por baixo)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = base * 0.012f
        paint.color = 0x99000000.toInt()
        paint.textSize = base * 0.42f
        paint.letterSpacing = 0.08f
        val tw = paint.measureText("TESTE")
        if (tw > w * 0.9f) paint.textSize *= w * 0.9f / tw
        c.save()
        c.rotate(-18f, w / 2f, h / 2f)
        val fm = paint.fontMetrics
        c.drawText("TESTE", (w - paint.measureText("TESTE")) / 2f, h / 2f - (fm.ascent + fm.descent) / 2f, paint)
        c.restore()

        // selos cheios nos dois cantos de cima
        paint.letterSpacing = 0.06f
        paint.textSize = base * 0.075f
        val bw = paint.measureText("TESTE") + base * 0.06f
        val bh = base * 0.12f
        val m = base * 0.03f
        val sfm = paint.fontMetrics
        for (left in floatArrayOf(m, w - m - bw)) {
            box.set(left, m, left + bw, m + bh)
            paint.style = Paint.Style.FILL
            paint.color = Color.BLACK
            c.drawRoundRect(box, bh * 0.15f, bh * 0.15f, paint)
            paint.color = Color.WHITE
            c.drawText("TESTE", left + base * 0.03f, m + bh / 2f - (sfm.ascent + sfm.descent) / 2f, paint)
        }
    }
}
