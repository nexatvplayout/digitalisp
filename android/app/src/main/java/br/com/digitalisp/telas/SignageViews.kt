package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import android.widget.FrameLayout
import br.com.digitalisp.telas.core.Insets
import br.com.digitalisp.telas.core.RiskColors
import br.com.digitalisp.telas.core.Signage
import br.com.digitalisp.telas.core.SignageFile
import br.com.digitalisp.telas.core.SignageItem
import br.com.digitalisp.telas.core.ThemeCfg
import br.com.digitalisp.telas.core.WeatherCfg
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import android.text.Layout as TextLayout

/*
 * TV Corporativa: o que aparece nas zonas, desenhado no Canvas pelo próprio app (sem WebView, sem segundo player).
 * O texto nunca transborda: a letra diminui até um mínimo legível e, se ainda não couber, corta com reticências.
 */

/** Cores do modo: as do tema da empresa (cor principal e claro/escuro). */
data class SignLook(val bg: Int, val panel: Int, val text: Int, val dim: Int, val line: Int, val accent: Int, val onAccent: Int, val light: Boolean) {
    companion object {
        fun of(theme: ThemeCfg, background: Int?): SignLook =
            SignLook(background ?: theme.bg, theme.panel, theme.text, theme.dim, theme.line, theme.color, theme.onColor, theme.light)
    }
}

/** O que as zonas precisam do resto do app (hora certa, clima, arquivos). */
class SignEnv(
    val look: SignLook,
    val tz: String,
    val now: () -> Long,
    val clockOk: () -> Boolean,
    val weather: () -> WeatherCfg?,
    val file: (SignageFile) -> java.io.File?,
    /** item entrou na tela / quanto tempo ficou (relatório de exibição) */
    val onShown: (String) -> Unit,
    val onTime: (String, Long) -> Unit,
)

/** Desenho de texto que cabe na caixa. */
internal object SignText {
    fun paint(px: Float, color: Int, bold: Boolean): TextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = px
        this.color = color
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }

    fun layout(text: CharSequence, w: Int, px: Float, color: Int, bold: Boolean, maxLines: Int, align: TextLayout.Alignment): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, paint(px, color, bold), w.coerceAtLeast(1))
            .setAlignment(align)
            .setIncludePad(false)
            .setLineSpacing(0f, 1.08f)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()

    /** A maior letra (de [startPx] até [minPx]) com que o texto cabe em w×h em até [maxLines] linhas. */
    fun fit(
        text: CharSequence, w: Int, h: Int, startPx: Float, minPx: Float, color: Int, bold: Boolean = false,
        maxLines: Int = 8, align: TextLayout.Alignment = TextLayout.Alignment.ALIGN_NORMAL,
    ): StaticLayout {
        var px = startPx.coerceAtLeast(minPx)
        while (true) {
            val l = layout(text, w, px, color, bold, maxLines, align)
            val cut = l.lineCount > 0 && l.getEllipsisCount(l.lineCount - 1) > 0
            if ((l.height <= h && !cut) || px <= minPx) return l
            px = (px * 0.9f).coerceAtLeast(minPx)
        }
    }

    fun draw(c: Canvas, l: StaticLayout, x: Float, y: Float) {
        c.save()
        c.translate(x, y)
        l.draw(c)
        c.restore()
    }

    /** Uma linha só, encurtada com reticências para caber em [w]. */
    fun line(c: Canvas, text: String, x: Float, baseline: Float, w: Float, p: Paint, alignRight: Boolean = false) {
        val t = TextUtils.ellipsize(text, p as TextPaint, w, TextUtils.TruncateAt.END).toString()
        val dx = if (alignRight) w - p.measureText(t) else 0f
        c.drawText(t, x + dx, baseline, p)
    }
}

/**
 * Um item (ou o conteúdo fixo de uma zona) desenhado no Canvas. O desenho é preparado uma vez por tamanho; só o que
 * depende da hora (relógio, contador, dias sem acidente, relógio mundial) é refeito a cada [tick].
 */
class SignItemView(
    ctx: Context,
    val item: SignageItem,
    private val env: SignEnv,
    private val bitmaps: Map<String, Bitmap>,
    private val edge: Insets,
) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private var preparedW = -1
    private var preparedH = -1
    private val ops = ArrayList<(Canvas) -> Unit>()
    private var dynamic: ((Canvas) -> Unit)? = null
    private val look get() = env.look
    private val ptBr = Locale("pt", "BR")

    /** Precisa de redesenho a cada segundo? */
    val timed: Boolean
        get() = item.kind in setOf("clock", "countdown", "safety", "worldclock") || (item.kind == "slide" && item.template == "evento" && item.target > 0) ||
            (item.kind == "post" && item.template == "evento" && item.target > 0)

    private var lastMinute = -1L

    fun tick() {
        if (!timed) return
        val m = env.now() / 60_000L
        if (m == lastMinute && item.kind != "clock") return
        lastMinute = m
        if (item.kind == "safety" || item.template == "evento") preparedW = -1 // o número muda: refaz o desenho
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return
        if (w != preparedW || h != preparedH) {
            preparedW = w
            preparedH = h
            ops.clear()
            dynamic = null
            try {
                prepare(w, h)
            } catch (_: Exception) {
                ops.clear()
            }
        }
        for (op in ops) op(canvas)
        dynamic?.invoke(canvas)
    }

    // ------------------------------------------------------------------ montagem

    private fun bmp(f: SignageFile?): Bitmap? = f?.let { bitmaps[it.sha256] }

    /** A caixa útil: com folga e com a margem do overscan nos lados que encostam na borda da tela. */
    private fun box(w: Int, h: Int, padK: Float = 0.06f): RectF {
        val p = minOf(w, h) * padK
        return RectF(edge.left + p, edge.top + p, w - edge.right - p, h - edge.bottom - p)
    }

    private fun background(w: Int, h: Int, color: Int = look.bg) {
        ops += { c -> c.drawColor(color) }
    }

    private fun prepare(w: Int, h: Int) {
        when (item.kind) {
            "image" -> image(w, h)
            "slide", "post" -> slide(w, h)
            "birthdays" -> { background(w, h); birthdays(box(w, h), item.title.ifEmpty { "Aniversariantes" }) }
            "kpi" -> { background(w, h); kpi(box(w, h), item.kpi!!, withHeader = true) }
            "news" -> { background(w, h); news(box(w, h)) }
            "quotes" -> { background(w, h); quotes(box(w, h)) }
            "menu" -> { background(w, h); menu(box(w, h), item.title.ifEmpty { "Cardápio de hoje" }, item.subtitle) }
            "countdown" -> { background(w, h); countdown(box(w, h)) }
            "safety" -> { background(w, h); safety(box(w, h)) }
            "worldclock" -> { background(w, h); worldclock(box(w, h)) }
            "text" -> { background(w, h); textBlock(box(w, h), item.title, item.text) }
            "clock" -> { background(w, h); clock(box(w, h)) }
            "qr" -> { background(w, h); qrBlock(box(w, h)) }
            "logo" -> logo(w, h)
            "weather" -> { background(w, h); weather(box(w, h)) }
            else -> background(w, h)
        }
    }

    // ------------------------------------------------------------------ peças comuns

    /** O chapéu (rótulo pequeno na cor do modelo) e o título; devolve onde o conteúdo continua. */
    private fun header(r: RectF, label: String, title: String, color: Int, titleK: Float = 0.11f): Float {
        val base = minOf(r.width(), r.height() * 1.4f)
        var y = r.top
        if (label.isNotEmpty()) {
            val px = (base * 0.045f).coerceAtLeast(12f)
            val l = SignText.fit(label.uppercase(ptBr), r.width().toInt(), (px * 1.6f).toInt(), px, px * 0.7f, color, true, 1)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height + px * 0.5f
        }
        if (title.isNotEmpty()) {
            val px = base * titleK
            val l = SignText.fit(title, r.width().toInt(), (r.height() * 0.4f).toInt(), px, px * 0.4f, look.text, true, 3)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height + px * 0.35f
        }
        return y
    }

    private fun accentBar(w: Int, h: Int, color: Int) {
        val t = minOf(w, h) * 0.018f
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.color = color
            c.drawRect(0f, 0f, t + edge.left, h.toFloat(), paint)
        }
    }

    private fun drawCover(c: Canvas, b: Bitmap, dst: RectF, contain: Boolean = false, radius: Float = 0f) {
        val bw = b.width.toFloat()
        val bh = b.height.toFloat()
        if (bw <= 0 || bh <= 0) return
        val scale = if (contain) minOf(dst.width() / bw, dst.height() / bh) else maxOf(dst.width() / bw, dst.height() / bh)
        val sw = dst.width() / scale
        val sh = dst.height() / scale
        paint.isFilterBitmap = true
        if (contain) {
            val dw = bw * scale
            val dh = bh * scale
            val out = RectF(dst.centerX() - dw / 2, dst.centerY() - dh / 2, dst.centerX() + dw / 2, dst.centerY() + dh / 2)
            c.drawBitmap(b, null, out, paint)
        } else {
            val src = Rect(((bw - sw) / 2).toInt(), ((bh - sh) / 2).toInt(), ((bw + sw) / 2).toInt(), ((bh + sh) / 2).toInt())
            if (radius > 0) {
                c.save()
                c.clipPath(Path().apply { addRoundRect(dst, radius, radius, Path.Direction.CW) })
                c.drawBitmap(b, src, dst, paint)
                c.restore()
            } else {
                c.drawBitmap(b, src, dst, paint)
            }
        }
    }

    /** QR code sobre placa branca, com "Aponte a câmera" embaixo; devolve a altura usada. */
    private fun qr(url: String, left: Float, top: Float, side: Float, caption: Boolean = true): Float {
        val b = ImageArt.qr(url, side.toInt()) ?: return 0f
        ops += { c -> ImageArt.drawQr(c, b, left, top, side, paint) }
        if (!caption) return side
        val px = side * 0.1f
        val l = SignText.fit("Aponte a câmera", side.toInt() + (side * 0.4f).toInt(), (px * 1.5f).toInt(), px, px * 0.6f, look.dim, false, 1, TextLayout.Alignment.ALIGN_CENTER)
        val y = top + side + side * 0.06f
        ops += { c -> SignText.draw(c, l, left - side * 0.2f, y) }
        return side * 1.06f + l.height
    }

    private fun templateColor(tpl: String): Int = when (tpl) {
        "boas-vindas" -> 0xFF16A34A.toInt()
        "aniversariantes" -> 0xFFDB2777.toInt()
        "reconhecimento" -> 0xFFF59E0B.toInt()
        "seguranca" -> 0xFFF97316.toInt()
        "evento" -> 0xFF7C3AED.toInt()
        "vaga" -> 0xFF0D9488.toInt()
        "cardapio" -> 0xFFEA580C.toInt()
        "data-comemorativa" -> 0xFFE11D48.toInt()
        else -> look.accent
    }

    // ------------------------------------------------------------------ imagem

    private fun image(w: Int, h: Int) {
        val b = bmp(item.file)
        ops += { c -> c.drawColor(Color.BLACK) }
        if (b != null) ops += { c -> drawCover(c, b, RectF(0f, 0f, w.toFloat(), h.toFloat()), item.contain) }
        if (item.label.isNotEmpty()) caption(w, h, item.label, "")
    }

    /** Faixa escura embaixo com a legenda (imagem com legenda). */
    private fun caption(w: Int, h: Int, title: String, text: String) {
        val r = box(w, h, 0.04f)
        val base = minOf(w, h).toFloat()
        val t = if (title.isNotEmpty()) SignText.fit(title, r.width().toInt(), (h * 0.14f).toInt(), base * 0.07f, base * 0.035f, Color.WHITE, true, 2) else null
        val s = if (text.isNotEmpty()) SignText.fit(text, r.width().toInt(), (h * 0.14f).toInt(), base * 0.045f, base * 0.028f, 0xFFE5E7EB.toInt(), false, 3) else null
        val inner = (t?.height ?: 0) + (s?.height ?: 0) + (if (t != null && s != null) base * 0.015f else 0f)
        val top = r.bottom - inner
        val pad = base * 0.03f
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.shader = LinearGradient(0f, top - pad * 3, 0f, h.toFloat(), 0x00000000, 0xD9000000.toInt(), Shader.TileMode.CLAMP)
            c.drawRect(0f, top - pad * 3, w.toFloat(), h.toFloat(), paint)
            paint.shader = null
            var y = top
            if (t != null) { SignText.draw(c, t, r.left, y); y += t.height + base * 0.015f }
            if (s != null) SignText.draw(c, s, r.left, y)
        }
    }

    // ------------------------------------------------------------------ slides (modelos)

    private fun slide(w: Int, h: Int) {
        val tpl = item.template.ifEmpty { "comunicado" }
        val color = templateColor(tpl)
        val label = item.label.ifEmpty { Signage.templateLabel(tpl) }
        when (tpl) {
            "imagem-com-legenda" -> {
                ops += { c -> c.drawColor(Color.BLACK) }
                bmp(item.file)?.let { b -> ops += { c -> drawCover(c, b, RectF(0f, 0f, w.toFloat(), h.toFloat())) } }
                caption(w, h, item.title, item.text)
                return
            }
            "aniversariantes" -> {
                background(w, h)
                accentBar(w, h, color)
                if (item.people.isNotEmpty()) birthdays(box(w, h), item.title.ifEmpty { "Aniversariantes" })
                else generic(w, h, label, color)
                return
            }
            "indicador" -> {
                background(w, h)
                accentBar(w, h, color)
                val k = item.kpi
                if (k != null) {
                    val r = box(w, h)
                    val y = header(r, label, item.title, color, 0.08f)
                    kpi(RectF(r.left, y, r.right, r.bottom), k, withHeader = item.title.isEmpty())
                } else generic(w, h, label, color)
                return
            }
            "cardapio" -> {
                background(w, h)
                accentBar(w, h, color)
                if (item.menu.isNotEmpty()) menu(box(w, h), item.title.ifEmpty { "Cardápio" }, item.subtitle)
                else generic(w, h, label, color)
                return
            }
            "data-comemorativa" -> {
                celebration(w, h, label, color)
                return
            }
            "qr" -> {
                if (item.qr != null) qrSlide(w, h, label, color) else { background(w, h); generic(w, h, label, color) }
                return
            }
        }
        background(w, h)
        if (tpl == "seguranca") hazard(w, h) else accentBar(w, h, color)
        generic(w, h, label, color)
    }

    /** Faixa zebrada de segurança no alto. */
    private fun hazard(w: Int, h: Int) {
        val bandH = minOf(w, h) * 0.035f
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.color = 0xFFFACC15.toInt()
            c.drawRect(0f, 0f, w.toFloat(), bandH + edge.top, paint)
            paint.color = 0xFF111111.toInt()
            val step = bandH * 1.6f
            var x = -bandH * 2
            c.save()
            c.clipRect(0f, 0f, w.toFloat(), bandH + edge.top)
            while (x < w + bandH * 2) {
                val p = Path().apply {
                    moveTo(x, bandH + edge.top); lineTo(x + step * 0.5f, bandH + edge.top)
                    lineTo(x + step * 0.5f + bandH + edge.top, 0f); lineTo(x + bandH + edge.top, 0f); close()
                }
                c.drawPath(p, paint)
                x += step
            }
            c.restore()
        }
    }

    /** Modelo geral: chapéu, título, subtítulo (nome), texto, imagem ao lado ou em cima e o QR no canto. */
    private fun generic(w: Int, h: Int, label: String, color: Int) {
        val r0 = box(w, h)
        if (item.template == "seguranca") r0.top += minOf(w, h) * 0.04f
        val img = bmp(item.file)
        val wide = r0.width() > r0.height() * 1.15f
        var r = RectF(r0)
        if (img != null) {
            if (wide) {
                val iw = r.width() * 0.42f
                val dst = RectF(r.right - iw, r.top, r.right, r.bottom)
                ops += { c -> drawCover(c, img, dst, radius = minOf(w, h) * 0.02f) }
                r = RectF(r.left, r.top, r.right - iw - r0.width() * 0.04f, r.bottom)
            } else {
                val ih = r.height() * 0.38f
                val dst = RectF(r.left, r.top, r.right, r.top + ih)
                ops += { c -> drawCover(c, img, dst, radius = minOf(w, h) * 0.02f) }
                r = RectF(r.left, r.top + ih + r0.height() * 0.04f, r.right, r.bottom)
            }
        }
        // o QR fica no canto de baixo à direita da área de texto
        val qrUrl = item.qr
        var qrSide = 0f
        if (qrUrl != null) {
            qrSide = (minOf(r.width(), r.height()) * 0.3f).coerceAtLeast(80f)
            if (qrSide * 2.2f > r.width()) qrSide = r.width() / 2.6f
        }
        var y = header(r, label, item.title, color)
        if (item.template == "reconhecimento") {
            val s = minOf(r.width(), r.height()) * 0.08f
            val cx = r.right - s - (if (qrUrl != null) 0f else 0f)
            val cy = r.top + s
            ops += { c -> star(c, cx, cy, s, color) }
        }
        val base = minOf(r.width(), r.height() * 1.4f)
        if (item.subtitle.isNotEmpty()) {
            val px = base * 0.07f
            val l = SignText.fit(item.subtitle, r.width().toInt(), (r.height() * 0.2f).toInt(), px, px * 0.5f, color, true, 2)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height + px * 0.4f
        }
        val bottomReserve = if (item.template == "evento" && item.target > 0) base * 0.14f else 0f
        if (item.text.isNotEmpty()) {
            val textW = if (qrUrl != null) r.width() - qrSide * 1.25f else r.width()
            val px = base * 0.06f
            val l = SignText.fit(item.text, textW.toInt(), (r.bottom - y - bottomReserve).toInt().coerceAtLeast(1), px, px * 0.5f, look.text, false, Signage.MAX_LINES)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height
        }
        if (qrUrl != null) qr(qrUrl, r.right - qrSide, r.bottom - qrSide * 1.25f - bottomReserve, qrSide)
        if (item.template == "evento" && item.target > 0) {
            val line = eventLine()
            val px = base * 0.065f
            val l = SignText.fit(line, r.width().toInt(), (bottomReserve).toInt(), px, px * 0.5f, color, true, 1)
            ops += { c -> SignText.draw(c, l, r.left, r.bottom - l.height) }
        }
    }

    /** Linha do evento: "Faltam 3 dias e 4 h" ou a data. */
    private fun eventLine(): String {
        if (!env.clockOk()) return dateTime(item.target)
        val rem = Signage.remaining(item.target, env.now())
        return when {
            rem.done -> dateTime(item.target)
            rem.days > 1 -> "Faltam ${rem.days} dias · ${dateTime(item.target)}"
            rem.days == 1L -> "Falta 1 dia · ${dateTime(item.target)}"
            rem.hours > 0 -> "Faltam ${rem.hours} h ${rem.minutes} min"
            else -> "Faltam ${rem.minutes} min"
        }
    }

    private fun dateTime(ms: Long): String {
        val f = SimpleDateFormat("d 'de' MMMM 'às' HH:mm", ptBr).apply { timeZone = TimeZone.getTimeZone(env.tz) }
        return f.format(Date(ms)).replace(" às 00:00", "")
    }

    private fun star(c: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        val p = Path()
        for (i in 0 until 10) {
            val rr = if (i % 2 == 0) r else r * 0.45f
            val a = Math.PI / 2 + i * Math.PI / 5
            val x = cx + (rr * Math.cos(a)).toFloat()
            val y = cy - (rr * Math.sin(a)).toFloat()
            if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
        }
        p.close()
        paint.style = Paint.Style.FILL
        paint.color = color
        c.drawPath(p, paint)
    }

    /** Data comemorativa: fundo na cor do modelo, título grande no centro. */
    private fun celebration(w: Int, h: Int, label: String, color: Int) {
        val on = RiskColors.textOn(color)
        ops += { c ->
            c.drawColor(color)
            paint.style = Paint.Style.FILL
            paint.color = 0x22FFFFFF
            val m = minOf(w, h).toFloat()
            c.drawCircle(w * 0.1f, h * 0.15f, m * 0.25f, paint)
            c.drawCircle(w * 0.92f, h * 0.88f, m * 0.32f, paint)
            c.drawCircle(w * 0.85f, h * 0.12f, m * 0.08f, paint)
        }
        val r = box(w, h, 0.1f)
        val base = minOf(r.width(), r.height() * 1.4f)
        val img = bmp(item.file)
        var top = r.top
        if (img != null) {
            val ih = r.height() * 0.35f
            val dst = RectF(r.centerX() - ih * 0.8f, r.top, r.centerX() + ih * 0.8f, r.top + ih)
            ops += { c -> drawCover(c, img, dst, contain = true) }
            top += ih + base * 0.03f
        }
        val parts = ArrayList<StaticLayout>()
        if (label.isNotEmpty()) parts += SignText.fit(label.uppercase(ptBr), r.width().toInt(), (base * 0.08f).toInt(), base * 0.045f, base * 0.03f, on, true, 1, TextLayout.Alignment.ALIGN_CENTER)
        if (item.title.isNotEmpty()) parts += SignText.fit(item.title, r.width().toInt(), ((r.bottom - top) * 0.5f).toInt(), base * 0.14f, base * 0.05f, on, true, 3, TextLayout.Alignment.ALIGN_CENTER)
        if (item.text.isNotEmpty()) parts += SignText.fit(item.text, r.width().toInt(), ((r.bottom - top) * 0.35f).toInt(), base * 0.06f, base * 0.03f, on, false, 5, TextLayout.Alignment.ALIGN_CENTER)
        val gap = base * 0.03f
        val total = parts.sumOf { it.height } + gap * (parts.size - 1).coerceAtLeast(0)
        var y = top + ((r.bottom - top) - total) / 2
        for (l in parts) {
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height + gap
        }
    }

    /** Chamada para ação: QR grande de um lado, título e texto do outro. */
    private fun qrSlide(w: Int, h: Int, label: String, color: Int) {
        background(w, h)
        accentBar(w, h, color)
        val r = box(w, h)
        val wide = r.width() > r.height()
        if (wide) {
            val side = minOf(r.height() * 0.78f, r.width() * 0.4f)
            val left = r.right - side - side * 0.05f
            qr(item.qr!!, left, r.top + (r.height() - side * 1.15f) / 2, side)
            val tr = RectF(r.left, r.top, left - r.width() * 0.05f, r.bottom)
            val y = header(tr, label, item.title, color)
            if (item.text.isNotEmpty()) {
                val px = minOf(tr.width(), tr.height()) * 0.08f
                val l = SignText.fit(item.text, tr.width().toInt(), (tr.bottom - y).toInt().coerceAtLeast(1), px, px * 0.5f, look.text, false, 6)
                ops += { c -> SignText.draw(c, l, tr.left, y) }
            }
        } else {
            val side = minOf(r.width() * 0.7f, r.height() * 0.45f)
            val y = header(r, label, item.title, color)
            qr(item.qr!!, r.centerX() - side / 2, r.bottom - side * 1.2f, side)
            if (item.text.isNotEmpty()) {
                val px = r.width() * 0.06f
                val l = SignText.fit(item.text, r.width().toInt(), (r.bottom - side * 1.25f - y).toInt().coerceAtLeast(1), px, px * 0.5f, look.text, false, 5)
                ops += { c -> SignText.draw(c, l, r.left, y) }
            }
        }
    }

    // ------------------------------------------------------------------ aniversariantes

    private fun birthdays(r: RectF, title: String) {
        val color = templateColor("aniversariantes")
        val y0 = header(r, "", title, color, 0.09f)
        val people = item.people
        if (people.isEmpty()) return
        val l = Signage.local(env.now(), env.tz)
        val today = l.date.substring(5) // MM-DD
        val avail = r.bottom - y0
        val base = minOf(r.width(), r.height() * 1.4f)
        val rowH = (avail / people.size).coerceIn(base * 0.11f, base * 0.2f)
        val fit = (avail / rowH).toInt().coerceAtLeast(1)
        val shown = if (people.size > fit) people.take(fit - 1) else people
        var y = y0
        val name = TextPaint(Paint.ANTI_ALIAS_FLAG)
        for (p in shown) {
            val yy = y
            val isToday = String.format(Locale.ROOT, "%02d-%02d", p.month, p.day) == today
            val photo = bmp(p.photo)
            ops += { c ->
                val d = rowH * 0.78f
                val cx = r.left + d / 2
                val cy = yy + rowH / 2
                if (photo != null) {
                    c.save()
                    c.clipPath(Path().apply { addCircle(cx, cy, d / 2, Path.Direction.CW) })
                    drawCover(c, photo, RectF(cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2))
                    c.restore()
                } else {
                    paint.style = Paint.Style.FILL
                    paint.color = if (isToday) color else look.panel
                    c.drawCircle(cx, cy, d / 2, paint)
                    name.textSize = d * 0.38f
                    name.typeface = Typeface.DEFAULT_BOLD
                    name.color = if (isToday) RiskColors.textOn(color) else look.text
                    val ini = Signage.initials(p.name)
                    c.drawText(ini, cx - name.measureText(ini) / 2, cy + name.textSize * 0.36f, name)
                }
                val tx = r.left + d + rowH * 0.25f
                val dateW = rowH * 1.4f
                name.typeface = Typeface.DEFAULT_BOLD
                name.textSize = rowH * (if (p.sector.isEmpty()) 0.4f else 0.34f)
                name.color = look.text
                val nameBase = if (p.sector.isEmpty()) cy + name.textSize * 0.35f else cy - rowH * 0.04f
                SignText.line(c, p.name, tx, nameBase, r.right - tx - dateW, name)
                if (p.sector.isNotEmpty()) {
                    name.typeface = Typeface.DEFAULT
                    name.textSize = rowH * 0.24f
                    name.color = look.dim
                    SignText.line(c, p.sector, tx, cy + rowH * 0.3f, r.right - tx - dateW, name)
                }
                name.typeface = Typeface.DEFAULT_BOLD
                name.textSize = rowH * 0.3f
                name.color = if (isToday) color else look.dim
                val dt = if (isToday) "Hoje!" else Signage.dayMonth(p)
                c.drawText(dt, r.right - name.measureText(dt), cy + name.textSize * 0.35f, name)
            }
            y += rowH
        }
        if (shown.size < people.size) {
            val more = "+${people.size - shown.size} aniversariante(s)"
            val yy = y
            ops += { c ->
                name.typeface = Typeface.DEFAULT
                name.textSize = rowH * 0.3f
                name.color = look.dim
                c.drawText(more, r.left, yy + rowH * 0.6f, name)
            }
        }
    }

    // ------------------------------------------------------------------ indicador

    private fun kpiColor(band: String): Int = when (band) {
        "bad" -> 0xFFDC2626.toInt()
        "warn" -> 0xFFF59E0B.toInt()
        else -> 0xFF16A34A.toInt()
    }

    private fun kpi(r0: RectF, k: br.com.digitalisp.telas.core.SignKpi, withHeader: Boolean) {
        val r = RectF(r0)
        var y = r.top
        if (withHeader && k.name.isNotEmpty()) y = header(r, "Indicador", k.name, look.accent, 0.08f)
        val base = minOf(r.width(), (r.bottom - y) * 1.6f)
        val band = Signage.kpiBand(k)
        val color = kpiColor(band)
        val value = Signage.kpiNumber(k.value) + (if (k.unit.isNotEmpty()) (if (k.unit == "%") "%" else " " + k.unit) else "")
        val big = SignText.fit(value, r.width().toInt(), ((r.bottom - y) * 0.45f).toInt(), base * 0.28f, base * 0.08f, color, true, 1)
        val yy = y
        ops += { c -> SignText.draw(c, big, r.left, yy) }
        y += big.height + base * 0.03f
        val ratio = Signage.kpiRatio(k) ?: return
        val barH = (base * 0.06f).coerceAtLeast(10f)
        val by = y
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.color = look.panel
            c.drawRoundRect(RectF(r.left, by, r.right, by + barH), barH / 2, barH / 2, paint)
            paint.color = color
            if (ratio > 0f) c.drawRoundRect(RectF(r.left, by, r.left + maxOf(barH, r.width() * ratio), by + barH), barH / 2, barH / 2, paint)
        }
        y += barH + base * 0.03f
        val t = k.target!!
        val meta = "Meta: " + Signage.kpiNumber(t) + (if (k.unit.isNotEmpty()) (if (k.unit == "%") "%" else " " + k.unit) else "") +
            " · " + Signage.number((ratio * 100).toDouble(), 0) + "% da meta"
        val px = base * 0.055f
        val l = SignText.fit(meta, r.width().toInt(), (px * 2.6f).toInt(), px, px * 0.6f, look.dim, false, 2)
        val ly = y
        ops += { c -> SignText.draw(c, l, r.left, ly) }
    }

    // ------------------------------------------------------------------ notícias e cotações

    private fun hourOf(ms: Long): String = if (ms <= 0) "" else Signage.hhmm(ms, env.tz)

    private fun news(r: RectF) {
        val y0 = header(r, "Notícias", item.title, look.accent, 0.07f)
        val list = item.news
        val base = minOf(r.width(), r.height() * 1.4f)
        val creditPx = base * 0.04f
        val credit = "Fonte: " + (item.label.ifEmpty { list.map { it.source }.filter { it.isNotEmpty() }.distinct().joinToString(", ") }).ifEmpty { "—" }
        val avail = r.bottom - y0 - creditPx * 2f
        // a primeira manchete com QR (para ler a matéria no celular)
        val first = list.first()
        val qrSide = if (first.qr != null) minOf(avail * 0.4f, r.width() * 0.22f) else 0f
        val count = minOf(list.size, if (r.height() > r.width()) 5 else 4)
        val slot = avail / count
        var y = y0
        for ((i, n) in list.take(count).withIndex()) {
            val tw = if (i == 0 && qrSide > 0) r.width() - qrSide * 1.2f else r.width()
            val meta = listOf(n.source, hourOf(n.at)).filter { it.isNotEmpty() }.joinToString(" · ")
            val metaPx = base * 0.038f
            val px = if (i == 0) base * 0.075f else base * 0.055f
            val l = SignText.fit(n.title, tw.toInt(), (slot - metaPx * 1.8f).toInt().coerceAtLeast(1), px, px * 0.55f, look.text, i == 0, 4)
            val yy = y
            ops += { c ->
                SignText.draw(c, l, r.left, yy)
                if (meta.isNotEmpty()) {
                    tp.textSize = metaPx
                    tp.color = look.dim
                    tp.typeface = Typeface.DEFAULT
                    SignText.line(c, meta, r.left, yy + l.height + metaPx * 1.2f, tw, tp)
                }
                if (i < count - 1) {
                    paint.color = look.line
                    paint.strokeWidth = 1f
                    c.drawLine(r.left, yy + slot - metaPx * 0.3f, r.right, yy + slot - metaPx * 0.3f, paint)
                }
            }
            if (i == 0 && first.qr != null) qr(first.qr, r.right - qrSide, yy, qrSide, caption = false)
            y += slot
        }
        ops += { c ->
            tp.textSize = creditPx
            tp.color = look.dim
            tp.typeface = Typeface.DEFAULT
            SignText.line(c, credit, r.left, r.bottom - creditPx * 0.3f, r.width(), tp)
        }
    }

    private fun quotes(r: RectF) {
        val y0 = header(r, "Cotações", item.title, look.accent, 0.07f)
        val base = minOf(r.width(), r.height() * 1.4f)
        val footPx = base * 0.04f
        val list = item.quotes
        val avail = r.bottom - y0 - footPx * 2.2f
        val rowH = (avail / list.size).coerceAtMost(base * 0.2f)
        var y = y0
        for (q in list) {
            val yy = y
            val value = (if (q.prefix.isNotEmpty()) q.prefix + " " else "") + Signage.number(q.value, q.decimals)
            ops += { c ->
                val cy = yy + rowH / 2
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.textSize = rowH * 0.36f
                tp.color = look.text
                SignText.line(c, q.label, r.left, cy + tp.textSize * 0.35f, r.width() * 0.4f, tp)
                val chW = r.width() * 0.25f
                SignText.line(c, value, r.left + r.width() * 0.4f, cy + tp.textSize * 0.35f, r.width() * 0.6f - chW, tp, alignRight = true)
                val ch = q.change
                if (ch != null) {
                    tp.textSize = rowH * 0.28f
                    tp.color = when {
                        ch > 0.004 -> 0xFF16A34A.toInt()
                        ch < -0.004 -> 0xFFDC2626.toInt()
                        else -> look.dim
                    }
                    val s = (if (ch > 0.004) "▲ " else if (ch < -0.004) "▼ " else "") + Signage.change(ch)
                    SignText.line(c, s, r.right - chW, cy + tp.textSize * 0.35f, chW, tp, alignRight = true)
                }
                paint.color = look.line
                paint.strokeWidth = 1f
                c.drawLine(r.left, yy + rowH, r.right, yy + rowH, paint)
            }
            y += rowH
        }
        val foot = listOf("Valores de referência", hourOf(item.at).let { if (it.isEmpty()) "" else "às $it" }, if (item.label.isNotEmpty()) "Fonte: ${item.label}" else "")
            .filter { it.isNotEmpty() }.joinToString(" · ")
        ops += { c ->
            tp.typeface = Typeface.DEFAULT
            tp.textSize = footPx
            tp.color = look.dim
            SignText.line(c, foot, r.left, r.bottom - footPx * 0.3f, r.width(), tp)
        }
    }

    // ------------------------------------------------------------------ cardápio

    private fun menu(r: RectF, title: String, sub: String) {
        val color = templateColor("cardapio")
        val y0 = header(r, sub, title, color, 0.08f)
        val list = item.menu
        val base = minOf(r.width(), r.height() * 1.4f)
        val rowH = ((r.bottom - y0) / list.size).coerceAtMost(base * 0.13f)
        var y = y0
        for (m in list) {
            val yy = y
            ops += { c ->
                tp.typeface = Typeface.DEFAULT
                tp.textSize = rowH * 0.5f
                tp.color = look.text
                val base2 = yy + rowH * 0.65f
                val priceW = if (m.price.isNotEmpty()) tp.measureText(m.price) else 0f
                paint.style = Paint.Style.FILL
                paint.color = color
                c.drawCircle(r.left + rowH * 0.12f, base2 - tp.textSize * 0.35f, rowH * 0.08f, paint)
                SignText.line(c, m.name, r.left + rowH * 0.35f, base2, r.width() - rowH * 0.35f - priceW - rowH * 0.3f, tp)
                if (m.price.isNotEmpty()) {
                    tp.typeface = Typeface.DEFAULT_BOLD
                    c.drawText(m.price, r.right - priceW, base2, tp)
                }
            }
            y += rowH
        }
    }

    // ------------------------------------------------------------------ contador, segurança, relógios

    private fun countdown(r: RectF) {
        val color = templateColor("evento")
        val y0 = header(r, "Contagem regressiva", item.title, color, 0.08f)
        val base = minOf(r.width(), (r.bottom - y0) * 1.5f)
        val textL = if (item.text.isNotEmpty()) SignText.fit(item.text, r.width().toInt(), (r.height() * 0.2f).toInt(), base * 0.05f, base * 0.03f, look.dim, false, 3) else null
        dynamic = { c ->
            val ok = env.clockOk()
            val rem = Signage.remaining(item.target, env.now())
            val big: String
            val small: String
            when {
                !ok -> { big = "--"; small = dateTime(item.target) }
                rem.done -> { big = "Chegou o dia!"; small = dateTime(item.target) }
                rem.days > 0 -> { big = if (rem.days == 1L) "1 dia" else "${rem.days} dias"; small = "${rem.hours} h ${rem.minutes} min" }
                else -> { big = "${rem.hours} h ${rem.minutes} min"; small = dateTime(item.target) }
            }
            tp.typeface = Typeface.DEFAULT_BOLD
            tp.color = color
            tp.textSize = base * 0.22f
            while (tp.measureText(big) > r.width() && tp.textSize > 10f) tp.textSize *= 0.9f
            val by = y0 + tp.textSize
            c.drawText(big, r.left, by, tp)
            tp.typeface = Typeface.DEFAULT
            tp.color = look.text
            tp.textSize = base * 0.07f
            SignText.line(c, small, r.left, by + tp.textSize * 1.5f, r.width(), tp)
            if (textL != null) SignText.draw(c, textL, r.left, r.bottom - textL.height)
        }
    }

    private fun safety(r: RectF) {
        val color = 0xFF16A34A.toInt()
        val y0 = header(r, "Segurança do trabalho", item.title.ifEmpty { "Dias sem acidente" }, color, 0.08f)
        val days = Signage.daysSince(item.since!!, env.now(), env.tz)
        val base = minOf(r.width(), (r.bottom - y0) * 1.5f)
        val big = SignText.fit(if (env.clockOk()) Signage.number(days.toDouble(), 0) else "--", r.width().toInt(), ((r.bottom - y0) * 0.5f).toInt(), base * 0.35f, base * 0.1f, color, true, 1)
        ops += { c -> SignText.draw(c, big, r.left, y0) }
        var y = y0 + big.height + base * 0.02f
        val goal = item.goal
        if (goal > 0 && env.clockOk()) {
            val ratio = (days.toFloat() / goal).coerceIn(0f, 1f)
            val barH = (base * 0.05f).coerceAtLeast(8f)
            val by = y
            ops += { c ->
                paint.style = Paint.Style.FILL
                paint.color = look.panel
                c.drawRoundRect(RectF(r.left, by, r.right, by + barH), barH / 2, barH / 2, paint)
                paint.color = color
                if (ratio > 0f) c.drawRoundRect(RectF(r.left, by, r.left + maxOf(barH, r.width() * ratio), by + barH), barH / 2, barH / 2, paint)
            }
            y += barH + base * 0.03f
        }
        val parts = listOfNotNull(
            if (item.record > 0) "Recorde: ${Signage.number(item.record.toDouble(), 0)} dias" else null,
            if (goal > 0) "Meta: ${Signage.number(goal.toDouble(), 0)} dias" else null,
        )
        if (parts.isNotEmpty()) {
            val px = base * 0.06f
            val l = SignText.fit(parts.joinToString(" · "), r.width().toInt(), (px * 2.6f).toInt(), px, px * 0.6f, look.dim, false, 2)
            val ly = y
            ops += { c -> SignText.draw(c, l, r.left, ly) }
        }
    }

    private fun worldclock(r: RectF) {
        val y0 = header(r, "", item.title.ifEmpty { "Relógio mundial" }, look.accent, 0.07f)
        val list = item.clocks
        val wide = r.width() > (r.bottom - y0) * 1.3f
        val cols = if (wide) minOf(list.size, 3) else 1
        val rows = (list.size + cols - 1) / cols
        val cw = r.width() / cols
        val ch = (r.bottom - y0) / rows
        dynamic = { c ->
            val ok = env.clockOk()
            val now = env.now()
            for ((i, k) in list.withIndex()) {
                val x = r.left + (i % cols) * cw
                val y = y0 + (i / cols) * ch
                tp.typeface = Typeface.DEFAULT
                tp.color = look.dim
                tp.textSize = minOf(ch * 0.2f, cw * 0.12f)
                SignText.line(c, k.label, x, y + tp.textSize * 1.1f, cw * 0.92f, tp)
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.color = look.text
                tp.textSize = minOf(ch * 0.45f, cw * 0.3f)
                c.drawText(if (ok) Signage.hhmm(now, k.tz) else "--:--", x, y + ch * 0.25f + tp.textSize, tp)
            }
        }
    }

    private fun clock(r: RectF) {
        val fmt = SimpleDateFormat("EEEE, d 'de' MMMM", ptBr).apply { timeZone = TimeZone.getTimeZone(env.tz) }
        dynamic = { c ->
            val ok = env.clockOk()
            val now = env.now()
            val hm = if (ok) Signage.hhmm(now, env.tz) else "--:--"
            tp.typeface = Typeface.DEFAULT_BOLD
            tp.color = look.text
            tp.textSize = minOf(r.height() * 0.55f, r.width() * 0.32f)
            val date = if (ok) fmt.format(Date(now)) else ""
            val dateSize = tp.textSize * 0.22f
            val total = tp.textSize + (if (date.isNotEmpty()) dateSize * 1.6f else 0f)
            val top = r.top + (r.height() - total) / 2
            c.drawText(hm, r.centerX() - tp.measureText(hm) / 2, top + tp.textSize * 0.9f, tp)
            if (date.isNotEmpty()) {
                tp.typeface = Typeface.DEFAULT
                tp.color = look.dim
                tp.textSize = dateSize
                val dw = minOf(tp.measureText(date), r.width())
                SignText.line(c, date, r.centerX() - dw / 2, top + total - dateSize * 0.2f, r.width(), tp)
            }
        }
    }

    private fun weather(r: RectF) {
        dynamic = { c ->
            val wt = env.weather()?.takeIf { it.fresh(env.now()) }
            if (wt != null) {
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.color = look.text
                tp.textSize = minOf(r.height() * 0.4f, r.width() * 0.25f)
                val t = wt.tempC?.let { "$it°C" } ?: ""
                c.drawText(t, r.left, r.top + tp.textSize, tp)
                tp.typeface = Typeface.DEFAULT
                val px = tp.textSize * 0.3f
                tp.textSize = px
                SignText.line(c, wt.condition, r.left, r.top + px * 5f, r.width(), tp)
                tp.color = look.dim
                SignText.line(c, wt.city, r.left, r.top + px * 6.4f, r.width(), tp)
            }
        }
    }

    private fun textBlock(r: RectF, title: String, text: String) {
        val y = header(r, "", title, look.accent, 0.09f)
        if (text.isEmpty()) return
        val base = minOf(r.width(), r.height() * 1.4f)
        val px = base * 0.07f
        val l = SignText.fit(text, r.width().toInt(), (r.bottom - y).toInt().coerceAtLeast(1), px, px * 0.45f, look.text, false, Signage.MAX_LINES)
        ops += { c -> SignText.draw(c, l, r.left, y) }
    }

    private fun qrBlock(r: RectF) {
        val url = item.qr ?: return
        val y = header(r, "", item.title, look.accent, 0.08f)
        val side = minOf(r.width() * 0.8f, (r.bottom - y) * 0.8f)
        if (side > 40f) qr(url, r.centerX() - side / 2, y + ((r.bottom - y) - side * 1.15f) / 2, side)
    }

    private fun logo(w: Int, h: Int) {
        val b = bmp(item.file) ?: return
        val r = box(w, h, 0.08f)
        ops += { c -> drawCover(c, b, r, contain = true) }
    }
}

/**
 * Playlist de uma zona: um item por vez, pelo tempo de cada um, com troca suave (o novo aparece por cima, esmaecendo).
 * Item de imagem ainda não baixada é pulado; as imagens são lidas fora da thread principal, já no tamanho da zona.
 */
class SignPlaylistView(
    ctx: Context,
    private val items: List<SignageItem>,
    private val env: SignEnv,
    private val edge: Insets,
) : FrameLayout(ctx) {
    private val handler = Handler(Looper.getMainLooper())
    private var index = -1
    private var current: SignItemView? = null
    private var shownAt = 0L
    private var gen = 0
    private var running = false

    init {
        setBackgroundColor(env.look.bg)
    }

    /** Pode aparecer agora? (Imagem só depois de baixada e conferida.) */
    private fun playable(i: SignageItem): Boolean = when (i.kind) {
        "image" -> i.file?.let { env.file(it) } != null
        "logo" -> i.file?.let { env.file(it) } != null
        else -> true
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        if (current == null) post { next() }
    }

    override fun onDetachedFromWindow() {
        running = false
        gen++
        handler.removeCallbacksAndMessages(null)
        closeCurrent()
        super.onDetachedFromWindow()
    }

    private fun closeCurrent() {
        val c = current ?: return
        if (shownAt > 0) env.onTime(c.item.id, SystemClock.uptimeMillis() - shownAt)
        shownAt = 0L
    }

    fun tick() {
        current?.tick()
    }

    private fun next() {
        if (!running) return
        val my = ++gen
        handler.removeCallbacksAndMessages(null)
        var pick = -1
        for (step in 1..items.size) {
            val i = (index + step) % items.size
            if (playable(items[i])) {
                pick = i
                break
            }
        }
        if (pick < 0) {
            // nada pronto (imagens ainda baixando): tenta de novo em 5 s
            closeCurrent()
            current?.let { removeView(it) }
            current = null
            handler.postDelayed({ if (my == gen) next() }, 5_000L)
            return
        }
        index = pick
        val item = items[pick]
        val cur = current
        if (cur != null && cur.item === item) {
            // um item só (ou só um pronto): fica, e conta de novo a cada volta
            closeCurrent()
            shownAt = SystemClock.uptimeMillis()
            env.onShown(item.id)
            schedule(item, my)
            return
        }
        val files = item.files.filter { env.file(it) != null }
        if (files.isEmpty()) {
            show(item, emptyMap(), my)
            return
        }
        val zw = width.coerceAtLeast(320)
        val zh = height.coerceAtLeast(180)
        Thread({
            val map = HashMap<String, Bitmap>()
            for (f in files) {
                val file = env.file(f) ?: continue
                // fotos de aniversariantes são pequenas na tela
                val small = item.kind == "birthdays" || (item.kind == "slide" && item.template == "aniversariantes")
                SignBitmaps.decode(file, if (small) 256 else zw, if (small) 256 else zh, alpha = f === item.file && item.kind == "logo")?.let { map[f.sha256] = it }
            }
            handler.post { if (my == gen && running) show(item, map, my) }
        }, "telas-signage-img").apply { priority = Thread.MIN_PRIORITY }.start()
    }

    private fun show(item: SignageItem, bitmaps: Map<String, Bitmap>, my: Int) {
        if (item.kind == "image" && bitmaps.isEmpty()) {
            // arquivo estragado ou memória curta: pula para o próximo
            handler.postDelayed({ if (my == gen) next() }, 2_000L)
            return
        }
        closeCurrent()
        val old = current
        val v = SignItemView(context, item, env, bitmaps, edge)
        v.alpha = 0f
        addView(v, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        current = v
        shownAt = SystemClock.uptimeMillis()
        env.onShown(item.id)
        v.animate().alpha(1f).setDuration(FADE_MS).withEndAction { if (old != null) removeView(old) }.start()
        schedule(item, my)
    }

    private fun schedule(item: SignageItem, my: Int) {
        handler.postDelayed({ if (my == gen) next() }, item.seconds * 1000L)
    }

    companion object {
        const val FADE_MS = 700L
    }
}

/** Leitura das imagens já no tamanho da zona (TV box de 1 a 2 GB: nunca abrir a imagem inteira sem precisar). */
object SignBitmaps {
    fun decode(file: java.io.File, maxW: Int, maxH: Int, alpha: Boolean = false): Bitmap? = try {
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null
        else {
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= maxW || bounds.outHeight / (sample * 2) >= maxH) sample *= 2
            android.graphics.BitmapFactory.decodeFile(file.path, android.graphics.BitmapFactory.Options().apply {
                inSampleSize = sample
                // logomarca tem transparência; o resto vai em 16 bits (metade da memória)
                inPreferredConfig = if (alpha) Bitmap.Config.ARGB_8888 else Bitmap.Config.RGB_565
            })
        }
    } catch (_: Throwable) {
        null
    }
}
