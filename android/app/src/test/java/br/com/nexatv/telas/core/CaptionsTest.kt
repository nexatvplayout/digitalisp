package br.com.nexatv.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §14 (1.2.5): legendas da programação, pelo painel e no aparelho. */
class CaptionsTest {
    @Test fun leDoConfig() {
        assertEquals(CaptionsCfg(), ConfigParser.parse("{}").captions)
        assertEquals(CaptionsCfg(true, null), ConfigParser.parse("""{"captions":{"on":true,"lang":null}}""").captions)
        assertEquals(CaptionsCfg(true, "en"), ConfigParser.parse("""{"captions":{"on":true,"lang":"en"}}""").captions)
        assertEquals(CaptionsCfg(true, null), ConfigParser.parse("""{"captions":{"on":true,"lang":"klingon"}}""").captions, )
        assertEquals(CaptionsCfg(false, null), CaptionsPolicy.parse(JSONObject("""{"on":"sim"}""")))
    }

    @Test fun aparelhoValeAteOPainelMudar() {
        val panel = CaptionsCfg(false, null)
        val local = LocalCaptions(true, "es", basis = panel)
        assertEquals(CaptionsCfg(true, "es"), CaptionsPolicy.effective(panel, local))
        assertFalse(CaptionsPolicy.stale(panel, local))
        // a prefeitura mudou no painel: vale o painel e a escolha do aparelho fica velha
        val novo = CaptionsCfg(true, null)
        assertEquals(novo, CaptionsPolicy.effective(novo, local))
        assertTrue(CaptionsPolicy.stale(novo, local))
        assertEquals(panel, CaptionsPolicy.effective(panel, null))
    }

    @Test fun guardaEIdiomas() {
        val l = LocalCaptions(true, null, CaptionsCfg(false, "en"))
        assertEquals(l, CaptionsPolicy.decode(CaptionsPolicy.encode(l)))
        assertNull(CaptionsPolicy.decode(""))
        assertNull(CaptionsPolicy.decode("lixo"))
        assertEquals("do canal", CaptionsPolicy.name(null)); assertEquals("do canal", CaptionsPolicy.name("und"))
        assertEquals("português", CaptionsPolicy.name("pt-BR")); assertEquals("chinês", CaptionsPolicy.name("zh-CN"))
        // o botão: do canal -> os idiomas do fluxo -> do canal
        val avail = listOf(null, "pt", "en", "pt")
        assertEquals("pt", CaptionsPolicy.nextLang(null, avail))
        assertEquals("en", CaptionsPolicy.nextLang("pt", avail))
        assertNull(CaptionsPolicy.nextLang("en", avail))
        assertNull(CaptionsPolicy.nextLang(null, emptyList()), )
        // o servidor e o app falam os mesmos idiomas
        assertEquals(listOf("pt", "en", "es", "fr", "de", "it", "zh-CN", "ja", "ko", "ru", "ar"), CaptionsPolicy.LANGS)
    }
}
