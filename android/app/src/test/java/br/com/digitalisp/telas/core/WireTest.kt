package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WireTest {
    @Test fun so401ApagaOToken() {
        assertEquals(ApiFailure.REVOKED, ApiErrors.classify(401, null))
        assertEquals(ApiFailure.REVOKED, ApiErrors.classify(401, "unavailable"))
    }

    @Test fun modoDesligadoGuardaOToken() {
        assertEquals(ApiFailure.UNAVAILABLE, ApiErrors.classify(403, "unavailable"))
        assertEquals(ApiFailure.UNAVAILABLE, ApiErrors.classify(403, " Unavailable "))
    }

    @Test fun outrosErrosSoTentamDeNovo() {
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(403, null))
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(403, "forbidden"))
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(404, "unavailable"))
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(429, null))
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(500, null))
        assertEquals(ApiFailure.OTHER, ApiErrors.classify(413, null))
    }

    @Test fun corpoDoErro() {
        assertEquals("Modo desligado" to "unavailable", ApiErrors.parse("""{"error":"Modo desligado","code":"unavailable"}"""))
        assertEquals("Só o texto" to null, ApiErrors.parse("""{"error":"Só o texto"}"""))
        assertEquals(null to null, ApiErrors.parse("<html>502</html>"))
        assertEquals(null to null, ApiErrors.parse(null))
        assertNull(ApiErrors.parse("""{"error":null,"code":null}""").first)
    }

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun jpegDeVerdade() {
        assertTrue(Jpeg.valid(bytes(0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9)))
        assertTrue(Jpeg.valid(bytes(0xFF, 0xD8, 0xFF, 0xD9)))
    }

    @Test fun jpegRecusado() {
        assertFalse(Jpeg.valid(null))
        assertFalse(Jpeg.valid(bytes()))
        assertFalse(Jpeg.valid(bytes(0x89, 0x50, 0x4E, 0x47, 0xFF, 0xD9)))        // PNG
        assertFalse(Jpeg.valid(bytes(0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3)))            // sem o fim FF D9
        assertFalse(Jpeg.valid(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xD9, 0)))      // lixo depois do fim
    }

    @Test fun jpegGrandeDemais() {
        val big = ByteArray(Jpeg.MAX_BYTES + 1)
        big[0] = 0xFF.toByte(); big[1] = 0xD8.toByte(); big[2] = 0xFF.toByte()
        big[big.size - 2] = 0xFF.toByte(); big[big.size - 1] = 0xD9.toByte()
        assertFalse(Jpeg.valid(big))
        val ok = big.copyOf(Jpeg.MAX_BYTES)
        ok[ok.size - 2] = 0xFF.toByte(); ok[ok.size - 1] = 0xD9.toByte()
        assertTrue(Jpeg.valid(ok))
    }
}
