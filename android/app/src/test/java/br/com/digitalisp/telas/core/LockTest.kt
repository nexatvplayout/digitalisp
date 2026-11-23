package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LockTest {
    @Test fun hashConhecido() {
        // sha256("abc") e sha256("") conhecidos
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Pin.hash("a", "bc"))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Pin.hash("", ""))
    }

    @Test fun vetorDoContrato() {
        // contrato §6: sal "00ff", PIN "1234" → sha256 do TEXTO "00ff1234"
        val esperado = Hex.sha256("00ff1234".toByteArray(Charsets.UTF_8))
        assertEquals(esperado, Pin.hash("00ff", "1234"))
        assertTrue(Pin.matches("00ff", "1234", esperado))
        // não são os bytes do sal (0x00 0xFF) seguidos do PIN
        val comBytes = Hex.sha256(byteArrayOf(0x00, 0xFF.toByte()) + "1234".toByteArray(Charsets.UTF_8))
        assertNotEquals(comBytes, Pin.hash("00ff", "1234"))
    }

    @Test fun confere() {
        val salt = "00ff10"
        val h = Pin.hash(salt, "1234")
        assertTrue(Pin.matches(salt, "1234", h))
        assertTrue(Pin.matches(salt, "1234", h.uppercase()))
        assertFalse(Pin.matches(salt, "1235", h))
        assertFalse(Pin.matches("outro", "1234", h))
        assertFalse(Pin.matches(salt, "1234", ""))
    }

    @Test fun pinValido() {
        assertTrue(Pin.valid("1234"))
        assertTrue(Pin.valid("12345678"))
        assertFalse(Pin.valid("123"))
        assertFalse(Pin.valid("123456789"))
        assertFalse(Pin.valid("12a4"))
    }

    @Test fun saltNovo() {
        val a = Pin.newSalt()
        assertEquals(32, a.length)
        assertNotEquals(a, Pin.newSalt())
    }

    @Test fun cincoErrosBloqueiamQuinzeMinutos() {
        var s = LockoutState()
        val t0 = 1_000_000L
        repeat(4) {
            s = Lockout.onWrong(s, t0)
            assertFalse(Lockout.isLocked(s, t0))
        }
        assertEquals(4, s.fails)
        s = Lockout.onWrong(s, t0)
        assertTrue(Lockout.isLocked(s, t0))
        assertEquals(Lockout.DURATION_MS, Lockout.remainingMs(s, t0))
        assertTrue(Lockout.isLocked(s, t0 + Lockout.DURATION_MS - 1))
        assertFalse(Lockout.isLocked(s, t0 + Lockout.DURATION_MS))
        // bloqueado: tentativa não conta nem estica
        assertEquals(s, Lockout.onWrong(s, t0 + 5))
        // passou o bloqueio: recomeça a contagem
        assertEquals(1, Lockout.onWrong(s, t0 + Lockout.DURATION_MS).fails)
    }

    @Test fun acertoZera() {
        var s = LockoutState()
        repeat(3) { s = Lockout.onWrong(s, 10) }
        assertEquals(LockoutState(), Lockout.onRight())
    }

    @Test fun relogioQueVoltouNaoEstica() {
        val s = LockoutState(0, 2_000_000_000_000L)
        val n = Lockout.normalize(s, 1_000L)
        assertEquals(1_000L + Lockout.DURATION_MS, n.lockedUntil)
        // dentro dos 15 min fica como está
        val ok = LockoutState(0, 5_000L)
        assertEquals(ok, Lockout.normalize(ok, 1_000L))
    }

    @Test fun sequenciaPadrao() {
        val q = ExitSequence(ConfigParser.DEFAULT_SEQ)
        var t = 0L
        val keys = listOf("UP", "UP", "DOWN", "DOWN")
        for (k in keys) assertFalse(q.feed(k, t++))
        assertTrue(q.feed("OK", t++))
        // zerou depois de bater
        assertFalse(q.feed("OK", t))
    }

    @Test fun sequenciaComTeclaAMais() {
        val q = ExitSequence(ConfigParser.DEFAULT_SEQ)
        var t = 0L
        // UP a mais no começo ainda vale: o final é a sequência
        for (k in listOf("LEFT", "UP", "UP", "UP", "DOWN", "DOWN")) assertFalse(q.feed(k, t++))
        assertTrue(q.feed("OK", t))
    }

    @Test fun sequenciaErradaNaoAbre() {
        val q = ExitSequence(ConfigParser.DEFAULT_SEQ)
        var t = 0L
        for (k in listOf("UP", "UP", "DOWN", "LEFT", "DOWN", "OK")) assertFalse(q.feed(k, t++))
    }

    @Test fun pausaLongaZera() {
        val q = ExitSequence(ConfigParser.DEFAULT_SEQ, gapMs = 4000)
        assertFalse(q.feed("UP", 0))
        assertFalse(q.feed("UP", 100))
        assertFalse(q.feed("DOWN", 200))
        assertFalse(q.feed("DOWN", 5000)) // pausa: recomeça daqui
        assertFalse(q.feed("OK", 5100))
    }

    @Test fun teclaForaDaListaZera() {
        val q = ExitSequence(ConfigParser.DEFAULT_SEQ)
        for (k in listOf("UP", "UP", "DOWN")) q.feed(k, 0)
        q.feed(null, 1)
        assertFalse(q.feed("DOWN", 2))
        assertFalse(q.feed("OK", 3))
    }

    @Test fun normaliza() {
        assertEquals(listOf("LEFT", "RIGHT", "OK"), ExitSequence.normalize(listOf("left", " Right", "enter")))
        assertEquals(ConfigParser.DEFAULT_SEQ, ExitSequence.normalize(listOf("UP", "OK")))
        assertEquals(ConfigParser.DEFAULT_SEQ, ExitSequence.normalize(listOf("UP", "UP", "VOLUME")))
        assertEquals(ConfigParser.DEFAULT_SEQ, ExitSequence.normalize(null))
        assertEquals(ConfigParser.DEFAULT_SEQ, ExitSequence.normalize(List(13) { "UP" }))
    }
}
