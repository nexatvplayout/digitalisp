package br.com.digitalisp.instalador.adb

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.Signature
import java.security.cert.X509Certificate

class ProtocoloSyncTest {
    private fun le32(b: ByteArray, at: Int) = ByteBuffer.wrap(b, at, 4).order(ByteOrder.LITTLE_ENDIAN).int

    @Test fun sendTemCaminhoEModoDecimal() {
        val b = ProtocoloSync.send("/data/local/tmp/a.apk")
        assertEquals("SEND", String(b, 0, 4))
        val corpo = "/data/local/tmp/a.apk,420"
        assertEquals(corpo.length, le32(b, 4))
        assertEquals(corpo, String(b, 8, b.size - 8))
    }

    @Test fun escreveArquivoEmBlocosQueCabemNumaEscrita() {
        val dados = ByteArray(10_000) { (it % 251).toByte() }
        val escritas = ArrayList<ByteArray>()
        val saida = object : OutputStream() {
            override fun write(b: Int) = fail("escrita de 1 byte não deveria acontecer")
            override fun write(b: ByteArray, off: Int, len: Int) { escritas.add(b.copyOfRange(off, off + len)) }
        }
        val progresso = ArrayList<Long>()
        ProtocoloSync.escrever(saida, ByteArrayInputStream(dados), dados.size.toLong(), "/x.apk", porEscrita = 4096, mtimeSegundos = 7) { progresso.add(it) }

        assertTrue("nenhuma escrita passa do limite do ADB", escritas.all { it.size <= 4096 })
        assertEquals("SEND", String(escritas.first(), 0, 4))
        val done = escritas.last()
        assertEquals("DONE", String(done, 0, 4))
        assertEquals(7, le32(done, 4))
        // remonta os DATA e confere os bytes
        val remontado = ByteArrayOutputStream()
        for (w in escritas.drop(1).dropLast(1)) {
            assertEquals("DATA", String(w, 0, 4))
            assertEquals(w.size - 8, le32(w, 4))
            remontado.write(w, 8, w.size - 8)
        }
        assertArrayEquals(dados, remontado.toByteArray())
        assertEquals(10_000L, progresso.last())
    }

    @Test fun limitaDataA64KMesmoComTransporteGrande() {
        val dados = ByteArray(200_000)
        val escritas = ArrayList<Int>()
        val saida = object : OutputStream() {
            override fun write(b: Int) = Unit
            override fun write(b: ByteArray, off: Int, len: Int) { escritas.add(len) }
        }
        ProtocoloSync.escrever(saida, ByteArrayInputStream(dados), dados.size.toLong(), "/x", porEscrita = 1024 * 1024, mtimeSegundos = 0) {}
        assertTrue(escritas.drop(1).dropLast(1).all { it <= ProtocoloSync.MAX_DADOS + 8 })
    }

    @Test fun arquivoMenorQueOEsperadoEErro() {
        try {
            ProtocoloSync.escrever(ByteArrayOutputStream(), ByteArrayInputStream(ByteArray(10)), 20, "/x", 4096, 0) {}
            fail()
        } catch (e: IOException) {
            assertTrue(e.message!!.contains("incompleto"))
        }
    }

    @Test fun leRespostas() {
        assertNull(ProtocoloSync.lerResposta(ByteArrayInputStream(ProtocoloSync.cabecalho("OKAY", 0))))
        val msg = "couldn't create file: Read-only file system".toByteArray()
        assertEquals(String(msg), ProtocoloSync.lerResposta(ByteArrayInputStream(ProtocoloSync.cabecalho("FAIL", msg.size) + msg)))
        assertTrue(ProtocoloSync.lerResposta(ByteArrayInputStream(ProtocoloSync.cabecalho("WHAT", 0)))!!.contains("inesperada"))
    }
}

class SaidaComandosTest {
    @Test fun sucesso() {
        assertEquals(ResultadoPm.Sucesso, SaidaComandos.lerPmInstall("Performing Streamed Install\nSuccess\n"))
        assertEquals(ResultadoPm.Sucesso, SaidaComandos.lerPmInstall("\tpkg: /data/local/tmp/a.apk\r\nSuccess\r\n"))
    }

    @Test fun opcaoGDesconhecida() {
        assertEquals(ResultadoPm.OpcaoDesconhecida, SaidaComandos.lerPmInstall("Error: Unknown option: -g"))
    }

    @Test fun falhasConhecidasTemExplicacao() {
        val r = SaidaComandos.lerPmInstall("Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]") as ResultadoPm.Falha
        assertEquals("INSTALL_FAILED_INSUFFICIENT_STORAGE", r.codigo)
        assertTrue(r.explicacao.contains("sem espaço"))
        val d = SaidaComandos.lerPmInstall("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]") as ResultadoPm.Falha
        assertTrue(d.explicacao.contains("mais nova"))
    }

    @Test fun falhaDesconhecidaMostraOCodigo() {
        val r = SaidaComandos.lerPmInstall("Failure [INSTALL_FAILED_QUALQUER_COISA]") as ResultadoPm.Falha
        assertTrue(r.explicacao.contains("INSTALL_FAILED_QUALQUER_COISA"))
        val s = SaidaComandos.lerPmInstall("") as ResultadoPm.Falha
        assertEquals("DESCONHECIDO", s.codigo)
    }

    @Test fun monkey() {
        assertTrue(SaidaComandos.abriuComMonkey("Events injected: 1\n## Network stats: elapsed time=12ms"))
        assertFalse(SaidaComandos.abriuComMonkey("** No activities found to run, monkey aborted."))
    }

    @Test fun comandosAbrirRecusamPacoteComTruqueDeShell() {
        assertEquals(2, SaidaComandos.comandosAbrir("br.com.digitalisp.telas").size)
        for (ruim in listOf("a.b; reboot", "a.b && rm -rf /", "semponto", "a.b\$(id)")) {
            try { SaidaComandos.comandosAbrir(ruim); fail(ruim) } catch (_: IllegalArgumentException) {}
        }
    }
}

class ChavesAdbTest {
    @get:Rule val pasta = TemporaryFolder()

    @Test fun geraUmaVezEGuardaParaAsProximas() {
        val dir = pasta.newFolder("adb")
        val (chave1, cert1) = ChavesAdb(dir).obter()
        val (chave2, cert2) = ChavesAdb(dir).obter() // nova instância lê do disco
        assertArrayEquals(chave1.encoded, chave2.encoded)
        assertArrayEquals(cert1.encoded, cert2.encoded)
        assertEquals("RSA", chave1.algorithm)

        // o certificado é da mesma chave
        val x = cert1 as X509Certificate
        val s = Signature.getInstance("SHA256withRSA")
        s.initSign(chave1); s.update("teste".toByteArray())
        val assinatura = s.sign()
        s.initVerify(x.publicKey); s.update("teste".toByteArray())
        assertTrue(s.verify(assinatura))
        x.checkValidity()
    }

    @Test fun arquivoEstragadoGeraChaveNova() {
        val dir = pasta.newFolder("adb2")
        ChavesAdb(dir).obter()
        dir.resolve("adb_chave.pk8").writeBytes(byteArrayOf(1, 2, 3))
        val (chave, _) = ChavesAdb(dir).obter()
        assertEquals("RSA", chave.algorithm)
    }
}
