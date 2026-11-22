package br.com.nexatv.telas.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Calendar
import java.util.TimeZone

class SignageTest {
    private val sha = "a".repeat(64)
    private val sha2 = "b".repeat(64)
    private val tz = "America/Sao_Paulo"

    /** epoch ms de uma hora local em São Paulo. */
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long = Calendar.getInstance(TimeZone.getTimeZone(tz)).apply {
        clear()
        set(y, mo - 1, d, h, mi, 0)
    }.timeInMillis

    private fun zones(vararg z: String) = JSONArray().apply { for (s in z) put(JSONObject(s)) }

    private val lZones = zones(
        """{"id":"main","x":0,"y":0,"w":75,"h":88,"kind":"video"}""",
        """{"id":"right","x":75,"y":0,"w":25,"h":88,"kind":"playlist"}""",
        """{"id":"bar","x":0,"y":88,"w":100,"h":12,"kind":"ticker"}""",
    )

    private fun block(id: String, days: List<Int>?, from: Int?, to: Int?, extra: (JSONObject) -> Unit = {}): JSONObject =
        JSONObject().put("id", id).put("layout", JSONObject().put("orientation", "land").put("background", "#0b1220").put("zones", lZones)).apply {
            if (days != null) put("days", JSONArray(days))
            if (from != null) put("from", from)
            if (to != null) put("to", to)
            extra(this)
        }

    private fun cfg(vararg blocks: JSONObject, fallback: String? = null): SignageCfg? = Signage.parse(
        JSONObject().put("tz", tz).put("blocks", JSONArray().apply { blocks.forEach { put(it) } }).apply { if (fallback != null) put("fallback", fallback) },
    )

    @Test fun exemploDoDocumento() {
        val json = """
        {"tz":"America/Sao_Paulo",
         "brand":{"logo":{"url":"https://x.test/logo.png","sha256":"$sha","bytes":12345},"color":"#1d4ed8","mode":"dark"},
         "blocks":[{"id":"s12","layout":{"orientation":"land","background":"#0b1220","zones":[
            {"id":"main","x":0,"y":0,"w":75,"h":88,"kind":"video"},
            {"id":"right","x":75,"y":0,"w":25,"h":88,"kind":"playlist"},
            {"id":"bar","x":0,"y":88,"w":100,"h":12,"kind":"ticker"}]},
          "days":[1,2,3,4,5],"from":420,"to":1080,"dateFrom":"2026-11-20","dateTo":null,
          "zones":{"right":[
            {"id":"m45","kind":"image","seconds":10,"url":"https://x.test/m45.jpg","sha256":"$sha2","bytes":210000},
            {"id":"p7","kind":"slide","seconds":12,"template":"comunicado","fields":{"title":"Férias coletivas","text":"De 22/12 a 05/01","qr":"https://x.test/f"}},
            {"id":"w:birthdays","kind":"birthdays","seconds":12,"people":[{"name":"Ana S.","day":20,"month":11,"sector":"Financeiro"}]},
            {"id":"k3","kind":"kpi","seconds":10,"name":"Vendas do mês","value":82,"target":100,"unit":"%","band":"warn"}]}}],
         "fallback":"s0"}
        """
        val s = Signage.parse(JSONObject(json))!!
        assertEquals(tz, s.tz)
        assertNotNull(s.brand.logo)
        assertFalse(s.brand.theme.light)
        val b = s.blocks.single()
        assertTrue(b.layout.hasVideo)
        assertEquals(setOf(1, 2, 3, 4, 5), b.days)
        assertEquals("2026-11-20", b.dateFrom)
        assertNull(b.dateTo)
        val items = b.zones["right"]!!
        assertEquals(listOf("m45", "p7", "w:birthdays", "k3"), items.map { it.id })
        assertEquals("comunicado", items[1].template)
        assertEquals("https://x.test/f", items[1].qr)
        assertEquals("Ana S.", items[2].people.single().name)
        assertEquals(82.0, items[3].kpi!!.value, 0.0)
        assertEquals("warn", Signage.kpiBand(items[3].kpi!!))
        // logomarca + imagem, sem repetir
        assertEquals(listOf(sha, sha2), s.files().map { it.sha256 })
    }

    @Test fun semSignageOuSemBlocoValidoFicaComoHoje() {
        assertNull(Signage.parse(null))
        assertNull(Signage.parse(JSONObject()))
        assertNull(Signage.parse(JSONObject().put("blocks", JSONArray().put(JSONObject().put("id", "x")))))
        // o /config de sempre não ganha nada
        val c = ConfigParser.parse("""{"rev":"1","layout":"side"}""")
        assertNull(c.signage)
        assertEquals(Layout.SIDE, c.layout)
        assertNotNull(ConfigParser.parse(JSONObject().put("rev", "2").put("signage", JSONObject().put("blocks", JSONArray().put(block("a", null, null, null))))).signage)
    }

    @Test fun zonasValidadas() {
        val z = zones(
            """{"id":"v1","x":0,"y":0,"w":50,"h":100,"kind":"video"}""",
            """{"id":"v2","x":50,"y":0,"w":50,"h":50,"kind":"video"}""", // segunda zona de vídeo: fora
            """{"id":"p","x":50,"y":50,"w":80,"h":80,"kind":"playlist"}""", // passa da borda: cortada em 50×50
            """{"id":"q","x":0,"y":0,"w":10,"h":10,"kind":"url"}""", // tipo desconhecido: fora
            """{"id":"n","x":-5,"y":0,"w":10,"h":10,"kind":"clock"}""", // fora da tela: fora
            """{"id":"p","x":0,"y":0,"w":10,"h":10,"kind":"clock"}""", // id repetido: fora
        )
        val s = Signage.parse(JSONObject().put("blocks", JSONArray().put(JSONObject().put("id", "b").put("layout", JSONObject().put("zones", z)))))!!
        val zs = s.blocks.single().layout.zones
        assertEquals(listOf("v1", "p"), zs.map { it.id })
        assertEquals(50, zs[1].w)
        assertEquals(50, zs[1].h)
        assertEquals(Signage.DEFAULT_TZ, s.tz)
    }

    @Test fun tetoDeZonasEItens() {
        val z = JSONArray()
        for (i in 0 until 9) z.put(JSONObject().put("id", "z$i").put("x", i * 10).put("y", 0).put("w", 10).put("h", 10).put("kind", "playlist"))
        val items = JSONArray()
        for (i in 0 until 80) items.put(JSONObject().put("id", "t$i").put("kind", "text").put("text", "oi $i"))
        val s = Signage.parse(JSONObject().put("blocks", JSONArray().put(JSONObject().put("id", "b").put("layout", JSONObject().put("zones", z)).put("zones", JSONObject().put("z0", items).put("nao-existe", items)))))!!
        val b = s.blocks.single()
        assertEquals(Signage.MAX_ZONES, b.layout.zones.size)
        assertEquals(Signage.MAX_ITEMS, b.zones["z0"]!!.size)
        assertFalse(b.zones.containsKey("nao-existe"))
    }

    @Test fun itensSemArquivoValidoOuSemConteudoSaem() {
        assertNull(Signage.item(JSONObject("""{"id":"a","kind":"image","url":"http://x.test/a.jpg","sha256":"$sha","bytes":10}"""))) // http
        assertNull(Signage.item(JSONObject("""{"id":"a","kind":"image","url":"https://x.test/a.jpg","sha256":"xyz","bytes":10}""")))
        assertNull(Signage.item(JSONObject("""{"id":"a","kind":"image","url":"https://x.test/a.jpg","sha256":"$sha","bytes":0}""")))
        assertNull(Signage.item(JSONObject("""{"id":"a","kind":"video"}"""))) // sem segundo player
        assertNull(Signage.item(JSONObject("""{"kind":"text","text":"sem id"}""")))
        assertNull(Signage.item(JSONObject("""{"id":"b","kind":"birthdays","people":[{"name":"X","day":31,"month":13}]}""")))
        assertNull(Signage.item(JSONObject("""{"id":"k","kind":"kpi","name":"x"}""")))
        assertNull(Signage.item(JSONObject("""{"id":"s","kind":"safety","since":"ontem"}""")))
        // tempo fora da faixa vira o mínimo/máximo; sem tempo, 10 s
        assertEquals(3, Signage.item(JSONObject("""{"id":"t","kind":"text","text":"x","seconds":1}"""))!!.seconds)
        assertEquals(300, Signage.item(JSONObject("""{"id":"t","kind":"text","text":"x","seconds":9999}"""))!!.seconds)
        assertEquals(10, Signage.item(JSONObject("""{"id":"t","kind":"text","text":"x"}"""))!!.seconds)
    }

    @Test fun limitesDeTextoEControle() {
        val longo = "x".repeat(500)
        val it = Signage.item(JSONObject().put("id", "s").put("kind", "slide").put("template", "nao-existe")
            .put("fields", JSONObject().put("title", longo).put("text", "a\u0007b\n" + (1..20).joinToString("\n") { "l$it" })))!!
        assertEquals("comunicado", it.template)
        assertEquals(Signage.MAX_TITLE, it.title.length)
        assertFalse(it.text.contains('\u0007'))
        assertEquals(Signage.MAX_LINES, it.text.lines().size)
    }

    @Test fun comunicadoUsaOModeloDaCategoria() {
        val p = Signage.item(JSONObject("""{"id":"p1","kind":"post","category":"seguranca","title":"Use o capacete","body":"Na área de carga."}"""))!!
        assertEquals("seguranca", p.template)
        assertEquals("Segurança", p.label)
        assertEquals("Na área de carga.", p.text)
        val q = Signage.item(JSONObject("""{"id":"p2","kind":"post","category":"rh","title":"Plano de saúde"}"""))!!
        assertEquals("comunicado", q.template)
        assertEquals("RH", q.label)
    }

    @Test fun datasDosWidgets() {
        val c = Signage.item(JSONObject("""{"id":"c","kind":"countdown","title":"SIPAT","target":"2026-11-25"}"""), tz)!!
        assertEquals(at(2026, 11, 25, 0, 0), c.target)
        val c2 = Signage.item(JSONObject("""{"id":"c","kind":"countdown","target":"2026-11-25T19:30:00-03:00"}"""))!!
        assertEquals(at(2026, 11, 25, 19, 30), c2.target)
        val c3 = Signage.item(JSONObject("""{"id":"c","kind":"countdown","target":"2026-11-25T22:30:00Z"}"""))!!
        assertEquals(at(2026, 11, 25, 19, 30), c3.target)
        assertEquals(0L, Signage.epochOf("25/11/2026", tz))
        val w = Signage.item(JSONObject("""{"id":"w","kind":"worldclock","clocks":[{"label":"Lisboa","tz":"Europe/Lisbon"},{"tz":"Nada/Nada"},{"tz":"Asia/Tokyo"}]}"""))!!
        assertEquals(listOf("Lisboa", "Tokyo"), w.clocks.map { it.label })
    }

    // ------------------------------------------------------------------ escolha do bloco

    @Test fun blocoCertoPelaHora() {
        val s = cfg(block("manha", listOf(1, 2, 3, 4, 5), 420, 720), block("tarde", listOf(1, 2, 3, 4, 5), 720, 1080), block("s0", null, null, null), fallback = "s0")!!
        // sexta, 20/11/2026
        assertEquals("manha", Signage.pick(s, at(2026, 11, 20, 7, 0))!!.id)
        assertEquals("manha", Signage.pick(s, at(2026, 11, 20, 11, 59))!!.id)
        assertEquals("tarde", Signage.pick(s, at(2026, 11, 20, 12, 0))!!.id)
        // o "s0" do dia inteiro também vale à noite (ele está na lista; a ordem é a prioridade)
        assertEquals("s0", Signage.pick(s, at(2026, 11, 20, 19, 0))!!.id)
    }

    @Test fun fallbackESemBloco() {
        val s = cfg(block("manha", listOf(1, 2, 3, 4, 5), 420, 720), block("padrao", listOf(0), 0, 60), fallback = "padrao")!!
        // sábado 21/11: nenhum vale → o fallback, mesmo fora do dia dele
        assertEquals("padrao", Signage.pick(s, at(2026, 11, 21, 10, 0))!!.id)
        // sem fallback: null (o layout de sempre)
        val s2 = cfg(block("manha", listOf(1, 2, 3, 4, 5), 420, 720))!!
        assertNull(Signage.pick(s2, at(2026, 11, 21, 10, 0)))
        // fallback que não existe na lista: null
        assertNull(Signage.pick(cfg(block("a", listOf(1), 0, 10), fallback = "zz"), at(2026, 11, 21, 10, 0)))
        assertNull(Signage.pick(null, at(2026, 11, 21, 10, 0)))
    }

    @Test fun semHoraConfiavelSoOFallback() {
        val s = cfg(block("manha", null, 0, 1440), block("padrao", listOf(6), 0, 10), fallback = "padrao")!!
        assertEquals("padrao", Signage.pick(s, at(2026, 11, 20, 10, 0), clockOk = false)!!.id)
        assertEquals("padrao", Signage.pick(s, null)!!.id)
        assertNull(Signage.pick(cfg(block("manha", null, 0, 1440)), null))
    }

    @Test fun faixaQueViraANoite() {
        // turno da noite de sexta: 22:00 às 06:00; a madrugada de sábado ainda é de sexta
        val s = cfg(block("noite", listOf(5), 1320, 360))!!
        assertEquals("noite", Signage.pick(s, at(2026, 11, 20, 23, 0))!!.id) // sexta 23h
        assertEquals("noite", Signage.pick(s, at(2026, 11, 21, 5, 59))!!.id) // sábado 05:59
        assertNull(Signage.pick(s, at(2026, 11, 21, 6, 0))) // sábado 06:00
        assertNull(Signage.pick(s, at(2026, 11, 20, 3, 0))) // sexta de madrugada = turno de quinta, fora
        assertNull(Signage.pick(s, at(2026, 11, 21, 23, 0))) // sábado 23h
    }

    @Test fun viradaDoDiaTrocaOBloco() {
        val s = cfg(block("sexta", listOf(5), 0, 1440), block("sabado", listOf(6), 0, 1440))!!
        assertEquals("sexta", Signage.pick(s, at(2026, 11, 20, 23, 59))!!.id)
        assertEquals("sabado", Signage.pick(s, at(2026, 11, 21, 0, 0))!!.id)
    }

    @Test fun periodoDeDatas() {
        val s = cfg(block("campanha", null, 0, 1440) { it.put("dateFrom", "2026-11-23").put("dateTo", "2026-11-27") })!!
        assertNull(Signage.pick(s, at(2026, 11, 22, 12, 0)))
        assertNotNull(Signage.pick(s, at(2026, 11, 23, 0, 0)))
        assertNotNull(Signage.pick(s, at(2026, 11, 27, 23, 59)))
        assertNull(Signage.pick(s, at(2026, 11, 28, 0, 0)))
    }

    @Test fun domingoComo7() {
        val s = cfg(block("dom", listOf(7), 0, 1440))!!
        assertNotNull(Signage.pick(s, at(2026, 11, 22, 10, 0))) // domingo
        assertNull(Signage.pick(s, at(2026, 11, 23, 10, 0)))
    }

    @Test fun diaDoRelatorioNoFusoDoModo() {
        // 02:30 UTC de 21/11 = 23:30 de 20/11 em São Paulo
        val ms = at(2026, 11, 20, 23, 30)
        assertEquals("2026-11-20", Signage.dayOf(ms, tz))
        assertEquals("2026-11-21", Signage.dayOf(ms, "UTC"))
    }

    // ------------------------------------------------------------------ contas dos widgets

    @Test fun contador() {
        val now = at(2026, 11, 20, 10, 0)
        assertEquals(Signage.Remaining(2, 3, 30, false), Signage.remaining(at(2026, 11, 22, 13, 30), now))
        assertEquals(Signage.Remaining(0, 0, 1, false), Signage.remaining(now + 1_000, now))
        assertTrue(Signage.remaining(now, now).done)
        assertTrue(Signage.remaining(now - 1, now).done)
    }

    @Test fun diasSemAcidente() {
        val now = at(2026, 11, 20, 0, 30)
        assertEquals(0L, Signage.daysSince("2026-11-20", now, tz))
        assertEquals(1L, Signage.daysSince("2026-11-19", now, tz))
        assertEquals(366L, Signage.daysSince("2025-11-19", now, tz))
        assertEquals(0L, Signage.daysSince("2026-12-01", now, tz)) // no futuro
        assertEquals(0L, Signage.daysSince("lixo", now, tz))
    }

    @Test fun barraDaMeta() {
        val up = SignKpi("Vendas", 82.0, 100.0, "%", "")
        assertEquals(0.82f, Signage.kpiRatio(up)!!, 0.001f)
        assertEquals("warn", Signage.kpiBand(up))
        assertEquals("ok", Signage.kpiBand(up.copy(value = 130.0)))
        assertEquals(1f, Signage.kpiRatio(up.copy(value = 130.0))!!, 0f)
        assertEquals("bad", Signage.kpiBand(up.copy(value = 10.0)))
        // menor é melhor (perdas): abaixo da meta = cheio
        val down = SignKpi("Perdas", 4.0, 5.0, "%", "", up = false)
        assertEquals(1f, Signage.kpiRatio(down)!!, 0f)
        assertEquals(0.5f, Signage.kpiRatio(down.copy(value = 10.0))!!, 0.001f)
        // sem meta: sem barra
        assertNull(Signage.kpiRatio(up.copy(target = null)))
        // a faixa do servidor manda
        assertEquals("bad", Signage.kpiBand(up.copy(value = 130.0, band = "bad")))
    }

    @Test fun numerosNoJeitoBrasileiro() {
        assertEquals("5,32", Signage.number(5.3241, 2))
        assertEquals("1.234", Signage.kpiNumber(1234.0))
        assertEquals("82,5", Signage.kpiNumber(82.5))
        assertEquals("+0,42%", Signage.change(0.42))
        assertEquals("−1,10%", Signage.change(-1.1))
        assertEquals("0,00%", Signage.change(0.001))
        assertEquals("AS", Signage.initials("Ana S."))
        assertEquals("M", Signage.initials("Maria"))
        assertEquals("05/03", Signage.dayMonth(SignPerson("X", 5, 3)))
        assertEquals("19:30", Signage.hhmm(at(2026, 11, 25, 19, 30), tz))
    }

    // ------------------------------------------------------------------ cache por SHA-256

    private fun f(sha: String, bytes: Long) = SignageFile("https://x.test/$sha", sha, bytes)
    private fun name(c: Char) = c.toString().repeat(64) + ".img"

    @Test fun cacheBaixaOQueFaltaEGuardaOResto() {
        val a = f("a".repeat(64), 100)
        val b = f("b".repeat(64), 200)
        val existing = mapOf(
            name('a') to SignageCache.Existing(100, 10),
            name('c') to SignageCache.Existing(50, 5), // saiu da configuração: fica (cabe)
            name('d') to SignageCache.Existing(999, 1), // saiu e não cabe mais: sai
            "x.tmp" to SignageCache.Existing(1, 1), // nome estranho: sai
            name('e') + ".part" to SignageCache.Existing(3, 1), // .part de quem ninguém pede: sai
        )
        val p = SignageCache.plan(listOf(a, b, a), existing, maxFiles = 10, maxBytes = 400)
        assertEquals(listOf(b), p.download)
        assertTrue(name('c') !in p.delete)
        assertTrue(name('d') in p.delete)
        assertTrue("x.tmp" in p.delete)
        assertTrue(name('e') + ".part" in p.delete)
        assertTrue(name('a') !in p.delete)
    }

    @Test fun cacheTetoDeArquivosTiraOMaisAntigo() {
        val want = f("a".repeat(64), 10)
        val existing = mapOf(
            name('a') to SignageCache.Existing(10, 1),
            name('b') to SignageCache.Existing(10, 100), // mais recente: fica
            name('c') to SignageCache.Existing(10, 50), // mais antigo: sai
        )
        val p = SignageCache.plan(listOf(want), existing, maxFiles = 2, maxBytes = 1_000)
        assertEquals(listOf(name('c')), p.delete)
        assertTrue(p.download.isEmpty())
    }

    @Test fun cachePedidoMaiorQueOTetoEPulado() {
        val a = f("a".repeat(64), 300)
        val b = f("b".repeat(64), 300)
        val p = SignageCache.plan(listOf(a, b), emptyMap(), maxFiles = 10, maxBytes = 400)
        assertEquals(listOf(a), p.download)
        assertEquals(listOf(b), p.skipped)
        // arquivo completo de tamanho errado sai e baixa de novo
        val p2 = SignageCache.plan(listOf(a), mapOf(name('a') to SignageCache.Existing(299, 1)))
        assertEquals(listOf(name('a')), p2.delete)
        assertEquals(listOf(a), p2.download)
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    @Test fun cacheConfereOSha256() {
        val dir = Files.createTempDirectory("nexa-signage").toFile()
        try {
            val good = "imagem boa".toByteArray()
            val bad = "imagem trocada".toByteArray()
            val fg = SignageFile("https://x.test/g", sha256(good), good.size.toLong())
            val fb = SignageFile("https://x.test/b", sha256("outra coisa".toByteArray()), bad.size.toLong())
            val transport = OfflineTransport { url, _ -> OfflineResponse(200, ByteArrayInputStream(if (url.endsWith("/g")) good else bad)) }
            val results = HashMap<String, OfflineFetch.Result>()
            val got = SignageCache.sync(dir, listOf(fg, fb), transport, 1_000L, onResult = { f, r -> results[f.url] = r })
            assertEquals(1, got)
            assertEquals(OfflineFetch.Result.OK, results["https://x.test/g"])
            assertEquals(OfflineFetch.Result.BAD_HASH, results["https://x.test/b"])
            assertNotNull(SignageCache.ready(dir, fg))
            assertNull(SignageCache.ready(dir, fb))
            assertFalse(File(dir, fb.fileName).exists())
            // sem rede: o que já está guardado continua pronto
            val offline = OfflineTransport { _, _ -> throw java.io.IOException("sem rede") }
            assertEquals(0, SignageCache.sync(dir, listOf(fg), offline, 2_000L))
            assertNotNull(SignageCache.ready(dir, fg))
        } finally {
            dir.deleteRecursively()
        }
    }
}
