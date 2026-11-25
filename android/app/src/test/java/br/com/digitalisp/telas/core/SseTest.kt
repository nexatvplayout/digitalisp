package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SseTest {
    @Test fun eventoSimples() {
        val p = SseParser()
        assertEquals(listOf(SseEvent("call", """{"id":1}""")), p.feed("event: call\ndata: {\"id\":1}\n\n"))
    }

    @Test fun semNomeEMessage() {
        assertEquals(listOf(SseEvent("message", "oi")), SseParser().feed("data: oi\n\n"))
    }

    @Test fun variosEventosNumPedaco() {
        val evs = SseParser().feed("event: call\ndata: a\n\nevent: state\ndata: b\n\n")
        assertEquals(listOf(SseEvent("call", "a"), SseEvent("state", "b")), evs)
    }

    @Test fun dataEmVariasLinhas() {
        val evs = SseParser().feed("event: state\ndata: {\"a\":1,\ndata:  \"b\":2}\n\n")
        assertEquals(listOf(SseEvent("state", "{\"a\":1,\n \"b\":2}")), evs)
    }

    @Test fun comentarioDePing() {
        val p = SseParser()
        assertTrue(p.feed(": ping\n\n").isEmpty())
        assertTrue(p.feed(":\n").isEmpty())
        assertEquals(2, p.comments)
        // ping no meio de um evento não o quebra
        assertEquals(listOf(SseEvent("call", "x")), p.feed("event: call\n: ping\ndata: x\n\n"))
        assertEquals(3, p.comments)
    }

    @Test fun pedacosPartidosEmQualquerLugar() {
        val text = "event: call\ndata: {\"id\":91,\"ticket\":\"P012\"}\n\n: ping\n\nevent: state\ndata: {\"waiting\":{\"total\":3}}\n\n"
        val inteiro = SseParser().feed(text)
        assertEquals(2, inteiro.size)
        // byte a byte
        val p = SseParser()
        val um = text.flatMap { p.feed(it.toString()) }
        assertEquals(inteiro, um)
        // em pedaços de 7
        val q = SseParser()
        val sete = text.chunked(7).flatMap { q.feed(it) }
        assertEquals(inteiro, sete)
        assertEquals(1, q.comments)
    }

    @Test fun eventoSoFechaNaLinhaEmBranco() {
        val p = SseParser()
        assertTrue(p.feed("event: call\ndata: x\n").isEmpty())
        assertEquals(listOf(SseEvent("call", "x")), p.feed("\n"))
    }

    @Test fun fimDeLinhaCrLfECr() {
        assertEquals(listOf(SseEvent("call", "x")), SseParser().feed("event: call\r\ndata: x\r\n\r\n"))
        assertEquals(listOf(SseEvent("call", "x")), SseParser().feed("event: call\rdata: x\r\r"))
        // \r no fim de um pedaço e \n no começo do outro são um fim de linha só
        val p = SseParser()
        val evs = p.feed("event: call\r") + p.feed("\ndata: x\r") + p.feed("\n\r") + p.feed("\n")
        assertEquals(listOf(SseEvent("call", "x")), evs)
    }

    @Test fun eventoSemDataEDescartado() {
        val p = SseParser()
        assertTrue(p.feed("event: call\n\n").isEmpty())
        // e o nome não vaza para o próximo
        assertEquals(listOf(SseEvent("message", "y")), p.feed("data: y\n\n"))
    }

    @Test fun camposSemEspacoEDesconhecidos() {
        val evs = SseParser().feed("id: 7\nretry: 3000\nevent:call\ndata:x\nfoo: bar\ndata\n\n")
        // "data" sem dois-pontos é uma linha de data vazia
        assertEquals(listOf(SseEvent("call", "x\n")), evs)
    }

    @Test fun acentosNoTexto() {
        assertEquals(listOf(SseEvent("call", "Guichê 3")), SseParser().feed("event: call\ndata: Guichê 3\n\n"))
    }
}
