package br.com.nexatv.telas.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Comunicação interna (contrato §17) e o som da chamada (§16): o parse do contrato novo e a precedência. */
class InternalTest {
    private fun base() = JSONObject().put("rev", "r1").put("device", JSONObject().put("id", 7).put("name", "Posto"))
        .put("cards", JSONArray().put(JSONObject().put("id", "c1").put("title", "Merenda").put("lines", JSONArray().put("Arroz"))))

    @Test
    fun telaPublicaNaoTemInterno() {
        val c = ConfigParser.parse(base())
        assertNull(c.internal)
        assertNull(c.callSound)
        assertEquals(listOf("Merenda"), c.cards.map { it.title })
    }

    @Test
    fun avisosInternosEntramNaFrenteDosCartoes() {
        val o = base().put(
            "internal",
            JSONObject().put("sector", "Posto de enfermagem").put(
                "notices",
                JSONArray()
                    .put(JSONObject().put("id", 5).put("kind", "aviso").put("header", "AVISO DA DIREÇÃO").put("title", "Reunião").put("text", "Sexta, 14h.\nAuditório.").put("seconds", 20).put("until", 1_900_000_000_000L))
                    .put(JSONObject().put("id", 6).put("title", "").put("text", ""))
                    .put("lixo"),
            ),
        )
        val c = ConfigParser.parse(o)
        assertEquals("Posto de enfermagem", c.internal?.sector)
        assertEquals(1, c.internal?.notices?.size)
        assertEquals(listOf("AVISO DA DIREÇÃO · Reunião", "Merenda"), c.cards.map { it.title })
        assertEquals(listOf("Sexta, 14h.", "Auditório."), c.cards[0].lines)
        assertEquals(20, c.cards[0].seconds)
        assertEquals("int-5", c.cards[0].id)
    }

    @Test
    fun quebraEmPalavras() {
        assertEquals(listOf("um dois", "tres"), Internal.wrap("um dois tres", 7))
        assertEquals(listOf("a", "b"), Internal.wrap("a\n\n  b  ", 90))
        assertEquals(listOf("abcde"), Internal.wrap("abcdefgh", 5))
    }

    @Test
    fun codigosDoSinalDeVida() {
        val arr = JSONArray()
            .put(JSONObject().put("id", 1).put("code", "azul").put("label", "Código Azul").put("meaning", "Parada").put("color", "#1565c0").put("textColor", "#ffffff").put("place", "Leito 4").put("firedAt", 1000L).put("until", 5000L))
            .put(JSONObject().put("id", 2).put("code", "amarelo").put("label", "Código Amarelo").put("color", "#f9a825").put("until", JSONObject.NULL))
            .put(JSONObject().put("id", 3).put("label", "Sem cor").put("color", "azul"))
            .put(JSONObject().put("id", 4).put("label", "").put("color", "#000000"))
        val list = Internal.codes(arr)
        assertEquals(listOf(1L, 2L), list.map { it.id })
        assertEquals(0xFF1565C0.toInt(), list[0].color)
        assertEquals(0xFFFFFFFF.toInt(), list[0].textColor)
        assertEquals(0xFF1A1A1A.toInt(), list[1].textColor) // sem textColor: escuro sobre o amarelo
        assertEquals(0L, list[1].until) // até encerrar
        assertEquals(2L, Internal.select(list, 4000L)?.id)
        assertEquals(listOf(2L), Internal.active(list, 6000L).map { it.id }) // o azul venceu
        assertNull(Internal.select(emptyList(), 0L))
        assertEquals(1, Internal.codesEvent("""{"codes":[{"id":9,"label":"Código Rosa","color":"#d81b60"}]}""")?.size)
        assertNull(Internal.codesEvent("quebrado"))
        assertEquals(0, Internal.codesEvent("""{"codes":[]}""")?.size)
    }

    @Test
    fun somDaChamadaParse() {
        val c = ConfigParser.parse(base().put("callSound", JSONObject().put("mode", "voice").put("volume", 70)))
        assertEquals(CallSoundCfg(CallSoundMode.VOICE, 70), c.callSound)
        val n = ConfigParser.parse(base().put("callSound", JSONObject().put("mode", JSONObject.NULL).put("volume", 250)))
        assertEquals(CallSoundCfg(null, 100), n.callSound)
        assertEquals(CallSoundMode.BOTH, CallSoundMode.of(" BOTH "))
        assertNull(CallSoundMode.of("grito"))
        assertTrue(CallSoundMode.BOTH.beep && CallSoundMode.BOTH.voice)
        assertTrue(CallSoundMode.BEEP.beep && !CallSoundMode.BEEP.voice)
        assertTrue(!CallSoundMode.VOICE.beep && CallSoundMode.VOICE.voice)
    }

    @Test
    fun somDaChamadaPrecedencia() {
        // o painel definiu: vale o do painel, mesmo com escolha no aparelho
        assertEquals(CallSoundChoice(CallSoundMode.BEEP, 60, CallSound.FROM_PANEL), CallSound.resolve(CallSoundCfg(CallSoundMode.BEEP, 60), CallSoundMode.VOICE, true))
        // o painel não definiu (null): vale o do aparelho
        assertEquals(CallSoundChoice(CallSoundMode.VOICE, 80, CallSound.FROM_DEVICE), CallSound.resolve(CallSoundCfg(null, 80), CallSoundMode.VOICE, false))
        // nenhum dos dois: bipe + falada
        assertEquals(CallSoundChoice(CallSoundMode.BOTH, 100, CallSound.FROM_DEFAULT), CallSound.resolve(CallSoundCfg(null, 100), null, false))
        // servidor sem o campo: o aparelho; sem escolha, a voz da repartição (queue.voice)
        assertEquals(CallSoundMode.BEEP, CallSound.resolve(null, CallSoundMode.BEEP, true).mode)
        assertEquals(CallSoundChoice(CallSoundMode.BOTH, 100, CallSound.FROM_LEGACY), CallSound.resolve(null, null, true))
        assertEquals(CallSoundMode.BEEP, CallSound.resolve(null, null, false).mode)
    }
}
