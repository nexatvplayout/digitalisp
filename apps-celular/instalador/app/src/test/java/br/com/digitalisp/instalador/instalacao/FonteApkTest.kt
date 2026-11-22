package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.IOException

class FonteApkTest {
    @get:Rule val pasta = TemporaryFolder()

    private val zip = byteArrayOf(0x50, 0x4B, 3, 4) + ByteArray(5000) { 7 }

    @Test fun copiaComProgressoENomeFinal() {
        val dir = pasta.newFolder()
        val prog = ArrayList<Long>()
        val f = copiarParaCache(ByteArrayInputStream(zip), zip.size.toLong(), dir) { feito, _ -> prog.add(feito) }
        assertEquals("telas.apk", f.name)
        assertEquals(zip.size.toLong(), f.length())
        assertEquals(zip.size.toLong(), prog.last())
        assertFalse(dir.resolve("telas.apk.parcial").exists())
    }

    @Test fun downloadIncompletoNaoDeixaApk() {
        val dir = pasta.newFolder()
        try {
            copiarParaCache(ByteArrayInputStream(zip), zip.size + 10L, dir) { _, _ -> }
            fail()
        } catch (e: IOException) {
            assertTrue(e.message!!.contains("incompleto"))
        }
        assertFalse(dir.resolve("telas.apk").exists())
        assertFalse(dir.resolve("telas.apk.parcial").exists())
    }

    @Test fun paginaHtmlNoLugarDoApkERecusada() {
        val html = "<html>erro</html>".toByteArray()
        try {
            copiarParaCache(ByteArrayInputStream(html), html.size.toLong(), pasta.newFolder()) { _, _ -> }
            fail()
        } catch (e: IOException) {
            assertTrue(e.message!!.contains("não é um app"))
        }
    }

    @Test fun enderecoComMarcadorOuSemHttpsERecusado() {
        for (url in listOf(Config.URL_APK_PADRAO, "", "http://exemplo.com.br/telas.apk", "ftp://x/y.apk")) {
            try { FonteUrl.validar(url); fail(url) } catch (_: IOException) {}
        }
        FonteUrl.validar("https://exemplo.com.br/app/telas.apk")
        assertTrue(Config.urlIndefinida(Config.URL_APK_PADRAO))
    }
}
