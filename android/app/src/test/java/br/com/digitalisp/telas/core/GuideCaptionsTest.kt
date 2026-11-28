package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** As legendas traduzidas do canal do NEXA: o guia, o WebVTT e a sincronia pelo horário da imagem. */
class GuideCaptionsTest {
    @Test
    fun oGuiaSaiDoEnderecoDoHls() {
        assertEquals("https://nexa.tv.br/api/c/nexa/epg?count=3", GuideCaptions.guideUrl("https://hls.nexa.tv.br/hls/nexa/live.m3u8"))
        assertEquals("https://nexa.tv.br/api/c/nexa/epg?count=3", GuideCaptions.guideUrl("https://hls.nexa.tv.br/hls/nexa/master.m3u8"))
        assertNull(GuideCaptions.guideUrl("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"))
        assertNull(GuideCaptions.guideUrl(null))
    }

    private val guia = """{"serverTime":1000000,"airLagMs":4600,"eas":{"cards":[]},"items":[
        {"kind":"program","startsAt":100000,"endsAt":200000,"mediaOffset":10,"captionsUrl":"/captions/a.vtt",
         "captions":[{"lang":"en","url":"/captions/a.vtt"},{"lang":"pt","url":"/captions/a.pt.f1.vtt"},{"lang":"zh-CN","url":"/captions/a.zh-cn.f1.vtt"}]},
        {"kind":"live","startsAt":200000,"endsAt":300000,"captions":[{"lang":"pt","url":"/x.vtt"}]}]}"""

    @Test
    fun leOGuiaEEscolheOIdioma() {
        val g = GuideCaptions.parseGuide(guia, "https://nexa.tv.br")
        assertNotNull(g)
        val it = g!!.itemAt(150000)!!
        assertEquals("https://nexa.tv.br/captions/a.pt.f1.vtt", it.captionFor("pt")!!.url)
        assertEquals("https://nexa.tv.br/captions/a.zh-cn.f1.vtt", it.captionFor("zh-CN")!!.url)
        assertNull(it.captionFor("ja"))
        assertEquals(listOf("en", "pt", "zh-CN"), g.languagesAt(150000))
        // o ao vivo ("live") não tem legenda pelo guia
        assertTrue(g.itemAt(250000)!!.captions.isEmpty())
        assertEquals(4600L, g.airLagMs)
        // a posição: (agora − início)/1000 + mediaOffset
        assertEquals(60.0, GuideCaptions.position(it, 150000), 0.0001)
    }

    @Test
    fun leOWebVttETiraAsMarcas() {
        val cues = GuideCaptions.parseVtt("WEBVTT\n\n00:00:19.000 --> 00:00:23.040\nCalibrar matriz,\n<i>lendo</i> coordenada\n\n1\n00:01:00.5 --> 00:01:02.000 align:center\nOutra fala\n")
        assertEquals(2, cues.size)
        assertEquals("Calibrar matriz,\nlendo coordenada", GuideCaptions.textAt(cues, 20.0))
        assertEquals("", GuideCaptions.textAt(cues, 24.0))
        assertEquals("Outra fala", GuideCaptions.textAt(cues, 61.0))
        assertEquals("", GuideCaptions.textAt(cues, 5.0))
    }
}
