package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchdogTest {
    private fun wd(main: Boolean = true, backup: Boolean = false, offline: Boolean = false) =
        Watchdog().apply { hasMain = main; hasBackup = backup; hasOffline = offline }

    /** Toca normalmente de `from` até `to` (posição andando a cada segundo). */
    private fun play(w: Watchdog, from: Long, to: Long, net: Boolean = true): List<WdAction> {
        val out = ArrayList<WdAction>()
        var t = from
        while (t <= to) {
            out.add(w.tick(t, t, net))
            t += 1000
        }
        return out
    }

    /** Fica travado (mesma posição) de `from` até `to`. */
    private fun stall(w: Watchdog, from: Long, to: Long, pos: Long = 42, net: Boolean = true): List<WdAction> {
        val out = ArrayList<WdAction>()
        var t = from
        while (t <= to) {
            out.add(w.tick(t, pos, net))
            t += 1000
        }
        return out
    }

    @Test fun comecaNoPrincipal() {
        val w = wd(backup = true, offline = true)
        assertEquals(WdAction.Play(Source.HLS), w.start(0))
        assertEquals(Source.HLS, w.source)
    }

    @Test fun semPrincipalComecaNaReservaOuNosGuardados() {
        assertEquals(WdAction.Play(Source.BACKUP), wd(main = false, backup = true).start(0))
        assertEquals(WdAction.Play(Source.OFFLINE), wd(main = false, offline = true).start(0))
    }

    @Test fun andandoNaoFazNada() {
        val w = wd()
        w.start(0)
        assertTrue(play(w, 1000, 120_000).all { it == WdAction.None })
        assertEquals(0, w.failedReloads)
    }

    @Test fun paradoDezSegundosRecarrega() {
        val w = wd()
        w.start(0)
        play(w, 1000, 20_000)
        val acts = stall(w, 21_000, 30_000, pos = 20_000)
        // último avanço em 20 s; aos 30 s completa 10 s parado
        assertTrue(acts.dropLast(1).all { it == WdAction.None })
        assertEquals(WdAction.Play(Source.HLS), acts.last())
        assertEquals(1, w.failedReloads)
    }

    @Test fun tresRecargasDepoisReserva() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        assertEquals(WdAction.Play(Source.HLS), w.onError(1000))
        assertEquals(WdAction.Play(Source.HLS), w.onError(2000))
        assertEquals(WdAction.Play(Source.HLS), w.onError(3000))
        assertEquals(WdAction.Play(Source.BACKUP), w.onError(4000))
        assertEquals(Source.BACKUP, w.source)
        assertEquals(0, w.failedReloads)
    }

    @Test fun reservaTambemCaiVaiParaGuardados() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        repeat(4) { w.onError(1000) }
        repeat(3) { assertEquals(WdAction.Play(Source.BACKUP), w.onError(2000)) }
        assertEquals(WdAction.Play(Source.OFFLINE), w.onError(3000))
        // nos guardados, erro só passa adiante (não troca de fonte)
        assertEquals(WdAction.Play(Source.OFFLINE), w.onError(4000))
        assertEquals(Source.OFFLINE, w.source)
    }

    @Test fun semReservaNemGuardadosInsisteNoPrincipal() {
        val w = wd()
        w.start(0)
        repeat(10) { assertEquals(WdAction.Play(Source.HLS), w.onError(1000L * it)) }
        assertEquals(Source.HLS, w.source)
    }

    @Test fun semReservaVaiDiretoParaGuardados() {
        val w = wd(offline = true)
        w.start(0)
        repeat(3) { w.onError(1000) }
        assertEquals(WdAction.Play(Source.OFFLINE), w.onError(2000))
    }

    @Test fun recargaQueDeuCertoZeraAContagem() {
        val w = wd(backup = true)
        w.start(0)
        w.onError(1000)
        w.onError(2000)
        assertEquals(2, w.failedReloads)
        play(w, 3000, 20_000) // tocou mais de 10 s seguidos
        assertEquals(0, w.failedReloads)
        // precisa de novo de 3 recargas antes de ir para a reserva
        repeat(3) { assertEquals(WdAction.Play(Source.HLS), w.onError(21_000)) }
        assertEquals(WdAction.Play(Source.BACKUP), w.onError(22_000))
    }

    @Test fun tocarPoucoNaoZera() {
        val w = wd(backup = true)
        w.start(0)
        w.onError(1000)
        play(w, 2000, 5000) // só 4 s depois da recarga
        assertEquals(1, w.failedReloads)
    }

    @Test fun semRedeVaiParaGuardados() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        assertEquals(WdAction.Play(Source.OFFLINE), w.tick(1000, 0, false))
        // sem rede não confere o ao vivo
        assertTrue(play(w, 2000, 120_000, net = false).all { it == WdAction.None })
    }

    @Test fun semRedeESemGuardadosFicaTentando() {
        val w = wd()
        w.start(0)
        val acts = stall(w, 1000, 11_000, net = false)
        assertEquals(WdAction.Play(Source.HLS), acts.last())
    }

    @Test fun nosGuardadosConfereOAoVivoACada30s() {
        val w = wd(offline = true)
        w.start(0)
        repeat(4) { w.onError(0) }
        assertEquals(Source.OFFLINE, w.source)
        val acts = play(w, 1000, 61_000)
        val probes = acts.withIndex().filter { it.value == WdAction.ProbeLive }.map { (it.index + 1) * 1000L }
        assertEquals(listOf(30_000L, 60_000L), probes)
    }

    @Test fun aoVivoVoltou() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        repeat(8) { w.onError(0) }
        assertEquals(Source.OFFLINE, w.source)
        assertEquals(WdAction.None, w.onProbe(30_000, mainOk = false, backupOk = false))
        assertEquals(WdAction.Play(Source.BACKUP), w.onProbe(60_000, mainOk = false, backupOk = true))
        assertEquals(WdAction.Play(Source.HLS), w.onProbe(90_000, mainOk = true, backupOk = true))
        assertEquals(Source.HLS, w.source)
        // já no principal, conferência atrasada não faz nada
        assertEquals(WdAction.None, w.onProbe(91_000, mainOk = true, backupOk = true))
    }

    @Test fun naReservaNaoTrocaPorReserva() {
        val w = wd(backup = true)
        w.start(0)
        repeat(4) { w.onError(0) }
        assertEquals(Source.BACKUP, w.source)
        assertEquals(WdAction.None, w.onProbe(30_000, mainOk = false, backupOk = true))
    }

    @Test fun voltaQueFalhaDobraOIntervalo() {
        val w = wd(offline = true)
        w.start(0)
        repeat(4) { w.onError(0) }
        assertEquals(30_000L, w.probeIntervalMs)
        w.onProbe(30_000, mainOk = true, backupOk = false) // voltou…
        repeat(4) { w.onError(31_000) } // …e caiu de novo sem estabilizar
        assertEquals(Source.OFFLINE, w.source)
        assertEquals(60_000L, w.probeIntervalMs)
        w.onProbe(100_000, mainOk = true, backupOk = false)
        repeat(4) { w.onError(101_000) }
        assertEquals(120_000L, w.probeIntervalMs)
        w.onProbe(300_000, mainOk = true, backupOk = false)
        repeat(4) { w.onError(301_000) }
        w.onProbe(600_000, mainOk = true, backupOk = false)
        repeat(4) { w.onError(601_000) }
        assertEquals(240_000L, w.probeIntervalMs) // teto
        // voltou e ficou: intervalo normal de novo
        w.onProbe(900_000, mainOk = true, backupOk = false)
        play(w, 901_000, 920_000)
        assertEquals(30_000L, w.probeIntervalMs)
    }

    @Test fun guardadosTravadosPassamAdiante() {
        val w = wd(main = false, offline = true)
        w.start(0)
        val acts = stall(w, 1000, 11_000)
        assertEquals(WdAction.Play(Source.OFFLINE), acts.last())
    }

    @Test fun pausaNaoContaComoTravamento() {
        val w = wd()
        w.start(0)
        play(w, 1000, 5000)
        // uma hora fora do horário, sem tiques
        w.resume(3_600_000)
        assertEquals(WdAction.None, w.tick(3_601_000, 5000, true))
    }

    // ---- erros que só pedem para voltar à ponta do ao vivo ----
    @Test fun classificaOsErros() {
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(1002, listOf("ExoPlaybackException", "BehindLiveWindowException")))
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(1002, emptyList()))
        // lista parada / reiniciada chega como erro de E/S genérico (2000) com a causa dentro
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(2000, listOf("ExoPlaybackException", "PlaylistStuckException")))
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(2000, listOf("ExoPlaybackException", "PlaylistResetException")))
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(3002, listOf("ExoPlaybackException", "ParserException")))
        assertEquals(ErrorKind.RESYNC, PlayerErrors.classify(3001, emptyList()))
        // rede, HTTP, decodificador, formato não suportado: recarga normal
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(2001, listOf("ExoPlaybackException", "HttpDataSourceException", "UnknownHostException")))
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(2004, listOf("ExoPlaybackException", "InvalidResponseCodeException")))
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(2000, listOf("ExoPlaybackException", "IOException")))
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(4003, listOf("ExoPlaybackException", "DecoderException")))
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(3003, listOf("ExoPlaybackException")))
        assertEquals(ErrorKind.RELOAD, PlayerErrors.classify(1000, emptyList()))
    }

    @Test fun voltarAPontaNaoContaParaAReserva() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        play(w, 1000, 20_000)
        // o canal voltou da cartela várias vezes ao longo do dia, sempre tocando entre uma e outra
        var t = 21_000L
        repeat(20) {
            assertEquals(WdAction.Resync, w.onResync(t))
            play(w, t + 1000, t + 5000)
            t += 6000
        }
        assertEquals(Source.HLS, w.source)
        assertEquals(0, w.failedReloads)
    }

    @Test fun voltarAPontaDaPrazoNovoAoVigia() {
        val w = wd()
        w.start(0)
        play(w, 1000, 20_000)
        stall(w, 21_000, 28_000, pos = 20_000) // 8 s parado
        assertEquals(WdAction.Resync, w.onResync(28_500))
        // mais 9 s sem andar depois da volta: ainda dentro do prazo
        assertTrue(stall(w, 29_000, 37_000, pos = 20_000).all { it == WdAction.None })
        assertEquals(WdAction.Play(Source.HLS), w.tick(39_000, 20_000, true))
        assertEquals(1, w.failedReloads)
    }

    @Test fun voltarAPontaEmSerieSemAndarViraFalha() {
        val w = wd(backup = true)
        w.start(0)
        repeat(5) { assertEquals(WdAction.Resync, w.onResync(1000L + it)) }
        // a sexta seguida, sem um quadro sequer entre elas, já é recarga de verdade
        assertEquals(WdAction.Play(Source.HLS), w.onResync(2000))
        assertEquals(1, w.failedReloads)
        // e a contagem recomeça
        assertEquals(WdAction.Resync, w.onResync(3000))
    }

    @Test fun nosGuardadosNaoHaPontaDoAoVivo() {
        val w = wd(main = false, offline = true)
        w.start(0)
        assertEquals(WdAction.Play(Source.OFFLINE), w.onResync(1000))
    }

    @Test fun descontinuidadesNaoDisparamOVigia() {
        // a cartela de fora do ar tem uma descontinuidade a cada 8 s e a janela anda: o número de progresso salta
        // para trás e para a frente, mas MUDA a cada tique; o vigia só olha se mudou
        val w = wd(backup = true)
        w.start(0)
        var t = 1000L
        var acts = ArrayList<WdAction>()
        for (i in 0 until 600) {
            val pos = if (i % 8 == 0) 5L else 1000L + (i % 8) * 30 // zera/salta a cada 8 s
            acts.add(w.tick(t, pos + i % 2, true))
            t += 1000
        }
        assertTrue(acts.all { it == WdAction.None })
        assertEquals(0, w.failedReloads)
        // parou de verdade (mesmo número por 10 s): aí sim recarrega
        val frozen = stall(w, t, t + 10_000, pos = 777)
        assertEquals(WdAction.Play(Source.HLS), frozen.last())
    }

    @Test fun configuracaoNovaRecomeca() {
        val w = wd(backup = true, offline = true)
        w.start(0)
        repeat(8) { w.onError(0) }
        assertEquals(Source.OFFLINE, w.source)
        assertEquals(WdAction.Play(Source.HLS), w.start(50_000))
        assertEquals(0, w.failedReloads)
    }
}
