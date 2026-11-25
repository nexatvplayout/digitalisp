package br.com.digitalisp.instalador.pacotes

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.rede.Plataforma
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.IOException
import java.security.MessageDigest

class PacotesTest {
    @get:Rule val pasta = TemporaryFolder()
    private val S = Config.SERVIDOR_PADRAO
    private fun sha(b: ByteArray) = Pacotes.hex(MessageDigest.getInstance("SHA-256").digest(b))

    @Test fun enderecosDoServidor() {
        assertEquals("https://www.digitalisp.com.br/telas/app/latest.json", Pacotes.enderecoIndice(S, Plataforma.ANDROID))
        assertEquals("https://www.digitalisp.com.br/telas/tv/latest.json", Pacotes.enderecoIndice("$S/", Plataforma.SAMSUNG))
        assertTrue(Config.servidorValido(S))
        assertFalse(Config.servidorValido("http://www.digitalisp.com.br"))
        assertFalse(Config.servidorValido("https://x.com/caminho?a=1"))
    }

    @Test fun leOLatestJsonDoAndroidComoOServidorManda() {
        // formato de server/telas-app.js
        val j = """{"versionCode":6,"versionName":"0.3.3","sha256":"4a388679bc75f95ec3b06451a81a89c39bed0144d8cd114b3e7d5d7f87e6c826","bytes":29638221,"url":"https://www.digitalisp.com.br/telas/app/latest.apk?v=6"}"""
        val p = Pacotes.ler(j, Plataforma.ANDROID, S)
        assertEquals("0.3.3", p.versao)
        assertEquals(29638221L, p.bytes)
        assertEquals("https://www.digitalisp.com.br/telas/app/latest.apk?v=6", p.url)
        assertNull(p.appId)
        assertEquals("telas.apk", p.nomeArquivo)
    }

    @Test fun leOLatestJsonDasTvs() {
        val j = """{"tizen":{"version":"1.0.27","appId":"DgIspTela1.Telas","sha256":"${"c".repeat(64)}","bytes":11162091,"url":"/telas/tv/latest.wgt?v=1.0.27","file":"DigitalISP-1.0.27.wgt"},
                   "webos":{"version":"1.0.27","appId":"br.com.digitalisp.telas","sha256":"${"d".repeat(64)}","bytes":11129208,"url":"https://www.digitalisp.com.br/telas/tv/latest.ipk?v=1.0.27","file":"br.com.digitalisp.telas_1.0.27_all.ipk"}}"""
        val s = Pacotes.ler(j, Plataforma.SAMSUNG, S)
        assertEquals("DgIspTela1.Telas", s.appId)
        assertEquals("https://www.digitalisp.com.br/telas/tv/latest.wgt?v=1.0.27", s.url)
        assertEquals("DigitalISP-1.0.27.wgt", s.nomeArquivo)
        val l = Pacotes.ler(j, Plataforma.LG, S)
        assertEquals("br.com.digitalisp.telas_1.0.27_all.ipk", l.nomeArquivo)
        assertEquals(11129208L, l.bytes)
    }

    @Test fun recusaListaIncompletaOuInsegura() {
        for (j in listOf(
            """{}""",
            """{"tizen":{"version":"1","sha256":"xyz","bytes":10,"url":"https://a/b"}}""",
            """{"tizen":{"version":"1","sha256":"${"a".repeat(64)}","bytes":0,"url":"https://a/b"}}""",
            """{"tizen":{"version":"1","sha256":"${"a".repeat(64)}","bytes":10,"url":"http://a/b"}}""",
            """{"tizen":{"version":"1","sha256":"${"a".repeat(64)}","bytes":10,"url":"//outro.com/b"}}""",
            "<html>",
        )) {
            try { Pacotes.ler(j, Plataforma.SAMSUNG, S); fail(j) } catch (_: IOException) {}
        }
        // nome de arquivo estranho cai no padrão
        val p = Pacotes.ler("""{"webos":{"version":"1","sha256":"${"a".repeat(64)}","bytes":10,"url":"/x","file":"../../etc/passwd"}}""", Plataforma.LG, S)
        assertEquals("br.com.digitalisp.telas.ipk", p.nomeArquivo)
    }

    @Test fun salvaConferindoOSha256() {
        val dados = ByteArray(150_000) { (it % 13).toByte() }
        val p = Pacote(Plataforma.LG, "1", sha(dados), dados.size.toLong(), "https://x/y", null, "a.ipk")
        val dir = pasta.newFolder()
        val prog = ArrayList<Long>()
        val f = Baixador.salvarConferindo(ByteArrayInputStream(dados), p, dir) { feito, _ -> prog.add(feito) }
        assertEquals(dados.size.toLong(), f.length())
        assertEquals(p.sha256, Baixador.sha256(f))
        assertEquals(dados.size.toLong(), prog.last())
        assertFalse(dir.resolve("a.ipk.parcial").exists())
    }

    @Test fun arquivoAlteradoEApagado() {
        val dados = ByteArray(1000) { 1 }
        val p = Pacote(Plataforma.SAMSUNG, "1", sha(dados), 1000, "https://x/y", null, "a.wgt")
        val dir = pasta.newFolder()
        val outro = dados.copyOf().also { it[500] = 2 }
        try { Baixador.salvarConferindo(ByteArrayInputStream(outro), p, dir) { _, _ -> }; fail() } catch (e: IOException) { assertTrue(e.message!!.contains("não confere")) }
        try { Baixador.salvarConferindo(ByteArrayInputStream(dados.copyOf(999)), p, dir) { _, _ -> }; fail() } catch (e: IOException) { assertTrue(e.message!!.contains("incompleto")) }
        try { Baixador.salvarConferindo(ByteArrayInputStream(dados + byteArrayOf(1)), p, dir) { _, _ -> }; fail() } catch (e: IOException) { assertTrue(e.message!!.contains("maior")) }
        assertTrue("nada fica no cache", dir.listFiles()!!.isEmpty())
    }

    @Test fun servidorPrecisaSerHttps() {
        try { Baixador("http://www.digitalisp.com.br", pasta.newFolder()); fail() } catch (_: IllegalArgumentException) {}
    }
}
