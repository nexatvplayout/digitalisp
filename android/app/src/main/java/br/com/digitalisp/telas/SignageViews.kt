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
        /**
         * As cores das zonas: o fundo de cada zona é o do tema (o "cartão", como a prévia e o app da Samsung: `--tbg`); o
         * `background` do layout pinta só o fundo da tela, entre as zonas. [background] fica para quem pede o do layout.
         */
        fun of(theme: ThemeCfg, @Suppress("UNUSED_PARAMETER") background: Int?): SignLook =
            SignLook(theme.bg, theme.panel, theme.text, theme.dim, theme.line, theme.color, theme.onColor, theme.light)
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
    /** Volume do som próprio da tela (0 a 1; 0 = mudo), para o vídeo próprio com som. */
    val volume: () -> Float = { 1f },
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
    /** As cores do slide com arte própria (o texto segue a arte); null = as do tema. */
    private var slideLook: SignLook? = null
    private val look get() = slideLook ?: env.look
    private val ptBr = Locale("pt", "BR")

    /** Precisa de redesenho a cada segundo? */
    val timed: Boolean
        get() = item.kind in setOf("clock", "countdown", "safety", "worldclock", "agenda") || (item.kind == "slide" && item.template == "evento" && item.target > 0) ||
            (item.kind == "post" && item.template == "evento" && item.target > 0)

    private var lastMinute = -1L

    fun tick() {
        if (!timed) return
        val m = env.now() / 60_000L
        if (m == lastMinute && item.kind != "clock" && item.kind != "countdown") return
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
        if (backdrop(w, h)) return
        ops += { c -> c.drawColor(color) }
    }

    /**
     * O fundo próprio do slide (DIGITAL ISP, como a prévia do painel): a arte (`fields.artFile`) em cover, a foto com o
     * véu escuro em gradiente (0,82 → 0,60); sem arte, o gradiente da paleta (`fields.palette`). False sem nenhum dos dois.
     */
    private fun backdrop(w: Int, h: Int): Boolean {
        if (item.kind != "slide") return false
        val art = bmp(item.art)
        val pal = Signage.PALETTES[item.palette]
        val full = RectF(0f, 0f, w.toFloat(), h.toFloat())
        if (art != null) {
            ops += { c ->
                c.drawColor(Color.BLACK)
                coverAt(c, art, full, if (item.artPhoto) 0.72f else 0.5f, 0.5f)
                if (item.artPhoto) {
                    paint.style = Paint.Style.FILL
                    paint.shader = LinearGradient(0f, 0f, w.toFloat(), 0f, 0xD1000000.toInt(), 0x99000000.toInt(), Shader.TileMode.CLAMP)
                    c.drawRect(full, paint)
                    paint.shader = null
                }
            }
            return true
        }
        if (pal != null) {
            val light = env.look.light
            val bg = env.look.bg
            ops += { c ->
                paint.style = Paint.Style.FILL
                // 135°: do canto de cima à esquerda para o de baixo à direita
                paint.shader = if (light) LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), intArrayOf(Color.WHITE, Color.WHITE, pal.lightCorner), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
                else LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), intArrayOf(pal.darkStart, bg, bg), floatArrayOf(0f, 0.7f, 1f), Shader.TileMode.CLAMP)
                c.drawRect(full, paint)
                paint.shader = null
            }
            return true
        }
        return false
    }

    /** Cobre a caixa com a imagem, cortando o que sobra em volta do ponto (fx, fy) da imagem (0 a 1, como background-position). */
    private fun coverAt(c: Canvas, b: Bitmap, dst: RectF, fx: Float, fy: Float) {
        val bw = b.width.toFloat()
        val bh = b.height.toFloat()
        if (bw <= 0 || bh <= 0) return
        val scale = maxOf(dst.width() / bw, dst.height() / bh)
        val sw = dst.width() / scale
        val sh = dst.height() / scale
        val sx = (bw - sw) * fx
        val sy = (bh - sh) * fy
        paint.isFilterBitmap = true
        c.drawBitmap(b, Rect(sx.toInt(), sy.toInt(), (sx + sw).toInt(), (sy + sh).toInt()), dst, paint)
    }

    private fun prepare(w: Int, h: Int) {
        when (item.kind) {
            "image" -> image(w, h)
            "slide", "post" -> slide(w, h)
            "birthdays" -> { background(w, h); birthdays(box(w, h), item.title.ifEmpty { "Aniversariantes" }) }
            "kpi" -> { background(w, h); kpi(box(w, h), item.kpi!!, withHeader = true) }
            "news" -> if (item.single) newsOne(w, h) else { background(w, h); news(box(w, h)) }
            "quotes" -> { background(w, h); quotes(box(w, h)) }
            "menu" -> { background(w, h); menu(box(w, h), item.title.ifEmpty { "Cardápio de hoje" }, item.subtitle) }
            "countdown" -> { background(w, h); countdown(box(w, h)) }
            "safety" -> { background(w, h); safety(box(w, h)) }
            "worldclock" -> { background(w, h); worldclock(box(w, h)) }
            "text" -> { background(w, h); textBlock(box(w, h), item.title, item.text) }
            "clock" -> { background(w, h); if (item.clockFace?.analog == true) analogClock(box(w, h)) else clock(box(w, h)) }
            "qr" -> { background(w, h); qrBlock(box(w, h)) }
            "logo" -> logo(w, h)
            "weather" -> weatherZone(w, h)
            "agenda" -> { background(w, h); agenda(box(w, h)) }
            "reviews" -> { background(w, h); reviews(box(w, h)) }
            "dashboard" -> { background(w, h); dashboard(box(w, h)) }
            "directions" -> { background(w, h); directions(box(w, h)) }
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
            val px = base * titleK * (if (item.kind == "slide") item.titleScale else 1f)
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

    private fun templateColor(tpl: String): Int = Signage.PALETTES[item.palette]?.accent?.takeIf { item.kind == "slide" } ?: when (tpl) {
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
        val full = RectF(0f, 0f, w.toFloat(), h.toFloat())
        if (b != null) {
            if (item.contain) {
                // inteira, com a mesma foto desfocada e escurecida atrás (sem faixas pretas)
                val blur = SignBitmaps.blurred(b)
                ops += { c ->
                    if (blur != null) {
                        drawCover(c, blur, full)
                        c.drawColor(0x8C000000.toInt())
                    }
                    drawCover(c, b, full, contain = true)
                }
            } else {
                ops += { c -> drawCover(c, b, full) }
            }
        }
        if (item.label.isNotEmpty()) caption(w, h, item.label, "")
    }

    /** Deitado ou em pé: o slide com `orient: port` desenha tudo em coluna, mesmo numa caixa larga. */
    private fun wideBox(r: RectF, k: Float = 1.15f): Boolean = !item.portrait && r.width() > r.height() * k

    // ------------------------------------------------------------------ notícia sozinha (DIGITAL ISP)

    /** A foto em tela cheia e, embaixo, a faixa escura com o nome da fonte, a manchete e a fonte · hora (filete vermelho). */
    private fun newsOne(w: Int, h: Int) {
        val n = item.news.first()
        val full = RectF(0f, 0f, w.toFloat(), h.toFloat())
        val photo = bmp(item.file)
        ops += { c ->
            c.drawColor(if (photo == null) env.look.bg else Color.BLACK)
            if (photo != null) drawCover(c, photo, full)
        }
        val base = minOf(w.toFloat(), h * 1.6f)
        val pad = base * 0.04f
        val inner = RectF(edge.left + pad * 1.6f, 0f, w - edge.right - pad, 0f)
        val kicker = SignText.fit((item.title.ifEmpty { "Notícias" }).uppercase(ptBr), inner.width().toInt(), (base * 0.06f).toInt(), base * 0.032f, base * 0.02f, 0xFFF87171.toInt(), true, 1)
        val head = SignText.fit(n.title, inner.width().toInt(), (h * 0.34f).toInt(), base * 0.062f, base * 0.03f, Color.WHITE, true, 3)
        val meta = listOf(n.source.ifEmpty { item.label }, hourOf(n.at)).filter { it.isNotEmpty() }.joinToString(" · ")
        val metaL = if (meta.isEmpty()) null else SignText.fit(meta, inner.width().toInt(), (base * 0.05f).toInt(), base * 0.03f, base * 0.02f, 0xFFCBD5E1.toInt(), false, 1)
        val gap = base * 0.012f
        val bandH = pad + kicker.height + gap + head.height + (metaL?.let { gap + it.height } ?: 0f) + pad + edge.bottom
        val top = h - bandH
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.shader = LinearGradient(0f, top - pad * 2, 0f, h.toFloat(), intArrayOf(0x00000000, 0xD9000000.toInt(), 0xF0000000.toInt()), floatArrayOf(0f, 0.25f, 1f), Shader.TileMode.CLAMP)
            c.drawRect(0f, top - pad * 2, w.toFloat(), h.toFloat(), paint)
            paint.shader = null
            paint.color = 0xFFEF4444.toInt()
            c.drawRect(edge.left + pad * 0.6f, top + pad, edge.left + pad * 0.6f + base * 0.008f, h - edge.bottom - pad, paint)
            var y = top + pad
            SignText.draw(c, kicker, inner.left, y); y += kicker.height + gap
            SignText.draw(c, head, inner.left, y); y += head.height + gap
            if (metaL != null) SignText.draw(c, metaL, inner.left, y)
        }
    }

    // ------------------------------------------------------------------ clima (foto do tempo)

    /**
     * O clima ocupando a zona: a foto do tempo na forma da zona (em pé: `artPort`), em cover, com o véu escuro de 35%, o
     * ícone e a temperatura grandes; os próximos dias embaixo, se vierem. Sem clima válido, a zona fica no fundo.
     */
    private fun weatherZone(w: Int, h: Int) {
        val wx = item.weather
        val portrait = h > w
        val photo = if (wx != null) bmp(if (portrait) wx.artPort ?: wx.art else wx.art ?: wx.artPort) else null
        val full = RectF(0f, 0f, w.toFloat(), h.toFloat())
        if (photo != null) {
            slideLook = env.look.copy(text = Color.WHITE, dim = 0xFFE2E8F0.toInt(), light = false)
            ops += { c ->
                c.drawColor(Color.BLACK)
                drawCover(c, photo, full)
                c.drawColor(0x59000000)
            }
        } else background(w, h)
        val r = box(w, h)
        if (wx == null) {
            weather(r) // o clima da configuração, do jeito de sempre
            return
        }
        val hasDays = wx.days.isNotEmpty() && r.height() > r.width() * 0.45f
        val mainH = if (hasDays) r.height() * 0.62f else r.height()
        // a frase do tempo ("muitas nuvens com pancadas de chuva"): inteira, em até 2 linhas, nunca cortada com reticências
        val condL = if (wx.text.isEmpty()) null else {
            val px = minOf(r.width(), mainH) * 0.07f
            SignText.fit(wx.text, r.width().toInt(), (px * 2.4f).toInt(), px, px * 0.5f, look.text, false, 2, TextLayout.Alignment.ALIGN_CENTER)
        }
        dynamic = draw@{ c ->
            if (wx.at > 0 && env.now() - wx.at >= br.com.digitalisp.telas.core.WeatherCfg.MAX_AGE_MS) return@draw
            val titleTxt = item.title.ifEmpty { wx.city }
            var top = r.top
            if (titleTxt.isNotEmpty()) {
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.color = look.text
                tp.textSize = minOf(r.width(), mainH) * 0.09f
                SignText.line(c, titleTxt, r.left, top + tp.textSize, r.width(), tp)
                top += tp.textSize * 1.4f
            }
            val temp = wx.tempC?.let { "$it°" } ?: listOfNotNull(wx.min?.let { "$it°" }, wx.max?.let { "$it°" }).joinToString(" / ")
            val condH = condL?.let { it.height + minOf(r.width(), mainH) * 0.02f } ?: 0f
            val avail = r.top + mainH - top - condH
            val vertical = r.width() < avail * 1.3f
            val ico = if (vertical) minOf(r.width() * 0.55f, avail * 0.45f) else minOf(avail * 0.85f, r.width() * 0.4f)
            tp.typeface = Typeface.DEFAULT_BOLD
            tp.color = look.text
            tp.textSize = if (vertical) minOf(avail * 0.32f, r.width() * 0.35f) else minOf(avail * 0.6f, r.width() * 0.3f)
            while (tp.measureText(temp) > (if (vertical) r.width() else r.width() - ico * 1.1f) && tp.textSize > 10f) tp.textSize *= 0.92f
            val tw = tp.measureText(temp)
            if (vertical) {
                val total = ico + tp.textSize * 1.1f
                val y0 = top + (avail - total) / 2
                weatherIcon(c, wx.cond, r.centerX() - ico / 2, y0, ico)
                c.drawText(temp, r.centerX() - tw / 2, y0 + ico + tp.textSize * 0.95f, tp)
            } else {
                val total = ico * 1.1f + tw
                val x0 = r.left + (r.width() - total) / 2
                weatherIcon(c, wx.cond, x0, top + (avail - ico) / 2, ico)
                c.drawText(temp, x0 + ico * 1.1f, top + avail / 2 + tp.textSize * 0.36f, tp)
            }
            if (condL != null) SignText.draw(c, condL, r.left, r.top + mainH - condL.height)
            if (hasDays) {
                val n = wx.days.size
                val cw = r.width() / n
                val dy = r.top + mainH + r.height() * 0.04f
                val dh = r.bottom - dy
                for ((i, d) in wx.days.withIndex()) {
                    val cx = r.left + cw * i + cw / 2
                    tp.typeface = Typeface.DEFAULT_BOLD
                    tp.textSize = minOf(cw * 0.16f, dh * 0.2f)
                    val lw = tp.measureText(d.label)
                    c.drawText(d.label, cx - lw / 2, dy + tp.textSize, tp)
                    val s = minOf(cw * 0.45f, dh * 0.45f)
                    weatherIcon(c, d.cond, cx - s / 2, dy + tp.textSize * 1.3f, s)
                    val mm = listOfNotNull(d.min?.let { "$it°" }, d.max?.let { "$it°" }).joinToString(" / ")
                    tp.typeface = Typeface.DEFAULT
                    val mw = tp.measureText(mm)
                    c.drawText(mm, cx - mw / 2, dy + tp.textSize * 1.3f + s + tp.textSize * 1.1f, tp)
                }
            }
            if (wx.source.isNotEmpty() && !hasDays) {
                tp.typeface = Typeface.DEFAULT
                tp.color = look.dim
                tp.textSize = minOf(r.width(), r.height()) * 0.035f
                SignText.line(c, "Fonte: " + wx.source, r.left, r.bottom, r.width(), tp)
            }
        }
    }

    private val iconViews = HashMap<String, WeatherIcon>()

    /** O ícone do tempo desenhado no quadrado (left, top, side). */
    private fun weatherIcon(c: Canvas, cond: String, left: Float, top: Float, side: Float) {
        if (side < 4f) return
        val v = iconViews.getOrPut(cond) { WeatherIcon(context, cond) }
        val s = side.toInt()
        if (v.width != s) v.layout(0, 0, s, s)
        c.save()
        c.translate(left, top)
        v.draw(c)
        c.restore()
    }

    // ------------------------------------------------------------------ gadgets (DIGITAL ISP)

    private fun agenda(r: RectF) {
        val y0 = header(r, "", item.title.ifEmpty { "Agenda" }, look.accent, 0.08f)
        val list = item.events
        val base = minOf(r.width(), r.height() * 1.4f)
        if (list.isEmpty()) {
            val l = SignText.fit("Nenhum compromisso pela frente", r.width().toInt(), (base * 0.12f).toInt(), base * 0.055f, base * 0.035f, look.dim, false, 2)
            ops += { c -> SignText.draw(c, l, r.left, y0) }
            return
        }
        val slot = (r.bottom - y0) / list.size
        val whenW = r.width() * 0.26f
        var y = y0
        for ((i, e) in list.withIndex()) {
            val day = if (e.date == item.today && item.today.isNotEmpty()) "Hoje" else e.date.substring(8, 10) + "/" + e.date.substring(5, 7)
            val hour = if (e.time.isEmpty()) "" else e.time + (if (e.end.isNotEmpty()) "–" + e.end else "")
            val px = minOf(slot * 0.32f, base * 0.06f)
            val d = SignText.fit(day, whenW.toInt(), (px * 1.4f).toInt(), px, px * 0.6f, look.accent, true, 1)
            val hr = if (hour.isEmpty()) null else SignText.fit(hour, whenW.toInt(), (px * 1.2f).toInt(), px * 0.75f, px * 0.5f, look.dim, false, 1)
            val t = SignText.fit(e.title, (r.width() - whenW).toInt(), (px * 1.4f).toInt(), px, px * 0.6f, look.text, true, 1)
            val pl = if (e.place.isEmpty()) null else SignText.fit(e.place, (r.width() - whenW).toInt(), (px * 1.2f).toInt(), px * 0.75f, px * 0.5f, look.dim, false, 1)
            val yy = y
            ops += { c ->
                SignText.draw(c, d, r.left, yy)
                hr?.let { SignText.draw(c, it, r.left, yy + d.height) }
                SignText.draw(c, t, r.left + whenW, yy)
                pl?.let { SignText.draw(c, it, r.left + whenW, yy + t.height) }
                if (i < list.size - 1) {
                    paint.color = look.line
                    paint.strokeWidth = 1f
                    c.drawLine(r.left, yy + slot - 4f, r.right, yy + slot - 4f, paint)
                }
            }
            y += slot
        }
    }

    private fun reviews(r: RectF) {
        val y0 = header(r, "", item.title.ifEmpty { "O que dizem os clientes" }, look.accent, 0.08f)
        val base = minOf(r.width(), r.height() * 1.4f)
        val qrUrl = item.qr
        val qrSide = if (qrUrl == null) 0f else minOf(r.width() * 0.28f, (r.bottom - y0) * 0.7f)
        val tw = r.width() - (if (qrSide > 0) qrSide * 1.2f else 0f)
        val list = item.reviews
        val slot = (r.bottom - y0) / list.size
        var y = y0
        for (rv in list) {
            val px = minOf(base * 0.05f, slot * 0.2f)
            val stars = "★".repeat(rv.stars)
            val st = SignText.fit(stars, tw.toInt(), (px * 1.4f).toInt(), px, px * 0.6f, 0xFFFACC15.toInt(), true, 1)
            val tx = SignText.fit("“" + rv.text + "”", tw.toInt(), (slot - px * 3.2f).toInt().coerceAtLeast(1), px, px * 0.55f, look.text, false, 4)
            val nm = SignText.fit("— " + rv.name, tw.toInt(), (px * 1.3f).toInt(), px * 0.8f, px * 0.5f, look.dim, false, 1)
            val yy = y
            ops += { c ->
                SignText.draw(c, st, r.left, yy)
                SignText.draw(c, tx, r.left, yy + st.height)
                SignText.draw(c, nm, r.left, yy + st.height + tx.height)
            }
            y += slot
        }
        if (qrUrl != null && qrSide > 40f) qr(qrUrl, r.right - qrSide, y0 + ((r.bottom - y0) - qrSide * 1.2f) / 2, qrSide)
    }

    private fun dashboard(r: RectF) {
        val y0 = header(r, "", item.title.ifEmpty { "Indicadores" }, look.accent, 0.08f)
        val list = item.kpis
        val cols = if (list.size <= 2) list.size else if (list.size <= 4) 2 else 3
        val rows = (list.size + cols - 1) / cols
        val gap = minOf(r.width(), r.height()) * 0.03f
        val cw = (r.width() - gap * (cols - 1)) / cols
        val ch = (r.bottom - y0 - gap * (rows - 1)) / rows
        for ((i, k) in list.withIndex()) {
            val cx = r.left + (i % cols) * (cw + gap)
            val cy = y0 + (i / cols) * (ch + gap)
            val cell = RectF(cx, cy, cx + cw, cy + ch)
            ops += { c ->
                paint.style = Paint.Style.FILL
                paint.color = look.panel
                c.drawRoundRect(cell, gap * 0.6f, gap * 0.6f, paint)
            }
            val inner = RectF(cell.left + gap * 0.6f, cell.top + gap * 0.5f, cell.right - gap * 0.6f, cell.bottom - gap * 0.5f)
            val base = minOf(inner.width(), inner.height() * 1.6f)
            val name = SignText.fit(k.name.ifEmpty { "Indicador" }, inner.width().toInt(), (inner.height() * 0.25f).toInt(), base * 0.09f, base * 0.05f, look.dim, false, 2)
            val color = kpiColor(Signage.kpiBand(k))
            val value = Signage.kpiNumber(k.value) + (if (k.unit.isNotEmpty()) (if (k.unit == "%") "%" else " " + k.unit) else "")
            val big = SignText.fit(value, inner.width().toInt(), (inner.height() * 0.4f).toInt(), base * 0.22f, base * 0.08f, color, true, 1)
            val ratio = Signage.kpiRatio(k)
            val meta = k.target?.let { "Meta: " + Signage.kpiNumber(it) + (if (k.unit.isNotEmpty()) (if (k.unit == "%") "%" else " " + k.unit) else "") }
            val metaL = meta?.let { SignText.fit(it, inner.width().toInt(), (inner.height() * 0.18f).toInt(), base * 0.07f, base * 0.04f, look.dim, false, 1) }
            ops += { c ->
                SignText.draw(c, name, inner.left, inner.top)
                SignText.draw(c, big, inner.left, inner.top + name.height)
                var y = inner.top + name.height + big.height
                metaL?.let { SignText.draw(c, it, inner.left, y); y += it.height }
                if (ratio != null) {
                    val barH = (inner.height() * 0.06f).coerceAtLeast(4f)
                    val by = minOf(y + barH * 0.5f, inner.bottom - barH)
                    paint.style = Paint.Style.FILL
                    paint.color = look.line
                    c.drawRoundRect(RectF(inner.left, by, inner.right, by + barH), barH / 2, barH / 2, paint)
                    paint.color = color
                    if (ratio > 0f) c.drawRoundRect(RectF(inner.left, by, inner.left + maxOf(barH, inner.width() * ratio), by + barH), barH / 2, barH / 2, paint)
                }
            }
        }
    }

    private fun directions(r: RectF) {
        val p = item.place ?: return
        val qrUrl = item.qr
        val wide = r.width() > r.height()
        val qrSide = if (qrUrl == null) 0f else if (wide) minOf(r.height() * 0.6f, r.width() * 0.3f) else minOf(r.width() * 0.5f, r.height() * 0.3f)
        val tr = RectF(r)
        if (qrSide > 0) { if (wide) tr.right -= qrSide * 1.25f else tr.bottom -= qrSide * 1.35f }
        var y = header(tr, "", item.title.ifEmpty { "Como chegar" }, look.accent, 0.08f)
        val base = minOf(tr.width(), tr.height() * 1.4f)
        val addr = SignText.fit(p.address, tr.width().toInt(), ((tr.bottom - y) * 0.45f).toInt(), base * 0.08f, base * 0.04f, look.text, true, 3)
        val yy = y
        ops += { c -> SignText.draw(c, addr, tr.left, yy) }
        y += addr.height + base * 0.02f
        for (line in listOf(p.reference, p.hours, p.phone).filter { it.isNotEmpty() }) {
            val l = SignText.fit(line, tr.width().toInt(), (base * 0.1f).toInt(), base * 0.05f, base * 0.03f, look.dim, false, 2)
            val ly = y
            ops += { c -> SignText.draw(c, l, tr.left, ly) }
            y += l.height + base * 0.01f
        }
        if (qrUrl != null && qrSide > 40f) {
            if (wide) qr(qrUrl, r.right - qrSide, r.top + (r.height() - qrSide * 1.2f) / 2, qrSide)
            else qr(qrUrl, r.centerX() - qrSide / 2, r.bottom - qrSide * 1.25f, qrSide)
        }
    }

    /** Relógio de ponteiros (gadget `clock` com `face: analog`), no fuso do gadget, com a data embaixo. */
    private fun analogClock(r: RectF) {
        val f = item.clockFace!!
        val tz = TimeZone.getTimeZone(f.tz ?: env.tz)
        val fmt = SimpleDateFormat("EEEE, d 'de' MMMM", ptBr).apply { timeZone = tz }
        dynamic = { c ->
            var top = r.top
            if (f.label.isNotEmpty()) {
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.color = look.text
                tp.textSize = minOf(r.width(), r.height()) * 0.08f
                val lw = minOf(tp.measureText(f.label), r.width())
                SignText.line(c, f.label, r.centerX() - lw / 2, top + tp.textSize, r.width(), tp)
                top += tp.textSize * 1.4f
            }
            val dateH = if (f.date) minOf(r.width(), r.height()) * 0.1f else 0f
            val d = minOf(r.width(), r.bottom - top - dateH)
            val cx = r.centerX()
            val cy = top + d / 2
            val rad = d / 2 * 0.94f
            paint.style = Paint.Style.FILL
            paint.color = look.panel
            c.drawCircle(cx, cy, rad, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeCap = Paint.Cap.ROUND
            paint.color = look.text
            for (i in 0 until 12) {
                val a = Math.toRadians(i * 30.0)
                val inner = rad * (if (i % 3 == 0) 0.78f else 0.86f)
                paint.strokeWidth = rad * (if (i % 3 == 0) 0.06f else 0.03f)
                c.drawLine(cx + (Math.sin(a) * inner).toFloat(), cy - (Math.cos(a) * inner).toFloat(), cx + (Math.sin(a) * rad * 0.94f).toFloat(), cy - (Math.cos(a) * rad * 0.94f).toFloat(), paint)
            }
            if (env.clockOk()) {
                val cal = java.util.Calendar.getInstance(tz).apply { timeInMillis = env.now() }
                val hh = cal.get(java.util.Calendar.HOUR) + cal.get(java.util.Calendar.MINUTE) / 60f
                val mm = cal.get(java.util.Calendar.MINUTE) + cal.get(java.util.Calendar.SECOND) / 60f
                val ss = cal.get(java.util.Calendar.SECOND).toFloat()
                fun hand(deg: Float, len: Float, wdt: Float, color: Int) {
                    val a = Math.toRadians(deg.toDouble())
                    paint.color = color
                    paint.strokeWidth = wdt
                    c.drawLine(cx, cy, cx + (Math.sin(a) * len).toFloat(), cy - (Math.cos(a) * len).toFloat(), paint)
                }
                hand(hh * 30f, rad * 0.5f, rad * 0.09f, look.text)
                hand(mm * 6f, rad * 0.72f, rad * 0.06f, look.text)
                if (f.seconds) hand(ss * 6f, rad * 0.8f, rad * 0.025f, look.accent)
            }
            paint.style = Paint.Style.FILL
            paint.color = look.accent
            c.drawCircle(cx, cy, rad * 0.06f, paint)
            if (f.date && env.clockOk()) {
                tp.typeface = Typeface.DEFAULT
                tp.color = look.dim
                tp.textSize = dateH * 0.6f
                val date = fmt.format(Date(env.now()))
                val dw = minOf(tp.measureText(date), r.width())
                SignText.line(c, date, r.centerX() - dw / 2, r.bottom - dateH * 0.2f, r.width(), tp)
            }
        }
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
        // arte de fundo: o texto segue a arte (foto e tone dark = claro; tone light = escuro), qualquer que seja o tema
        slideLook = if (item.kind == "slide" && bmp(item.art) != null && tpl != "imagem-com-legenda") {
            if (item.artLight && !item.artPhoto) env.look.copy(text = 0xFF0F172A.toInt(), dim = 0xFF334155.toInt(), light = true)
            else env.look.copy(text = 0xFFF8FAFC.toInt(), dim = 0xFFE2E8F0.toInt(), light = false)
        } else null
        val color = templateColor(tpl)
        val label = item.label.ifEmpty { Signage.templateLabel(tpl) }
        when (tpl) {
            "oferta", "combo" -> {
                background(w, h)
                accentBar(w, h, color)
                priceSlide(w, h, label, color)
                return
            }
            "precos", "horario" -> {
                background(w, h)
                accentBar(w, h, color)
                rowsSlide(w, h, label, color)
                return
            }
            "redes" -> {
                background(w, h)
                accentBar(w, h, color)
                socialSlide(w, h, label, color)
                return
            }
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

    // ------------------------------------------------------------------ modelos do comércio (DIGITAL ISP)

    /** Oferta e combo: etiqueta, produto, texto ou a lista do combo, validade; o preço numa placa ao lado (ou embaixo). */
    private fun priceSlide(w: Int, h: Int, label: String, color: Int) {
        val r = box(w, h)
        val wide = wideBox(r)
        val base = minOf(r.width(), r.height() * 1.4f)
        val ps = item.priceScale.coerceAtMost(1.5f)
        val plateW = if (wide) r.width() * 0.34f * ps.coerceAtMost(1.4f) else r.width()
        val plateH = if (wide) minOf(r.height() * 0.5f * ps, plateW * 0.75f) else r.height() * 0.24f * ps
        val qrUrl = item.qr
        val qrSide = if (qrUrl == null) 0f else if (wide) minOf(plateW * 0.45f * item.qrScale, r.height() - plateH - base * 0.12f).coerceAtLeast(0f) else minOf(r.width() * 0.3f * item.qrScale, r.height() * 0.18f * item.qrScale)
        val text = if (wide) RectF(r.left, r.top, r.right - plateW - r.width() * 0.05f, r.bottom)
        else RectF(r.left, r.top, r.right, r.bottom - plateH - base * 0.04f)
        var y = header(text, item.tag.ifEmpty { label }, item.title, color)
        val until = item.until?.let { d -> "Válido até ${d.substring(8, 10)}/${d.substring(5, 7)} ou enquanto durar o estoque." }
        val untilPx = base * 0.035f
        val untilReserve = if (until != null) untilPx * 2f else 0f
        val body = if (item.template == "combo" && item.rows.isNotEmpty()) item.rows.joinToString("\n") { (a, b) -> if (b.isEmpty()) "• $a" else "• $a $b" } else item.text
        if (body.isNotEmpty()) {
            val px = base * 0.055f
            val l = SignText.fit(body, text.width().toInt(), (text.bottom - y - untilReserve).toInt().coerceAtLeast(1), px, px * 0.5f, look.text, false, Signage.MAX_LINES)
            val yy = y
            ops += { c -> SignText.draw(c, l, text.left, yy) }
            y += l.height
        }
        if (until != null) {
            val l = SignText.fit(until, text.width().toInt(), untilReserve.toInt(), untilPx, untilPx * 0.6f, look.dim, false, 2)
            ops += { c -> SignText.draw(c, l, text.left, text.bottom - l.height) }
        }
        // a placa do preço: amarela com texto escuro (no tema claro, na cor do fundo da paleta com texto branco)
        val qrBelow = if (wide && qrSide > 40f) qrSide * 1.25f + base * 0.04f else 0f
        val plate = if (wide) {
            val top = r.top + (r.height() - plateH - qrBelow) / 2
            RectF(r.right - plateW, top, r.right, top + plateH)
        } else RectF(r.left, r.bottom - plateH, if (qrSide > 40f) r.right - qrSide * 1.2f else r.right, r.bottom)
        val light = look.light
        val plateColor = if (light) (Signage.PALETTES[item.palette]?.darkStart ?: color) else 0xFFFACC15.toInt()
        val plateText = if (light) Color.WHITE else 0xFF0F172A.toInt()
        ops += { c ->
            paint.style = Paint.Style.FILL
            paint.color = plateColor
            c.drawRoundRect(plate, base * 0.025f, base * 0.025f, paint)
        }
        val parts = ArrayList<StaticLayout>()
        val pw = (plate.width() * 0.9f).toInt()
        if (item.oldPrice.isNotEmpty()) parts += SignText.fit("De ${item.oldPrice} por", pw, (plate.height() * 0.2f).toInt(), base * 0.035f, base * 0.02f, plateText, true, 1, TextLayout.Alignment.ALIGN_CENTER)
        parts += SignText.fit(item.price.ifEmpty { "—" }, pw, (plate.height() * 0.55f).toInt(), base * (if (item.price.length > 10) 0.085f else 0.11f) * ps, base * 0.04f, plateText, true, 1, TextLayout.Alignment.ALIGN_CENTER)
        if (item.unit.isNotEmpty()) parts += SignText.fit(item.unit, pw, (plate.height() * 0.2f).toInt(), base * 0.035f, base * 0.02f, plateText, true, 1, TextLayout.Alignment.ALIGN_CENTER)
        val gap = base * 0.01f
        val total = parts.sumOf { it.height } + gap * (parts.size - 1)
        var py = plate.centerY() - total / 2
        for (l in parts) {
            val yy = py
            ops += { c -> SignText.draw(c, l, plate.left + (plate.width() - pw) / 2, yy) }
            py += l.height + gap
        }
        if (qrUrl != null && qrSide > 40f) {
            if (wide) qr(qrUrl, plate.centerX() - qrSide / 2, plate.bottom + base * 0.04f, qrSide)
            else qr(qrUrl, r.right - qrSide, r.bottom - qrSide * 1.15f, qrSide, caption = false)
        }
    }

    /** Vitrine de preços e horário: uma linha por item, o nome à esquerda e o preço (ou o horário) à direita. */
    private fun rowsSlide(w: Int, h: Int, label: String, color: Int) {
        val r0 = box(w, h)
        val base = minOf(r0.width(), r0.height() * 1.4f)
        val wide = wideBox(r0, 1f)
        val qrUrl = item.qr
        val qrSide = if (qrUrl == null) 0f else minOf(r0.width(), r0.height()) * 0.28f * item.qrScale.coerceAtMost(1.4f)
        val r = RectF(r0)
        if (qrSide > 0) { if (wide) r.right -= qrSide * 1.3f else r.bottom -= qrSide * 1.3f }
        var y = header(r, label, item.title, color, 0.09f)
        val notePx = base * 0.035f
        val noteReserve = if (item.note.isNotEmpty()) notePx * 2f else 0f
        val rows = item.rows.ifEmpty { item.text.split('\n').filter { it.isNotBlank() }.map { it.trim() to "" } }
        if (rows.isNotEmpty()) {
            val avail = r.bottom - y - noteReserve
            val rowH = (avail / rows.size).coerceAtMost(base * 0.12f)
            val px = rowH * 0.55f
            val name = SignText.paint(px, look.text, false)
            val value = SignText.paint(px, look.text, true)
            for ((a, b) in rows) {
                val baseline = y + rowH * 0.7f
                val vw = if (b.isEmpty()) 0f else value.measureText(b)
                val lineY = y + rowH
                ops += { c ->
                    SignText.line(c, a, r.left, baseline, (r.width() - vw - px).coerceAtLeast(1f), name)
                    if (b.isNotEmpty()) c.drawText(b, r.right - vw, baseline, value)
                    paint.style = Paint.Style.FILL
                    paint.color = 0x5994A3B8
                    c.drawRect(r.left, lineY - 1f, r.right, lineY, paint)
                }
                y += rowH
            }
        }
        if (item.note.isNotEmpty()) {
            val l = SignText.fit(item.note, r.width().toInt(), noteReserve.toInt(), notePx, notePx * 0.6f, look.dim, false, 2)
            ops += { c -> SignText.draw(c, l, r.left, r.bottom - l.height) }
        }
        if (qrUrl != null) {
            if (wide) qr(qrUrl, r0.right - qrSide, r0.top + (r0.height() - qrSide * 1.2f) / 2, qrSide)
            else qr(qrUrl, r0.centerX() - qrSide / 2, r0.bottom - qrSide * 1.25f, qrSide)
        }
    }

    /** Redes sociais: o perfil (@) grande na cor de destaque, o texto, o site e o QR. */
    private fun socialSlide(w: Int, h: Int, label: String, color: Int) {
        val r0 = box(w, h)
        val base = minOf(r0.width(), r0.height() * 1.4f)
        val qrUrl = item.qr
        val wide = wideBox(r0, 1f)
        val qs = item.qrScale.coerceAtMost(1.3f)
        val qrSide = if (qrUrl == null) 0f else if (wide) minOf(r0.height() * 0.7f * qs, r0.width() * 0.35f * qs) else minOf(r0.width() * 0.6f * qs, r0.height() * 0.36f * qs)
        val r = RectF(r0)
        if (qrSide > 0) { if (wide) r.right -= qrSide * 1.2f else r.bottom -= qrSide * 1.3f }
        var y = header(r, label, item.title, color)
        if (item.handle.isNotEmpty()) {
            val px = base * 0.1f
            val l = SignText.fit(item.handle, r.width().toInt(), (r.height() * 0.25f).toInt(), px, px * 0.4f, color, true, 2)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
            y += l.height + px * 0.3f
        }
        val sitePx = base * 0.045f
        val siteReserve = if (item.site.isNotEmpty()) sitePx * 1.8f else 0f
        if (item.text.isNotEmpty()) {
            val px = base * 0.055f
            val l = SignText.fit(item.text, r.width().toInt(), (r.bottom - y - siteReserve).toInt().coerceAtLeast(1), px, px * 0.5f, look.text, false, 5)
            val yy = y
            ops += { c -> SignText.draw(c, l, r.left, yy) }
        }
        if (item.site.isNotEmpty()) {
            val l = SignText.fit(item.site, r.width().toInt(), siteReserve.toInt(), sitePx, sitePx * 0.6f, look.dim, false, 1)
            ops += { c -> SignText.draw(c, l, r.left, r.bottom - l.height) }
        }
        if (qrUrl != null) {
            if (wide) qr(qrUrl, r0.right - qrSide, r0.top + (r0.height() - qrSide * 1.2f) / 2, qrSide)
            else qr(qrUrl, r0.centerX() - qrSide / 2, r0.bottom - qrSide * 1.25f, qrSide)
        }
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
        val wide = wideBox(r0)
        var r = RectF(r0)
        if (img != null) {
            if (wide) {
                val iw = r.width() * (0.42f * item.photoScale).coerceAtMost(0.7f)
                val dst = RectF(r.right - iw, r.top, r.right, r.bottom)
                ops += { c -> drawCover(c, img, dst, radius = minOf(w, h) * 0.02f) }
                r = RectF(r.left, r.top, r.right - iw - r0.width() * 0.04f, r.bottom)
            } else {
                val ih = r.height() * (0.38f * item.photoScale).coerceAtMost(0.6f)
                val dst = RectF(r.left, r.top, r.right, r.top + ih)
                ops += { c -> drawCover(c, img, dst, radius = minOf(w, h) * 0.02f) }
                r = RectF(r.left, r.top + ih + r0.height() * 0.04f, r.right, r.bottom)
            }
        }
        // o QR fica no canto de baixo à direita da área de texto
        val qrUrl = item.qr
        var qrSide = 0f
        if (qrUrl != null) {
            qrSide = (minOf(r.width(), r.height()) * 0.3f * item.qrScale).coerceAtLeast(80f)
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
        val wide = wideBox(r, 1f)
        if (wide) {
            val side = minOf(r.height() * 0.78f * minOf(item.qrScale, 1.2f), r.width() * 0.4f * item.qrScale.coerceAtMost(1.3f))
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
            val side = minOf(r.width() * 0.7f * item.qrScale.coerceAtMost(1.3f), r.height() * 0.45f * item.qrScale.coerceAtMost(1.3f))
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

    /**
     * Contagem: antes do `target`, "Começa em"; entre o `target` e o `until`, "Termina em"; depois, "Encerrado" (sem `until`,
     * "É hoje!"). Dias, horas, minutos e segundos, andando a cada segundo.
     */
    private fun countdown(r: RectF) {
        val color = templateColor("evento")
        val y0 = header(r, "Contagem regressiva", item.title, color, 0.08f)
        val base = minOf(r.width(), (r.bottom - y0) * 1.5f)
        val textL = if (item.text.isNotEmpty()) SignText.fit(item.text, r.width().toInt(), (r.height() * 0.2f).toInt(), base * 0.05f, base * 0.03f, look.dim, false, 3) else null
        dynamic = { c ->
            val ok = env.clockOk()
            val ph = Signage.countPhase(item.target, item.endAt, env.now())
            tp.typeface = Typeface.DEFAULT_BOLD
            tp.color = look.text
            tp.textSize = base * 0.065f
            c.drawText(if (ok) ph.label else "--", r.left, y0 + tp.textSize, tp)
            val top = y0 + tp.textSize * 1.5f
            val avail = r.bottom - top - (textL?.height ?: 0).toFloat() - base * 0.03f
            val units = listOf(ph.days to (if (ph.days == 1L) "dia" else "dias"), ph.hours.toLong() to (if (ph.hours == 1) "hora" else "horas"), ph.minutes.toLong() to "min", ph.seconds.toLong() to "seg")
            val cw = r.width() / 4
            for ((i, u) in units.withIndex()) {
                val cx = r.left + cw * i + cw / 2
                val num = if (!ok) "--" else if (i == 0) u.first.toString() else String.format(Locale.ROOT, "%02d", u.first)
                tp.typeface = Typeface.DEFAULT_BOLD
                tp.color = color
                tp.textSize = minOf(cw * 0.5f, avail * 0.6f)
                while (tp.measureText(num) > cw * 0.92f && tp.textSize > 10f) tp.textSize *= 0.9f
                val nw = tp.measureText(num)
                val nb = top + tp.textSize
                c.drawText(num, cx - nw / 2, nb, tp)
                tp.typeface = Typeface.DEFAULT
                tp.color = look.dim
                tp.textSize = minOf(cw * 0.16f, avail * 0.15f)
                val lw = tp.measureText(u.second)
                c.drawText(u.second, cx - lw / 2, nb + tp.textSize * 1.3f, tp)
            }
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
            if (item.hasRecord && item.record > 0) "Recorde: ${Signage.number(item.record.toDouble(), 0)} dias" else null,
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
                val cl = SignText.fit(wt.condition, r.width().toInt(), (px * 2.4f).toInt(), px, px * 0.6f, look.text, false, 2)
                SignText.draw(c, cl, r.left, r.top + px * 4.1f)
                tp.color = look.dim
                SignText.line(c, wt.city, r.left, r.top + px * 4.6f + cl.height, r.width(), tp)
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
    /** Conjunto de telas com a troca sincronizada: o relógio diz qual item está no ar (core/Wall.syncPosition). */
    private val syncEpoch: Long? = null,
) : FrameLayout(ctx) {
    private val handler = Handler(Looper.getMainLooper())
    private var index = -1
    private var current: View? = null
    private var currentItem: SignageItem? = null
    private var shownAt = 0L
    private var gen = 0
    private var running = false
    /** O vídeo próprio tocando agora (um player por zona, só enquanto o item está no ar). */
    private var video: SignVideo? = null

    init {
        // zona por cima (fundo translúcido): o item já pinta o fundo; pintar aqui também dobraria o escuro
        if (Color.alpha(env.look.bg) == 255) setBackgroundColor(env.look.bg)
    }

    /** Pode aparecer agora? (Imagem e vídeo só depois de baixados e conferidos.) */
    private fun playable(i: SignageItem): Boolean = when (i.kind) {
        "image", "logo", "video" -> i.file?.let { env.file(it) } != null
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
        video?.release()
        video = null
        (current as? android.webkit.WebView)?.destroy()
        super.onDetachedFromWindow()
    }

    private fun closeCurrent() {
        val c = currentItem ?: return
        if (shownAt > 0) env.onTime(c.id, SystemClock.uptimeMillis() - shownAt)
        shownAt = 0L
    }

    fun tick() {
        (current as? SignItemView)?.tick()
    }

    /** Quanto tempo fica o item (ms), na conta sincronizada. */
    private fun durationMs(i: SignageItem): Long = i.seconds * 1000L

    private fun next() {
        if (!running) return
        val my = ++gen
        handler.removeCallbacksAndMessages(null)
        var pick = -1
        var syncRemaining = -1L
        val epoch = syncEpoch
        if (epoch != null && env.clockOk()) {
            // sincronizado: todas as TVs do conjunto fazem a mesma conta com o mesmo relógio
            val sp = br.com.digitalisp.telas.core.Wall.syncPosition(items.map { durationMs(it) }, epoch, env.now())
            if (sp != null && playable(items[sp.index])) {
                pick = sp.index
                syncRemaining = sp.remaining.coerceAtLeast(500L)
            }
        }
        if (pick < 0) for (step in 1..items.size) {
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
        nextDelay = if (syncRemaining > 0) syncRemaining else -1L
        val cur = current
        if (cur != null && currentItem === item && item.kind != "video") {
            // um item só (ou só um pronto): fica, e conta de novo a cada volta
            closeCurrent()
            shownAt = SystemClock.uptimeMillis()
            env.onShown(item.id)
            schedule(item, my)
            return
        }
        if (item.kind == "video") {
            showVideo(item, my)
            return
        }
        if (item.kind == "web") {
            showWeb(item, my)
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
                val small = (item.kind == "birthdays" || (item.kind == "slide" && item.template == "aniversariantes")) && f !== item.art
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
        put(SignItemView(context, item, env, bitmaps, edge), item, my)
    }

    /** Põe a vista nova por cima da antiga com a transição do item (fade, slide ou zoom) e o zoom lento, se pedido. */
    private fun put(v: View, item: SignageItem, my: Int, scheduleNext: Boolean = true) {
        closeCurrent()
        val old = current
        val oldItem = currentItem
        addView(v, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        current = v
        currentItem = item
        shownAt = SystemClock.uptimeMillis()
        env.onShown(item.id)
        val done = Runnable {
            if (old != null) removeView(old)
            if (oldItem?.kind == "video") stopVideo(keep = video?.takeIf { it.view === v })
            if (old is android.webkit.WebView) old.destroy()
        }
        when (item.transition) {
            "slide" -> {
                v.translationX = width.toFloat().coerceAtLeast(1f)
                v.animate().translationX(0f).setDuration(SLIDE_MS).withEndAction(done).start()
            }
            "zoom" -> {
                v.alpha = 0f
                v.scaleX = 1.12f
                v.scaleY = 1.12f
                v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(SLIDE_MS).withEndAction(done).start()
            }
            else -> {
                v.alpha = 0f
                v.animate().alpha(1f).setDuration(FADE_MS).withEndAction(done).start()
            }
        }
        if (item.kenburns && item.kind == "image") {
            // zoom lento na imagem durante o tempo do item (depois da transição)
            v.postDelayed({
                if (current === v) v.animate().scaleX(1.08f).scaleY(1.08f).setDuration(item.seconds * 1000L).setInterpolator(android.view.animation.LinearInterpolator()).start()
            }, SLIDE_MS)
        }
        if (scheduleNext) schedule(item, my)
    }

    /** O tempo do item (ou o que falta na conta sincronizada) e depois o próximo. */
    private var nextDelay = -1L

    private fun schedule(item: SignageItem, my: Int) {
        val ms = if (nextDelay > 0) nextDelay else item.seconds * 1000L
        nextDelay = -1L
        handler.postDelayed({ if (my == gen) next() }, ms)
    }

    // ---- vídeo próprio: o arquivo guardado, inteiro, mudo sem `sound`; no fim (ou erro), o próximo

    private fun showVideo(item: SignageItem, my: Int) {
        val file = item.file?.let { env.file(it) }
        if (file == null) {
            handler.postDelayed({ if (my == gen) next() }, 500L)
            return
        }
        val sv = SignVideo(context, file, item.sound && env.volume() > 0f, env.volume(), item.contain) {
            // terminou ou falhou: o próximo (na troca sincronizada, só quando a conta mandar)
            if (my == gen && nextDelay <= 0) handler.post { if (my == gen) next() }
        }
        video?.release()
        video = sv
        put(sv.view, item, my, scheduleNext = false)
        // rede de segurança: o tempo do item mais 5 s (o arquivo pode travar sem avisar)
        val ms = if (nextDelay > 0) nextDelay else item.seconds * 1000L + 5_000L
        nextDelay = -1L
        handler.postDelayed({ if (my == gen) next() }, ms)
    }

    private fun stopVideo(keep: SignVideo?) {
        val v = video ?: return
        if (v === keep) return
        v.release()
        video = null
    }

    // ---- página da internet: uma WebView ocupando a zona, recarregada a cada `refreshMin`

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(item: SignageItem, my: Int) {
        val url = item.webUrl ?: return handler.post { if (my == gen) next() }.let { }
        val wv = try {
            android.webkit.WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                isFocusable = false
                isFocusableInTouchMode = false
                webViewClient = object : android.webkit.WebViewClient() {
                    // os links da página abrem aqui mesmo, nunca num navegador por cima do quiosque
                    override fun shouldOverrideUrlLoading(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): Boolean = false
                }
                loadUrl(url)
            }
        } catch (_: Throwable) {
            null // aparelho sem WebView instalada: pula o item
        }
        if (wv == null) {
            handler.postDelayed({ if (my == gen) next() }, 1_000L)
            return
        }
        put(wv, item, my)
        if (item.refreshMin > 0) {
            val every = item.refreshMin * 60_000L
            val reload = object : Runnable {
                override fun run() {
                    if (current !== wv || my != gen) return
                    wv.reload()
                    handler.postDelayed(this, every)
                }
            }
            handler.postDelayed(reload, every)
        }
    }

    companion object {
        const val FADE_MS = 700L
        const val SLIDE_MS = 600L
    }
}

/**
 * O vídeo próprio de uma zona (item `video`, MP4 guardado no aparelho): um ExoPlayer só dele, numa TextureView (respeita o
 * recorte da zona), inteiro (`contain`, com fundo preto). [onEnd] é chamado no fim e no erro.
 */
class SignVideo(ctx: Context, file: java.io.File, sound: Boolean, volume: Float, contain: Boolean, private val onEnd: () -> Unit) {
    private val player: androidx.media3.exoplayer.ExoPlayer = androidx.media3.exoplayer.ExoPlayer.Builder(ctx).build()
    private val texture = android.view.TextureView(ctx)
    val view: FrameLayout = object : FrameLayout(ctx) {
        override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
            super.onLayout(changed, l, t, r, b)
            fit()
        }
    }.apply {
        setBackgroundColor(Color.BLACK)
        addView(texture, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }
    private var vw = 0
    private var vh = 0
    private val contain = contain
    private var ended = false

    init {
        player.setVideoTextureView(texture)
        player.volume = if (sound) volume.coerceIn(0f, 1f) else 0f
        player.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == androidx.media3.common.Player.STATE_ENDED) end()
            }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) = end()
            override fun onVideoSizeChanged(size: androidx.media3.common.VideoSize) {
                vw = size.width
                vh = size.height
                fit()
            }
        })
        player.setMediaItem(androidx.media3.common.MediaItem.fromUri(android.net.Uri.fromFile(file)))
        player.prepare()
        player.playWhenReady = true
    }

    private fun end() {
        if (ended) return
        ended = true
        onEnd()
    }

    /** Inteiro na zona (contain) ou cobrindo (cover), sem distorcer. */
    private fun fit() {
        val w = view.width
        val h = view.height
        if (w <= 0 || h <= 0 || vw <= 0 || vh <= 0) return
        val s = if (contain) minOf(w.toFloat() / vw, h.toFloat() / vh) else maxOf(w.toFloat() / vw, h.toFloat() / vh)
        val m = android.graphics.Matrix()
        m.setScale(vw * s / w, vh * s / h, w / 2f, h / 2f)
        texture.setTransform(m)
    }

    fun release() {
        ended = true
        try { player.release() } catch (_: Throwable) { }
    }
}

/** Leitura das imagens já no tamanho da zona (TV box de 1 a 2 GB: nunca abrir a imagem inteira sem precisar). */
object SignBitmaps {
    /** Uma cópia minúscula da imagem: desenhada esticada, vira o fundo desfocado (sem RenderScript, que o Android 12 tirou). */
    fun blurred(b: Bitmap): Bitmap? = try {
        val w = 24
        val h = (24f * b.height / b.width.coerceAtLeast(1)).toInt().coerceIn(4, 96)
        Bitmap.createScaledBitmap(b, w, h, true)
    } catch (_: Throwable) {
        null
    }

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
