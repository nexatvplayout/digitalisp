package br.com.nexatv.telas.core

/**
 * A última hora boa que o aparelho conheceu: `wallMs` (hora certa) medida quando o relógio monotônico do aparelho
 * (SystemClock.elapsedRealtime) marcava `elapsedMs`, na ligada número `bootCount` (Settings.Global.BOOT_COUNT; -1 =
 * desconhecida).
 */
data class ClockAnchor(val wallMs: Long, val elapsedMs: Long, val bootCount: Int) {
    fun toWire(): String = "$wallMs,$elapsedMs,$bootCount"

    companion object {
        fun parse(raw: String?): ClockAnchor? {
            val p = raw?.split(',') ?: return null
            if (p.size != 3) return null
            val w = p[0].toLongOrNull() ?: return null
            val e = p[1].toLongOrNull() ?: return null
            val b = p[2].toIntOrNull() ?: return null
            return if (ClockCheck.wrong(w) || e < 0) null else ClockAnchor(w, e, b)
        }
    }
}

/**
 * Hora confiável para a tela, sem Android dentro (testável na JVM). Pedido do dono (14/11): sem internet, a tela continua
 * como estava. TV box sem bateria de relógio que reinicia sem rede liga em 1970/2015 e não tem como saber a hora; mas:
 * - sem reiniciar o aparelho (só o app caiu ou a rede saiu), a última hora boa + o tempo do relógio monotônico É a hora;
 * - depois de reiniciar, a hora é no MÍNIMO a última boa + o tempo desde que ligou (o aparelho ligou depois dela). Esse
 *   mínimo basta para saber que um alerta ou um caso já venceu; não basta para mostrar a hora nem para o horário de ligar.
 */
object TrustedClock {
    /** De quanto em quanto tempo regravar a âncora no disco (com o relógio andando normal). */
    const val SAVE_EVERY_MS = 60_000L

    /** Diferença entre a hora prevista pela âncora e a medida que conta como "o relógio foi acertado": regrava na hora. */
    const val DRIFT_MS = 5_000L

    /** Mesma ligada do aparelho? Sem o número da ligada, não dá para afirmar. */
    fun sameBoot(a: ClockAnchor, elapsedMs: Long, bootCount: Int): Boolean =
        bootCount >= 0 && a.bootCount == bootCount && elapsedMs >= a.elapsedMs

    /**
     * A hora certa agora, ou null se não há como saber.
     * @param correctedWallMs hora do aparelho já com a correção do servidor (Engine.clockOffset)
     */
    fun now(correctedWallMs: Long, elapsedMs: Long, bootCount: Int, anchor: ClockAnchor?): Long? = when {
        !ClockCheck.wrong(correctedWallMs) -> correctedWallMs
        anchor != null && sameBoot(anchor, elapsedMs, bootCount) -> anchor.wallMs + (elapsedMs - anchor.elapsedMs)
        else -> null
    }

    /** O mínimo que a hora pode ser agora (para vencimentos); null sem âncora nenhuma. */
    fun floor(elapsedMs: Long, bootCount: Int, anchor: ClockAnchor?): Long? = when {
        anchor == null -> null
        sameBoot(anchor, elapsedMs, bootCount) -> anchor.wallMs + (elapsedMs - anchor.elapsedMs)
        else -> anchor.wallMs + elapsedMs.coerceAtLeast(0L)
    }

    /**
     * A hora para decidir o que já venceu (alertas, desaparecidos, clima): a certa; sem ela, o mínimo; sem nada, 0 (nada
     * vence: a tela mostra o último estado guardado até a hora voltar).
     */
    fun forExpiry(now: Long?, floor: Long?): Long = now ?: floor ?: 0L

    /** Regravar a âncora? Na 1ª vez, em outra ligada, com o relógio acertado (salto) ou a cada [SAVE_EVERY_MS]. */
    fun shouldSave(prev: ClockAnchor?, next: ClockAnchor): Boolean {
        if (ClockCheck.wrong(next.wallMs)) return false
        if (prev == null || prev.bootCount != next.bootCount || next.elapsedMs < prev.elapsedMs) return true
        val predicted = prev.wallMs + (next.elapsedMs - prev.elapsedMs)
        return kotlin.math.abs(next.wallMs - predicted) >= DRIFT_MS || next.elapsedMs - prev.elapsedMs >= SAVE_EVERY_MS
    }
}
