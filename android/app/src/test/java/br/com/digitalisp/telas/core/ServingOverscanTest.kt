package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Contrato §12: as senhas em atendimento ficam listadas abaixo da atual até serem finalizadas. */
class QueueServingTest {
    private fun call(id: Long, ticket: String, desk: String) = QueueCall(id, ticket, desk, null, false, 0L)

    @Test fun leOCampoNovoEOAntigoSemEle() {
        val s = QueueParser.snapshot(
            """{"current":{"id":3,"ticket":"A003","desk":"Consultorio 2"},"last":[],
                "waiting":{"total":0},"serving":[{"id":2,"ticket":"A002","desk":"Consultorio 1"},"lixo",{"id":1}]}""",
        )!!
        assertEquals(listOf("A002"), s.serving!!.map { it.ticket })
        assertNull("servidor antigo: sem o campo", QueueParser.snapshot("""{"current":null,"last":[]}""")!!.serving)
    }

    @Test fun estadoDoServidorValeEAtualNaoRepete() {
        val snap = QueueSnapshot(call(3, "A003", "C2"), emptyList(), null, listOf(call(3, "A003", "C2"), call(2, "A002", "C1")))
        val st = QueueReducer.onSnapshot(QueueState(), snap)
        assertEquals(listOf("A002"), QueueReducer.servingShown(st).map { it.ticket })
    }

    @Test fun chamadaNovaDesceAAnteriorAteOStateChegar() {
        var s = QueueReducer.onSnapshot(QueueState(), QueueSnapshot(call(1, "A001", "Consultorio 1"), emptyList(), null, emptyList()))
        // outro consultório chama: a A001 continua em atendimento, embaixo
        s = QueueReducer.onCall(s, call(2, "A002", "Consultorio 2"), 1000).state
        assertEquals(listOf("A001"), QueueReducer.servingShown(s).map { it.ticket })
        // o Consultório 1 chama a próxima: o servidor encerra a A001 (mesmo consultório), ela sai; a A002 desce
        s = QueueReducer.onCall(s, call(3, "A003", "Consultorio 1"), 2000).state
        assertEquals(listOf("A002"), QueueReducer.servingShown(s).map { it.ticket })
        // repetir a atual não mexe na lista
        s = QueueReducer.onCall(s, call(3, "A003", "Consultorio 1").copy(repeat = true), 3000).state
        assertEquals(listOf("A002"), QueueReducer.servingShown(s).map { it.ticket })
        // finalizar a A002: o state do servidor tira da lista
        s = QueueReducer.onSnapshot(s, QueueSnapshot(call(3, "A003", "Consultorio 1"), emptyList(), null, emptyList()))
        assertEquals(emptyList<String>(), QueueReducer.servingShown(s).map { it.ticket })
    }

    @Test fun ateQuatroEServidorAntigoSemLista() {
        val many = (1L..7L).map { call(it, "A00$it", "C$it") }
        val s = QueueReducer.onSnapshot(QueueState(), QueueSnapshot(null, emptyList(), null, many))
        assertEquals(4, QueueReducer.servingShown(s).size)
        val old = QueueReducer.onCall(QueueState(), call(1, "A001", "C1"), 0).state
        assertNull(QueueReducer.onCall(old, call(2, "A002", "C2"), 0).state.serving)
    }
}

/** Margem de segurança (overscan): de 0 a 8% de cada borda, padrão 0 (a imagem inteira). */
class OverscanTest {
    @Test fun margensPorBorda() {
        assertEquals(Insets(58, 32, 58, 32), Overscan.insets(1920, 1080, 3))
        assertEquals(Insets(0, 0, 0, 0), Overscan.insets(1920, 1080, 0))
        assertEquals(Insets(134, 76, 134, 76), Overscan.insets(1920, 1080, 7))
        assertEquals(Insets(38, 22, 38, 22), Overscan.insets(1280, 720, 3))
        // TV em pé: a largura é a menor
        assertEquals(Insets(54, 96, 54, 96), Overscan.insets(1080, 1920, 5))
        assertEquals(Insets(0, 0, 0, 0), Overscan.insets(0, 1080, 3))
    }

    @Test fun valoresPermitidosEOCiclo() {
        assertEquals(0, Overscan.DEFAULT)
        assertEquals(4, Overscan.clean(4))
        assertEquals(0, Overscan.clean(-1))
        assertEquals(Insets(0, 0, 0, 0), Overscan.insets(1920, 1080, 50)) // fora da lista = o padrão (0)
        assertEquals(listOf(1, 3, 8, 0), listOf(0, 2, 7, 8).map { Overscan.next(it) })
        assertEquals(1, Overscan.next(50)) // desconhecido conta como o padrão
    }
}
