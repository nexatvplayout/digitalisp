package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import br.com.digitalisp.telas.core.Insets
import br.com.digitalisp.telas.core.QueueCall
import br.com.digitalisp.telas.core.QueueCallCard
import br.com.digitalisp.telas.core.QueueLayout
import br.com.digitalisp.telas.core.QueueServiceRow
import br.com.digitalisp.telas.core.QueueState
import br.com.digitalisp.telas.core.RiskColors
import br.com.digitalisp.telas.core.TelaConfig
import br.com.digitalisp.telas.core.ThemeCfg

/**
 * Caixas de senha (15/11, pedido do dono): cada senha anterior dentro de uma caixa com borda e fundo, o código grande, o
 * guichê/consultório embaixo e a faixa da cor do risco (§13) à esquerda. Usadas no painel "queue", na coluna lateral e nos
 * painéis do §15. O tipo da triagem nunca aparece: só o nível do risco em palavras.
 */
object QueueBoxes {
    fun text(ctx: Context, px: Float, color: Int, bold: Boolean = false, gravity: Int = Gravity.START or Gravity.CENTER_VERTICAL, lines: Int = 1) = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        this.gravity = gravity
        maxLines = lines
        ellipsize = TextUtils.TruncateAt.END
        includeFontPadding = false
    }

    fun rounded(fill: Int, radius: Float, stroke: Int = 0, strokePx: Int = 0) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radius
        if (strokePx > 0) setStroke(strokePx, stroke)
    }

    /**
     * Uma senha numa caixa. unit: o tamanho do código (px); horizontal: código e local na mesma linha (listas estreitas);
     * withKind: o tipo (PREFERENCIAL, URGENTE…) acima; withTime: a hora da chamada.
     */
    fun box(
        ctx: Context, call: QueueCall, unit: Float, panel0: Int, fg0: Int, dim0: Int, line: Int,
        showName: Boolean = false, withKind: Boolean = false, withTime: Boolean = false, horizontal: Boolean = false, center: Boolean = false,
    ): View {
        // 19/11, do dono: a caixa inteira na cor da urgência (Manchester); sem risco, as cores do tema
        val rc = RiskColors.of(call.risk)
        val panel = rc ?: panel0
        val fg = if (rc == null) fg0 else RiskColors.textOn(rc)
        val dim = if (rc == null) dim0 else (fg and 0x00FFFFFF) or (0xD9 shl 24)
        val outer = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = rounded(panel, unit * 0.22f, line, maxOf(1, (unit * 0.04f).toInt()))
            clipToOutline = true
        }
        // a faixa da cor do risco (sem risco, nada)
        // 19/11: a faixa mede 0 de altura até a LinearLayout repassar a altura da caixa (forceUniformHeight). Uma View comum
        // numa coluna sem altura fixa (a lateral) pega TODA a altura livre e a caixa esticava até o fim da coluna.
        // (a faixa lateral da cor saiu: a caixa toda já tem a cor)
        val pad = (unit * 0.22f).toInt()
        val g = if (center) Gravity.CENTER else Gravity.START or Gravity.CENTER_VERTICAL
        val body = LinearLayout(ctx).apply {
            orientation = if (horizontal) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = g
            setPadding(pad, pad / 2, pad, pad / 2)
        }
        if (withKind) body.addView(text(ctx, unit * 0.36f, dim, true, g).apply { text = QueueLayout.kind(call); letterSpacing = 0.06f })
        body.addView(text(ctx, unit, fg, true, g).apply { text = QueueLayout.who(call, showName) })
        val desk = QueueCallCard.text(call, false).desk
        if (desk.isNotEmpty()) body.addView(text(ctx, unit * 0.5f, dim, false, g).apply { text = desk },
            if (horizontal) LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = pad } else LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        if (withTime) QueueLayout.hhmm(call.at).takeIf { it.isNotEmpty() }?.let { h -> body.addView(text(ctx, unit * 0.4f, dim, false, g).apply { this.text = h }) }
        outer.addView(body, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        return outer
    }
}

/** Um painel de senha do §15 já montado: a vista, o relógio e a data (o MainActivity atualiza) e o refresh do estado. */
class QueueBoard(val root: View, val clock: TextView?, val date: TextView?, private val paint: (QueueState, TelaConfig) -> Unit) {
    private var sig = ""

    /** Redesenha só quando o que aparece mudou (o estado vem a cada evento e a cada repaint). */
    fun refresh(s: QueueState, c: TelaConfig) {
        val key = listOf(s.current, s.last, s.serving, s.byService, c.queue).hashCode().toString()
        if (key == sig) return
        sig = key
        paint(s, c)
    }
}

/**
 * Monta os painéis de senha do §15 (QueueLayout). Cada um é desenhado dentro da margem de segurança (overscan), com o tema
 * da tela (cor principal e claro/escuro). Os sem vídeo (BIG, DUO) deixam a moldura do vídeo com 1 px, escondida: o canal
 * continua tocando (o som segue o volume da tela).
 */
object QueueBoards {
    fun build(
        ctx: Context, style: QueueLayout, c: TelaConfig, sw: Int, sh: Int, ins: Insets, frame: View,
        makeTicker: () -> View,
    ): QueueBoard {
        val t = c.theme
        val u = minOf(sh / 100f, sw / 178f) // 1 u = 1% da altura numa tela 16:9
        val gap = (u * 1.2f).toInt()
        val showName = c.queue.showName
        val office = c.device.office.ifEmpty { c.side.title ?: c.queue.title.ifEmpty { "Atendimento" } }
        val title = c.queue.title.ifEmpty { "Atendimento" }

        fun tv(px: Float, color: Int = t.text, bold: Boolean = false, g: Int = Gravity.START or Gravity.CENTER_VERTICAL, lines: Int = 1) = QueueBoxes.text(ctx, px, color, bold, g, lines)
        fun col() = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        fun row() = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        fun lpW(weight: Float, top: Int = 0, left: Int = 0) = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight).apply { topMargin = top; leftMargin = left }
        fun lpH(weight: Float, top: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, weight).apply { topMargin = top }
        fun lpWrap(top: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = top }
        fun panelBg(fill: Int = t.panel) = QueueBoxes.rounded(fill, u * 1.2f, t.line, maxOf(1, (u * 0.15f).toInt()))
        fun colorBg(fill: Int) = QueueBoxes.rounded(fill, u * 1.2f)
        fun box(call: QueueCall, unit: Float, kind: Boolean = false, time: Boolean = false, horizontal: Boolean = false, center: Boolean = false) =
            QueueBoxes.box(ctx, call, unit, t.panel, t.text, t.dim, t.line, showName, kind, time, horizontal, center)
        fun label(text: String, px: Float = u * 2.6f, color: Int = t.dim) = tv(px, color, true).apply { this.text = text; letterSpacing = 0.08f }

        var clock: TextView? = null
        var date: TextView? = null
        /** Cabeçalho: o nome do local à esquerda; hora e data à direita (na cor principal). */
        fun header(): View {
            val h = row().apply {
                gravity = Gravity.CENTER_VERTICAL
                background = colorBg(t.color)
                setPadding((u * 2).toInt(), (u * 1).toInt(), (u * 2).toInt(), (u * 1).toInt())
            }
            h.addView(tv(u * 4.4f, t.onColor, true).apply { text = office }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            val right = col().apply { gravity = Gravity.END }
            clock = tv(u * 4.6f, t.onColor, true, Gravity.END).also { right.addView(it) }
            date = tv(u * 2.2f, t.onColor, false, Gravity.END).also { right.addView(it) }
            h.addView(right)
            return h
        }
        /** Relógio numa caixa da cor principal (rodapés com texto rolante). */
        fun clockChip(): View = tv(u * 4.2f, t.onColor, true, Gravity.CENTER).apply {
            background = colorBg(t.color)
            setPadding((u * 2).toInt(), 0, (u * 2).toInt(), 0)
            clock = this
        }
        /** A cor de fundo da senha atual: a do risco (§13) ou a principal; o texto que se lê sobre ela. */
        fun curColors(call: QueueCall?): Pair<Int, Int> {
            val bg = RiskColors.of(call?.risk) ?: t.color
            return bg to RiskColors.textOn(bg)
        }
        /** O cartão grande da senha atual (o tipo, a senha, o local, o nome só com showName e uma linha extra). */
        fun bigCard(host: FrameLayout, call: QueueCall?, widthPx: Int, ticketPx: Float, extra: String? = null, fallback: String = "SENHA") {
            host.removeAllViews()
            val (bg, fg) = curColors(call)
            val card = col().apply { gravity = Gravity.CENTER; background = colorBg(bg); setPadding((u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt()) }
            card.addView(tv(u * 3.2f, fg, true, Gravity.CENTER).apply { text = QueueLayout.kind(call, fallback); letterSpacing = 0.08f }, lpWrap())
            val ticket = call?.ticket ?: "—"
            val px = minOf(ticketPx, widthPx / (maxOf(ticket.length, 3) * 0.62f))
            card.addView(tv(px, fg, true, Gravity.CENTER).apply { text = ticket }, lpWrap((u * 1).toInt()))
            val txt = call?.let { QueueCallCard.text(it, showName) }
            card.addView(tv(u * 5.4f, fg, true, Gravity.CENTER, 2).apply { text = txt?.desk?.ifEmpty { null } ?: if (call == null) "Aguarde a chamada" else "" }, lpWrap((u * 1).toInt()))
            txt?.name?.let { n -> card.addView(tv(u * 4.4f, fg, true, Gravity.CENTER).apply { text = n }, lpWrap()) }
            if (extra != null && call != null) card.addView(tv(u * 2.4f, fg, false, Gravity.CENTER).apply { text = extra }, lpWrap((u * 1).toInt()))
            host.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        /** Tabela SENHA | GUICHÊ: o cabeçalho, a atual (opcional, na cor) e as anteriores com a faixa do risco. */
        fun tableRow(a: String, b: String, px: Float, bg: Int, fg: Int, risk: String? = null, bold: Boolean = true): View {
            val r = row().apply { gravity = Gravity.CENTER_VERTICAL; background = if (bg == t.panel) panelBg() else colorBg(bg) }
            RiskColors.of(risk)?.let { rc -> r.addView(View(ctx).apply { setBackgroundColor(rc) }, LinearLayout.LayoutParams((u * 0.8f).toInt(), ViewGroup.LayoutParams.MATCH_PARENT)) }
            val p = (u * 1.6f).toInt()
            r.addView(tv(px, fg, bold).apply { text = a; setPadding(p, 0, p / 2, 0) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            r.addView(tv(px, fg, bold).apply { text = b; setPadding(p / 2, 0, p, 0) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f))
            return r
        }
        fun table(host: LinearLayout, s: QueueState, withCurrent: Boolean, rows: Int) {
            host.removeAllViews()
            host.addView(tableRow("SENHA", "GUICHÊ", u * 2.6f, t.color, t.onColor), lpH(0.7f))
            if (withCurrent) {
                val cur = s.current
                val (bg, fg) = curColors(cur)
                host.addView(tableRow(cur?.let { QueueLayout.who(it, showName) } ?: "—", cur?.desk ?: "", u * 6f, bg, fg), lpH(1.6f, gap))
            }
            val prev = QueueLayout.previous(s, rows)
            for (i in 0 until rows) {
                val call = prev.getOrNull(i)
                host.addView(if (call == null) View(ctx) else tableRow(QueueLayout.who(call, showName), call.desk.ifEmpty { "—" }, u * 4f, t.panel, t.text, call.risk), lpH(1f, gap))
            }
        }
        fun boxes(host: LinearLayout, calls: List<QueueCall>, n: Int, unit: Float, kind: Boolean = false, time: Boolean = false, vertical: Boolean = false, horizontalBox: Boolean = false) {
            host.removeAllViews()
            for (i in 0 until n) {
                val call = calls.getOrNull(i)
                val v = call?.let { box(it, unit, kind, time, horizontalBox, center = !vertical) } ?: View(ctx)
                host.addView(v, if (vertical) LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { if (i > 0) topMargin = gap }
                    else LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply { if (i > 0) leftMargin = gap })
            }
        }

        val content = col().apply {
            setBackgroundColor(t.bg)
            setPadding(ins.left + gap, ins.top + gap, ins.right + gap, ins.bottom + gap)
        }
        val innerW = sw - ins.left - ins.right - 2 * gap
        val innerH = sh - ins.top - ins.bottom - 2 * gap
        fun detach(v: View) = (v.parent as? ViewGroup)?.removeView(v)
        detach(frame)
        val paint: (QueueState, TelaConfig) -> Unit

        when (style) {
            QueueLayout.TABLE -> {
                val top = row()
                top.addView(frame, lpW(64f))
                val tab = col()
                top.addView(tab, lpW(36f, left = gap))
                content.addView(top, lpH(1f))
                val foot = row()
                foot.addView(makeTicker(), lpW(1f))
                foot.addView(clockChip(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { leftMargin = gap })
                content.addView(foot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 8).toInt()).apply { topMargin = gap })
                paint = { s, _ -> table(tab, s, true, 4) }
            }
            QueueLayout.BIG -> {
                val r = row()
                val left = col()
                val kind = tv(u * 5f, t.text, true, Gravity.CENTER).apply { background = panelBg() }
                left.addView(kind, lpH(0.6f))
                left.addView(label("SENHA"), lpWrap(gap))
                val ticket = FrameLayout(ctx)
                left.addView(ticket, lpH(1.9f, gap / 2))
                left.addView(label("GUICHÊ"), lpWrap(gap))
                val desk = tv(u * 9f, t.text, true, Gravity.CENTER, 2).apply { background = panelBg() }
                left.addView(desk, lpH(1f, gap / 2))
                r.addView(left, lpW(58f))
                val right = col()
                right.addView(header(), lpWrap())
                val tab = col()
                right.addView(tab, lpH(1f, gap))
                r.addView(right, lpW(42f, left = gap))
                content.addView(r, lpH(1f))
                val leftW = (innerW * 0.58f).toInt()
                paint = { s, _ ->
                    val cur = s.current
                    kind.text = QueueLayout.kind(cur, title.uppercase())
                    ticket.removeAllViews()
                    val (bg, fg) = curColors(cur)
                    val tk = cur?.let { QueueLayout.who(it, false) } ?: "—"
                    ticket.addView(tv(minOf(u * 26f, leftW / (maxOf(tk.length, 3) * 0.62f)), fg, true, Gravity.CENTER).apply { text = tk; background = colorBg(bg) }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    val txt = cur?.let { QueueCallCard.text(it, showName) }
                    desk.text = listOfNotNull(txt?.desk?.ifEmpty { null } ?: "—", txt?.name).joinToString("\n")
                    table(tab, s, false, 6)
                }
            }
            QueueLayout.CARDS -> {
                content.addView(header(), lpWrap())
                val mid = row()
                mid.addView(frame, lpW(58f))
                val cur = FrameLayout(ctx)
                mid.addView(cur, lpW(42f, left = gap))
                content.addView(mid, lpH(1f, gap))
                content.addView(label("ÚLTIMAS SENHAS"), lpWrap(gap))
                val strip = row()
                content.addView(strip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 15).toInt()).apply { topMargin = gap / 2 })
                val curW = (innerW * 0.42f).toInt()
                paint = { s, _ -> bigCard(cur, s.current, curW - (u * 4).toInt(), u * 18f); boxes(strip, QueueLayout.previous(s, 5), 5, u * 5f, time = true) }
            }
            QueueLayout.HEADER -> {
                content.addView(header(), lpWrap())
                val body = row()
                val cur = FrameLayout(ctx)
                body.addView(cur, lpW(58f))
                val right = col()
                right.addView(label("ÚLTIMAS CHAMADAS"), lpWrap())
                val list = col()
                right.addView(list, lpWrap(gap / 2))
                right.addView(frame, lpH(1f, gap))
                body.addView(right, lpW(42f, left = gap))
                content.addView(body, lpH(1f, gap))
                val curW = (innerW * 0.58f).toInt()
                paint = { s, _ -> bigCard(cur, s.current, curW - (u * 4).toInt(), u * 24f, "Dirija-se ao local indicado"); boxes(list, QueueLayout.previous(s, 3), 3, u * 4.6f, vertical = true, horizontalBox = true) }
            }
            QueueLayout.INFO -> {
                val r = row()
                val left = col().apply { background = panelBg(); setPadding((u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt()) }
                left.addView(tv(u * 4f, t.text, true, lines = 3).apply { text = office }, lpWrap())
                clock = tv(u * 7f, t.text, true).also { left.addView(it, lpWrap(gap)) }
                date = tv(u * 2.4f, t.dim, lines = 2).also { left.addView(it, lpWrap()) }
                left.addView(View(ctx), lpH(1f))
                val leftW = (innerW * 0.28f).toInt() - (u * 4).toInt()
                left.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, leftW * 9 / 16))
                r.addView(left, lpW(28f))
                val bands = col()
                fun band(name: String, weight: Float): Pair<LinearLayout, TextView> {
                    val b = row().apply { background = panelBg(); clipToOutline = true }
                    b.addView(label(name, u * 2.8f, t.onColor).apply { gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(t.color); setPadding((u * 2).toInt(), 0, (u * 2).toInt(), 0) }, LinearLayout.LayoutParams((innerW * 0.17f).toInt(), ViewGroup.LayoutParams.MATCH_PARENT))
                    val v = tv(u * 7f, t.text, true, lines = 2).apply { setPadding((u * 2.4f).toInt(), 0, (u * 2).toInt(), 0) }
                    b.addView(v, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
                    bands.addView(b, lpH(weight, if (bands.childCount > 0) gap else 0))
                    return b to v
                }
                val (senhaBand, senha) = band("SENHA", 1.7f)
                val (_, atend) = band("ATENDIMENTO", 1f)
                val (_, local) = band("LOCAL", 1f)
                bands.addView(label("ANTERIORES", u * 2.2f), lpWrap(gap))
                val strip = row()
                bands.addView(strip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 11).toInt()).apply { topMargin = gap / 2 })
                r.addView(bands, lpW(72f, left = gap))
                content.addView(r, lpH(1f))
                val valueW = (innerW * 0.72f - innerW * 0.17f).toInt()
                paint = { s, _ ->
                    val cur = s.current
                    val (bg, fg) = curColors(cur)
                    senhaBand.background = colorBg(bg)
                    senha.setTextColor(fg)
                    val tk = cur?.let { QueueLayout.who(it, showName) } ?: "—"
                    senha.text = tk
                    senha.setTextSize(TypedValue.COMPLEX_UNIT_PX, minOf(u * 16f, valueW / (maxOf(tk.length, 3) * 0.62f)))
                    atend.text = cur?.service ?: QueueLayout.kind(cur, title)
                    local.text = cur?.let { QueueCallCard.text(it, false).desk }?.ifEmpty { "—" } ?: "—"
                    boxes(strip, QueueLayout.previous(s, 4), 4, u * 4f, horizontalBox = true)
                }
            }
            QueueLayout.MOSAIC -> {
                val top = row()
                val cur = FrameLayout(ctx)
                top.addView(cur, lpW(60f))
                top.addView(frame, lpW(40f, left = gap))
                content.addView(top, lpH(1f))
                val strip = row()
                content.addView(strip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 17).toInt()).apply { topMargin = gap })
                val foot = row().apply { gravity = Gravity.CENTER_VERTICAL; background = colorBg(t.color); setPadding((u * 2).toInt(), 0, (u * 2).toInt(), 0) }
                foot.addView(tv(u * 3.4f, t.onColor, true).apply { text = if (office == title) office else "$office · $title" }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                clock = tv(u * 4f, t.onColor, true, Gravity.END).also { foot.addView(it) }
                content.addView(foot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 7).toInt()).apply { topMargin = gap })
                val curW = (innerW * 0.6f).toInt()
                paint = { s, _ -> bigCard(cur, s.current, curW - (u * 4).toInt(), u * 22f); boxes(strip, QueueLayout.previous(s, 3), 3, u * 5.4f, kind = true) }
            }
            QueueLayout.DUO -> {
                content.addView(header(), lpWrap())
                val halves = row()
                content.addView(halves, lpH(1f, gap))
                content.addView(label("ÚLTIMAS CHAMADAS"), lpWrap(gap))
                val strip = row()
                content.addView(strip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 13).toInt()).apply { topMargin = gap / 2 })
                val halfW = (innerW - gap) / 2
                paint = { s, cfg ->
                    halves.removeAllViews()
                    val two = QueueLayout.duo(s.byService, cfg.queue.pair)
                    // servidor sem byService: uma metade só, com a senha atual e o título da fila
                    val shown: List<QueueServiceRow> = two.ifEmpty { listOf(QueueServiceRow(0, title, t.color, s.current, 0)) }
                    shown.forEachIndexed { i, svc ->
                        val h = col().apply {
                            gravity = Gravity.CENTER
                            background = QueueBoxes.rounded(t.panel, u * 1.2f, svc.color, (u * 0.6f).toInt())
                            setPadding((u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt(), (u * 2).toInt())
                        }
                        h.addView(tv(u * 3.6f, RiskColors.textOn(svc.color), true, Gravity.CENTER).apply {
                            text = svc.name.uppercase(); background = QueueBoxes.rounded(svc.color, u * 0.8f); setPadding((u * 2).toInt(), (u * 0.6f).toInt(), (u * 2).toInt(), (u * 0.6f).toInt())
                        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                        val call = svc.current
                        // ▶ na fila da chamada mais recente
                        val hot = call != null && s.current != null && call.id == s.current.id
                        val tk = (if (hot) "▶ " else "") + (call?.let { QueueLayout.who(it, false) } ?: "—")
                        h.addView(tv(minOf(u * 22f, (halfW - u * 4) / (maxOf(tk.length, 3) * 0.62f)), RiskColors.of(call?.risk) ?: t.text, true, Gravity.CENTER).apply { text = tk }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = gap })
                        call?.let { cl ->
                            val txt = QueueCallCard.text(cl, showName)
                            h.addView(tv(u * 5f, t.text, true, Gravity.CENTER).apply { text = txt.desk })
                            txt.name?.let { n -> h.addView(tv(u * 3.6f, t.dim, true, Gravity.CENTER).apply { text = n }) }
                            if (cl.risk != null) h.addView(tv(u * 2.6f, t.dim, true, Gravity.CENTER).apply { text = QueueLayout.kind(cl) })
                        }
                        halves.addView(h, lpW(1f, left = if (i > 0) gap else 0))
                    }
                    boxes(strip, QueueLayout.previous(s, 4), 4, u * 4.6f)
                }
            }
            QueueLayout.GRID -> {
                val top = row()
                top.addView(frame, lpW(45f))
                val grid = col()
                top.addView(grid, lpW(55f, left = gap))
                content.addView(top, lpH(1f))
                val foot = row().apply { gravity = Gravity.CENTER_VERTICAL; background = colorBg(t.color); setPadding((u * 2).toInt(), 0, (u * 2).toInt(), 0) }
                date = tv(u * 3f, t.onColor, true).also { foot.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)) }
                clock = tv(u * 4.2f, t.onColor, true, Gravity.END).also { foot.addView(it) }
                content.addView(foot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 7).toInt()).apply { topMargin = gap })
                paint = { s, _ ->
                    grid.removeAllViews()
                    val list = QueueLayout.grid(s.byService)
                    val rows = maxOf(1, minOf(4, (list.size + 1) / 2))
                    if (list.isEmpty()) grid.addView(tv(u * 4f, t.dim, true, Gravity.CENTER).apply { text = "Nenhuma fila ativa" }, lpH(1f))
                    for (r in 0 until rows) {
                        val line = row()
                        for (k in 0 until 2) {
                            val svc = list.getOrNull(r * 2 + k)
                            val cell: View = svc?.let { sv ->
                                val fg = RiskColors.textOn(sv.color)
                                col().apply {
                                    background = colorBg(sv.color)
                                    setPadding((u * 1.4f).toInt(), (u * 0.8f).toInt(), (u * 1.4f).toInt(), (u * 0.8f).toInt())
                                    gravity = Gravity.CENTER_VERTICAL
                                    addView(tv(u * 2.4f, fg, true).apply { text = sv.name.uppercase() })
                                    val call = sv.current
                                    val l2 = row().apply { gravity = Gravity.CENTER_VERTICAL }
                                    l2.addView(tv(u * 6f, fg, true).apply { text = call?.ticket ?: "—"; if (call != null) RiskColors.of(call.risk)?.let { rc -> setCompoundDrawablesRelative(dot(rc, u * 2.2f), null, null, null); compoundDrawablePadding = (u * 0.8f).toInt() } })
                                    l2.addView(tv(u * 2.8f, fg, true, Gravity.END or Gravity.CENTER_VERTICAL).apply { text = call?.desk ?: "" }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                                    addView(l2)
                                }
                            } ?: View(ctx)
                            line.addView(cell, lpW(1f, left = if (k > 0) gap else 0))
                        }
                        grid.addView(line, lpH(1f, if (r > 0) gap else 0))
                    }
                }
            }
            QueueLayout.LIST -> {
                val r = row()
                val left = col().apply { background = panelBg(); setPadding((u * 1.6f).toInt(), (u * 1.6f).toInt(), (u * 1.6f).toInt(), (u * 1.6f).toInt()) }
                left.addView(tv(u * 3.8f, t.text, true, lines = 2).apply { text = office }, lpWrap())
                left.addView(label("ÚLTIMAS CHAMADAS", u * 2.4f), lpWrap(gap))
                val list = col()
                left.addView(list, lpWrap(gap / 2))
                r.addView(left, lpW(32f))
                val right = col()
                val bar = FrameLayout(ctx)
                right.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 17).toInt()))
                right.addView(frame, lpH(1f, gap))
                r.addView(right, lpW(68f, left = gap))
                content.addView(r, lpH(1f))
                val foot = row()
                foot.addView(makeTicker(), lpW(1f))
                foot.addView(clockChip(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { leftMargin = gap })
                content.addView(foot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (u * 8).toInt()).apply { topMargin = gap })
                val barW = (innerW * 0.68f).toInt()
                paint = { s, _ ->
                    bar.removeAllViews()
                    val cur = s.current
                    val (bg, fg) = curColors(cur)
                    val b = row().apply { gravity = Gravity.CENTER_VERTICAL; background = colorBg(bg); setPadding((u * 2).toInt(), 0, (u * 2).toInt(), 0) }
                    b.addView(tv(u * 3f, fg, true).apply { text = QueueLayout.kind(cur, "SENHA"); letterSpacing = 0.06f }, LinearLayout.LayoutParams((barW * 0.24f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT))
                    val tk = cur?.let { QueueLayout.who(it, showName) } ?: "—"
                    b.addView(tv(minOf(u * 12f, barW * 0.42f / (maxOf(tk.length, 3) * 0.62f)), fg, true, Gravity.CENTER).apply { text = tk }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    b.addView(tv(u * 4.4f, fg, true, Gravity.END or Gravity.CENTER_VERTICAL, 2).apply { text = cur?.let { QueueCallCard.text(it, false).desk } ?: "" }, LinearLayout.LayoutParams((barW * 0.3f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT))
                    bar.addView(b, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    boxes(list, QueueLayout.previous(s, 4), 4, u * 5f, kind = true, vertical = true)
                }
            }
            QueueLayout.CLASSIC -> error("o painel queue é montado pelo MainActivity")
        }
        val root = FrameLayout(ctx)
        root.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // sem vídeo: a moldura fica com 1 px no canto (o tocador segue ligado; a tela mostra só a senha)
        if (!style.video) root.addView(frame, FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.START))
        return QueueBoard(root, clock, date, paint)
    }

    private fun dot(color: Int, size: Float) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
        setStroke(maxOf(1, (size / 10).toInt()), Color.WHITE)
        setBounds(0, 0, size.toInt(), size.toInt())
    }
}
