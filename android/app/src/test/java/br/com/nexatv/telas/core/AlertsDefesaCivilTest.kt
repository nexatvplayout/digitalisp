package br.com.nexatv.telas.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §9: `header`, `category` e `test` nos alertas (todos opcionais; servidor antigo não manda). */
class AlertsDefesaCivilTest {
    private fun one(extra: String): Alert =
        Alerts.parse(JSONArray("""[{"id":3,"title":"Chuva intensa na Zona de Teste","text":"Texto de teste","level":"critical","sound":true,"until":1794300000000$extra}]""")).single()

    @Test fun camposNovos() {
        val a = one(""","header":"Alerta extremo · Defesa Civil","category":"meteorologico","test":false""")
        assertEquals("Alerta extremo · Defesa Civil", a.header)
        assertEquals("meteorologico", a.category)
        assertFalse(a.test)
        assertEquals(2, a.level) // o nível continua mandando na cor e na prioridade
        assertTrue(a.sound)
    }

    @Test fun servidorAntigoSemOsCampos() {
        val a = one("")
        assertEquals("", a.header)
        assertEquals("", a.category)
        assertFalse(a.test)
        assertEquals(Alert(3, "Chuva intensa na Zona de Teste", "Texto de teste", 2, true, 1794300000000L), a)
    }

    @Test fun tiposErradosValemComoAusentes() {
        for (bad in listOf("null", "7", "true", "[\"A\"]", "{\"a\":1}", "\"\"", "\"   \"")) {
            assertEquals("header $bad", "", one(""","header":$bad""").header)
        }
        for (bad in listOf("null", "7", "true", "[]", "{}", "\"\"", "\"terremoto-lunar\"")) {
            assertEquals("category $bad", "", one(""","category":$bad""").category)
        }
        for (bad in listOf("null", "1", "\"true\"", "\"sim\"", "[]", "{}", "false")) {
            assertFalse("test $bad", one(""","test":$bad""").test)
        }
        assertTrue(one(""","test":true""").test)
    }

    @Test fun todasAsCategorias() {
        for (c in listOf("meteorologico", "geologico", "tecnologico", "incendio-ar", "saude", "teste", "outro")) {
            assertEquals(c, one(""","category":"$c"""").category)
        }
        assertEquals("saude", one(""","category":" SAUDE """").category)
    }

    @Test fun cabecalhoCortadoEmSessentaEUmaLinhaSo() {
        assertEquals(60, one(""","header":"${"A".repeat(200)}"""").header.length)
        assertEquals("ALERTA SEVERO · DEFESA CIVIL", one(""","header":"  ALERTA SEVERO\n· DEFESA   CIVIL  """").header)
    }

    @Test fun escolhaDoCabecalho() {
        // sem header: o de sempre, pelo nível
        assertEquals("AVISO", Alerts.headerFor(Alert(1, "t", "x", 0, false, 0)))
        assertEquals("ATENÇÃO", Alerts.headerFor(Alert(1, "t", "x", 1, false, 0)))
        assertEquals("ALERTA", Alerts.headerFor(Alert(1, "t", "x", 2, false, 0)))
        // com header: o do servidor, em caixa alta
        assertEquals("ALERTA EXTREMO · DEFESA CIVIL", Alerts.headerFor(Alert(1, "t", "x", 2, false, 0, header = "Alerta extremo · Defesa Civil")))
        assertEquals("AVISO · UBS CENTRO", Alerts.headerFor(Alert(1, "t", "x", 0, false, 0, header = "AVISO · UBS Centro")))
        assertEquals("ATENÇÃO À ÁREA", Alerts.headerFor(Alert(1, "t", "x", 1, false, 0, header = "atenção à área")))
        // teste: o header vem do servidor; a palavra TESTE grande é desenhada à parte
        val teste = Alert(9, "Simulado", "x", 1, false, 0, header = "TESTE DO SISTEMA", category = "teste", test = true)
        assertEquals("TESTE DO SISTEMA", Alerts.headerFor(teste))
        assertTrue(teste.test)
    }

    @Test fun idaEVoltaDoQueFicaGuardadoComOsCamposNovos() {
        val list = listOf(
            Alert(1, "Título de teste", "Texto", 2, true, 50, header = "ALERTA EXTREMO · DEFESA CIVIL", category = "geologico", test = false),
            Alert(2, "Simulado", "Texto", 1, false, 0, header = "TESTE DO SISTEMA", category = "teste", test = true),
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

    /** Contrato §10: segurança pública. */
    @Test fun categoriasDeSegurancaETransito() {
        val s = one(""","header":"ALERTA · GUARDA MUNICIPAL","category":"seguranca"""")
        assertEquals("seguranca", s.category)
        assertEquals("ALERTA · GUARDA MUNICIPAL", Alerts.headerFor(s))
        assertEquals("transito", one(""","category":"transito"""").category)
        assertEquals(9, Alerts.CATEGORIES.size)
    }
}
