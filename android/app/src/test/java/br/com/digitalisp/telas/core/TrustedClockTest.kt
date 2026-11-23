package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedClockTest {
    private val good = ClockCheck.FLOOR_MS + 13L * 86_400_000L // 14/11/2026
    private val y1970 = 5_000L

    @Test fun relogioCertoValeDireto() {
        assertEquals(good, TrustedClock.now(good, 1_000, 3, null))
    }

    @Test fun mesmaLigadaSegueAUltimaHoraBoa() {
        val a = ClockAnchor(good, 100_000, 7)
        // o relógio do aparelho voltou para 1970, mas é a mesma ligada: a hora boa + o tempo monotônico
        assertEquals(good + 60_000, TrustedClock.now(y1970, 160_000, 7, a))
    }

    @Test fun depoisDeReiniciarNaoHaHora() {
        val a = ClockAnchor(good, 100_000, 7)
        assertNull(TrustedClock.now(y1970, 20_000, 8, a)) // outra ligada
        assertNull(TrustedClock.now(y1970, 20_000, -1, a)) // ligada desconhecida
        assertNull(TrustedClock.now(y1970, 50_000, 7, a)) // monotônico menor que o guardado = reiniciou
        assertNull(TrustedClock.now(y1970, 20_000, 8, null))
    }

    @Test fun minimoDepoisDeReiniciar() {
        val a = ClockAnchor(good, 100_000, 7)
        // ligou depois da última hora boa: a hora é no mínimo ela + o tempo desde que ligou
        assertEquals(good + 20_000, TrustedClock.floor(20_000, 8, a))
        assertEquals(good + 60_000, TrustedClock.floor(160_000, 7, a))
        assertNull(TrustedClock.floor(20_000, 8, null))
    }

    @Test fun horaDosVencimentos() {
        assertEquals(10L, TrustedClock.forExpiry(10L, 5L))
        assertEquals(5L, TrustedClock.forExpiry(null, 5L))
        assertEquals(0L, TrustedClock.forExpiry(null, null)) // nada vence: a tela fica como estava
    }

    @Test fun alertaGuardadoContinuaSemHoraEVencidoSome() {
        val a = ClockAnchor(good, 100_000, 7)
        val alerts = listOf(
            Alert(1, "Chuva forte", "", 2, false, until = 0L),
            Alert(2, "Já acabou", "", 2, false, until = good - 1),
            Alert(3, "Até amanhã", "", 1, false, until = good + 86_400_000L),
        )
        // reiniciou sem rede: só some o que acabou antes da última hora boa
        val t = TrustedClock.forExpiry(TrustedClock.now(y1970, 20_000, 8, a), TrustedClock.floor(20_000, 8, a))
        assertEquals(listOf(1L, 3L), Alerts.active(alerts, t).map { it.id })
        assertEquals(1L, Alerts.select(alerts, t)?.id)
        // sem hora boa nenhuma guardada: todos continuam
        assertEquals(3, Alerts.active(alerts, TrustedClock.forExpiry(null, null)).size)
    }

    @Test fun quandoGravar() {
        val a = ClockAnchor(good, 100_000, 7)
        assertTrue(TrustedClock.shouldSave(null, a))
        assertFalse(TrustedClock.shouldSave(a, ClockAnchor(good + 10_000, 110_000, 7)))
        assertTrue(TrustedClock.shouldSave(a, ClockAnchor(good + 60_000, 160_000, 7)))
        assertTrue(TrustedClock.shouldSave(a, ClockAnchor(good + 3_600_000, 110_000, 7))) // relógio acertado
        assertTrue(TrustedClock.shouldSave(a, ClockAnchor(good, 1_000, 8))) // outra ligada
        assertFalse(TrustedClock.shouldSave(null, ClockAnchor(y1970, 1_000, 8))) // hora errada nunca
    }

    @Test fun formatoGuardado() {
        val a = ClockAnchor(good, 100_000, 7)
        assertEquals(a, ClockAnchor.parse(a.toWire()))
        assertNull(ClockAnchor.parse(null))
        assertNull(ClockAnchor.parse("x,1,2"))
        assertNull(ClockAnchor.parse("$y1970,1,2")) // âncora de 1970 não vale
    }
}
