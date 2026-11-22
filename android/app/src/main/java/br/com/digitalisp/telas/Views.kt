package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.SystemClock
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** Pequenos ajudantes para montar as telas em código (sem XML), pensados para o controle remoto. */
object Ui {
    const val BG = 0xF0181818.toInt() // telas de cadastro e ajustes: cinza neutro (white-label)
    const val ACCENT = 0xFF2F80ED.toInt()
    const val MUTED = 0xFFB8C4D6.toInt()

    fun dp(ctx: Context, v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).toInt()

    fun label(ctx: Context, text: CharSequence, sp: Float = 18f, color: Int = Color.WHITE, bold: Boolean = false): TextView =
        TextView(ctx).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
            setTextColor(color)
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }

    private fun box(ctx: Context, fill: Int, stroke: Int, strokeDp: Float): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(ctx, 8f).toFloat()
        if (strokeDp > 0) setStroke(dp(ctx, strokeDp), stroke)
    }

    /** Fundo que deixa claro onde está o foco do controle remoto. */
    fun focusBg(ctx: Context, normal: Int = 0xFF1C3357.toInt()): StateListDrawable = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), box(ctx, ACCENT, Color.WHITE, 3f))
        addState(intArrayOf(android.R.attr.state_pressed), box(ctx, ACCENT, Color.WHITE, 3f))
        addState(intArrayOf(), box(ctx, normal, 0x33FFFFFF, 1f))
    }

    fun button(ctx: Context, text: CharSequence, sp: Float = 18f, onClick: (Button) -> Unit): Button = Button(ctx).apply {
        this.text = text
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(Color.WHITE)
        background = focusBg(ctx)
        stateListAnimator = null
        isFocusable = true
        isFocusableInTouchMode = false
        isLongClickable = false
        val h = dp(ctx, 18f)
        val v = dp(ctx, 10f)
        setPadding(h, v, h, v)
        minHeight = 0
        minimumHeight = 0
        setOnClickListener { onClick(this) }
    }

    fun field(ctx: Context, hint: String, value: String = "", number: Boolean = false, secret: Boolean = false): EditText = EditText(ctx).apply {
        this.hint = hint
        setText(value)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setTextColor(Color.WHITE)
        setHintTextColor(0x88FFFFFF.toInt())
        background = focusBg(ctx, 0xFF10233F.toInt())
        isSingleLine = true
        isLongClickable = false
        inputType = when {
            number && secret -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            number -> InputType.TYPE_CLASS_NUMBER
            else -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        val h = dp(ctx, 14f)
        val v = dp(ctx, 10f)
        setPadding(h, v, h, v)
    }

    fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, top: Int = 0, weight: Float = 0f) =
        android.widget.LinearLayout.LayoutParams(w, h, weight).apply { topMargin = top }

    /** QR code gerado no aparelho (sem rede). Devolve null se o texto não couber. */
    fun qr(text: String, size: Int, margin: Int = 2): Bitmap? = try {
        val hints = mapOf(EncodeHintType.MARGIN to margin, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.CHARACTER_SET to "UTF-8")
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val px = IntArray(m.width * m.height)
        for (y in 0 until m.height) for (x in 0 until m.width) px[y * m.width + x] = if (m[x, y]) Color.BLACK else Color.WHITE
        Bitmap.createBitmap(px, m.width, m.height, Bitmap.Config.RGB_565)
    } catch (_: Exception) {
        null
    }
}

/** Moldura do vídeo: encaixa o filho na proporção do vídeo (faixas pretas no que sobrar). */
class VideoFrame(ctx: Context) : FrameLayout(ctx) {
    var aspect: Float = 16f / 9f
        set(v) {
            if (v > 0f && v != field) {
                field = v
                requestLayout()
            }
        }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(w, h)
        if (w == 0 || h == 0) return
        var cw = w
        var ch = (w / aspect).toInt()
        if (ch > h) {
            ch = h
            cw = (h * aspect).toInt()
        }
        for (i in 0 until childCount) {
            getChildAt(i).measure(MeasureSpec.makeMeasureSpec(cw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(ch, MeasureSpec.EXACTLY))
        }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val w = r - l
        val h = b - t
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            val x = (w - c.measuredWidth) / 2
            val y = (h - c.measuredHeight) / 2
            c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
        }
    }
}

/** Faixa de avisos rolando da direita para a esquerda. */
class TickerView(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = Typeface.DEFAULT_BOLD
    }
    private var unit = ""
    private var unitWidth = 0f
    private var offset = 0f
    private var lastAt = 0L
    private var speedPx = 0f
    var running = true
        set(v) {
            field = v
            lastAt = 0L
            if (v) invalidate()
        }

    init {
        setBackgroundColor(0xFF0B1E3A.toInt())
    }

    /** `speed` do contrato tratado como dp por segundo. */
    fun set(items: List<String>, speed: Int) {
        val text = items.joinToString("      •      ")
        unit = if (text.isEmpty()) "" else "$text      •      "
        speedPx = Ui.dp(context, speed.toFloat()).toFloat()
        remeasure()
        offset = -width.toFloat() // começa entrando pela direita
        invalidate()
    }

    private fun remeasure() {
        paint.textSize = (height - paddingTop - paddingBottom) * 0.52f
        unitWidth = if (unit.isEmpty()) 0f else paint.measureText(unit)
    }

    override fun setPadding(left: Int, top: Int, right: Int, bottom: Int) {
        super.setPadding(left, top, right, bottom)
        remeasure()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        remeasure()
        offset = -w.toFloat()
    }

    override fun onDraw(canvas: Canvas) {
        if (unitWidth <= 0f) return
        val now = SystemClock.uptimeMillis()
        val dt = if (lastAt == 0L) 0L else (now - lastAt).coerceAtMost(100L)
        lastAt = now
        offset += speedPx * dt / 1000f
        if (offset >= unitWidth) offset -= unitWidth
        // margem do overscan (padding): o fundo vai até a borda; o texto corre só dentro da área segura
        val inner = (height - paddingTop - paddingBottom).toFloat()
        val base = paddingTop + inner / 2f - (paint.descent() + paint.ascent()) / 2f
        canvas.save()
        canvas.clipRect(paddingLeft.toFloat(), paddingTop.toFloat(), (width - paddingRight).toFloat(), (height - paddingBottom).toFloat())
        var x = paddingLeft - offset
        while (x < width) {
            if (x + unitWidth > 0) canvas.drawText(unit, x, base, paint)
            x += unitWidth
        }
        canvas.restore()
        if (running) postInvalidateOnAnimation()
    }
}

/** Teclado numérico do PIN: funciona com as setas + OK e também com as teclas de número do controle. */
class PinPad(ctx: Context, maxWidthPx: Int, private val onChange: (String) -> Unit, private val onSubmit: (String) -> Unit) : android.widget.GridLayout(ctx) {
    private var pin = ""
    var enabledInput = true

    init {
        columnCount = 3
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "Apagar", "0", "OK")
        val m = Ui.dp(ctx, 5f)
        // as teclas cabem na largura que a tela tem (área segura do overscan incluída): nada sai pela direita
        val keyW = minOf(Ui.dp(ctx, 108f), maxWidthPx / 3 - 2 * m).coerceAtLeast(Ui.dp(ctx, 40f))
        for (k in keys) {
            val b = Ui.button(ctx, k, if (keyW < Ui.dp(ctx, 90f)) 18f else 22f) { press(k) }
            b.gravity = Gravity.CENTER
            b.setPadding(0, 0, 0, 0)
            val lp = LayoutParams().apply {
                width = keyW
                height = Ui.dp(ctx, 56f)
                setMargins(m, m, m, m)
            }
            addView(b, lp)
        }
    }

    fun focusFirst() {
        getChildAt(4)?.requestFocus() // o "5", no meio
    }

    fun clear() {
        pin = ""
        onChange(pin)
    }

    fun digit(d: Char) {
        if (!enabledInput || pin.length >= br.com.digitalisp.telas.core.PinDisplay.MAX) return
        pin += d
        onChange(pin)
    }

    fun backspace() {
        if (pin.isNotEmpty()) pin = pin.dropLast(1)
        onChange(pin)
    }

    fun submit() {
        if (enabledInput) onSubmit(pin)
    }

    private fun press(k: String) = when (k) {
        "Apagar" -> backspace()
        "OK" -> submit()
        else -> digit(k[0])
    }
}

/**
 * Teclado da chave de acesso, para digitar só com as setas e o OK do controle remoto. Mostra EXATAMENTE os caracteres
 * que a chave usa (core/ActivationKey: sem 0, 1, I e O): os números 2–9 numa linha, depois as letras.
 * TV box genérica costuma vir com o teclado de tablet do Android, que não se usa com as setas.
 */
class KeyPad(ctx: Context, maxWidthPx: Int, private val onChar: (Char) -> Unit, private val onErase: () -> Unit) : android.widget.GridLayout(ctx) {
    init {
        columnCount = 8
        val m = Ui.dp(ctx, 3f)
        // 8 colunas que cabem na largura que a tela tem (área segura do overscan incluída): nada sai pela direita
        val keyW = minOf(Ui.dp(ctx, 52f), maxWidthPx / 8 - 2 * m).coerceAtLeast(Ui.dp(ctx, 28f))
        val alphabet = br.com.digitalisp.telas.core.ActivationKey.ALPHABET
        val keys = (alphabet.filter { it.isDigit() } + alphabet.filter { it.isLetter() }).map { it.toString() } + "Apagar"
        for (k in keys) {
            val erase = k == "Apagar"
            val small = keyW < Ui.dp(ctx, 44f)
            val b = Ui.button(ctx, k, if (erase) (if (small) 13f else 16f) else (if (small) 16f else 20f)) { if (erase) onErase() else onChar(k[0]) }
            b.gravity = Gravity.CENTER
            b.setPadding(0, 0, 0, 0)
            val lp = LayoutParams(spec(UNDEFINED), spec(UNDEFINED, if (erase) 2 else 1)).apply {
                width = if (erase) 2 * keyW + 2 * m else keyW
                height = Ui.dp(ctx, 46f)
                setMargins(m, m, m, m)
            }
            addView(b, lp)
        }
    }

    fun focusFirst() {
        getChildAt(0)?.requestFocus()
    }
}

/** Ícone do clima desenhado no aparelho, pelos 6 nomes do contrato: clear, cloudy, partly, rain, storm, fog. */
class WeatherIcon(ctx: Context, private val icon: String) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    private fun sun(c: Canvas, cx: Float, cy: Float, r: Float) {
        paint.style = Paint.Style.FILL
        paint.color = 0xFFFFC83D.toInt()
        c.drawCircle(cx, cy, r, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = r * 0.22f
        paint.strokeCap = Paint.Cap.ROUND
        for (i in 0 until 8) {
            val a = Math.PI * i / 4
            val dx = Math.cos(a).toFloat()
            val dy = Math.sin(a).toFloat()
            c.drawLine(cx + dx * r * 1.35f, cy + dy * r * 1.35f, cx + dx * r * 1.75f, cy + dy * r * 1.75f, paint)
        }
        paint.style = Paint.Style.FILL
    }

    private fun cloud(c: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        paint.style = Paint.Style.FILL
        paint.color = color
        c.drawCircle(cx - r * 0.9f, cy + r * 0.25f, r * 0.7f, paint)
        c.drawCircle(cx, cy - r * 0.2f, r, paint)
        c.drawCircle(cx + r * 0.95f, cy + r * 0.3f, r * 0.65f, paint)
        c.drawRect(cx - r * 0.9f, cy + r * 0.25f, cx + r * 0.95f, cy + r * 0.95f, paint)
    }

    private fun lines(c: Canvas, color: Int, width: Float, pts: FloatArray) {
        paint.style = Paint.Style.STROKE
        paint.color = color
        paint.strokeWidth = width
        paint.strokeCap = Paint.Cap.ROUND
        c.drawLines(pts, paint)
        paint.style = Paint.Style.FILL
    }

    override fun onDraw(canvas: Canvas) {
        val s = minOf(width, height).toFloat()
        if (s <= 0f) return
        val x0 = (width - s) / 2f
        val y0 = (height - s) / 2f
        fun x(v: Float) = x0 + s * v
        fun y(v: Float) = y0 + s * v
        when (icon) {
            "clear" -> sun(canvas, x(0.5f), y(0.5f), s * 0.24f)
            "partly" -> {
                sun(canvas, x(0.36f), y(0.36f), s * 0.16f)
                cloud(canvas, x(0.56f), y(0.6f), s * 0.2f, Color.WHITE)
            }
            "rain" -> {
                cloud(canvas, x(0.5f), y(0.38f), s * 0.22f, 0xFFCFD8DC.toInt())
                lines(canvas, 0xFF4FC3F7.toInt(), s * 0.05f, floatArrayOf(
                    x(0.32f), y(0.68f), x(0.26f), y(0.86f),
                    x(0.52f), y(0.68f), x(0.46f), y(0.86f),
                    x(0.72f), y(0.68f), x(0.66f), y(0.86f),
                ))
            }
            "storm" -> {
                cloud(canvas, x(0.5f), y(0.36f), s * 0.22f, 0xFF90A4AE.toInt())
                lines(canvas, 0xFFFFC83D.toInt(), s * 0.06f, floatArrayOf(
                    x(0.54f), y(0.6f), x(0.42f), y(0.76f),
                    x(0.42f), y(0.76f), x(0.56f), y(0.76f),
                    x(0.56f), y(0.76f), x(0.46f), y(0.94f),
                ))
            }
            "fog" -> {
                cloud(canvas, x(0.5f), y(0.34f), s * 0.2f, 0xFFCFD8DC.toInt())
                lines(canvas, 0xFFB0BEC5.toInt(), s * 0.05f, floatArrayOf(
                    x(0.18f), y(0.66f), x(0.82f), y(0.66f),
                    x(0.26f), y(0.78f), x(0.74f), y(0.78f),
                    x(0.18f), y(0.9f), x(0.82f), y(0.9f),
                ))
            }
            else -> cloud(canvas, x(0.5f), y(0.48f), s * 0.24f, Color.WHITE)
        }
    }
}
