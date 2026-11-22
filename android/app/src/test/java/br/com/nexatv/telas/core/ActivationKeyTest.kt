package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.2.4, retorno do dono: a chave em maiúsculas, XXXX-XXXX com o hífen automático, e o teclado só com os caracteres dela. */
class ActivationKeyTest {
    @Test fun oAlfabetoEhODoServidor() {
        // server/telas-core.js: KEY_ALPHABET
        assertEquals("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", ActivationKey.ALPHABET)
        for (c in "01IO") assertFalse(c in ActivationKey.ALPHABET)
        assertEquals(32, ActivationKey.ALPHABET.toSet().size)
    }

    @Test fun formatoComHifenAutomatico() {
        assertEquals("", ActivationKey.format(""))
        assertEquals("ABC", ActivationKey.format("ABC"))
        assertEquals("ABCD-", ActivationKey.format("ABCD"))
        assertEquals("ABCD-E", ActivationKey.format("ABCDE"))
        assertEquals("ABCD-EFGH", ActivationKey.format("ABCDEFGH"))
        assertEquals("ABCD-EFGH", ActivationKey.complete("ABCDEFGH"))
        assertNull(ActivationKey.complete("ABCDEFG"))
    }

    @Test fun tecladoDaTelaEApagar() {
        var k = ""
        for (ch in "abcd2") k = ActivationKey.append(k, ch)
        assertEquals("ABCD2", k)
        k = ActivationKey.append(k, 'I') // não é da chave: nada
        assertEquals("ABCD2", k)
        for (ch in "XYZW") k = ActivationKey.append(k, ch)
        assertEquals("ABCD2XYZ", k, )
        // apagar passa por cima do hífen: "ABCD-" -> "ABC"
        assertEquals("ABC", ActivationKey.erase("ABCD"))
        assertEquals("", ActivationKey.erase(""))
    }

    @Test fun colarOuTecladoUsbNormaliza() {
        assertEquals(ActivationKey.Clean("ABCDEFGH", false), ActivationKey.clean(" abcd-efgh "))
        assertEquals(ActivationKey.Clean("ABCDEFGH", false), ActivationKey.clean("ab cd ef gh xyz"))
        // 0, 1, I e O: não são trocados em silêncio; saem e a tela avisa
        val c = ActivationKey.clean("ABC1-EFG0")
        assertEquals("ABCEFG", c.chars); assertTrue(c.confusing)
        assertTrue(ActivationKey.warning(true)!!.contains("0, 1, I nem O"))
        assertNull(ActivationKey.warning(false))
        // L é da chave (não confunde)
        assertEquals(ActivationKey.Clean("LLLL", false), ActivationKey.clean("llll"))
    }

    @Test fun apagarOHifenPeloTecladoUsbNaoPrende() {
        // o campo mostra "ABCD-"; a tecla Apagar do teclado tira o hífen: sai também o D
        assertEquals("ABC", ActivationKey.onEdited("ABCD", "ABCD").chars)
        // digitou mais uma letra
        assertEquals("ABCDE", ActivationKey.onEdited("ABCD", "ABCD-E").chars)
        // apagou uma letra normal
        assertEquals("ABCDE", ActivationKey.onEdited("ABCDEF", "ABCD-E").chars)
    }
}
