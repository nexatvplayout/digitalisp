package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigTest {
    private val full = """
    {
      "rev": "a1b2c3",
      "device": { "id": 12, "name": "UBS Centro, recepção", "office": "UBS Centro", "officeType": "ubs", "region": "Centro" },
      "stream": { "hls": "https://hls.nexa.tv.br/hls/nexa/master.m3u8", "backup": null, "volume": 80, "muted": true },
      "layout": "side",
      "ticker": { "items": ["Vacinação contra a gripe até sexta.", "Outro aviso"], "speed": 90 },
      "side": { "widgets": ["clock", "weather", "queue", "qr"], "qrUrl": "https://exemplo.gov.br/x", "title": "Bem-vindo" },
      "lock": { "pinHash": "ABCDEF", "pinSalt": "00ff", "exitSeq": ["UP","UP","DOWN","DOWN","OK"] },
      "offline": { "items": [ { "url": "https://cdn.exemplo/video.mp4", "sha256": "AA", "bytes": 1234 }, { "url": "ftp://x/y", "sha256": "bb", "bytes": 1 } ] },
      "schedule": { "tvOn": "07:00", "tvOff": "19:00", "days": [1,2,3,4,5] },
      "heartbeatSec": 45
    }
    """

    @Test fun completo() {
        val c = ConfigParser.parse(full)
        assertEquals("a1b2c3", c.rev)
        assertEquals(12L, c.device.id)
        assertEquals("UBS Centro, recepção", c.device.name)
        assertEquals("Centro", c.device.region)
        assertEquals("https://hls.nexa.tv.br/hls/nexa/master.m3u8", c.stream.hls)
        assertNull(c.stream.backup)
        assertEquals(80, c.stream.volume)
        assertTrue(c.stream.muted)
        assertEquals(Layout.SIDE, c.layout)
        assertEquals(2, c.ticker.items.size)
        assertEquals(90, c.ticker.speed)
        assertEquals(listOf("clock", "weather", "queue", "qr"), c.side.widgets)
        assertEquals("https://exemplo.gov.br/x", c.side.qrUrl)
        assertEquals("abcdef", c.lock.pinHash)
        assertEquals("00ff", c.lock.pinSalt)
        assertEquals(1, c.offline.size) // o ftp:// cai fora
        assertEquals("aa", c.offline[0].sha256)
        assertEquals(ScheduleCfg(420, 1140, setOf(1, 2, 3, 4, 5)), c.schedule)
        assertEquals(45, c.heartbeatSec)
        assertNull(c.update)
    }

    @Test fun vazioUsaPadroes() {
        val c = ConfigParser.parse("{}")
        assertEquals("", c.rev)
        assertNull(c.stream.hls)
        assertEquals(100, c.stream.volume)
        assertFalse(c.stream.muted)
        assertEquals(Layout.FULL, c.layout)
        assertTrue(c.ticker.items.isEmpty())
        assertEquals(60, c.ticker.speed)
        assertEquals(listOf("clock", "qr"), c.side.widgets)
        assertFalse(c.lock.hasPin)
        assertEquals(ConfigParser.DEFAULT_SEQ, c.lock.exitSeq)
        assertTrue(c.offline.isEmpty())
        assertNull(c.schedule)
        assertEquals(30, c.heartbeatSec)
    }

    @Test fun layouts() {
        assertEquals(Layout.FULL, ConfigParser.layoutOf("full"))
        assertEquals(Layout.TICKER, ConfigParser.layoutOf("ticker"))
        assertEquals(Layout.LBAR, ConfigParser.layoutOf("lbar"))
        assertEquals(Layout.LBAR, ConfigParser.layoutOf(" LBar "))
        assertEquals(Layout.SIDE, ConfigParser.layoutOf("side"))
        assertEquals(Layout.QUEUE, ConfigParser.layoutOf("queue"))
        assertEquals(Layout.PORTRAIT, ConfigParser.layoutOf(" Portrait "))
        assertEquals(Layout.FULL, ConfigParser.layoutOf("holograma"))
        assertEquals(Layout.FULL, ConfigParser.layoutOf(null))
        assertEquals(Layout.FULL, ConfigParser.parse("""{"layout":"novidade-2030"}""").layout)
    }

    /** O que cada layout põe na tela: faixa de avisos e coluna lateral. */
    @Test fun faixaEColunaPorLayout() {
        fun cfg(layout: String, items: String = "\"Aviso 1\"", extra: String = "") =
            ConfigParser.parse("""{"layout":"$layout","ticker":{"items":[$items]}$extra}""")
        // layout -> (faixa, coluna)
        val esperado = mapOf(
            "full" to (false to false),
            "ticker" to (true to false),
            "side" to (false to true),
            "lbar" to (true to true),
            "portrait" to (true to true),
        )
        for ((layout, par) in esperado) {
            val c = cfg(layout)
            assertEquals("faixa em $layout", par.first, c.showsTicker)
            assertEquals("coluna em $layout", par.second, c.showsSide)
        }
        // lbar sem nenhum aviso: fica só a coluna (igual ao side)
        val vazio = cfg("lbar", "")
        assertEquals(Layout.LBAR, vazio.effectiveLayout)
        assertFalse(vazio.showsTicker)
        assertTrue(vazio.showsSide)
        // queue monta a própria coluna; sem a senha ligada vira side
        val fila = cfg("queue", extra = ""","queue":{"enabled":true}""")
        assertFalse(fila.showsTicker)
        assertFalse(fila.showsSide)
        assertTrue(cfg("queue").showsSide)
    }

    @Test fun lbarLeOsMesmosCamposDoSideEDoTicker() {
        val c = ConfigParser.parse(
            """{"layout":"lbar","ticker":{"items":["A","B"],"speed":90},"side":{"widgets":["clock","weather","queue","qr"],"qrUrl":"https://a.b/c","title":"UBS Centro"},
               "cards":[{"id":"merenda-1","title":"Merenda","lines":["Arroz"]}],"queue":{"enabled":true}}""",
        )
        assertEquals("lbar", c.layoutRaw)
        assertEquals(Layout.LBAR, c.layout)
        assertEquals(listOf("A", "B"), c.ticker.items)
        assertEquals(90, c.ticker.speed)
        assertEquals(listOf("clock", "weather", "queue", "qr"), c.side.widgets)
        assertEquals("UBS Centro", c.side.title)
        assertEquals(1, c.cards.size)
    }

    @Test fun nulosETiposErrados() {
        val c = ConfigParser.parse(
            """{"rev":null,"stream":{"hls":"javascript:alert(1)","backup":"null","volume":900,"muted":null},
               "ticker":{"items":[null,"",3,{"a":1},"ok"],"speed":-5},"side":{"widgets":[],"qrUrl":null,"title":null},
               "schedule":null,"heartbeatSec":0,"lock":{"exitSeq":["UP","PULAR"]}}""",
        )
        assertEquals("", c.rev)
        assertNull(c.stream.hls)
        assertNull(c.stream.backup)
        assertEquals(100, c.stream.volume)
        assertEquals(listOf("3", "ok"), c.ticker.items)
        assertEquals(20, c.ticker.speed) // o contrato vai de 20 a 200
        assertTrue(c.side.widgets.isEmpty())
        assertNull(c.side.title)
        assertNull(c.schedule)
        assertEquals(30, c.heartbeatSec)
        assertEquals(ConfigParser.DEFAULT_SEQ, c.lock.exitSeq)
    }

    @Test fun velocidadeDaFaixaLimitada() {
        assertEquals(200, ConfigParser.parse("""{"ticker":{"speed":999}}""").ticker.speed)
        assertEquals(120, ConfigParser.parse("""{"ticker":{"speed":120}}""").ticker.speed)
    }

    @Test fun widgetsDeHoje() {
        val c = ConfigParser.parse("""{"side":{"widgets":["clock","weather","qr"]}}""")
        assertEquals(listOf("clock", "weather", "qr"), c.side.widgets)
    }

    @Test fun heartbeatLimitado() {
        assertEquals(10, ConfigParser.parse("""{"heartbeatSec":1}""").heartbeatSec)
        assertEquals(300, ConfigParser.parse("""{"heartbeatSec":99999}""").heartbeatSec)
    }

    @Test fun horarioInvalidoViraSemHorario() {
        assertNull(ConfigParser.parse("""{"schedule":{"tvOn":"7h","tvOff":"19:00"}}""").schedule)
        val s = ConfigParser.parse("""{"schedule":{"tvOn":"7:05","tvOff":"24:00","days":[0,7,9]}}""").schedule
        assertEquals(ScheduleCfg(425, 1440, setOf(0)), s)
    }

    @Test fun atualizacaoSoComTudoCerto() {
        val sha = "a".repeat(64)
        assertNotNull(ConfigParser.parse("""{"update":{"url":"https://x.y/app.apk","sha256":"$sha","versionCode":2}}""").update)
        assertNull(ConfigParser.parse("""{"update":{"url":"http://x.y/app.apk","sha256":"$sha","versionCode":2}}""").update)
        assertNull(ConfigParser.parse("""{"update":{"url":"https://x.y/app.apk","sha256":"curto","versionCode":2}}""").update)
    }

    @Test fun enderecos() {
        assertEquals("https://a.b/c.m3u8", Urls.clean(" https://a.b/c.m3u8 "))
        assertNull(Urls.clean("file:///sdcard/x.m3u8"))
        assertNull(Urls.clean("rtmp://a.b/live"))
        assertNull(Urls.clean("https://a.b/c d"))
        assertNull(Urls.clean("https://"))
        assertNull(Urls.clean(""))
        assertTrue(Urls.streamAllowed("https://a.b/c", standalone = false))
        assertFalse(Urls.streamAllowed("http://a.b/c", standalone = false))
        assertTrue(Urls.streamAllowed("http://a.b/c", standalone = true))
        assertTrue(Urls.apiAllowed("https://api.nexa.tv.br", debug = false))
        assertFalse(Urls.apiAllowed("http://10.0.0.5:3000", debug = false))
        assertTrue(Urls.apiAllowed("http://10.0.0.5:3000", debug = true))
        assertTrue(Urls.apiAllowed("http://localhost:3000", debug = true))
        assertFalse(Urls.apiAllowed("http://192.168.0.5:3000", debug = true))
        assertFalse(Urls.apiAllowed("http://10.0.0.5.evil.com", debug = true))
        assertEquals("https://api.nexa.tv.br", Urls.origin("https://api.nexa.tv.br/"))
    }

    @Test fun avulso() {
        val c = ConfigParser.standalone("http://192.168.0.9/tv.m3u8", "aa", "BB")
        assertEquals("http://192.168.0.9/tv.m3u8", c.stream.hls)
        assertEquals(Layout.FULL, c.layout)
        assertEquals("bb", c.lock.pinHash)
        assertEquals(ConfigParser.DEFAULT_SEQ, c.lock.exitSeq)
    }
}
