package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class VoicePlanTest {
    private val tsvFile = File("src/main/assets/voz/vocabulario.tsv")
    private val vocab = VoiceVocab.parse(tsvFile.readText())

    private fun call(ticket: String, desk: String, name: String? = null) =
        QueueCall(id = 1, ticket = ticket, desk = desk, name = name, priority = false, at = 0)

    @Test
    fun senhaELocal() {
        val p = VoicePlan.build(call("A002", "Consultório 3"), false, vocab)
        assertEquals(listOf("senha_a", "dm_0", "dm_0", "df_2", ",", "c_consultorio_3"), p.tokens)
        assertTrue(p.unknown.isEmpty())
        assertFalse(p.nameSkipped)
    }

    @Test
    fun numerosEPalavrasCompostas() {
        assertEquals(listOf("senha_p", "dm_1", "df_2", ",", "c_guiche_12"), VoicePlan.build(call("P12", "Guichê 12"), false, vocab).tokens)
        assertEquals(listOf(",", "sala", "dm_1", "dm_2", "df_5"), VoicePlan.build(call("A1", "Sala 125"), false, vocab).tokens.drop(2))
        assertEquals(listOf(",", "sala", "n_45"), VoicePlan.build(call("A1", "Sala 45"), false, vocab).tokens.drop(2))
        assertEquals(listOf(",", "raio_x"), VoicePlan.build(call("A1", "Raio-X"), false, vocab).tokens.drop(2))
        assertEquals(listOf(",", "raio_x", "n_2"), VoicePlan.build(call("A1", "Raio X 2"), false, vocab).tokens.drop(2))
        assertEquals(listOf(",", "sala", "de", "medicacao"), VoicePlan.build(call("A1", "Sala de Medicação"), false, vocab).tokens.drop(2))
        assertEquals(listOf(",", "consultorio", "dr", "n_4"), VoicePlan.build(call("A1", "Consultório Dr. 4"), false, vocab).tokens.drop(2))
        assertEquals(listOf("senha", "dm_4", "df_2"), VoicePlan.build(call("42", ""), false, vocab).tokens)
        assertEquals(listOf("senha_a", "l_b", "df_1"), VoicePlan.build(call("AB1", ""), false, vocab).tokens)
    }

    @Test
    fun palavraSemAudioSaiDaFala() {
        val p = VoicePlan.build(call("B7", "Sala Xpto 2"), false, vocab)
        assertEquals(listOf("senha_b", "df_7", ",", "c_sala_2"), p.tokens)
        assertEquals(listOf("Xpto"), p.unknown)
    }

    @Test
    fun semLocalENome() {
        assertEquals(listOf("senha_c", "df_9"), VoicePlan.build(call("C9", ""), false, vocab).tokens)
        assertTrue(VoicePlan.build(call("C9", "", "Maria Souza"), true, vocab).nameSkipped)
        assertFalse(VoicePlan.build(call("C9", "", "Maria Souza"), false, vocab).nameSkipped)
    }

    @Test
    fun todoTokenTemAudioNasDuasVozes() {
        for (v in listOf("ash", "onyx", "coral", "nova")) for (t in vocab.tokens) {
            val f = File("src/main/assets/voz/$v/$t.ulaw")
            assertTrue("falta $v/$t", f.isFile && f.length() >= 1600)
        }
        for (c in 'a'..'z') assertTrue(vocab.tokens.contains("l_$c") && vocab.tokens.contains("senha_$c"))
        for (n in 0..99) assertTrue(vocab.tokens.contains("n_$n"))
        for (d in 0..9) assertTrue(vocab.tokens.contains("dm_$d") && vocab.tokens.contains("df_$d"))
        assertTrue(vocab.tokens.contains("c_consultorio_30") && vocab.tokens.contains("c_leito_1"))
    }

    @Test
    fun muLaw() {
        val pcm = MuLaw.decode(byteArrayOf(0xFF.toByte(), 0x7F, 0x00, 0x80.toByte()))
        assertEquals(0, pcm[0].toInt())
        assertEquals(0, pcm[1].toInt())
        assertEquals(-32124, pcm[2].toInt())
        assertEquals(32124, pcm[3].toInt())
    }
}
