package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertsTest {
    private fun a(id: Long, level: Int, until: Long = 0) = Alert(id, "t$id", "x", level, false, until)

    @Test fun leDoServidor() {
        val list = Alerts.parse(
            JSONArray("""[{"id":3,"title":"Aviso geral","text":"Chuva forte","level":"critical","sound":true,"until":1794300000000},
                         {"id":4,"title":"Aviso","text":"","level":"desconhecido"},
                         {"id":5},"lixo"]"""),
        )
        assertEquals(2, list.size)
        assertEquals(Alert(3, "Aviso geral", "Chuva forte", 2, true, 1794300000000L), list[0])
        assertEquals(0, list[1].level)
        assertEquals(0L, list[1].until)
    }

    @Test fun idaEVolta() {
        val list = listOf(a(1, 0, 50), Alert(2, "Título", "Texto com \"aspas\"", 2, true, 0))
        assertEquals(list, Alerts.parse(Alerts.toJson(list)))
        assertTrue(Alerts.parse("não é json").isEmpty())
        assertTrue(Alerts.parse(null as String?).isEmpty())
    }

    @Test fun maiorNivelGanha() {
        assertEquals(2L, Alerts.select(listOf(a(9, 0), a(2, 2), a(5, 1)), 100)!!.id)
    }

    @Test fun empateFicaComOMaisNovo() {
        assertEquals(7L, Alerts.select(listOf(a(3, 1), a(7, 1), a(5, 1)), 100)!!.id)
    }

    @Test fun vencidoNaoAparece() {
        assertEquals(1L, Alerts.select(listOf(a(1, 0, 0), a(2, 2, 100)), 100)!!.id) // until == agora já venceu
        assertEquals(2L, Alerts.select(listOf(a(1, 0, 0), a(2, 2, 101)), 100)!!.id)
        assertNull(Alerts.select(listOf(a(2, 2, 50)), 100))
        assertNull(Alerts.select(emptyList(), 100))
    }

    @Test fun recenteQuandoVenceNoHorario() {
        val old = listOf(a(1, 1, 1000))
        val r = Alerts.recentAfter(null, old, old, 1500)
        assertEquals(1L, r!!.alert.id)
        assertEquals(1000L, r.endedAt)
        // some depois de 30 min
        assertNull(Alerts.recentAfter(r, emptyList(), emptyList(), 1000 + Alerts.RECENT_MS))
        assertEquals(r, Alerts.recentAfter(r, emptyList(), emptyList(), 1000 + Alerts.RECENT_MS - 1))
    }

    @Test fun encerradoAntesDaHoraNaoViraRecente() {
        val old = listOf(a(1, 1, 9000))
        assertNull(Alerts.recentAfter(null, old, emptyList(), 1500))
        // e derruba o recente se for o mesmo
        val r = RecentAlert(a(1, 1, 9000), 1000)
        assertNull(Alerts.recentAfter(r, old, emptyList(), 1500))
    }

    @Test fun recenteFicaComOQueTerminouPorUltimo() {
        val old = listOf(a(1, 2, 1000), a(2, 0, 1200), a(3, 1, 5000))
        assertEquals(2L, Alerts.recentAfter(null, old, old, 1300)!!.alert.id)
    }
}
