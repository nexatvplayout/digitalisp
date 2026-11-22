package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pedido do dono (14/11): relógio ainda acertando na partida é "Carregando…", não mensagem de erro. */
class StartupClockTest {
    private val long = 10 * 60_000L

    @Test fun relogioCertoEhNormal() {
        assertEquals(ClockView.NORMAL, StartupClock.view(5_000, 5_000, clockWrong = false, certTimeError = false))
        assertEquals(ClockView.NORMAL, StartupClock.view(long, long, false, false))
    }

    @Test fun naPartidaEhCarregando() {
        // aparelho acabou de ligar (o app também)
        assertEquals(ClockView.LOADING, StartupClock.view(8_000, 3_000, clockWrong = true, certTimeError = false))
        // relógio já parece certo, mas o https recusou o certificado pela data
        assertEquals(ClockView.LOADING, StartupClock.view(20_000, 20_000, false, certTimeError = true))
        // aparelho ligado há tempo, app recém-aberto (atualização, queda): também conta como partida
        assertEquals(ClockView.LOADING, StartupClock.view(long, 59_999, true, false))
        // app aberto há tempo, aparelho ligado agora (não acontece, mas vale o mais recente)
        assertEquals(ClockView.LOADING, StartupClock.view(30_000, long, true, false))
    }

    @Test fun passadoOPrazoEhAMensagem() {
        assertEquals(ClockView.MESSAGE, StartupClock.view(long, 60_000, true, false))
        assertEquals(ClockView.MESSAGE, StartupClock.view(long, long, false, true))
        assertTrue(StartupClock.MESSAGE_TEXT.contains("confira a internet"))
        assertFalse(StartupClock.LOADING_TEXT.lowercase().contains("erro"))
        assertTrue(StartupClock.RETRY_MS in 2_000L..3_000L)
    }

    @Test fun saltoDoRelogio() {
        // 1 s de relógio monotônico e o relógio de parede pulou de 2015 para 2026: acertado
        assertTrue(StartupClock.jumped(1_420_070_400_000L, 10_000, 1_794_000_000_000L, 11_000))
        // andou junto: nada
        assertFalse(StartupClock.jumped(1_794_000_000_000L, 10_000, 1_794_000_001_000L, 11_000))
        // ajuste pequeno (segundos) não conta; para trás grande conta
        assertFalse(StartupClock.jumped(1_794_000_000_000L, 10_000, 1_794_000_031_000L, 11_000))
        assertTrue(StartupClock.jumped(1_794_000_000_000L, 10_000, 1_793_000_000_000L, 11_000))
    }

    @Test fun certificadoPelaData() {
        assertTrue(NetErrors.dateRelated(listOf("SSLHandshakeException", "CertificateNotYetValidException"), clockWrong = false))
        assertTrue(NetErrors.dateRelated(listOf("SSLHandshakeException"), clockWrong = true))
        assertFalse(NetErrors.dateRelated(listOf("SSLHandshakeException"), clockWrong = false))
        assertFalse(NetErrors.dateRelated(listOf("UnknownHostException"), clockWrong = true))
    }
}
