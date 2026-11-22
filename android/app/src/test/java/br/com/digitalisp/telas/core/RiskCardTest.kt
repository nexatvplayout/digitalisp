package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §13 (1.2.3): a cor da classificação de risco no cartão da chamada, com o nível em palavras. */
class RiskCardTest {
    private fun call(risk: String? = null, priority: Boolean = false) = QueueCall(1, "M001", "Consultório 2", null, priority, 0L, risk = risk)

    @Test fun leORisco() {
        assertEquals("vermelho", QueueParser.call("""{"id":1,"ticket":"M001","risk":"vermelho"}""")!!.risk)
        assertEquals("azul", QueueParser.call("""{"id":1,"ticket":"M001","risk":"AZUL"}""")!!.risk)
        assertNull(QueueParser.call("""{"id":1,"ticket":"M001","risk":"roxo"}""")!!.risk)
        assertNull(QueueParser.call("""{"id":1,"ticket":"M001","risk":null}""")!!.risk)
        assertNull(QueueParser.call("""{"id":1,"ticket":"M001"}""")!!.risk, )
        val snap = QueueParser.snapshot("""{"current":{"id":2,"ticket":"M002","risk":"laranja"},"last":[],"serving":[{"id":1,"ticket":"M001","risk":"verde"}]}""")!!
        assertEquals("laranja", snap.current!!.risk)
        assertEquals("verde", snap.serving!![0].risk)
    }

    @Test fun asCincoCoresEPalavras() {
        val expected = mapOf(
            "vermelho" to (0xFFD92D20.toInt() to "EMERGÊNCIA"),
            "laranja" to (0xFFF97316.toInt() to "MUITO URGENTE"),
            "amarelo" to (0xFFFACC15.toInt() to "URGENTE"),
            "verde" to (0xFF16A34A.toInt() to "POUCO URGENTE"),
            "azul" to (0xFF2563EB.toInt() to "NÃO URGENTE"),
        )
        for ((risk, pair) in expected) {
            val st = RiskColors.style(call(risk))
            assertEquals(risk, pair.first, st.bg)
            assertTrue(risk, st.headline.startsWith(pair.second + " · "))
            assertTrue("o nome da cor também vai escrito", st.headline.endsWith(risk.uppercase()))
        }
    }

    @Test fun contrasteDoTexto() {
        // branco só onde passa de 4,5; escuro no amarelo, no laranja e no verde
        assertEquals(QueueColors.WHITE, RiskColors.textOn(RiskColors.VERMELHO))
        assertEquals(QueueColors.WHITE, RiskColors.textOn(RiskColors.AZUL))
        assertEquals(QueueColors.DARK, RiskColors.textOn(RiskColors.AMARELO))
        assertEquals(QueueColors.DARK, RiskColors.textOn(RiskColors.LARANJA))
        assertEquals(QueueColors.DARK, RiskColors.textOn(RiskColors.VERDE))
        for (r in QueueParser.RISK_ORDER) {
            val st = RiskColors.style(call(r))
            assertTrue("$r: contraste ${QueueColors.contrast(st.text, st.bg)}", QueueColors.contrast(st.text, st.bg) >= 4.5)
        }
    }

    @Test fun semRiscoOAmareloEPrioritaria() {
        val plain = RiskColors.style(call())
        assertEquals(QueueColors.HOT_BG, plain.bg)
        assertEquals("SENHA", plain.headline)
        val pref = RiskColors.style(call(priority = true))
        assertEquals(QueueColors.HOT_BG, pref.bg)
        assertEquals("PREFERENCIAL", pref.headline)
        assertTrue(QueueColors.contrast(pref.label, pref.bg) >= 7.0)
        // prioritária com risco: vale a cor do risco (o "preferencial" continua junto do consultório)
        assertEquals(RiskColors.VERMELHO, RiskColors.style(call("vermelho", priority = true)).bg)
        assertEquals("Consultório 2 · preferencial", QueueCallCard.text(call("vermelho", priority = true), false).desk)
    }
}
