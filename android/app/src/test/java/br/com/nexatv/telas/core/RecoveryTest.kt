package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

/** A licença que sobrevive à reinstalação (docs/TELAS.md §32): o hwid e o que fazer com cada resposta do /recover. */
class RecoveryTest {
    private val pkg = "br.com.nexatv.telas"

    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    @Test fun hwidEhOResumoDoAndroidIdComOPacote() {
        val h = HardwareId.of("a1b2c3d4e5f60718", pkg)!!
        assertEquals(sha("a1b2c3d4e5f60718|$pkg"), h)
        assertTrue(Regex("^[0-9a-f]{64}$").matches(h))
        assertFalse("o ANDROID_ID cru não vai", h.contains("a1b2c3d4e5f60718"))
        assertEquals("maiúsculas e espaços não mudam o resumo", h, HardwareId.of(" A1B2C3D4E5F60718 ", pkg))
        assertNotEquals("outro aparelho, outro hwid", h, HardwareId.of("a1b2c3d4e5f60719", pkg))
        assertNotEquals("outro app, outro hwid", h, HardwareId.of("a1b2c3d4e5f60718", "outro.app"))
    }

    @Test fun androidIdQueNaoServe() {
        for (bad in listOf(null, "", "   ", "abc", "9774d56d682e549c", "0000000000000000")) assertNull(bad, HardwareId.of(bad, pkg))
        assertNull(HardwareId.of("a1b2c3d4e5f60718", ""))
    }

    @Test fun passos() {
        assertEquals(RecoverStep.DONE, Recovery.step(200))
        assertEquals(RecoverStep.NONE, Recovery.step(404))
        assertEquals(RecoverStep.NONE, Recovery.step(400))
        assertEquals(RecoverStep.RETRY_LATER, Recovery.step(429))
        assertEquals(RecoverStep.RETRY_LATER, Recovery.step(500))
        assertEquals(RecoverStep.RETRY_LATER, Recovery.step(502))
        assertEquals(RecoverStep.RETRY_SOON, Recovery.step(null))
    }

    @Test fun variosServidores() {
        assertEquals(RecoverStep.DONE, Recovery.combine(listOf(RecoverStep.NONE, RecoverStep.DONE)))
        assertEquals(RecoverStep.NONE, Recovery.combine(listOf(RecoverStep.NONE, RecoverStep.NONE)))
        assertEquals("um sem resposta: tenta de novo", RecoverStep.RETRY_SOON, Recovery.combine(listOf(RecoverStep.NONE, RecoverStep.RETRY_SOON)))
        assertEquals(RecoverStep.RETRY_LATER, Recovery.combine(listOf(RecoverStep.RETRY_LATER, RecoverStep.NONE)))
        assertEquals(RecoverStep.NONE, Recovery.combine(emptyList()))
    }

    @Test fun esperas() {
        assertEquals(5_000L, Recovery.delayMs(RecoverStep.RETRY_SOON, 1))
        assertEquals(5_000L, Recovery.delayMs(RecoverStep.RETRY_SOON, 12))
        assertEquals(30_000L, Recovery.delayMs(RecoverStep.RETRY_SOON, 13))
        assertEquals(60_000L, Recovery.delayMs(RecoverStep.RETRY_LATER, 1))
    }

    @Test fun quandoPerguntar() {
        assertTrue("reinstalado: modo vazio, sem token", Recovery.shouldTry("", hasToken = false, gaveUp = false))
        assertTrue("revogado: gerenciado sem token (o servidor responde 404)", Recovery.shouldTry("managed", hasToken = false, gaveUp = false))
        assertFalse(Recovery.shouldTry("managed", hasToken = true, gaveUp = false))
        assertFalse("avulso não tem servidor", Recovery.shouldTry("standalone", hasToken = false, gaveUp = false))
        assertFalse(Recovery.shouldTry("", hasToken = false, gaveUp = true))
    }

    @Test fun ondePerguntar() {
        assertEquals(listOf("https://api.nexa.tv.br"), Recovery.servers("https://api.nexa.tv.br/", "https://api.nexa.tv.br"))
        assertEquals(listOf("https://outro.exemplo.gov.br", "https://api.nexa.tv.br"), Recovery.servers("https://outro.exemplo.gov.br", "https://api.nexa.tv.br"))
        assertEquals(listOf("https://api.nexa.tv.br"), Recovery.servers(null, "https://api.nexa.tv.br"))
        assertEquals(listOf("https://api.nexa.tv.br"), Recovery.servers("lixo", "https://api.nexa.tv.br"))
    }
}
