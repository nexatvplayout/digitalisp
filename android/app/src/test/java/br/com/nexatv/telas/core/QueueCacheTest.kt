package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueCacheTest {
    private val cur = QueueCall(91, "P012", "Consultório 3", "Maria S.", true, 1_794_300_000_000, risk = "laranja")
    private val prev = QueueCall(90, "A011", "Guichê 1", null, false, 1_794_299_000_000, risk = null)
    private val serving = QueueCall(88, "V009", "Consultório 1", "João P.", false, 1_794_298_000_000, risk = "vermelho")
    private val state = QueueState(
        current = cur, last = listOf(prev), waiting = QueueWaiting(14, listOf("vermelho" to 0, "laranja" to 1), 22),
        highlightUntil = 999_999, serving = listOf(serving),
    )

    @Test fun voltaComoEstavaSemDestaque() {
        val back = QueueCache.restore(QueueCache.toJson(state, showName = true), showName = true)!!
        assertEquals(state.copy(highlightUntil = 0L), back)
        assertEquals("laranja", back.current?.risk)
        assertEquals("vermelho", back.serving?.first()?.risk)
    }

    @Test fun semShowNameNaoGuardaNome() {
        val json = QueueCache.toJson(state, showName = false)
        assertFalse(json.contains("Maria"))
        assertFalse(json.contains("João"))
        assertNull(QueueCache.restore(json, false)!!.current?.name)
        // guardado com nome e o painel desligou o showName: o nome não volta
        assertNull(QueueCache.restore(QueueCache.toJson(state, true), false)!!.serving?.first()?.name)
    }

    @Test fun soOQueATelaMostra() {
        val json = QueueCache.toJson(state, true)
        val keys = Regex("\"([a-zA-Z]+)\":").findAll(json).map { it.groupValues[1] }.toSet()
        val allowed = setOf("current", "last", "waiting", "serving", "id", "ticket", "desk", "name", "priority", "at", "risk", "total", "avgWaitMin", "byRisk", "vermelho", "laranja")
        assertTrue("campos: $keys", allowed.containsAll(keys))
    }

    @Test fun vazioOuEstragado() {
        assertNull(QueueCache.restore(null, false))
        assertNull(QueueCache.restore("", false))
        assertNull(QueueCache.restore("{nao é json", false))
        assertEquals(QueueState(), QueueCache.restore(QueueCache.toJson(QueueState(), false), false))
    }

    @Test fun mesmaCoisa() {
        assertTrue(QueueCache.same(state, state.copy(highlightUntil = 1)))
        assertFalse(QueueCache.same(state, state.copy(current = prev)))
    }
}
