package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §7.1: clima, cartões e senha no /config. Tudo opcional: servidor antigo = recurso desligado. */
class ConfigFase3Test {
    @Test fun servidorAntigoSemOsCampos() {
        val c = ConfigParser.parse("""{"rev":"a","layout":"side","stream":{"hls":"https://a.b/c.m3u8"}}""")
        assertNull(c.weather)
        assertTrue(c.cards.isEmpty())
        assertFalse(c.queue.enabled)
        assertFalse(c.queue.voice)
        assertEquals(Layout.SIDE, c.effectiveLayout)
    }

    @Test fun clima() {
        val w = ConfigParser.parse("""{"weather":{"city":"Niterói","tempC":26.6,"condition":"Parcialmente nublado","icon":"partly","at":1794300000000}}""").weather!!
        assertEquals(WeatherCfg("Niterói", 27, "Parcialmente nublado", "partly", 1794300000000L), w)
    }

    @Test fun osSeisIcones() {
        for (icon in listOf("clear", "cloudy", "partly", "rain", "storm", "fog")) {
            val json = """{"weather":{"tempC":20,"icon":"ICON"}}""".replace("ICON", icon)
            assertEquals(icon, ConfigParser.parse(json).weather!!.icon)
        }
        // ícone desconhecido vira nuvem; temperatura negativa vale
        val x = ConfigParser.parse("""{"weather":{"tempC":-3.4,"icon":"granizo","condition":"Frio"}}""").weather!!
        assertEquals("cloudy", x.icon)
        assertEquals(-3, x.tempC)
        assertEquals(0L, x.at)
    }

    @Test fun climaAusenteOuVazio() {
        assertNull(ConfigParser.parse("""{"weather":null}""").weather)
        assertNull(ConfigParser.parse("{}").weather)
        assertNull(ConfigParser.parse("""{"weather":{}}""").weather)
        assertNull(ConfigParser.parse("""{"weather":{"city":"Niterói","tempC":null}}""").weather)
        // sem temperatura mas com a condição ainda mostra
        assertNull(ConfigParser.parse("""{"weather":{"condition":"Chuva","icon":"rain"}}""").weather!!.tempC)
    }

    @Test fun climaVelhoSome() {
        val w = WeatherCfg("X", 20, "Sol", "clear", 1_000_000L)
        assertTrue(w.fresh(1_000_000L + WeatherCfg.MAX_AGE_MS - 1))
        assertFalse(w.fresh(1_000_000L + WeatherCfg.MAX_AGE_MS))
        assertTrue(w.copy(at = 0).fresh(9_999_999_999L))
    }

    @Test fun cartoes() {
        val c = ConfigParser.parse(
            """{"cards":[{"id":"merenda","title":"Merenda de hoje","lines":["Arroz, feijão, frango","Fruta: banana"],"seconds":12},
                         {"title":"Sem tempo","lines":["x"]},
                         {"id":"vazio"},
                         {"id":"rapido","title":"R","seconds":1},
                         "lixo"]}""",
        ).cards
        assertEquals(3, c.size)
        assertEquals(CardCfg("merenda", "Merenda de hoje", listOf("Arroz, feijão, frango", "Fruta: banana"), 12), c[0])
        assertEquals(10, c[1].seconds) // padrão
        assertEquals("1", c[1].id)     // sem id usa a posição
        assertEquals(3, c[2].seconds)  // mínimo de 3 s
    }

    @Test fun cartoesComLimites() {
        val title = "T".repeat(100)
        val line = "\"" + "L".repeat(120) + "\""
        val lines = List(12) { line }.joinToString(",")
        val one = "{\"id\":\"c\",\"title\":\"" + title + "\",\"lines\":[" + lines + "],\"seconds\":999}"
        val c = ConfigParser.parse("{\"cards\":[" + List(20) { one }.joinToString(",") + "]}").cards
        assertEquals(12, c.size)
        assertEquals(60, c[0].title.length)
        assertEquals(8, c[0].lines.size)
        assertEquals(90, c[0].lines[0].length)
        assertEquals(120, c[0].seconds)
    }

    @Test fun senha() {
        val c = ConfigParser.parse("""{"layout":"queue","queue":{"enabled":true,"voice":true,"title":"Atendimento","showName":true}}""")
        assertEquals(QueueCfg(true, true, "Atendimento", true), c.queue)
        assertEquals(Layout.QUEUE, c.layout)
        assertEquals(Layout.QUEUE, c.effectiveLayout)
    }

    @Test fun layoutDeSenhaSemASenhaLigadaViraSide() {
        assertEquals(Layout.SIDE, ConfigParser.parse("""{"layout":"queue","queue":{"enabled":false}}""").effectiveLayout)
        assertEquals(Layout.SIDE, ConfigParser.parse("""{"layout":"queue"}""").effectiveLayout)
        assertEquals(QueueCfg(), ConfigParser.parse("""{"queue":null}""").queue)
    }
}
