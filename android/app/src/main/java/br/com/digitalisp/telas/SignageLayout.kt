package br.com.digitalisp.telas

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import android.widget.FrameLayout
import br.com.digitalisp.telas.core.Insets
import br.com.digitalisp.telas.core.ShapeCmd
import br.com.digitalisp.telas.core.Shapes
import br.com.digitalisp.telas.core.SignWeather
import br.com.digitalisp.telas.core.Wall
import br.com.digitalisp.telas.core.WeatherCfg
import br.com.digitalisp.telas.core.Signage
import br.com.digitalisp.telas.core.SignageBlock
import br.com.digitalisp.telas.core.SignageCfg
import br.com.digitalisp.telas.core.SignageItem
import br.com.digitalisp.telas.core.SignageZone

/** A composição montada de um bloco: a raiz, se tem a zona do vídeo e o tique de 1 s das zonas com hora. */
class SignageBuilt(val root: View, val block: SignageBlock, private val lists: List<SignPlaylistView>) {
    val hasVideo: Boolean get() = block.layout.hasVideo

    fun tick() {
        for (l in lists) l.tick()
    }
}

/**
 * Monta as zonas do bloco num FrameLayout, por porcentagem da tela (docs/TV-CORPORATIVA.md §4.1). A zona `video` recebe
 * a MESMA moldura do vídeo de sempre (o player não muda); sem zona de vídeo, a moldura fica embaixo de tudo, coberta.
 */
object SignageLayout {
    /** O que vem da tela principal: a faixa de avisos e o painel da senha já existentes. */
    interface Hooks {
        /** A faixa de avisos (texto rolante da configuração); null = sem avisos. */
        fun ticker(edge: Insets): View?
        /** A senha (o mesmo widget da coluna lateral); null = a unidade não tem a senha ligada. */
        fun queue(w: Int, h: Int, edge: Insets): View?
        /** O endereço do QR da coluna lateral (para a zona `qr` sem endereço próprio). */
        fun qrUrl(): String?
        /** O clima da tela (o da configuração, ou o último bom guardado), para a zona `weather`. */
        fun weather(): WeatherCfg? = null
    }

    /** O clima da configuração no formato do item (com a foto do tempo, se o servidor mandou). */
    fun weatherItem(w: WeatherCfg?): SignWeather? = w?.let {
        SignWeather(it.city, it.tempC, null, null, it.icon, it.condition, emptyList(), "", it.art, it.artPort, it.at)
    }

    /** Retângulo da zona em pixels; as bordas são arredondadas do mesmo jeito, então zonas vizinhas encostam. */
    fun rect(z: SignageZone, sw: Int, sh: Int): IntArray {
        val l = sw * z.x / 100
        val t = sh * z.y / 100
        val r = sw * (z.x + z.w) / 100
        val b = sh * (z.y + z.h) / 100
        return intArrayOf(l, t, r, b)
    }

    /** A margem do overscan só nos lados da zona que encostam na borda da tela. */
    fun edge(z: SignageZone, ins: Insets): Insets = Insets(
        if (z.x == 0) ins.left else 0,
        if (z.y == 0) ins.top else 0,
        if (z.x + z.w >= 100) ins.right else 0,
        if (z.y + z.h >= 100) ins.bottom else 0,
    )

    fun build(
        ctx: Context, s: SignageCfg, block: SignageBlock, sw: Int, sh: Int, ins: Insets,
        frame: VideoFrame, env: SignEnv, hooks: Hooks,
    ): SignageBuilt {
        val outer = FrameLayout(ctx)
        val lists = ArrayList<SignPlaylistView>()
        // o conteúdo fixo das zonas (relógio, logomarca…) não entra no relatório de exibição
        val quiet = SignEnv(env.look, env.tz, env.now, env.clockOk, env.weather, env.file, { }, { _, _ -> }, env.volume)
        // videowall: o layout no tamanho do conjunto inteiro; esta TV mostra só a janela dela (o resto fica cortado)
        val wall = s.wall
        val win = if (wall != null && wall.videowall) Wall.window(wall) else null
        val cw = if (win != null) Math.round(sw * win.scaleX / 100f) else sw
        val ch = if (win != null) Math.round(sh * win.scaleY / 100f) else sh
        val root = if (win == null) outer else FrameLayout(ctx).also {
            outer.addView(it, FrameLayout.LayoutParams(cw, ch).apply {
                leftMargin = Math.round(sw * win.offsetX / 100f)
                topMargin = Math.round(sh * win.offsetY / 100f)
            })
        }
        val syncEpoch = wall?.takeIf { it.sync }?.epoch
        val ins0 = if (win != null) Insets(0, 0, 0, 0) else ins
        if (!block.layout.hasVideo) {
            // sem zona de vídeo: a moldura continua existindo (o player é o mesmo), embaixo de um fundo que a cobre
            root.addView(frame, FrameLayout.LayoutParams(cw, ch))
        }
        root.addView(View(ctx).apply { setBackgroundColor(env.look.bg) }, FrameLayout.LayoutParams(cw, ch))
        for (z in block.layout.zones) {
            val (l, t, r, b) = rect(z, cw, ch).let { listOf(it[0], it[1], it[2], it[3]) }
            val w = r - l
            val h = b - t
            if (w <= 0 || h <= 0) continue
            val lp = FrameLayout.LayoutParams(w, h).apply {
                leftMargin = l
                topMargin = t
            }
            val e = edge(z, ins0)
            // a zona por cima (gadget sobre a imagem ou o vídeo): fundo escuro translúcido e o texto claro
            val zEnv = if (z.overlay) overlayEnv(env, z.opacity) else env
            val zQuiet = if (z.overlay) overlayEnv(quiet, z.opacity) else quiet
            val items = block.zones[z.id].orEmpty().map { if (it.kind == "logo") it.copy(file = s.brand.logo) else it }
            val v: View? = when {
                z.kind == Signage.ZONE_VIDEO -> frame
                z.kind == Signage.ZONE_TICKER -> hooks.ticker(e)
                z.kind == Signage.ZONE_QUEUE -> hooks.queue(w, h, e)
                items.isNotEmpty() -> SignPlaylistView(ctx, items, zEnv, e, syncEpoch).also { lists.add(it) }
                else -> fixed(z, s, hooks)?.let { SignPlaylistView(ctx, listOf(it), zQuiet, e).also { p -> lists.add(p) } }
            }
            if (v == null) continue
            if (v === frame) frame.cover = z.cover // proporcional por padrão; cortando as bordas só com `fit: 'cover'`
            if (z.shape.isEmpty()) {
                root.addView(v, lp)
            } else {
                // recorte não retangular e o filete: a moldura recorta o que está dentro (o vídeo usa TextureView)
                if (v === frame) frame.forceTexture = true
                (v.parent as? android.view.ViewGroup)?.removeView(v)
                val sf = ShapeFrame(ctx, z.shape, z.edgeColor, z.edgeWidth / 100f * sh)
                sf.addView(v, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                root.addView(sf, lp)
            }
        }
        return SignageBuilt(outer, block, lists)
    }

    private fun overlayEnv(env: SignEnv, opacity: Int): SignEnv {
        val a = (opacity.coerceIn(0, 100) * 255 / 100) shl 24
        val look = env.look.copy(bg = a or 0x020617, text = 0xFFF8FAFC.toInt(), dim = 0xFFE2E8F0.toInt(), panel = 0x33FFFFFF, line = 0x33FFFFFF, light = false)
        return SignEnv(look, env.tz, env.now, env.clockOk, env.weather, env.file, env.onShown, env.onTime, env.volume)
    }

    /** O conteúdo de uma zona sem playlist: relógio, clima, QR, logomarca ou o texto fixo. */
    private fun fixed(z: SignageZone, s: SignageCfg, hooks: Hooks): SignageItem? = when (z.kind) {
        "clock" -> SignageItem(z.id, "clock", 60)
        "weather" -> SignageItem(z.id, "weather", 60, weather = weatherItem(hooks.weather()))
        "qr" -> (z.qr ?: hooks.qrUrl())?.let { SignageItem(z.id, "qr", 60, qr = it, title = z.title) }
        "logo" -> s.brand.logo?.let { SignageItem(z.id, "logo", 60, file = it) }
        "text" -> if (z.text.isNotEmpty() || z.title.isNotEmpty()) SignageItem(z.id, "text", 60, title = z.title, text = z.text) else null
        else -> null
    }
}

/**
 * A zona com formato (`zone.shape`): recorta o que está dentro no caminho do formato (core/Shapes) e desenha o filete
 * (`zone.edge`) por cima. [edgePx] = 0: sem filete.
 */
class ShapeFrame(ctx: Context, private val shape: String, edgeColor: Int, private val edgePx: Float) : FrameLayout(ctx) {
    private val clip = Path()
    private val edge = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = edgeColor
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    init {
        setWillNotDraw(false)
        clipChildren = true
    }

    private fun build(path: Path, cmds: List<ShapeCmd>?) {
        path.reset()
        for (c in cmds ?: return) when (c) {
            is ShapeCmd.M -> path.moveTo(c.x, c.y)
            is ShapeCmd.L -> path.lineTo(c.x, c.y)
            is ShapeCmd.C -> path.cubicTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
            ShapeCmd.Z -> path.close()
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        build(clip, Shapes.commands(shape, w.toFloat(), h.toFloat()))
        build(edge, Shapes.edgeCommands(shape, w.toFloat(), h.toFloat()))
    }

    override fun dispatchDraw(canvas: Canvas) {
        if (clip.isEmpty) {
            super.dispatchDraw(canvas)
        } else {
            val n = canvas.save()
            canvas.clipPath(clip)
            super.dispatchDraw(canvas)
            canvas.restoreToCount(n)
        }
        if (edgePx > 0f && !edge.isEmpty) {
            paint.strokeWidth = edgePx
            canvas.drawPath(edge, paint)
        }
    }
}
