package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Opcionais nos alertas: `header` e `test` (servidor sem eles = o de sempre); `category` é ignorado. */
class AlertsCabecalhoTest {
    private fun one(extra: String): Alert =
        Alerts.parse(JSONArray("""[{"id":3,"title":"Aviso de teste","text":"Texto de teste","level":"critical","sound":true,"until":1794300000000$extra}]""")).single()

    @Test fun camposOpcionais() {
        val a = one(""","header":"Aviso urgente · Loja Centro","test":false""")
        assertEquals("Aviso urgente · Loja Centro", a.header)
        assertFalse(a.test)
        assertEquals(2, a.level) // o nível continua mandando na cor e na prioridade
        assertTrue(a.sound)
    }

    @Test fun servidorSemOsCampos() {
        val a = one("")
        assertEquals("", a.header)
        assertFalse(a.test)
        assertEquals(Alert(3, "Aviso de teste", "Texto de teste", 2, true, 1794300000000L), a)
    }

    @Test fun categoriaQueOServidorMandeEIgnorada() {
        assertEquals(Alert(3, "Aviso de teste", "Texto de teste", 2, true, 1794300000000L), one(""","category":"meteorologico""""))
    }

    @Test fun tiposErradosValemComoAusentes() {
        for (bad in listOf("null", "7", "true", "[\"A\"]", "{\"a\":1}", "\"\"", "\"   \"")) {
            assertEquals("header $bad", "", one(""","header":$bad""").header)
        }
        for (bad in listOf("null", "1", "\"true\"", "\"sim\"", "[]", "{}", "false")) {
            assertFalse("test $bad", one(""","test":$bad""").test)
        }
        assertTrue(one(""","test":true""").test)
    }

    @Test fun cabecalhoCortadoEmSessentaEUmaLinhaSo() {
        assertEquals(60, one(""","header":"${"A".repeat(200)}"""").header.length)
        assertEquals("AVISO URGENTE · LOJA CENTRO", one(""","header":"  AVISO URGENTE\n· LOJA   CENTRO  """").header)
    }

    @Test fun escolhaDoCabecalho() {
        // sem header: o de sempre, pelo nível
        assertEquals("AVISO", Alerts.headerFor(Alert(1, "t", "x", 0, false, 0)))
        assertEquals("ATENÇÃO", Alerts.headerFor(Alert(1, "t", "x", 1, false, 0)))
        assertEquals("ALERTA", Alerts.headerFor(Alert(1, "t", "x", 2, false, 0)))
        // com header: o do servidor, em caixa alta
        assertEquals("AVISO · LOJA CENTRO", Alerts.headerFor(Alert(1, "t", "x", 0, false, 0, header = "AVISO · Loja Centro")))
        assertEquals("ATENÇÃO À ÁREA", Alerts.headerFor(Alert(1, "t", "x", 1, false, 0, header = "atenção à área")))
        // teste: o header vem do servidor; a palavra TESTE grande é desenhada à parte
        val teste = Alert(9, "Simulado", "x", 1, false, 0, header = "TESTE DO SISTEMA", test = true)
        assertEquals("TESTE DO SISTEMA", Alerts.headerFor(teste))
        assertTrue(teste.test)
    }

    @Test fun idaEVoltaDoQueFicaGuardado() {
        val list = listOf(
            Alert(1, "Título de teste", "Texto", 2, true, 50, header = "AVISO URGENTE", test = false),
            Alert(2, "Simulado", "Texto", 1, false, 0, header = "TESTE DO SISTEMA", test = true),
            Alert(3, "Antigo", "Texto", 0, false, 0),
        )
        assertEquals(list, Alerts.parse(Alerts.toJson(list)))
    }

    @Test fun prioridadeContinuaPeloNivel() {
        val list = listOf(
            Alert(1, "info com header", "x", 0, false, 0, header = "ALERTA EXTREMO"),
            Alert(2, "critico de teste", "x", 2, false, 0, test = true),
            Alert(3, "warn", "x", 1, false, 0),
        )
        assertEquals(2L, Alerts.select(list, 1000)!!.id)
    }
}
