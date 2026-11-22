package br.com.nexatv.telas.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files

/** O caminho inteiro do conteúdo guardado: plano (o que baixar) + download + conferência, com um servidor de mentira. */
class OfflineFetchTest {
    private lateinit var dir: File
    private val content = ByteArray(200_000) { (it * 31 % 251).toByte() }
    private val sha = Hex.sha256(content)
    private val item = OfflineItem("https://cdn.x/video.mp4", sha, content.size.toLong())
    private val name = "$sha.mp4"

    @Before fun setUp() {
        dir = Files.createTempDirectory("nexa-telas-teste").toFile()
    }

    @After fun tearDown() {
        dir.deleteRecursively()
    }

    private fun existing() = dir.listFiles()!!.associate { it.name to it.length() }

    /** Servidor que respeita o Range e conta os pedidos. */
    private class Server(val body: ByteArray, val honorRange: Boolean = true) : OfflineTransport {
        val requests = ArrayList<Long>()
        override fun open(url: String, from: Long): OfflineResponse {
            requests.add(from)
            return if (from > 0 && honorRange) OfflineResponse(206, ByteArrayInputStream(body, from.toInt(), body.size - from.toInt()))
            else OfflineResponse(200, ByteArrayInputStream(body))
        }
    }

    /** Entrega `limit` bytes e derruba a conexão. */
    private class Dropping(val body: ByteArray, val limit: Int) : OfflineTransport {
        override fun open(url: String, from: Long): OfflineResponse {
            val src = ByteArrayInputStream(body, from.toInt(), body.size - from.toInt())
            var sent = 0
            return OfflineResponse(if (from > 0) 206 else 200, object : InputStream() {
                override fun read(): Int = throw UnsupportedOperationException()
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (sent >= limit) throw IOException("conexão caiu")
                    val n = src.read(b, off, minOf(len, limit - sent))
                    if (n > 0) sent += n
                    return n
                }
            })
        }
    }

    @Test fun baixaConfereEDaONomeFinal() {
        val plan = OfflinePlan.reconcile(listOf(item), existing(), 10_000_000, 1_000)
        assertEquals(listOf(item), plan.download)
        val srv = Server(content)
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(plan.download[0], dir, srv))
        assertArrayEquals(content, File(dir, name).readBytes())
        assertFalse(File(dir, "$name.part").exists())
        // na próxima passada não há mais nada a baixar
        val again = OfflinePlan.reconcile(listOf(item), existing(), 10_000_000, 1_000)
        assertEquals(listOf(item), again.keep)
        assertTrue(again.download.isEmpty())
        assertTrue(again.delete.isEmpty())
    }

    @Test fun sha256ErradoApagaEBaixaDeNovoDepois() {
        val corrupted = content.copyOf().also { it[1234] = (it[1234] + 1).toByte() }
        assertEquals(OfflineFetch.Result.BAD_HASH, OfflineFetch.fetch(item, dir, Server(corrupted)))
        // não sobra nem o arquivo nem o parcial
        assertTrue(existing().isEmpty())
        // a passada seguinte põe o item de novo na fila, do zero
        val plan = OfflinePlan.reconcile(listOf(item), existing(), 10_000_000, 1_000)
        assertEquals(listOf(item), plan.download)
        val good = Server(content)
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(item, dir, good))
        assertEquals(listOf(0L), good.requests)
        assertEquals(sha, OfflineFetch.sha256(File(dir, name)))
    }

    @Test fun conexaoQueCaiDeixaOParcialEContinua() {
        assertEquals(OfflineFetch.Result.FAILED, OfflineFetch.fetch(item, dir, Dropping(content, 70_000)))
        val part = File(dir, "$name.part")
        assertEquals(70_000L, part.length())
        // o plano mantém o parcial e pede o item
        val plan = OfflinePlan.reconcile(listOf(item), existing(), 10_000_000, 1_000)
        assertTrue(plan.delete.isEmpty())
        assertEquals(listOf(item), plan.download)
        val srv = Server(content)
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(item, dir, srv))
        assertEquals(listOf(70_000L), srv.requests) // pediu só o que faltava
        assertArrayEquals(content, File(dir, name).readBytes())
    }

    @Test fun servidorQueIgnoraORangeRecomeca() {
        File(dir, "$name.part").writeBytes(content.copyOf(50_000))
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(item, dir, Server(content, honorRange = false)))
        assertArrayEquals(content, File(dir, name).readBytes())
    }

    @Test fun parcialJaCompletoSoConfere() {
        File(dir, "$name.part").writeBytes(content)
        val srv = Server(content)
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(item, dir, srv))
        assertTrue(srv.requests.isEmpty())
    }

    @Test fun parcialEstragadoEApagado() {
        // parcial do tamanho certo mas com conteúdo errado (disco cheio, queda de energia)
        File(dir, "$name.part").writeBytes(ByteArray(content.size))
        assertEquals(OfflineFetch.Result.BAD_HASH, OfflineFetch.fetch(item, dir, Server(content)))
        assertTrue(existing().isEmpty())
    }

    @Test fun arquivoMaiorQueOAnunciado() {
        val bigger = content + ByteArray(10)
        assertEquals(OfflineFetch.Result.BAD_HASH, OfflineFetch.fetch(item, dir, Server(bigger)))
        assertTrue(existing().isEmpty())
    }

    @Test fun erroDoServidor() {
        val failing = OfflineTransport { _, _ -> throw IOException("HTTP 404") }
        assertEquals(OfflineFetch.Result.FAILED, OfflineFetch.fetch(item, dir, failing))
        val weird = OfflineTransport { _, _ -> OfflineResponse(302, ByteArrayInputStream(ByteArray(0))) }
        assertEquals(OfflineFetch.Result.FAILED, OfflineFetch.fetch(item, dir, weird))
    }

    @Test fun cancelado() {
        assertEquals(OfflineFetch.Result.CANCELLED, OfflineFetch.fetch(item, dir, Server(content)) { true })
        assertFalse(File(dir, name).exists())
    }

    @Test fun itemQueSaiuDaListaEApagado() {
        assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetch(item, dir, Server(content)))
        val plan = OfflinePlan.reconcile(emptyList(), existing(), 10_000_000, 1_000)
        assertEquals(listOf(name), plan.delete)
    }
}
