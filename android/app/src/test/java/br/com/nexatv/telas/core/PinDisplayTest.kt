package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.2.4, retorno do dono: a tela do PIN mostrava 4 casas e o PIN sorteado tem 6. */
class PinDisplayTest {
    @Test fun semCasasFixas() {
        assertEquals("", PinDisplay.dots(0))
        assertEquals("● ● ● ● ● ●", PinDisplay.dots(6))
        assertEquals(8, PinDisplay.dots(12).count { it == '●' }, )
        assertTrue(PinDisplay.HINT.contains("4 a 8"))
    }

    @Test fun curtoDemaisNaoContaComoErro() {
        assertTrue(PinDisplay.tooShort("123"))
        assertFalse(PinDisplay.tooShort("1234"))
        assertFalse(PinDisplay.tooShort("123456"))
        // o contrato e o servidor: PIN de 4 a 8 dígitos (LIMITS.pinMin/pinMax), o sorteado com 6
        assertEquals(4, PinDisplay.MIN); assertEquals(8, PinDisplay.MAX)
    }
}
