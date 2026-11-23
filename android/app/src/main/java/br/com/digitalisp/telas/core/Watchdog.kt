package br.com.digitalisp.telas.core

enum class Source(val wire: String) { HLS("hls"), BACKUP("backup"), OFFLINE("offline") }

sealed class WdAction {
    /** Nada a fazer neste tique. */
    object None : WdAction()

    /** (Re)carregar esta fonte no player. */
    data class Play(val source: Source) : WdAction()

    /** Conferir por fora do player se o ao vivo voltou; a resposta entra por [Watchdog.onProbe]. */
    object ProbeLive : WdAction()

    /** Só voltar à ponta do ao vivo (seekToDefaultPosition + prepare), sem contar como recarga que falhou. */
    object Resync : WdAction()
}

/**
 * Vigia do player, sem Android dentro (testável na JVM).
 *
 * - posição parada por [stallMs] com o player devendo tocar, ou erro do player: recarrega;
 * - depois de [maxReloads] recargas sem sucesso: principal → reserva → vídeos guardados;
 * - sem rede: direto para os vídeos guardados (se houver);
 * - fora do principal: confere o ao vivo a cada [retryMs]; se a volta ao ao vivo falhar de novo sem ter
 *   estabilizado, o intervalo dobra até [maxRetryMs] para não ficar trocando de fonte sem parar.
 */
class Watchdog(
    private val stallMs: Long = 10_000L,
    private val maxReloads: Int = 3,
    private val retryMs: Long = 30_000L,
    private val maxRetryMs: Long = 240_000L,
    private val maxResyncs: Int = 5,
) {
    var source: Source = Source.HLS
        private set
    var failedReloads = 0
        private set
    var hasMain = false
    var hasBackup = false
    var hasOffline = false

    /**
     * A internet caiu (o servidor não responde por falha de rede), mesmo com o Wi-Fi/cabo ligado: a 1ª recarga que falhar
     * já vai para os vídeos guardados, sem gastar as recargas e a reserva com a tela parada (1.2.6, pedido do dono).
     */
    var internetDown = false

    private var lastPos = Long.MIN_VALUE
    private var lastAdvanceAt = 0L
    private var loadedAt = 0L
    private var lastProbeAt = 0L
    private var probeEvery = retryMs
    private var returnedByProbe = false
    private var resyncs = 0
    private var streak = 0

    val probeIntervalMs: Long get() = probeEvery

    private fun mark(now: Long) {
        lastPos = Long.MIN_VALUE
        lastAdvanceAt = now
        loadedAt = now
    }

    /** Começo (ou configuração nova): escolhe a primeira fonte que existe; sem rede, direto os vídeos guardados. */
    fun start(now: Long, networkUp: Boolean = true): WdAction {
        source = when {
            (!networkUp || internetDown) && hasOffline -> Source.OFFLINE
            hasMain -> Source.HLS
            hasBackup -> Source.BACKUP
            else -> Source.OFFLINE
        }
        failedReloads = 0
        resyncs = 0
        probeEvery = retryMs
        returnedByProbe = false
        lastProbeAt = now
        mark(now)
        return WdAction.Play(source)
    }

    /** Depois de uma pausa (fora do horário, tela de ajustes): não contar o tempo parado como travamento. */
    fun resume(now: Long) {
        lastAdvanceAt = now
    }

    fun onError(now: Long): WdAction = fail(now)

    /**
     * Erro que se resolve voltando à ponta do ao vivo (ver [PlayerErrors]): o servidor mantém o HLS vivo com uma
     * cartela enquanto o canal está parado e, na volta, a sequência de segmentos salta. Não conta para a troca de
     * fonte. Só se repetir [maxResyncs] vezes seguidas sem o vídeo andar nada é que vira uma falha de verdade.
     */
    fun onResync(now: Long): WdAction {
        if (source == Source.OFFLINE) return fail(now)
        resyncs++
        if (resyncs > maxResyncs) {
            resyncs = 0
            return fail(now)
        }
        streak = 0
        lastAdvanceAt = now
        return WdAction.Resync
    }

    /**
     * Um tique por segundo. `position` é qualquer número que MUDA enquanto o vídeo anda (não precisa crescer: o app
     * manda a contagem de quadros decodificados, que segue andando nas descontinuidades do HLS e zera na recarga).
     */
    fun tick(now: Long, position: Long, networkUp: Boolean): WdAction {
        if (position != lastPos) {
            lastPos = position
            lastAdvanceAt = now
            if (++streak >= 3) resyncs = 0 // andou três tiques seguidos: está tocando
            if (source != Source.OFFLINE && now - loadedAt >= stallMs) {
                failedReloads = 0
                if (source == Source.HLS) {
                    probeEvery = retryMs
                    returnedByProbe = false
                }
            }
        } else {
            streak = 0
        }
        if (source != Source.OFFLINE && !networkUp && hasOffline) return switchTo(Source.OFFLINE, now)
        if (now - lastAdvanceAt >= stallMs) return fail(now)
        if (source != Source.HLS && networkUp && (hasMain || hasBackup) && now - lastProbeAt >= probeEvery) {
            lastProbeAt = now
            return WdAction.ProbeLive
        }
        return WdAction.None
    }

    /** Resultado da conferência por fora: volta ao principal se respondeu; dos guardados, aceita a reserva. */
    fun onProbe(now: Long, mainOk: Boolean, backupOk: Boolean): WdAction {
        if (source == Source.HLS) return WdAction.None
        if (mainOk && hasMain) {
            returnedByProbe = true
            return enter(Source.HLS, now)
        }
        if (backupOk && hasBackup && source == Source.OFFLINE) return enter(Source.BACKUP, now)
        return WdAction.None
    }

    private fun enter(next: Source, now: Long): WdAction {
        source = next
        failedReloads = 0
        resyncs = 0
        lastProbeAt = now
        mark(now)
        return WdAction.Play(next)
    }

    private fun switchTo(next: Source, now: Long): WdAction {
        if (source == Source.HLS && next != Source.HLS && returnedByProbe) {
            probeEvery = (probeEvery * 2).coerceAtMost(maxRetryMs)
            returnedByProbe = false
        }
        return enter(next, now)
    }

    private fun fail(now: Long): WdAction {
        if (source == Source.OFFLINE) {
            mark(now)
            return WdAction.Play(Source.OFFLINE)
        }
        failedReloads++
        if (internetDown && hasOffline) return switchTo(Source.OFFLINE, now)
        if (failedReloads <= maxReloads) {
            mark(now)
            return WdAction.Play(source)
        }
        val next = when (source) {
            Source.HLS -> if (hasBackup) Source.BACKUP else if (hasOffline) Source.OFFLINE else Source.HLS
            else -> if (hasOffline) Source.OFFLINE else if (hasMain) Source.HLS else Source.BACKUP
        }
        return switchTo(next, now)
    }
}

/** O que fazer com um erro do player. */
enum class ErrorKind {
    /** Voltar à ponta do ao vivo na hora, sem contar como recarga que falhou. */
    RESYNC,

    /** Recarregar a fonte (conta para a troca principal → reserva → guardados). */
    RELOAD,
}

object PlayerErrors {
    // códigos do Media3 (PlaybackException.ERROR_CODE_*), repetidos aqui para o teste não depender do Android
    const val BEHIND_LIVE_WINDOW = 1002
    const val PARSING_CONTAINER_MALFORMED = 3001
    const val PARSING_MANIFEST_MALFORMED = 3002

    private val RESYNC_CAUSES = setOf("BehindLiveWindowException", "PlaylistStuckException", "PlaylistResetException", "ParserException")

    /**
     * @param code PlaybackException.errorCode
     * @param causes nomes simples das classes da cadeia de causas do erro
     *
     * RESYNC: o player ficou atrás da janela do ao vivo (a sequência saltou), a lista parou de andar/foi reiniciada
     * ou veio malformada num instante de troca. O resto (rede, HTTP 4xx/5xx, decodificador, formato não suportado)
     * é RELOAD.
     */
    fun classify(code: Int, causes: List<String>): ErrorKind = when {
        code == BEHIND_LIVE_WINDOW || code == PARSING_CONTAINER_MALFORMED || code == PARSING_MANIFEST_MALFORMED -> ErrorKind.RESYNC
        causes.any { it in RESYNC_CAUSES } -> ErrorKind.RESYNC
        else -> ErrorKind.RELOAD
    }
}
