package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueTest {
    private fun call(id: Long, ticket: String = "P%03d".format(id), desk: String = "Guichê 3", name: String? = null, repeat: Boolean = false) =
        QueueCall(id, ticket, desk, name, false, 1000L * id, repeat)

    // ---- leitura ----
    @Test fun leChamada() {
        val c = QueueParser.call("""{"id":91,"ticket":"P012","desk":"Guichê 3","name":null,"priority":true,"at":1794300000000}""")
        assertEquals(QueueCall(91, "P012", "Guichê 3", null, true, 1794300000000L, false), c)
        assertTrue(QueueParser.call("""{"id":91,"ticket":"P012","repeat":true}""")!!.repeat)
        assertNull(QueueParser.call("""{"id":91}"""))
        assertNull(QueueParser.call("lixo"))
    }

    @Test fun leEstadoInteiro() {
        val s = QueueParser.snapshot(
            """{"current":{"id":91,"ticket":"P012","desk":"Guichê 3","name":"Maria S.","priority":false,"at":5},
                "last":[{"id":90,"ticket":"N044","desk":"Guichê 1"},{"id":89,"ticket":"N043","desk":"Guichê 2"},"lixo"],
                "waiting":{"total":14,"byRisk":{"azul":2,"vermelho":0,"verde":8,"laranja":1,"amarelo":3},"avgWaitMin":22}}""",
        )!!
        assertEquals("P012", s.current!!.ticket)
        assertEquals("Maria S.", s.current!!.name)
        assertEquals(listOf(90L, 89L), s.last.map { it.id })
        assertEquals(14, s.waiting!!.total)
        // sempre na ordem da classificação de risco, não na ordem em que veio
        assertEquals(listOf("vermelho" to 0, "laranja" to 1, "amarelo" to 3, "verde" to 8, "azul" to 2), s.waiting!!.byRisk)
        assertEquals(22, s.waiting!!.avgWaitMin)
    }

    @Test fun estadoVazioESemRisco() {
        val s = QueueParser.snapshot("""{"current":null,"last":[],"waiting":{"total":3,"byRisk":null,"avgWaitMin":null}}""")!!
        assertNull(s.current)
        assertTrue(s.last.isEmpty())
        assertNull(s.waiting!!.byRisk)
        assertNull(s.waiting!!.avgWaitMin)
        assertNull(QueueParser.snapshot("{}")!!.waiting)
        assertNull(QueueParser.snapshot("[1,2]"))
    }

    // ---- redutor ----
    @Test fun chamadaNovaAnunciaEDestaca() {
        val r = QueueReducer.onCall(QueueState(), call(1), 5000)
        assertEquals(1L, r.state.current!!.id)
        assertEquals(1L, r.announce!!.id)
        assertTrue(QueueReducer.highlighted(r.state, 5000))
        assertTrue(QueueReducer.highlighted(r.state, 14_999))
        assertFalse(QueueReducer.highlighted(r.state, 15_000))
    }

    @Test fun anteriorDesceParaAsUltimas() {
        var s = QueueState()
        for (i in 1L..14L) s = QueueReducer.onCall(s, call(i), i * 1000).state
        assertEquals(14L, s.current!!.id)
        assertEquals((13L downTo 2L).toList(), s.last.map { it.id }) // só 12 (20/11; eram 5), mais nova primeiro
    }

    @Test fun repeticaoAnunciaDeNovoSemMexerNaLista() {
        var s = QueueReducer.onCall(QueueState(), call(1), 0).state
        s = QueueReducer.onCall(s, call(2), 1000).state
        val r = QueueReducer.onCall(s, call(2, repeat = true), 60_000)
        assertEquals(2L, r.announce!!.id)
        assertTrue(r.announce!!.repeat)
        assertEquals(2L, r.state.current!!.id)
        assertEquals(listOf(1L), r.state.last.map { it.id })
        assertTrue(QueueReducer.highlighted(r.state, 69_999))
    }

    @Test fun entregaRepetidaSemRepeatNaoAnuncia() {
        val s = QueueReducer.onCall(QueueState(), call(2), 1000).state
        val r = QueueReducer.onCall(s, call(2), 5000)
        assertNull(r.announce)
        assertEquals(s, r.state)
    }

    @Test fun repeticaoDeSenhaAntigaVoltaASerAAtual() {
        var s = QueueReducer.onCall(QueueState(), call(1), 0).state
        s = QueueReducer.onCall(s, call(2), 1000).state
        val r = QueueReducer.onCall(s, call(1, repeat = true), 2000)
        assertEquals(1L, r.state.current!!.id)
        assertEquals(listOf(2L), r.state.last.map { it.id })
        assertEquals(1L, r.announce!!.id)
    }

    @Test fun estadoDoServidorSubstituiSemAnunciar() {
        var s = QueueReducer.onCall(QueueState(), call(5), 1000).state
        val snap = QueueSnapshot(call(5), listOf(call(5), call(4), call(3)), QueueWaiting(9, null, 12))
        s = QueueReducer.onSnapshot(s, snap)
        assertEquals(5L, s.current!!.id)
        assertEquals(listOf(4L, 3L), s.last.map { it.id }) // a atual não se repete nas últimas
        assertEquals(9, s.waiting!!.total)
        assertTrue(QueueReducer.highlighted(s, 2000)) // mesma senha: o destaque em curso continua
    }

    @Test fun servidorQueMandaPoucasNaoApagaAsAnteriores() {
        // 20/11: servidor antigo manda só 5 últimas; a tela guarda as que já tinha, até 12, sem repetir
        var s = QueueState()
        for (i in 1L..10L) s = QueueReducer.onCall(s, call(i), i * 1000).state
        s = QueueReducer.onSnapshot(s, QueueSnapshot(call(11), listOf(call(10), call(9), call(8), call(7), call(6)), null))
        assertEquals(11L, s.current!!.id)
        assertEquals((10L downTo 1L).toList(), s.last.map { it.id })
        // dia novo / fila zerada no servidor: a lista limpa
        s = QueueReducer.onSnapshot(s, QueueSnapshot(null, emptyList(), null))
        assertTrue(s.last.isEmpty())
    }

    @Test fun estadoComOutraSenhaNaoDestaca() {
        var s = QueueReducer.onCall(QueueState(), call(5), 1000).state
        s = QueueReducer.onSnapshot(s, QueueSnapshot(call(8), emptyList(), null))
        assertEquals(8L, s.current!!.id)
        assertFalse(QueueReducer.highlighted(s, 2000)) // chamada perdida enquanto estava fora do ar: sem voz atrasada
        s = QueueReducer.onSnapshot(s, QueueSnapshot(null, emptyList(), null))
        assertNull(s.current)
    }

    @Test fun esperaMudaSemMexerNaSenha() {
        var s = QueueReducer.onCall(QueueState(), call(5), 1000).state
        s = QueueReducer.onSnapshot(s, QueueSnapshot(call(5), emptyList(), QueueWaiting(20, listOf("verde" to 20), null)))
        assertEquals(20, s.waiting!!.total)
        assertEquals(5L, s.current!!.id)
    }

    // ---- fala ----
    @Test fun soletraASenha() {
        assertEquals("pê zero um dois", SpeechText.ticket("P012"))
        assertEquals("á bê um zero", SpeechText.ticket("ab-10"))
        assertEquals("nove nove nove", SpeechText.ticket("999"))
    }

    @Test fun numerosDoGuiche() {
        assertEquals("guichê três", SpeechText.desk("Guichê 3"))
        assertEquals("sala doze", SpeechText.desk("Sala 12"))
        assertEquals("consultório vinte e um", SpeechText.desk("Consultório 21"))
        assertEquals("guichê quarenta", SpeechText.desk("Guichê 40"))
        assertEquals("mesa um zero cinco", SpeechText.desk("Mesa 105"))
        assertEquals("sala dois, porta sete", SpeechText.desk("Sala 2, porta 7"))
        assertEquals("zero", SpeechText.number("0"))
        assertEquals("dezenove", SpeechText.number("19"))
        assertEquals("noventa e nove", SpeechText.number("99"))
        assertEquals("sete", SpeechText.number("07"))
    }

    @Test fun fraseDaChamada() {
        assertEquals("Senha pê zero um dois, guichê três", SpeechText.build(call(1, "P012"), showName = false))
        assertEquals("Senha pê zero um dois", SpeechText.build(call(1, "P012", desk = ""), showName = false))
    }

    @Test fun nomeNoLugarDaSenha() {
        assertEquals("Maria S., guichê três", SpeechText.build(call(1, "P012", name = "Maria S."), showName = true))
        // showName desligado ou sem nome: fala a senha
        assertEquals("Senha pê zero um dois, guichê três", SpeechText.build(call(1, "P012", name = "Maria S."), showName = false))
        assertEquals("Senha pê zero um dois, guichê três", SpeechText.build(call(1, "P012", name = " "), showName = true))
    }

    // ---- cartões ----
    private fun card(sec: Int) = CardCfg("c$sec", "t", emptyList(), sec)

    @Test fun cadaCartaoFicaOSeuTempo() {
        val cards = listOf(card(12), card(5), card(8))
        assertEquals(0, CardRotation.indexAt(cards, 0))
        assertEquals(0, CardRotation.indexAt(cards, 11_999))
        assertEquals(1, CardRotation.indexAt(cards, 12_000))
        assertEquals(1, CardRotation.indexAt(cards, 16_999))
        assertEquals(2, CardRotation.indexAt(cards, 17_000))
        assertEquals(2, CardRotation.indexAt(cards, 24_999))
        assertEquals(0, CardRotation.indexAt(cards, 25_000)) // recomeça
        assertEquals(1, CardRotation.indexAt(cards, 25_000L * 1000 + 13_000))
    }

    @Test fun umCartaoOuNenhum() {
        assertEquals(-1, CardRotation.indexAt(emptyList(), 5000))
        assertEquals(0, CardRotation.indexAt(listOf(card(10)), 999_999))
    }

    // ---- espera da reconexão ----
    @Test fun esperaDe1a30s() {
        val seen = ArrayList<Long>()
        var w = Backoff.FIRST_MS
        repeat(8) {
            seen.add(w)
            w = Backoff.next(w)
        }
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16_000L, 30_000L, 30_000L, 30_000L), seen)
    }
}
