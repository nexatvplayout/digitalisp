package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** 1.2.6: com a rede caída, os vídeos guardados entram rápido (sem gastar recargas com a tela parada). */
class WatchdogOfflineTest {
    private fun wd(offline: Boolean = true) = Watchdog().apply { hasMain = true; hasBackup = true; hasOffline = offline }

    @Test fun partidaSemRedeVaiDiretoAosGuardados() {
        assertEquals(WdAction.Play(Source.OFFLINE), wd().start(0, networkUp = false))
        assertEquals(WdAction.Play(Source.OFFLINE), wd().apply { internetDown = true }.start(0))
        // sem vídeo guardado, tenta o ao vivo como antes
        assertEquals(WdAction.Play(Source.HLS), wd(offline = false).start(0, networkUp = false))
        assertEquals(WdAction.Play(Source.HLS), wd().start(0, networkUp = true))
    }

    @Test fun internetCaidaPrimeiraFalhaJaVaiAosGuardados() {
        val w = wd()
        w.start(0)
        w.internetDown = true
        assertEquals(WdAction.Play(Source.OFFLINE), w.onError(1_000))
    }

    @Test fun internetBoaSegueAsRecargas() {
        val w = wd()
        w.start(0)
        assertEquals(WdAction.Play(Source.HLS), w.onError(1_000))
    }

    @Test fun nosGuardadosVoltaAoAoVivoPelaConferencia() {
        val w = wd()
        w.start(0, networkUp = false)
        w.internetDown = false
        // rede de volta: confere o ao vivo depois do intervalo e volta
        var t = 1_000L
        var probe: WdAction = WdAction.None
        while (t <= 31_000L && probe != WdAction.ProbeLive) {
            probe = w.tick(t, t, true)
            t += 1_000
        }
        assertEquals(WdAction.ProbeLive, probe)
        assertEquals(WdAction.Play(Source.HLS), w.onProbe(t, mainOk = true, backupOk = false))
    }
}
