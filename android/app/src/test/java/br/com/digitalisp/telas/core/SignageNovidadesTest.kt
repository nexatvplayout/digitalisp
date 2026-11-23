package br.com.digitalisp.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** O que o app da Samsung já desenha e o Android passou a ler (contrato do signage, DIGITAL ISP, 23/11/2026). */
class SignageNovidadesTest {
    private val sha = "ab".repeat(32)
    private val file = """{"url":"https://a.exemplo/f.jpg","sha256":"$sha","bytes":1000}"""
    private fun item(json: String) = Signage.item(JSONObject(json))

    // ---- notícia sozinha
    @Test fun noticiaSozinha() {
        val n = item("""{"id":"n3-1","kind":"news","single":true,"seconds":12,"title":"G1","items":[{"title":"Manchete","source":"G1","at":1795400000000},{"title":"Outra"}],"image":$file}""")!!
        assertTrue(n.single)
        assertEquals(1, n.news.size)
        assertEquals("Manchete", n.news[0].title)
        assertEquals(12, n.seconds)
        assertEquals(sha, n.file!!.sha256)
        assertTrue(n.files.contains(n.file))
        // sem `single`, a lista de sempre e sem foto
        val l = item("""{"id":"n","kind":"news","items":[{"title":"A"},{"title":"B"}],"image":$file}""")!!
        assertFalse(l.single)
        assertEquals(2, l.news.size)
        assertNull(l.file)
    }

    // ---- clima
    @Test fun climaComFotoNaConfiguracao() {
        val w = ConfigParser.weather(JSONObject("""{"city":"Niterói","tempC":27.4,"condition":"Sol","icon":"clear","at":1,"art":$file,"artPort":$file}"""))!!
        assertEquals(27, w.tempC)
        assertEquals(sha, w.art!!.sha256)
        assertNotNull(w.artPort)
        assertEquals(6 * 60 * 60 * 1000L, WeatherCfg.MAX_AGE_MS)
        assertNull(ConfigParser.weather(JSONObject("""{"city":"X"}""")))
    }

    @Test fun itemDeClima() {
        val i = item("""{"id":"w","kind":"weather","city":"Rio","uf":"RJ","tempC":30,"cond":"rain","text":"Chuva","days":[{"date":"2026-11-24","weekday":"ter","min":20,"max":31,"cond":"storm"}],"source":"INMET","art":$file}""")!!
        val w = i.weather!!
        assertEquals("Rio · RJ", w.city)
        assertEquals(30, w.tempC)
        assertEquals("rain", w.cond)
        assertEquals(1, w.days.size)
        assertEquals("ter", w.days[0].label)
        assertEquals("storm", w.days[0].cond)
        assertTrue(i.files.contains(w.art))
        // cond desconhecida = parcialmente nublado; sem nada, só o fundo
        assertEquals("partly", item("""{"id":"w","kind":"weather","tempC":20,"cond":"neve"}""")!!.weather!!.cond)
        assertNull(item("""{"id":"w","kind":"weather"}""")!!.weather)
    }

    // ---- slides: em pé e tamanhos
    @Test fun slideEmPeETamanhos() {
        val s = item("""{"id":"s","kind":"slide","template":"oferta","fields":{"title":"X","price":"R$ 1","orient":"port","qrSize":"xl","priceSize":"l","photoSize":"s","titleSize":"nada"}}""")!!
        assertTrue(s.portrait)
        assertEquals(1.8f, s.qrScale)
        assertEquals(1.4f, s.priceScale)
        assertEquals(0.7f, s.photoScale)
        assertEquals(1f, s.titleScale)
        assertFalse(item("""{"id":"s","kind":"slide","fields":{"title":"X","orient":"land"}}""")!!.portrait)
    }

    @Test fun transicaoEKenburns() {
        val i = item("""{"id":"i","kind":"image","url":"https://a.exemplo/f.jpg","sha256":"$sha","bytes":10,"fit":"contain","transition":"zoom","kenburns":true}""")!!
        assertTrue(i.contain)
        assertEquals("zoom", i.transition)
        assertTrue(i.kenburns)
        assertEquals("fade", item("""{"id":"i","kind":"text","title":"t","transition":"girar"}""")!!.transition)
    }

    // ---- vídeo próprio
    @Test fun videoProprio() {
        val v = item("""{"id":"v1","kind":"video","seconds":95,"url":"https://a.exemplo/v.mp4","sha256":"$sha","bytes":${50L * 1024 * 1024},"width":1920,"height":1080,"sound":false,"fit":"contain"}""")!!
        assertEquals(95, v.seconds)
        assertFalse(v.sound)
        assertTrue(v.contain)
        assertEquals(50L * 1024 * 1024, v.file!!.bytes)
        // grande demais ou sem https: fora
        assertNull(item("""{"id":"v","kind":"video","url":"https://a.exemplo/v.mp4","sha256":"$sha","bytes":${Signage.MAX_VIDEO_BYTES + 1}}"""))
        assertNull(item("""{"id":"v","kind":"video","url":"http://a.exemplo/v.mp4","sha256":"$sha","bytes":10}"""))
        assertTrue(item("""{"id":"v","kind":"video","url":"https://a.exemplo/v.mp4","sha256":"$sha","bytes":10,"sound":true}""")!!.sound)
    }

    // ---- contador com começo e fim
    @Test fun contadorComFim() {
        val c = item("""{"id":"c","kind":"countdown","target":2000000,"until":5000000}""")!!
        assertEquals(5000000L, c.endAt)
        assertEquals("Começa em", Signage.countPhase(2_000_000, 5_000_000, 1_000_000).label)
        val p = Signage.countPhase(90_061_000 + 1000, 0, 1000) // 1 dia, 1 h, 1 min e 1 s antes
        assertEquals(1L, p.days); assertEquals(1, p.hours); assertEquals(1, p.minutes); assertEquals(1, p.seconds)
        assertEquals("Termina em", Signage.countPhase(2_000_000, 5_000_000, 3_000_000).label)
        assertEquals("Encerrado", Signage.countPhase(2_000_000, 5_000_000, 6_000_000).label)
        assertEquals("É hoje!", Signage.countPhase(2_000_000, 0, 3_000_000).label)
        // until antes do target não vale
        assertEquals(0L, item("""{"id":"c","kind":"countdown","target":2000000,"until":1000}""")!!.endAt)
    }

    @Test fun diasDesdeSemRecorde() {
        assertFalse(item("""{"id":"s","kind":"safety","since":"2026-01-01","record":null}""")!!.hasRecord)
        assertTrue(item("""{"id":"s","kind":"safety","since":"2026-01-01","record":40}""")!!.hasRecord)
        assertTrue(item("""{"id":"s","kind":"safety","since":"2026-01-01"}""")!!.hasRecord)
    }

    // ---- QR de Wi-Fi e vCard
    @Test fun qrWifiEVcard() {
        assertEquals("WIFI:T:WPA;S:Loja;P:123;;", Signage.qrText("WIFI:T:WPA;S:Loja;P:123;;"))
        val v = "BEGIN:VCARD\nVERSION:3.0\nFN:Ana\nEND:VCARD"
        assertEquals(v, Signage.qrText(v.replace("\n", "\r\n")))
        assertEquals("https://a.exemplo/x", Signage.qrText("https://a.exemplo/x"))
        assertNull(Signage.qrText("http://a.exemplo/x"))
        assertNull(Signage.qrText("qualquer texto"))
        assertNull(Signage.qrText("WIFI:" + "x".repeat(1000) + ";"))
        assertEquals("WIFI:T:nopass;S:Lobby;;", item("""{"id":"q","kind":"qr","qr":"WIFI:T:nopass;S:Lobby;;"}""")!!.qr)
    }

    // ---- gadgets novos
    @Test fun gadgets() {
        val a = item("""{"id":"a","kind":"agenda","title":"Agenda","today":"2026-11-23","events":[{"date":"2026-11-23","time":"9:00","end":"10:30","title":"Reunião","place":"Sala 2"},{"date":"x","title":"sem data"},{"date":"2026-11-24","title":""}]}""")!!
        assertEquals(1, a.events.size)
        assertEquals("9:00", a.events[0].time)
        assertEquals("2026-11-23", a.today)
        val r = item("""{"id":"r","kind":"reviews","items":[{"name":"Ana","text":"Ótimo","stars":9},{"text":""}],"qr":"https://g.page/x"}""")!!
        assertEquals(1, r.reviews.size)
        assertEquals(5, r.reviews[0].stars)
        assertNull(item("""{"id":"r","kind":"reviews","items":[]}"""))
        val d = item("""{"id":"d","kind":"dashboard","items":[{"name":"Vendas","value":120,"target":100,"unit":"%","band":"ok"},{"name":"x","value":"abc"}]}""")!!
        assertEquals(1, d.kpis.size)
        val dir = item("""{"id":"d","kind":"directions","title":"Como chegar","address":"Rua A, 10","phone":"(21) 9999","qr":"https://maps.exemplo/x"}""")!!
        assertEquals("Rua A, 10", dir.place!!.address)
        assertNull(item("""{"id":"d","kind":"directions","phone":"1"}"""))
        val w = item("""{"id":"w","kind":"web","url":"https://a.exemplo/painel","refreshMin":5}""")!!
        assertEquals("https://a.exemplo/painel", w.webUrl)
        assertEquals(5, w.refreshMin)
        assertNull(item("""{"id":"w","kind":"web","url":"http://a.exemplo"}"""))
        val c = item("""{"id":"c","kind":"clock","face":"analog","tz":"Europe/Lisbon","label":"Lisboa","date":false}""")!!
        assertTrue(c.clockFace!!.analog)
        assertEquals("Europe/Lisbon", c.clockFace!!.tz)
        assertFalse(c.clockFace!!.date)
        assertNull(item("""{"id":"c","kind":"clock"}""")!!.clockFace)
    }

    // ---- zonas: formato, filete, overlay, widget e o rádio de fundo
    private fun block(zones: String, audio: String = "") = Signage.parse(JSONObject("""{"blocks":[{"id":"b","layout":{"zones":[$zones]$audio},"zones":{}}]}"""))!!.blocks[0]

    @Test fun zonasNovas() {
        val b = block("""{"id":"z1","kind":"playlist","x":0,"y":0,"w":60,"h":100,"shape":"onda-dir","edge":{"color":"#29d3e5","width":9}},
            {"id":"z2","kind":"widget","x":60,"y":0,"w":40,"h":50,"overlay":true,"opacity":70},
            {"id":"z3","kind":"video","x":60,"y":50,"w":40,"h":50,"overlay":true},
            {"id":"z4","kind":"text","x":0,"y":90,"w":10,"h":10,"shape":"estrela","edge":{"color":"#fff","width":1}}""")
        val z = b.layout.zones.associateBy { it.id }
        assertEquals("onda-dir", z["z1"]!!.shape)
        assertEquals(0xFF29D3E5.toInt(), z["z1"]!!.edgeColor)
        assertEquals(3f, z["z1"]!!.edgeWidth) // até 3% da altura
        assertTrue(z["z2"]!!.overlay)
        assertEquals(70, z["z2"]!!.opacity)
        assertFalse(z["z3"]!!.overlay) // o vídeo nunca vem por cima
        assertEquals("", z["z4"]!!.shape) // formato desconhecido = retângulo, e sem filete
        assertEquals(0f, z["z4"]!!.edgeWidth)
    }

    @Test fun radioDeFundo() {
        val a = block("""{"id":"z","kind":"playlist","x":0,"y":0,"w":100,"h":100}""", ""","audio":{"kind":"radio","id":"r1","name":"Rádio","url":"http://radio.exemplo:8000/stream","volume":40}""").layout.audio!!
        assertEquals("http://radio.exemplo:8000/stream", a.url)
        assertEquals(40, a.volume)
        // com zona de vídeo, o som do canal manda
        assertNull(block("""{"id":"z","kind":"video","x":0,"y":0,"w":100,"h":100}""", ""","audio":{"kind":"radio","url":"https://r.exemplo/s"}""").layout.audio)
        assertNull(block("""{"id":"z","kind":"playlist","x":0,"y":0,"w":100,"h":100}""", ""","audio":{"kind":"spotify","url":"https://r.exemplo/s"}""").layout.audio)
    }

    // ---- formatos
    @Test fun formatos() {
        for (k in Shapes.KEYS) {
            val c = Shapes.commands(k, 400f, 200f)!!
            assertTrue(k, c.first() is ShapeCmd.M)
            assertTrue(k, c.last() == ShapeCmd.Z)
            assertNotNull(k, Shapes.edgeCommands(k, 400f, 200f))
        }
        assertNull(Shapes.commands("estrela", 1f, 1f))
        // a diagonal à direita: o canto de baixo à direita entra 20%
        assertEquals(listOf(ShapeCmd.M(0f, 0f), ShapeCmd.L(100f, 0f), ShapeCmd.L(80f, 50f), ShapeCmd.L(0f, 50f), ShapeCmd.Z), Shapes.commands("diagonal-dir", 100f, 50f))
        // o filete da onda à esquerda é só a borda recortada (aberta)
        assertFalse(Shapes.edgeCommands("onda-esq", 100f, 100f)!!.contains(ShapeCmd.Z))
        // a onda à direita é o espelho da da esquerda
        val dir = Shapes.commands("onda-dir", 100f, 100f)!!
        assertEquals(ShapeCmd.M(84f, 0f), dir[0])
    }

    // ---- conjunto de telas
    @Test fun conjunto() {
        val cfg = Signage.parse(JSONObject("""{"wall":{"id":7,"name":"Vitrine","mode":"wall","cols":2,"rows":1,"pos":2,"col":1,"row":0,"bezel":{"x":0,"y":0},"sync":true,"epoch":1000},
            "blocks":[{"id":"b","layout":{"zones":[{"id":"z","kind":"playlist","x":0,"y":0,"w":100,"h":100}]},"zones":{}}]}"""))!!
        val w = cfg.wall!!
        assertTrue(w.videowall)
        assertEquals(2, w.pos)
        val win = Wall.window(w)
        assertEquals(200f, win.scaleX)
        assertEquals(-100f, win.offsetX)
        assertEquals(0f, win.offsetY)
        // com moldura: o quadro cresce e a janela pula a moldura
        val wb = Wall.window(w.copy(bezelX = 2f))
        assertEquals(202f, wb.scaleX)
        assertEquals(-102f, wb.offsetX)
        // pos fora da grade = sem conjunto
        assertNull(Wall.parse(JSONObject("""{"cols":2,"rows":1,"pos":3}""")))
        assertNull(Wall.parse(JSONObject("""{"cols":1,"rows":1,"pos":1}""")))
        assertFalse(Wall.parse(JSONObject("""{"cols":2,"rows":2,"pos":4,"mode":"menu","sync":false}"""))!!.sync)
        assertEquals(1, Wall.parse(JSONObject("""{"cols":2,"rows":2,"pos":4}"""))!!.col)
    }

    @Test fun trocaSincronizada() {
        val d = listOf(10_000L, 5_000L, 15_000L)
        assertEquals(SyncPos(0, 0, 10_000), Wall.syncPosition(d, 1000, 1000))
        assertEquals(SyncPos(1, 2_000, 3_000), Wall.syncPosition(d, 1000, 13_000))
        assertEquals(SyncPos(2, 14_000, 1_000), Wall.syncPosition(d, 1000, 30_000))
        assertEquals(SyncPos(0, 0, 10_000), Wall.syncPosition(d, 1000, 31_000)) // deu a volta
        assertEquals(SyncPos(2, 14_000, 1_000), Wall.syncPosition(d, 1000, 0)) // antes do epoch também
        assertNull(Wall.syncPosition(emptyList(), 0, 0))
        assertNull(Wall.syncPosition(listOf(0L), 0, 0))
    }

    // ---- faixa com estilo
    @Test fun faixaComEstilo() {
        val c = ConfigParser.parse("""{"ticker":{"items":["A","B"],"speed":80,"style":{"color":"#ff0000","bg":"#000000","bold":false,"italic":true,"size":120,"font":"mono","sep":"estrela","label":"  AVISOS  ","labelBg":"#zzzzzz"},
            "rich":[{"text":"A","color":"#00ff00","bold":true},{"text":"  "},{"text":"B","italic":true}]}}""")
        val s = c.ticker.style!!
        assertEquals(0xFFFF0000.toInt(), s.color)
        assertFalse(s.bold)
        assertTrue(s.italic)
        assertEquals(90, s.size)
        assertEquals("mono", s.font)
        assertEquals("★", s.sep)
        assertEquals("AVISOS", s.label)
        assertEquals(0xFF1D4ED8.toInt(), s.labelBg)
        assertEquals(listOf(TickerRun("A", 0xFF00FF00.toInt(), true, false), TickerRun("B", null, false, true)), c.ticker.rich)
        // sem estilo: o desenho de sempre
        val old = ConfigParser.parse("""{"ticker":{"items":["A"]}}""")
        assertNull(old.ticker.style)
        assertTrue(old.ticker.rich.isEmpty())
        assertEquals("", ConfigParser.tickerStyle(JSONObject("""{"sep":"nada"}"""))!!.sep)
    }
}
