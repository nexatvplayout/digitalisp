package br.com.nexatv.telas.core

/** O que a tela mostra quando o relógio do aparelho está errado (ou o https recusa o certificado pela data). */
enum class ClockView { NORMAL, LOADING, MESSAGE }

/**
 * TV box sem bateria de relógio liga com a data errada e acerta pela rede (NTP) alguns segundos depois. Nesse intervalo
 * o https recusa o certificado ("ainda não é válido"). Pedido do dono (14/11): na partida isso é "Carregando…", não erro.
 * Só depois de [GRACE_MS] com o relógio ainda errado a tela diz o que fazer.
 */
object StartupClock {
    /** Prazo depois de ligar o aparelho ou abrir o app em que relógio errado = carregando. */
    const val GRACE_MS = 60_000L

    /** Nesse prazo, de quanto em quanto tempo tentar de novo (servidor e vídeo). */
    const val RETRY_MS = 2_500L

    /** Salto do relógio de parede (comparado ao relógio monotônico) que conta como "o relógio foi acertado". */
    const val JUMP_MS = 60_000L

    const val LOADING_TEXT = "Carregando…"
    const val MESSAGE_TEXT = "Acertando o relógio do aparelho… confira a internet."

    /**
     * sinceBootMs: SystemClock.elapsedRealtime() (tempo desde que o aparelho ligou); sinceAppMs: desde que o app abriu.
     * clockWrong: a data do aparelho é absurda; certTimeError: o último https falhou pelo certificado por causa da data.
     */
    fun view(sinceBootMs: Long, sinceAppMs: Long, clockWrong: Boolean, certTimeError: Boolean): ClockView = when {
        !clockWrong && !certTimeError -> ClockView.NORMAL
        sinceBootMs < GRACE_MS || sinceAppMs < GRACE_MS -> ClockView.LOADING
        else -> ClockView.MESSAGE
    }

    /** O relógio de parede andou diferente do monotônico (acerto pela rede ou à mão)? */
    fun jumped(prevWallMs: Long, prevElapsedMs: Long, wallMs: Long, elapsedMs: Long): Boolean =
        kotlin.math.abs((wallMs - prevWallMs) - (elapsedMs - prevElapsedMs)) >= JUMP_MS
}
