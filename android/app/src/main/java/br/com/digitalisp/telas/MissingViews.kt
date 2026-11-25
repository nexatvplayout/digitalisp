package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import br.com.digitalisp.telas.core.Missing
import br.com.digitalisp.telas.core.MissingCase
import br.com.digitalisp.telas.core.MissingQrSize
import java.io.File

/**
 * Pessoas desaparecidas (contrato §8.2): a tela cheia e a faixa, desenhadas direto no Canvas para o texto nunca se
 * sobrepor: a fonte diminui até um mínimo legível e, se ainda não couber, o texto é cortado com reticências.
 */
object MissingArt {
    const val BG = 0xFF0A0E16.toInt()
    const val PANEL = 0xFF131A27.toInt()
    const val ACCENT = 0xFFFFD166.toInt()
    const val DIM = 0xFF9FB0C8.toInt()
    const val RED = 0xFFC62828.toInt()
    private const val MIN_SCALE = 0.6f

    // ---- QR code do caso (contrato §11) ----
    private val qrCache = HashMap<String, Bitmap>()

    /**
     * O QR code no tamanho pedido, gerado uma vez (pelo mesmo gerador do widget `qr`: preto no branco, com margem) e
     * guardado enquanto o caso estiver na lista. Nunca é gerado a cada quadro. Só na thread principal.
     */
    fun qr(data: String, side: Int): Bitmap? {
        if (side <= 0) return null
        val key = side.toString() + "|" + data
        qrCache[key]?.let { return it }
        return Ui.qr(data, side, margin = 4)?.also { qrCache[key] = it } // margem branca inteira (4 módulos)
    }

    /** Solta os códigos dos casos que saíram da lista. */
    fun retainQr(datas: Set<String>) {
        qrCache.keys.retainAll { it.substringAfter('|') in datas }
    }

    /** O código sobre uma placa branca (QR sobre fundo escuro não lê bem), sem suavizar os quadradinhos. */
    fun drawQr(c: Canvas, bmp: Bitmap, left: Float, top: Float, side: Float, paint: Paint) {
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        val m = side * 0.03f
        c.drawRoundRect(RectF(left - m, top - m, left + side + m, top + side + m), m * 2, m * 2, paint)
        paint.isFilterBitmap = false
        c.drawBitmap(bmp, null, RectF(left, top, left + side, top + side), paint)
    }

    /** A foto já reduzida para o tamanho em que vai aparecer, em pé pelo EXIF; null se não for uma imagem (o caso aparece com a silhueta). */
    fun decode(file: File, maxW: Int, maxH: Int): Bitmap? = ImageArt.decode(file, maxW, maxH)

    /** A foto inteira dentro da caixa (ajustada por dentro, sem cortar o rosto) ou, sem foto conferida, a silhueta. */
    fun photo(c: Canvas, box: RectF, bmp: Bitmap?, paint: Paint) {
        paint.style = Paint.Style.FILL
        paint.color = PANEL
        val r = minOf(box.width(), box.height()) * 0.04f
        c.drawRoundRect(box, r, r, paint)
        if (bmp != null && !bmp.isRecycled) {
            val k = minOf(box.width() / bmp.width, box.height() / bmp.height)
            val w = bmp.width * k
            val h = bmp.height * k
            val dst = RectF(box.centerX() - w / 2, box.centerY() - h / 2, box.centerX() + w / 2, box.centerY() + h / 2)
            paint.isFilterBitmap = true
            c.drawBitmap(bmp, null, dst, paint)
            return
        }
        // silhueta: cabeça e ombros
        val s = minOf(box.width(), box.height())
        val cx = box.centerX()
        val cy = box.centerY()
        paint.color = 0xFF3A4A63.toInt()
        c.drawCircle(cx, cy - s * 0.14f, s * 0.15f, paint)
        c.save()
        c.clipRect(box)
        c.drawOval(RectF(cx - s * 0.3f, cy + s * 0.06f, cx + s * 0.3f, cy + s * 0.62f), paint)
        c.restore()
    }

    /** Uma linha só: diminui a fonte até caber na largura (até 60%) e, se ainda não couber, corta com reticências. */
    fun line(c: Canvas, text: String, paint: TextPaint, px: Float, x: Float, top: Float, width: Float, center: Boolean = false): Float {
        if (text.isEmpty() || width <= 0f) return 0f
        paint.textSize = px
        val w = paint.measureText(text)
        if (w > width) paint.textSize = maxOf(px * MIN_SCALE, px * width / w)
        val shown = TextUtils.ellipsize(text, paint, width, TextUtils.TruncateAt.END).toString()
        val fm = paint.fontMetrics
        val dx = if (center) (width - paint.measureText(shown)) / 2f else 0f
        c.drawText(shown, x + dx, top - fm.ascent, paint)
        return fm.descent - fm.ascent
    }

    fun block(text: String, paint: TextPaint, px: Float, width: Int, maxLines: Int, align: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL): StaticLayout {
        paint.textSize = px
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, maxOf(width, 1))
            .setAlignment(align)
            .setLineSpacing(0f, 1.08f)
            .setIncludePad(false)
            .setMaxLines(maxOf(maxLines, 1))
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()
    }

    /** Um trecho do texto da tela cheia: tamanho base, cor, negrito e quantas linhas pode ocupar no máximo. */
    class Part(val text: String, val px: Float, val color: Int, val bold: Boolean, val maxLines: Int)

    /**
     * Desenha os trechos um embaixo do outro dentro de `height`. Primeiro tenta diminuir a fonte de todos (até 60%);
     * se ainda passar, os últimos trechos perdem linhas (com reticências) e, sem lugar para uma linha, não saem.
     */
    fun column(c: Canvas, parts: List<Part>, paint: TextPaint, x: Float, top: Float, width: Int, height: Float, align: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL) {
        val list = parts.filter { it.text.isNotEmpty() }
        if (list.isEmpty() || width <= 0 || height <= 0f) return
        var scale = 1f
        var layouts: List<StaticLayout>
        var gap: Float
        while (true) {
            gap = list.first().px * 0.22f * scale
            layouts = list.map { p ->
                paint.typeface = if (p.bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                block(p.text, paint, p.px * scale, width, p.maxLines, align)
            }
            val total = layouts.sumOf { it.height } + gap * (layouts.size - 1)
            if (total <= height || scale <= MIN_SCALE + 0.001f) break
            scale = maxOf(MIN_SCALE, scale - 0.05f)
        }
        var y = top
        for ((i, p) in list.withIndex()) {
            val room = top + height - y
            paint.typeface = if (p.bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            paint.color = p.color
            var l = layouts[i]
            if (l.height > room) {
                // não cabe inteiro: só as linhas que cabem, a última com reticências
                val lineH = l.height.toFloat() / maxOf(l.lineCount, 1)
                val fit = (room / lineH).toInt()
                if (fit < 1) break
                l = block(p.text, paint, p.px * scale, width, fit, align)
                if (l.height > room) break
            } else {
                paint.textSize = p.px * scale
            }
            c.save()
            c.translate(x, y)
            l.draw(c)
            c.restore()
            y += l.height + gap
        }
    }
}

/** Tela cheia: a foto de um lado e o texto do outro (TV em pé: foto em cima). Cobre o layout; o vídeo segue por baixo. */
class MissingFullView(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private var case: MissingCase? = null
    private var bitmap: Bitmap? = null

    init {
        setBackgroundColor(MissingArt.BG)
        isClickable = true
    }

    fun show(c: MissingCase, bmp: Bitmap?) {
        if (c == case && bmp === bitmap) return
        case = c
        bitmap = bmp
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val c = case ?: return
        // margem do overscan (padding): o fundo vai até a borda; o desenho fica dentro da área segura
        val w = (width - paddingLeft - paddingRight).toFloat()
        val h = (height - paddingTop - paddingBottom).toFloat()
        if (w <= 0f || h <= 0f) return
        canvas.translate(paddingLeft.toFloat(), paddingTop.toFloat())
        val u = minOf(w, h) / 100f
        val pad = u * 4f
        val portrait = h > w

        // cabeçalho na largura toda
        val headH = u * 11f
        paint.style = Paint.Style.FILL
        paint.color = MissingArt.RED
        canvas.drawRect(0f, 0f, w, headH, paint)
        text.typeface = Typeface.DEFAULT_BOLD
        text.color = Color.WHITE
        text.letterSpacing = 0.06f
        val headPx = u * 6f
        MissingArt.line(canvas, Missing.headerFor(c), text, headPx, pad, (headH - headPx * 1.18f) / 2f, w - pad * 2, center = true)
        text.letterSpacing = 0f

        // QR code para contato imediato (contrato §11): pelo menos 22% da altura da tela, junto do contato
        val qrSide = if (c.qr != null) MissingQrSize.full(w.toInt(), h.toInt()).toFloat() else 0f
        val qrBmp = c.qr?.let { MissingArt.qr(it.data, qrSide.toInt()) }
        val hasQr = qrBmp != null && qrSide > 0f

        // rodapé: o contato em destaque (com o código ao lado, o contato fica no espaço que sobra à esquerda dele)
        val footH = if (c.contact.isEmpty()) 0f else u * 13f
        // tela deitada: o código fica no canto de baixo, à direita, por cima da ponta do rodapé
        val qrLeftWide = w - pad - qrSide
        val qrTopWide = h - pad * 0.6f - qrSide
        if (footH > 0f) {
            paint.color = MissingArt.ACCENT
            canvas.drawRect(0f, h - footH, w, h, paint)
            text.color = 0xFF1A1A1A.toInt()
            text.typeface = Typeface.DEFAULT_BOLD
            val px = u * 6.4f
            val contactW = if (hasQr && !portrait) qrLeftWide - pad * 2 else w - pad * 2
            MissingArt.line(canvas, c.contact, text, px, pad, h - footH + (footH - px * 1.18f) / 2f, contactW, center = true)
        }

        val top = headH + pad
        var bottom = h - footH - pad
        var textBottom = bottom
        val textLeft = if (c.textOnly || portrait) (if (c.textOnly) pad * 2 else pad) else pad * 2 + (w - pad * 3) * 0.42f
        if (hasQr && qrBmp != null) {
            val label = listOf(MissingArt.Part(c.qr?.label.orEmpty(), u * 4.6f, MissingArt.ACCENT, true, 3))
            if (!portrait) {
                MissingArt.drawQr(canvas, qrBmp, qrLeftWide, qrTopWide, qrSide, paint)
                // a frase ao lado do código, encostada nele, na altura que sobra acima do rodapé
                val labelBottom = h - footH - pad * 0.5f
                MissingArt.column(canvas, label, text, textLeft, qrTopWide, (qrLeftWide - pad - textLeft).toInt(), labelBottom - qrTopWide, Layout.Alignment.ALIGN_OPPOSITE)
                textBottom = qrTopWide - pad
            } else {
                // TV em pé: o código abaixo do texto, logo acima do rodapé, com a frase ao lado
                val qrTop = bottom - qrSide
                MissingArt.drawQr(canvas, qrBmp, pad, qrTop, qrSide, paint)
                MissingArt.column(canvas, label, text, pad * 2 + qrSide, qrTop + qrSide * 0.2f, (w - pad * 3 - qrSide).toInt(), qrSide * 0.8f)
                bottom = qrTop - pad
                textBottom = bottom
            }
        }
        if (c.textOnly) {
            // cartela policial sem foto: o texto ocupa a largura
            MissingArt.column(canvas, parts(c, u), text, pad * 2, top, (w - pad * 4).toInt(), textBottom - top)
            return
        }
        val photoBox: RectF
        val textX: Float
        val textTop: Float
        val textW: Float
        if (!portrait) {
            val photoW = (w - pad * 3) * 0.42f
            photoBox = RectF(pad, top, pad + photoW, bottom)
            textX = pad * 2 + photoW
            textTop = top
            textW = w - textX - pad
        } else {
            val photoH = (bottom - top) * (if (hasQr) 0.48f else 0.52f)
            photoBox = RectF(pad, top, w - pad, top + photoH)
            textX = pad
            textTop = top + photoH + pad
            textW = w - pad * 2
        }
        MissingArt.photo(canvas, photoBox, bitmap, paint)

        MissingArt.column(canvas, parts(c, u), text, textX, textTop, textW.toInt(), textBottom - textTop)
    }

    /** As linhas do texto; as que vêm vazias (idade, data, visto por último, descrição) não são desenhadas. */
    private fun parts(c: MissingCase, u: Float): List<MissingArt.Part> {
        return listOf(
            MissingArt.Part(c.name, u * 9f, Color.WHITE, true, 2),
            MissingArt.Part(Missing.age(c.age), u * 6f, MissingArt.ACCENT, true, 1),
            MissingArt.Part(Missing.since(c.since), u * 4.6f, MissingArt.DIM, false, 1),
            MissingArt.Part(Missing.lastSeen(c.lastSeen), u * 4.8f, Color.WHITE, false, 4),
            MissingArt.Part(c.description, u * 4.8f, Color.WHITE, false, 6),
        )
    }
}

/** Faixa na parte de baixo: miniatura da foto, "DESAPARECIDA(O)", nome e idade, e o contato. */
class MissingBannerView(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private var case: MissingCase? = null
    private var bitmap: Bitmap? = null

    /** A altura da tela inteira (da composição), para decidir se o QR code cabe num tamanho que o celular lê. */
    var screenHeight = 0
        set(v) {
            if (v != field) {
                field = v
                invalidate()
            }
        }

    init {
        setBackgroundColor(MissingArt.BG)
    }

    fun show(c: MissingCase, bmp: Bitmap?) {
        if (c == case && bmp === bitmap) return
        case = c
        bitmap = bmp
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val c = case ?: return
        // margem do overscan (padding): o fundo vai até a borda; o desenho fica dentro da área segura
        val w = (width - paddingLeft - paddingRight).toFloat()
        val h = (height - paddingTop - paddingBottom).toFloat()
        if (w <= 0f || h <= 0f) return
        canvas.translate(paddingLeft.toFloat(), paddingTop.toFloat())
        val pad = h * 0.08f
        // filete vermelho em cima, para separar do vídeo
        paint.style = Paint.Style.FILL
        paint.color = MissingArt.RED
        canvas.drawRect(0f, 0f, w, h * 0.05f, paint)

        val thumb = h - pad * 2 - h * 0.05f
        val box = RectF(pad, h * 0.05f + pad, pad + thumb * 0.8f, h - pad)
        if (!c.textOnly) MissingArt.photo(canvas, box, bitmap, paint)

        // QR code na ponta direita, na altura útil da faixa; pequeno demais para ler de longe, não é desenhado
        val qrSide = if (c.qr != null) MissingQrSize.banner(h.toInt(), screenHeight).toFloat() else 0f
        val qrBmp = c.qr?.let { MissingArt.qr(it.data, qrSide.toInt()) }
        val qrLeft = w - pad - qrSide
        if (qrBmp != null && qrSide > 0f) MissingArt.drawQr(canvas, qrBmp, qrLeft, h * 0.05f + (h * 0.95f - qrSide) / 2f, qrSide, paint)

        val x = if (c.textOnly) pad * 2 else box.right + pad * 1.5f
        val room = (if (qrBmp != null && qrSide > 0f) qrLeft - pad else w) - x - pad
        if (room <= 0f) return
        // faixa larga: o contato fica à direita; faixa estreita (coluna do painel de senha): tudo empilhado
        val wide = room > h * 5f
        val leftW = if (wide) room * 0.6f else room
        val rows = if (wide || c.contact.isEmpty()) 2 else 3
        val rowH = (h * 0.95f - pad * 2) / (if (rows == 2) 2.3f else 3.2f)
        var y = h * 0.05f + pad
        text.typeface = Typeface.DEFAULT_BOLD
        text.color = MissingArt.ACCENT
        text.letterSpacing = 0.06f
        y += MissingArt.line(canvas, Missing.shortHeaderFor(c), text, rowH * 0.62f, x, y, leftW)
        text.letterSpacing = 0f
        text.color = Color.WHITE
        y += MissingArt.line(canvas, Missing.nameAndAge(c), text, rowH * (if (rows == 2) 0.95f else 0.8f), x, y, leftW)
        if (c.contact.isEmpty()) return
        if (wide) {
            val cw = room - leftW - pad
            val cx = x + leftW + pad
            paint.color = MissingArt.ACCENT
            val r = h * 0.08f
            canvas.drawRoundRect(RectF(cx, h * 0.05f + pad, cx + cw, h - pad), r, r, paint)
            text.color = 0xFF1A1A1A.toInt()
            val px = rowH * 0.7f
            MissingArt.line(canvas, c.contact, text, px, cx + pad, (h * 1.05f - px * 1.18f) / 2f, cw - pad * 2, center = true)
        } else {
            text.color = MissingArt.ACCENT
            MissingArt.line(canvas, c.contact, text, rowH * 0.7f, x, y, leftW)
        }
    }
}
