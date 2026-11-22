package br.com.nexatv.telas

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import br.com.nexatv.telas.core.Insets
import br.com.nexatv.telas.core.Signage
import br.com.nexatv.telas.core.SignageBlock
import br.com.nexatv.telas.core.SignageCfg
import br.com.nexatv.telas.core.SignageItem
import br.com.nexatv.telas.core.SignageZone

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
        val root = FrameLayout(ctx)
        val lists = ArrayList<SignPlaylistView>()
        // o conteúdo fixo das zonas (relógio, logomarca…) não entra no relatório de exibição
        val quiet = SignEnv(env.look, env.tz, env.now, env.clockOk, env.weather, env.file, { }, { _, _ -> })
        if (!block.layout.hasVideo) {
            // sem zona de vídeo: a moldura continua existindo (o player é o mesmo), embaixo de um fundo que a cobre
            root.addView(frame, FrameLayout.LayoutParams(sw, sh))
        }
        root.addView(View(ctx).apply { setBackgroundColor(env.look.bg) }, FrameLayout.LayoutParams(sw, sh))
        for (z in block.layout.zones) {
            val (l, t, r, b) = rect(z, sw, sh).let { listOf(it[0], it[1], it[2], it[3]) }
            val w = r - l
            val h = b - t
            if (w <= 0 || h <= 0) continue
            val lp = FrameLayout.LayoutParams(w, h).apply {
                leftMargin = l
                topMargin = t
            }
            val e = edge(z, ins)
            val items = block.zones[z.id].orEmpty().map { if (it.kind == "logo") it.copy(file = s.brand.logo) else it }
            val v: View? = when {
                z.kind == Signage.ZONE_VIDEO -> frame
                z.kind == Signage.ZONE_TICKER -> hooks.ticker(e)
                z.kind == Signage.ZONE_QUEUE -> hooks.queue(w, h, e)
                items.isNotEmpty() -> SignPlaylistView(ctx, items, env, e).also { lists.add(it) }
                else -> fixed(z, s, hooks)?.let { SignPlaylistView(ctx, listOf(it), quiet, e).also { p -> lists.add(p) } }
            }
            if (v != null) root.addView(v, lp)
        }
        return SignageBuilt(root, block, lists)
    }

    /** O conteúdo de uma zona sem playlist: relógio, clima, QR, logomarca ou o texto fixo. */
    private fun fixed(z: SignageZone, s: SignageCfg, hooks: Hooks): SignageItem? = when (z.kind) {
        "clock" -> SignageItem(z.id, "clock", 60)
        "weather" -> SignageItem(z.id, "weather", 60)
        "qr" -> (z.qr ?: hooks.qrUrl())?.let { SignageItem(z.id, "qr", 60, qr = it, title = z.title) }
        "logo" -> s.brand.logo?.let { SignageItem(z.id, "logo", 60, file = it) }
        "text" -> if (z.text.isNotEmpty() || z.title.isNotEmpty()) SignageItem(z.id, "text", 60, title = z.title, text = z.text) else null
        else -> null
    }
}
