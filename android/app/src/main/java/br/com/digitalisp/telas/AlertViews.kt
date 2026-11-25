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
 * Ícone da categoria do alerta (contrato §9), desenhado no aparelho (sem fonte de emoji):
 * meteorologico, geologico, tecnologico, incendio-ar, saude, seguranca, transito, teste, outro (contrato §9 e §10). Categoria vazia = não desenha nada.
 */
class AlertIcon(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private var category = ""
    private var color = Color.WHITE

    fun set(category: String, color: Int) {
        if (category == this.category && color == this.color) return
        this.category = category
        this.color = color
        invalidate()
    }

    private fun fill() {
        paint.style = Paint.Style.FILL
        paint.color = color
    }

    private fun stroke(width: Float) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = width
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        paint.color = color
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height).toFloat()
        if (s <= 0f || category.isEmpty()) return
        val x0 = (width - s) / 2f
        val y0 = (height - s) / 2f
        fun x(v: Float) = x0 + s * v
        fun y(v: Float) = y0 + s * v
        path.reset()
        when (category) {
            "meteorologico" -> { // nuvem com chuva
                fill()
                c.drawCircle(x(0.32f), y(0.42f), s * 0.16f, paint)
                c.drawCircle(x(0.52f), y(0.32f), s * 0.22f, paint)
                c.drawCircle(x(0.72f), y(0.44f), s * 0.14f, paint)
                c.drawRect(x(0.32f), y(0.42f), x(0.72f), y(0.58f), paint)
                stroke(s * 0.06f)
                c.drawLine(x(0.34f), y(0.7f), x(0.28f), y(0.88f), paint)
                c.drawLine(x(0.54f), y(0.7f), x(0.48f), y(0.88f), paint)
                c.drawLine(x(0.74f), y(0.7f), x(0.68f), y(0.88f), paint)
            }
            "geologico" -> { // encosta com pedras rolando
                fill()
                path.moveTo(x(0.08f), y(0.88f))
                path.lineTo(x(0.08f), y(0.3f))
                path.lineTo(x(0.92f), y(0.88f))
                path.close()
                c.drawPath(path, paint)
                c.drawCircle(x(0.52f), y(0.34f), s * 0.09f, paint)
                c.drawCircle(x(0.76f), y(0.52f), s * 0.07f, paint)
            }
            "tecnologico" -> { // engrenagem
                stroke(s * 0.1f)
                for (i in 0 until 8) {
                    val a = Math.PI * i / 4
                    val dx = Math.cos(a).toFloat()
                    val dy = Math.sin(a).toFloat()
                    c.drawLine(x(0.5f) + dx * s * 0.3f, y(0.5f) + dy * s * 0.3f, x(0.5f) + dx * s * 0.4f, y(0.5f) + dy * s * 0.4f, paint)
                }
                stroke(s * 0.12f)
                c.drawCircle(x(0.5f), y(0.5f), s * 0.22f, paint)
            }
            "incendio-ar" -> { // chama
                fill()
                path.moveTo(x(0.5f), y(0.06f))
                path.cubicTo(x(0.56f), y(0.3f), x(0.84f), y(0.44f), x(0.8f), y(0.68f))
                path.cubicTo(x(0.76f), y(0.86f), x(0.62f), y(0.94f), x(0.5f), y(0.94f))
                path.cubicTo(x(0.36f), y(0.94f), x(0.22f), y(0.84f), x(0.2f), y(0.66f))
                path.cubicTo(x(0.18f), y(0.5f), x(0.3f), y(0.42f), x(0.34f), y(0.3f))
                path.cubicTo(x(0.4f), y(0.4f), x(0.42f), y(0.44f), x(0.44f), y(0.5f))
                path.cubicTo(x(0.5f), y(0.36f), x(0.5f), y(0.2f), x(0.5f), y(0.06f))
                path.close()
                c.drawPath(path, paint)
            }
            "saude" -> { // cruz
                fill()
                c.drawRect(x(0.38f), y(0.1f), x(0.62f), y(0.9f), paint)
                c.drawRect(x(0.1f), y(0.38f), x(0.9f), y(0.62f), paint)
            }
            "seguranca" -> { // escudo
                fill()
                path.moveTo(x(0.5f), y(0.06f))
                path.lineTo(x(0.86f), y(0.2f))
                path.lineTo(x(0.86f), y(0.5f))
                path.cubicTo(x(0.86f), y(0.72f), x(0.7f), y(0.86f), x(0.5f), y(0.95f))
                path.cubicTo(x(0.3f), y(0.86f), x(0.14f), y(0.72f), x(0.14f), y(0.5f))
                path.lineTo(x(0.14f), y(0.2f))
                path.close()
                c.drawPath(path, paint)
            }
            "transito" -> { // cone de trânsito
                fill()
                path.moveTo(x(0.44f), y(0.08f))
                path.lineTo(x(0.56f), y(0.08f))
                path.lineTo(x(0.63f), y(0.34f))
                path.lineTo(x(0.37f), y(0.34f))
                path.close()
                path.moveTo(x(0.34f), y(0.44f))
                path.lineTo(x(0.66f), y(0.44f))
                path.lineTo(x(0.73f), y(0.72f))
                path.lineTo(x(0.27f), y(0.72f))
                path.close()
                c.drawPath(path, paint)
                c.drawRect(x(0.1f), y(0.8f), x(0.9f), y(0.92f), paint)
            }
            "teste" -> { // círculo com o "visto" de conferência
                stroke(s * 0.09f)
                c.drawCircle(x(0.5f), y(0.5f), s * 0.38f, paint)
                path.moveTo(x(0.32f), y(0.52f))
                path.lineTo(x(0.45f), y(0.65f))
                path.lineTo(x(0.69f), y(0.37f))
                c.drawPath(path, paint)
            }
            "outro" -> { // triângulo de atenção
                stroke(s * 0.09f)
                path.moveTo(x(0.5f), y(0.12f))
                path.lineTo(x(0.92f), y(0.86f))
                path.lineTo(x(0.08f), y(0.86f))
                path.close()
                c.drawPath(path, paint)
                c.drawLine(x(0.5f), y(0.4f), x(0.5f), y(0.62f), paint)
                fill()
                c.drawCircle(x(0.5f), y(0.74f), s * 0.05f, paint)
            }
        }
    }
}
