package br.com.nexatv.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FallbackImageTest {
    private val sha = "ab".repeat(32)
    private val sha2 = "cd".repeat(32)

    private fun parse(json: String?) = FallbackImages.parse(json?.let { JSONObject(it) })

    @Test fun parseValido() {
        val i = parse("""{"url":"https://midia.exemplo/fora.jpg","sha256":"${sha.uppercase()}","bytes":123456}""")
        assertEquals(FallbackImage("https://midia.exemplo/fora.jpg", sha, 123456), i)
        assertEquals("$sha.jpg", i!!.fileName)
    }

    @Test fun parseInvalidoIgnora() {
        assertNull(parse(null))
        assertNull(parse("""{"url":"http://midia.exemplo/fora.jpg","sha256":"$sha","bytes":10}""")) // sem https
        assertNull(parse("""{"url":"https://midia.exemplo/fora.jpg","sha256":"abc","bytes":10}""")) // sha curto
        assertNull(parse("""{"url":"https://midia.exemplo/fora.jpg","sha256":"${"zz".repeat(32)}","bytes":10}"""))
        assertNull(parse("""{"url":"https://midia.exemplo/fora.jpg","sha256":"$sha","bytes":0}"""))
        assertNull(parse("""{"url":"https://midia.exemplo/fora.jpg","sha256":"$sha","bytes":${2 * 1024 * 1024 + 1}}""")) // > 2 MB
        assertNull(parse("""{"sha256":"$sha","bytes":10}"""))
        assertEquals(2L * 1024 * 1024, parse("""{"url":"https://m.exemplo/a.jpg","sha256":"$sha","bytes":${2 * 1024 * 1024}}""")?.bytes)
    }

    @Test fun naConfiguracao() {
        val base = """{"rev":"r","stream":{"hls":"https://x/a.m3u8"},"offline":{"items":[],"image":%s}}"""
        assertEquals(sha, ConfigParser.parse(base.format("""{"url":"https://m.exemplo/a.jpg","sha256":"$sha","bytes":99}""")).offlineImage?.sha256)
        assertNull(ConfigParser.parse(base.format("null")).offlineImage)
        assertNull(ConfigParser.parse("""{"rev":"r","offline":{"items":[]}}""").offlineImage)
        assertNull(ConfigParser.parse("""{"rev":"r"}""").offlineImage)
    }

    @Test fun planoGuardaAUltimaBoa() {
        val img = FallbackImage("https://m.exemplo/a.jpg", sha, 100)
        // nada no aparelho: baixa, nada a mostrar
        assertEquals(FallbackImages.Plan(img, emptyList(), null), FallbackImages.plan(img, emptyMap()))
        // já está: mostra e apaga o resto
        assertEquals(
            FallbackImages.Plan(null, listOf("$sha2.jpg"), "$sha.jpg"),
            FallbackImages.plan(img, mapOf("$sha.jpg" to 100L, "$sha2.jpg" to 50L)),
        )
        // a nova ainda não baixou: mostra a anterior, mantém o .part da nova e apaga o .part velho
        assertEquals(
            FallbackImages.Plan(img, listOf("$sha2.jpg.part"), "$sha2.jpg"),
            FallbackImages.plan(img, mapOf("$sha2.jpg" to 50L, "$sha.jpg.part" to 40L, "$sha2.jpg.part" to 1L)),
        )
        // arquivo com o nome certo e tamanho errado: apaga e baixa de novo
        assertEquals(FallbackImages.Plan(img, listOf("$sha.jpg"), null), FallbackImages.plan(img, mapOf("$sha.jpg" to 7L)))
    }

    @Test fun semImagemNaConfiguracaoApagaAGuardada() {
        assertEquals(
            FallbackImages.Plan(null, listOf("$sha.jpg", "$sha2.jpg.part"), null),
            FallbackImages.plan(null, mapOf("$sha.jpg" to 100L, "$sha2.jpg.part" to 1L)),
        )
    }

    @Test fun escolhaVideoGuardadoImagemPreto() {
        // tocando (ao vivo, reserva ou vídeo guardado): o vídeo
        assertEquals(VideoArea.VIDEO, FallbackImages.area(playing = true, notPlayingMs = 0, hasImage = true))
        // nada toca há pouco (recarga do vigia): ainda não troca
        assertEquals(VideoArea.VIDEO, FallbackImages.area(false, FallbackImages.GRACE_MS - 1, true))
        // nada toca: a imagem; sem imagem, preto
        assertEquals(VideoArea.IMAGE, FallbackImages.area(false, FallbackImages.GRACE_MS, true))
        assertEquals(VideoArea.BLACK, FallbackImages.area(false, 60_000, false))
    }

    @Test fun comVideoGuardadoOVigiaTrocaParaEle() {
        // principal e reserva caem: com vídeo guardado, o vigia vai para ele (a imagem só cobre o intervalo)
        val w = Watchdog().apply { hasMain = true; hasOffline = true; internetDown = true }
        w.start(0)
        assertEquals(WdAction.Play(Source.OFFLINE), w.onError(1_000))
    }
}
