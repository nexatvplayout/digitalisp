package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Girar a tela" nos ajustes: automático (o de sempre) ou 0/90/180/270 para qualquer layout. */
class ScreenTurnTest {
    @Test
    fun automaticoSoGiraOLayoutEmPeNaTvDeitada() {
        assertEquals(90, ScreenTurn.angle(ScreenTurn.AUTO, 90, portraitLayout = true, displayPortrait = false))
        assertEquals(270, ScreenTurn.angle(ScreenTurn.AUTO, 270, portraitLayout = true, displayPortrait = false))
        assertEquals(0, ScreenTurn.angle(ScreenTurn.AUTO, 90, portraitLayout = false, displayPortrait = false))
        assertEquals(0, ScreenTurn.angle(ScreenTurn.AUTO, 90, portraitLayout = true, displayPortrait = true))
    }

    @Test
    fun giroFixoValeEmQualquerLayout() {
        for (g in listOf(0, 90, 180, 270)) {
            assertEquals(g, ScreenTurn.angle(g, 90, portraitLayout = false, displayPortrait = false))
            assertEquals(g, ScreenTurn.angle(g, 90, portraitLayout = true, displayPortrait = false))
        }
        assertTrue(ScreenTurn.swaps(90)); assertTrue(ScreenTurn.swaps(270))
        assertFalse(ScreenTurn.swaps(180)); assertFalse(ScreenTurn.swaps(0))
    }

    @Test
    fun oBotaoPassaPorTodosEVolta() {
        var g = ScreenTurn.AUTO
        val vistos = mutableListOf<Int>()
        repeat(5) { g = ScreenTurn.next(g); vistos.add(g) }
        assertEquals(listOf(0, 90, 180, 270, ScreenTurn.AUTO), vistos)
        assertEquals(ScreenTurn.AUTO, ScreenTurn.clean(45))
    }
}
