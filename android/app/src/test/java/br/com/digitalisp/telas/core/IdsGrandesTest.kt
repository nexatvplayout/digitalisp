package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contrato §7.3: os alertas de emergência do canal (EAS) chegam com `id` a partir de 1.000.000.000 e podem crescer.
 * Todo id é lido como Long: nada pode cortar em 32 bits nem embaralhar a ordem.
 */
class IdsGrandesTest {
    private val eas = 1_000_000_000L
    private val alemDe32Bits = 5_000_000_000L        // não cabe em Int
    private val enorme = 9_007_199_254_740_993L      // acima de 2^53: também não pode passar por double

    @Test fun alertaDoEasMantemOId() {
        val list = Alerts.parse(
            JSONArray("""[{"id":1000000000,"title":"Alerta de emergência","text":"x","level":"critical","sound":true,"until":1794300000000},
                         {"id":5000000000,"title":"Outro","text":"y","level":"critical"},
                         {"id":9007199254740993,"title":"Maior","text":"z","level":"info"}]"""),
        )
        assertEquals(listOf(eas, alemDe32Bits, enorme), list.map { it.id })
    }

    @Test fun alertaGrandeVaiEVoltaDoQueFicaGuardado() {
        val list = listOf(Alert(eas, "A", "a", 2, true, 0), Alert(alemDe32Bits, "B", "b", 2, false, 99), Alert(enorme, "C", "c", 0, false, 0))
        assertEquals(list, Alerts.parse(Alerts.toJson(list)))
    }

    @Test fun easGanhaDoPainelNoMesmoNivel() {
        // mesmo nível: vale o maior id, e o do EAS é sempre maior que os do painel
        val painel = Alert(42, "Painel", "p", 2, false, 0)
        val doEas = Alert(eas + 7, "EAS", "e", 2, true, 0)
        assertEquals(eas + 7, Alerts.select(listOf(painel, doEas), 100)!!.id)
        assertEquals(eas + 7, Alerts.select(listOf(doEas, painel), 100)!!.id)
        // ordem certa também acima de 32 bits (um corte para Int inverteria)
        val a = Alert(alemDe32Bits, "a", "a", 1, false, 0)
        val b = Alert(alemDe32Bits + 1, "b", "b", 1, false, 0)
        assertEquals(alemDe32Bits + 1, Alerts.select(listOf(b, a), 100)!!.id)
        // 2^32 + 5 cortado em 32 bits viraria 5 e perderia para o 6
        val cortaria = Alert(4_294_967_301L, "c", "c", 1, false, 0)
        assertEquals(4_294_967_301L, Alerts.select(listOf(Alert(6, "d", "d", 1, false, 0), cortaria), 100)!!.id)
    }

    @Test fun nivelAindaVemAntesDoId() {
        val easInfo = Alert(eas, "EAS", "e", 0, false, 0)
        val painelCritico = Alert(3, "Painel", "p", 2, false, 0)
        assertEquals(3L, Alerts.select(listOf(easInfo, painelCritico), 100)!!.id)
    }

    @Test fun ultimoAvisoComIdGrande() {
        val old = listOf(Alert(alemDe32Bits, "A", "a", 2, false, 1000))
        val r = Alerts.recentAfter(null, old, old, 1500)
        assertEquals(alemDe32Bits, r!!.alert.id)
        // encerrado antes da hora: some (a comparação de id não pode cortar)
        val vivo = listOf(Alert(alemDe32Bits, "A", "a", 2, false, 9000))
        assertNull(Alerts.recentAfter(RecentAlert(vivo[0], 1000), vivo, emptyList(), 1500))
    }

    @Test fun chamadaDeSenhaComIdGrande() {
        val c = QueueParser.call("""{"id":5000000000,"ticket":"P012","desk":"Guichê 3","at":1794300000000}""")!!
        assertEquals(alemDe32Bits, c.id)
        val s = QueueParser.snapshot(
            """{"current":{"id":9007199254740993,"ticket":"A1"},"last":[{"id":5000000001,"ticket":"A0"},{"id":5000000000,"ticket":"Z9"}],
                "waiting":{"total":0,"byRisk":null,"avgWaitMin":null}}""",
        )!!
        assertEquals(enorme, s.current!!.id)
        assertEquals(listOf(5_000_000_001L, alemDe32Bits), s.last.map { it.id })
    }

    @Test fun redutorDistingueIdsQueSoDiferemAcimaDe32Bits() {
        // 5.000.000.000 e 705.032.704 são iguais nos 32 bits de baixo: têm de ser chamadas diferentes
        val a = QueueCall(alemDe32Bits, "P001", "Guichê 1", null, false, 1)
        val b = QueueCall(alemDe32Bits.toInt().toLong(), "P002", "Guichê 2", null, false, 2)
        assertEquals(705_032_704L, b.id)
        var r = QueueReducer.onCall(QueueState(), a, 0)
        r = QueueReducer.onCall(r.state, b, 1000)
        assertEquals(b.id, r.state.current!!.id)
        assertEquals(b.id, r.announce!!.id)          // não é "a mesma senha de novo"
        assertEquals(listOf(a.id), r.state.last.map { it.id })
        // repetição da chamada de id grande
        val again = QueueReducer.onCall(QueueState(a), a.copy(repeat = true), 2000)
        assertEquals(alemDe32Bits, again.announce!!.id)
        // estado do servidor: a atual repetida em `last` sai, comparando o id inteiro
        val s = QueueReducer.onSnapshot(QueueState(), QueueSnapshot(a, listOf(a, b), null))
        assertEquals(listOf(b.id), s.last.map { it.id })
    }

    @Test fun estadoComoOServidorManda() {
        // §7.3: `last` vem sem a atual, `byRisk` com as cinco chaves, e o cliente sem senha manda tudo vazio
        val s = QueueParser.snapshot(
            """{"current":{"id":91,"ticket":"P012","desk":"Guichê 3","name":null,"priority":false,"at":5},
                "last":[{"id":90,"ticket":"N044","desk":"Guichê 1"}],
                "waiting":{"total":14,"byRisk":{"vermelho":0,"laranja":1,"amarelo":3,"verde":8,"azul":2},"avgWaitMin":22}}""",
        )!!
        assertEquals(listOf("vermelho", "laranja", "amarelo", "verde", "azul"), s.waiting!!.byRisk!!.map { it.first })
        val vazio = QueueParser.snapshot("""{"current":null,"last":[],"waiting":{"total":0,"byRisk":null,"avgWaitMin":null}}""")!!
        assertNull(vazio.current)
        assertTrue(vazio.last.isEmpty())
        assertEquals(QueueWaiting(0, null, null), vazio.waiting)
    }

    @Test fun streamComecaComOk() {
        // o `: ok` do começo é só um comentário; o `state` que vem em seguida é o estado inteiro
        val p = SseParser()
        val evs = p.feed(": ok\n\nevent: state\ndata: {\"current\":null,\"last\":[],\"waiting\":{\"total\":0,\"byRisk\":null,\"avgWaitMin\":null}}\n\n: ping\n\n")
        assertEquals(1, evs.size)
        assertEquals("state", evs[0].event)
        assertEquals(2, p.comments)
        assertEquals(QueueWaiting(0, null, null), QueueParser.snapshot(evs[0].data)!!.waiting)
    }

    @Test fun idDoCartaoETexto() {
        val c = ConfigParser.parse("""{"cards":[{"id":"cardapio-12","title":"Cardápio","lines":["x"]},{"id":"unidade-5000000000","title":"Aviso","lines":["y"]},{"id":77,"title":"Número","lines":["z"]}]}""").cards
        assertEquals(listOf("cardapio-12", "unidade-5000000000", "77"), c.map { it.id })
    }

    @Test fun idDoAparelhoGrande() {
        assertEquals(alemDe32Bits, ConfigParser.parse("""{"device":{"id":5000000000,"name":"Tela"}}""").device.id)
    }
}
