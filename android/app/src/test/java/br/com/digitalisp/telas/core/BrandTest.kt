package br.com.digitalisp.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** A marca da revenda (docs/CONTRATO-APP-MARCA.md). */
class BrandTest {
    private val sha = "ab".repeat(32)
    private val sha2 = "cd".repeat(32)
    private val full = """{"nome":"Provedor Exemplo","logoUrl":"https://cdn.exemplo.com.br/logo.png","logoHash":"$sha","logoBytes":48213,"corFundo":"#0B1E3A","corDestaque":"#ffcc00"}"""

    private fun res(marca: String?) = JSONObject(if (marca == null) "{}" else """{"token":"x","marca":$marca}""")

    @Test fun marcaCompleta() {
        val u = Brands.update(res(full))
        val b = (u as BrandUpdate.Set).brand
        assertEquals("Provedor Exemplo", b.name)
        assertEquals(BrandLogo("https://cdn.exemplo.com.br/logo.png", sha, 48213), b.logo)
        assertEquals(0xFF0B1E3A.toInt(), b.background)
        assertEquals(0xFFFFCC00.toInt(), b.accent)
        assertEquals("$sha.img", b.logo!!.fileName)
    }

    @Test fun campoAusenteMantemNullApagaVazioENeutro() {
        val atual = Brand("Guardada")
        assertSame(atual, Brands.apply(atual, Brands.update(res(null))))
        assertNull(Brands.apply(atual, Brands.update(res("null"))))
        assertNull(Brands.apply(atual, Brands.update(res("{}"))))
        // tipo errado não apaga o que já tem
        assertSame(atual, Brands.apply(atual, Brands.update(res("\"Provedor\""))))
        assertSame(atual, Brands.apply(atual, Brands.update(res("[1]"))))
        assertSame(atual, Brands.apply(atual, Brands.update(res("7"))))
        // corpo que não é JSON (ou vazio): nada muda
        assertSame(atual, Brands.apply(atual, Brands.update("<html>")))
        assertSame(atual, Brands.apply(atual, Brands.update("")))
        assertSame(atual, Brands.apply(atual, Brands.update(null as String?)))
    }

    @Test fun campoInvalidoSoSomeEle() {
        // cor errada: a padrão; o resto vale
        val b = Brands.parse(JSONObject("""{"nome":"P","corFundo":"azul","corDestaque":"#12345"}"""))!!
        assertEquals("P", b.name)
        assertEquals(Brands.DEFAULT_BACKGROUND, b.background)
        assertEquals(Brands.DEFAULT_ACCENT, b.accent)
        assertNull(b.logo)
        for (bad in listOf("\"#FFF\"", "\"FFFFFF\"", "\"#GGGGGG\"", "16777215", "null", "\"#FFFFFF80\"")) {
            assertEquals(bad, Brands.DEFAULT_BACKGROUND, Brands.parse(JSONObject("""{"corFundo":$bad}"""))!!.background)
        }
    }

    @Test fun logoSoComHttpsHashETamanho() {
        fun logo(extra: String) = Brands.parse(JSONObject("""{"nome":"P",$extra}"""))!!.logo
        val ok = """"logoUrl":"https://c.exemplo/l.png","logoHash":"$sha","logoBytes":10"""
        assertEquals(BrandLogo("https://c.exemplo/l.png", sha, 10), logo(ok))
        assertNull(logo(ok.replace("https://", "http://")))
        assertNull(logo(ok.replace(sha, "abc")))
        assertNull(logo(ok.replace(sha, "zz".repeat(32))))
        assertNull(logo(ok.replace("10", "0")))
        assertNull(logo(ok.replace(":10", ":${1024 * 1024 + 1}")))
        assertNull(logo(ok.replace(":10", ":\"10\"")))
        assertNull(logo(""""logoHash":"$sha","logoBytes":10"""))
        assertNull(logo(""""logoUrl":"https://c.exemplo/l.png","logoBytes":10"""))
        assertNull(logo(""""logoUrl":"https://c.exemplo/l.png","logoHash":"$sha""""))
        assertEquals(1024L * 1024, logo(ok.replace(":10", ":${1024 * 1024}"))!!.bytes)
        // o hash aceita maiúsculas e o prefixo sha256:
        assertEquals(sha, logo(ok.replace(sha, "sha256:" + sha.uppercase()))!!.sha256)
        // sem logo válida, o nome continua (a tela mostra o nome)
        val semLogo = Brands.parse(JSONObject("""{"nome":"P","logoUrl":"http://x/l.png","logoHash":"$sha","logoBytes":10}"""))!!
        assertEquals("P", semLogo.name)
        assertNull(semLogo.logo)
    }

    @Test fun nomeLimpoECortado() {
        assertEquals("Provedor da Serra", Brands.parse(JSONObject("""{"nome":"  Provedor\n da   Serra "}"""))!!.name)
        assertEquals(Brands.MAX_NAME, Brands.parse(JSONObject("""{"nome":"${"A".repeat(200)}"}"""))!!.name.length)
        assertEquals("", Brands.parse(JSONObject("""{"nome":7}"""))!!.name)
    }

    @Test fun guardadaIdaEVolta() {
        val b = (Brands.update(res(full)) as BrandUpdate.Set).brand
        assertEquals(b, Brands.fromStore(b.toJson().toString()))
        val semLogo = Brand("Só nome", null, 0xFF112233.toInt(), 0xFFFFFFFF.toInt())
        assertEquals(semLogo, Brands.fromStore(semLogo.toJson().toString()))
        assertNull(Brands.fromStore(null))
        assertNull(Brands.fromStore("lixo"))
    }

    @Test fun cores() {
        assertEquals(0xFF000000.toInt(), Brands.color("#000000"))
        assertEquals(0xFFABCDEF.toInt(), Brands.color(" #abcdef "))
        assertEquals("#ABCDEF", Brands.hex(0xFFABCDEF.toInt()))
        assertNull(Brands.color(null))
    }

    @Test fun planoDaLogo() {
        val logo = BrandLogo("https://c.exemplo/l.png", sha, 100)
        // sem logo: apaga tudo
        assertEquals(Brands.Plan(null, listOf("$sha.img", "x.part"), null), Brands.plan(null, mapOf("$sha.img" to 100L, "x.part" to 3L)))
        // já está: mostra e apaga o resto
        assertEquals(Brands.Plan(null, listOf("$sha2.img"), "$sha.img"), Brands.plan(logo, mapOf("$sha.img" to 100L, "$sha2.img" to 50L)))
        // falta: baixa, mostra a anterior enquanto isso e guarda o .part da pedida
        assertEquals(
            Brands.Plan(logo, listOf("velho.part"), "$sha2.img"),
            Brands.plan(logo, mapOf("$sha2.img" to 50L, "$sha.img.part" to 40L, "velho.part" to 1L)),
        )
        // tamanho diferente do anunciado: baixa de novo (o arquivo errado sai)
        assertEquals(Brands.Plan(logo, listOf("$sha.img"), null), Brands.plan(logo, mapOf("$sha.img" to 99L)))
    }

    @Test fun abertura() {
        // sempre pelo menos 3 s
        assertTrue(Brands.splashVisible(0, configured = true, contentPlaying = true))
        assertTrue(Brands.splashVisible(2_999, configured = false, contentPlaying = false))
        // depois: some quando o conteúdo começa, quando vai para o cadastro, ou aos 15 s
        assertFalse(Brands.splashVisible(3_000, configured = true, contentPlaying = true))
        assertFalse(Brands.splashVisible(3_000, configured = false, contentPlaying = false))
        assertTrue(Brands.splashVisible(10_000, configured = true, contentPlaying = false))
        assertFalse(Brands.splashVisible(15_000, configured = true, contentPlaying = false))
    }
}
