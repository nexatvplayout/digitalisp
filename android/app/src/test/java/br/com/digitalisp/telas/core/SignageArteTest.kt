package br.com.digitalisp.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A arte de fundo, a paleta e os modelos do comércio nos slides (templates por segmento, DIGITAL ISP). */
class SignageArteTest {
    private val sha = "ab".repeat(32)
    private fun slide(tpl: String, fields: String) = Signage.item(JSONObject("""{"id":"s1","kind":"slide","template":"$tpl","fields":{$fields}}"""))

    @Test fun artFileFoto() {
        val s = slide("comunicado", """"title":"Oferta","art":"foto-padaria","artFile":{"url":"https://a.exemplo/arte/foto-padaria.jpg","sha256":"$sha","bytes":120000}""")!!
        assertEquals(SignageFile("https://a.exemplo/arte/foto-padaria.jpg", sha, 120000), s.art)
        assertTrue(s.artPhoto) // pela chave foto-*
        assertFalse(s.artLight)
        assertTrue(s.files.contains(s.art)) // entra na lista de arquivos para baixar e guardar
    }

    @Test fun artFileComPhotoETone() {
        val s = slide("comunicado", """"title":"T","art":"papel","artFile":{"url":"https://a.exemplo/papel.png","sha256":"$sha","bytes":10,"photo":false,"tone":"light"}""")!!
        assertFalse(s.artPhoto)
        assertTrue(s.artLight)
    }

    @Test fun artSemArquivoOuInvalidoCaiNaPaleta() {
        assertNull(slide("comunicado", """"title":"T","art":"ondas"""")!!.art)
        assertNull(slide("comunicado", """"title":"T","artFile":{"url":"http://a.exemplo/x.jpg","sha256":"$sha","bytes":10}""")!!.art)
        assertNull(slide("comunicado", """"title":"T","artFile":"https://a.exemplo/x.jpg"""")!!.art)
    }

    @Test fun paleta() {
        assertEquals("vermelho", slide("comunicado", """"title":"T","palette":"Vermelho"""")!!.palette)
        assertEquals("", slide("comunicado", """"title":"T","palette":"neon"""")!!.palette)
        assertEquals(11, Signage.PALETTES.size)
        assertEquals(0xFF991B1B.toInt(), Signage.PALETTES.getValue("vermelho").darkStart)
    }

    @Test fun oferta() {
        val s = slide("oferta", """"title":"Pão francês","price":"R$ 12,90","oldPrice":"R$ 15,90","unit":"o kg","tag":"Só hoje","until":"2026-12-24","text":"Quentinho"""")!!
        assertEquals("oferta", s.template)
        assertEquals("R$ 12,90", s.price)
        assertEquals("R$ 15,90", s.oldPrice)
        assertEquals("o kg", s.unit)
        assertEquals("Só hoje", s.tag)
        assertEquals("2026-12-24", s.until)
        assertNull(slide("oferta", """"title":"x","until":"24/12"""")!!.until)
        // só o preço já basta para o slide existir
        assertNotNull(slide("oferta", """"price":"R$ 1,00""""))
    }

    @Test fun precosEHorario() {
        val s = slide("precos", """"title":"Cortes","text":"Corte | R$ 40\nBarba|R$ 30\nSobrancelha\n\n  ","note":"Cartão e Pix"""")!!
        assertEquals(listOf("Corte" to "R$ 40", "Barba" to "R$ 30", "Sobrancelha" to ""), s.rows)
        assertEquals("Cartão e Pix", s.note)
        val h = slide("horario", """"text":"Seg a sex | 8h às 18h\nSáb | 8h às 12h"""")!!
        assertEquals(listOf("Seg a sex" to "8h às 18h", "Sáb" to "8h às 12h"), h.rows)
        // o último | separa
        assertEquals(listOf("A | B" to "C"), Signage.rows("A | B | C"))
    }

    @Test fun redes() {
        val s = slide("redes", """"title":"Siga","handle":"@padaria","site":"padaria.com.br","qr":"https://instagram.com/padaria"""")!!
        assertEquals("@padaria", s.handle)
        assertEquals("padaria.com.br", s.site)
        assertEquals("https://instagram.com/padaria", s.qr)
        assertEquals("Siga a gente", Signage.templateLabel("redes"))
    }
}
