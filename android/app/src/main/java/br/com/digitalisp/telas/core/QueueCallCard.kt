package br.com.digitalisp.telas.core

/** O texto da senha chamada, como aparece no painel de senha e no cartão por cima do vídeo. */
data class CallCardText(val ticket: String, val desk: String, val name: String?)

/** Cores do bloco da senha: fundo, texto (senha, guichê, nome) e rótulo ("SENHA", título). */
data class QueueColors(val bg: Int, val text: Int, val label: Int) {
    companion object {
        const val HOT_BG = 0xFFFFD166.toInt()
        const val DARK = 0xFF1A1A1A.toInt()
        const val DARK_LABEL = 0xFF4A3A10.toInt()
        const val WHITE = 0xFFFFFFFF.toInt()
        const val MUTED = 0xFFB8C4D6.toInt()

        /**
         * No destaque (10 s) o bloco fica amarelo FIXO e TODO texto dentro dele fica escuro (branco ou cinza-claro sobre
         * amarelo não se lê); fora do destaque, o fundo escuro de sempre com texto branco.
         */
        fun of(hot: Boolean, idleBg: Int): QueueColors =
            if (hot) QueueColors(HOT_BG, DARK, DARK_LABEL) else QueueColors(idleBg, WHITE, MUTED)

        /** Contraste WCAG entre duas cores ARGB opacas (1 a 21). */
        fun contrast(a: Int, b: Int): Double {
            fun lum(c: Int): Double {
                fun ch(v: Int): Double {
                    val s = v / 255.0
                    return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
                }
                return 0.2126 * ch((c shr 16) and 0xFF) + 0.7152 * ch((c shr 8) and 0xFF) + 0.0722 * ch(c and 0xFF)
            }
            val (x, y) = lum(a) to lum(b)
            return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
        }
    }
}

/**
 * O visual do cartão da chamada (contrato §13): a cor da classificação de risco como fundo e a linha em palavras (quem
 * não distingue as cores lê o nível). Sem risco: o amarelo do destaque; prioritária sem risco: "PREFERENCIAL".
 */
data class CallCardStyle(val bg: Int, val text: Int, val label: Int, val headline: String)

object RiskColors {
    const val VERMELHO = 0xFFD92D20.toInt()
    const val LARANJA = 0xFFF97316.toInt()
    const val AMARELO = 0xFFFACC15.toInt()
    const val VERDE = 0xFF16A34A.toInt()
    const val AZUL = 0xFF2563EB.toInt()

    /** A cor de cada nível; null para o que não é uma das cinco. */
    fun of(risk: String?): Int? = when (risk) {
        "vermelho" -> VERMELHO
        "laranja" -> LARANJA
        "amarelo" -> AMARELO
        "verde" -> VERDE
        "azul" -> AZUL
        else -> null
    }

    /** O nível em palavras (Protocolo de Manchester), com o nome da cor. */
    fun words(risk: String?): String? = when (risk) {
        "vermelho" -> "EMERGÊNCIA · VERMELHO"
        "laranja" -> "MUITO URGENTE · LARANJA"
        "amarelo" -> "URGENTE · AMARELO"
        "verde" -> "POUCO URGENTE · VERDE"
        "azul" -> "NÃO URGENTE · AZUL"
        else -> null
    }

    /**
     * Texto sobre a cor: branco quando ele tem contraste de pelo menos 4,5 (WCAG AA); senão o escuro. Na prática: branco
     * no vermelho e no azul; escuro no amarelo, no laranja (branco daria 2,8) e no verde (branco daria 3,3).
     */
    fun textOn(bg: Int): Int =
        if (QueueColors.contrast(QueueColors.WHITE, bg) >= 4.5) QueueColors.WHITE else QueueColors.DARK

    fun style(call: QueueCall): CallCardStyle {
        val bg = of(call.risk)
        if (bg != null) {
            val text = textOn(bg)
            return CallCardStyle(bg, text, text, words(call.risk)!!)
        }
        return CallCardStyle(QueueColors.HOT_BG, QueueColors.DARK, QueueColors.DARK_LABEL, if (call.priority) "PREFERENCIAL" else "SENHA")
    }
}

/**
 * Chamada de senha em destaque em QUALQUER layout (contrato §7.2: "Na chamada o app mostra a senha em destaque por 10 s").
 *
 * 1.2.2, pedido do dono: na chamada (nova ou repetida) o cartão amarelo ocupa a TELA INTEIRA por 10 s em todos os layouts,
 * inclusive `queue` e `side` com o widget; a coluna e o painel ficam só com o estado normal (sem pintar de amarelo). O alerta em
 * tela cheia continua por cima do cartão.
 */
object QueueCallCard {
    /** Mostrar o cartão agora? Com a chamada de senha ligada, uma chamada em destaque e a tela dentro do horário. */
    fun show(c: TelaConfig?, state: QueueState, now: Long, scheduleOn: Boolean, block: SignageBlock? = null): Boolean =
        c != null && callsHere(c, block) && scheduleOn && QueueReducer.highlighted(state, now)

    /** A chamada de senha vale no layout no ar? Ligada na tela e, na TV Corporativa, só no layout com a zona de senha. */
    fun callsHere(c: TelaConfig, block: SignageBlock?): Boolean = c.queue.enabled && (block == null || block.layout.hasQueue)

    /** Mesmas regras de texto do painel de senha: guichê, "preferencial" e o nome (só com `showName` e nome). */
    fun text(call: QueueCall, showName: Boolean): CallCardText = CallCardText(
        ticket = call.ticket,
        desk = when {
            call.priority && call.desk.isNotEmpty() -> "${call.desk} · preferencial"
            call.priority -> "Preferencial"
            else -> call.desk
        },
        name = if (showName && !call.name.isNullOrBlank()) call.name.trim() else null,
    )
}
