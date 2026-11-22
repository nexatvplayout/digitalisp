package br.com.nexatv.telas.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Os painéis de senha do §15 (15/11): as chaves, o tema, as filas (byService), as duas do queue-duo e a grade. */
class QueueLayoutTest {
    private fun cfg(layout: String, queueOn: Boolean = true, extra: String = "") = ConfigParser.parse(
        """{"layout":"$layout","queue":{"enabled":$queueOn,"pair":[9,"x",3,3,7]}$extra}""",
    )

    @Test
    fun `as chaves novas sao Layout QUEUE e o desenho sai do layoutRaw`() {
        for (k in QueueLayout.KEYS) {
            assertEquals(k, Layout.QUEUE, ConfigParser.layoutOf(k))
            assertEquals(k, QueueLayout.of(k), QueueLayout.forScreen(cfg(k), portraitStage = false))
        }
        assertEquals(9, QueueLayout.KEYS.size)
        assertEquals(QueueLayout.CLASSIC, QueueLayout.of("queue"))
        assertEquals(Layout.FULL, ConfigParser.layoutOf("queue-inventado"))
        // em pé: o painel de sempre; sem a senha ligada: nada de painel (vira side, como o queue)
        assertEquals(QueueLayout.CLASSIC, QueueLayout.forScreen(cfg("queue-grid"), portraitStage = true))
        assertEquals(Layout.SIDE, cfg("queue-table", queueOn = false).effectiveLayout)
        assertEquals(QueueLayout.CLASSIC, QueueLayout.forScreen(cfg("queue-table", queueOn = false), portraitStage = false))
        assertFalse(QueueLayout.BIG.video); assertFalse(QueueLayout.DUO.video); assertTrue(QueueLayout.TABLE.ticker); assertTrue(QueueLayout.LIST.ticker)
    }

    @Test
    fun `pair ate 2 ids positivos distintos e tema com padrao azul escuro`() {
        assertEquals(listOf(9L, 3L), cfg("queue-duo").queue.pair)
        assertEquals(emptyList<Long>(), QueueLayout.pair(JSONArray("[0,-1]")))
        val t = cfg("queue-duo", extra = ""","theme":{"color":"#15803d","mode":"light"}""").theme
        assertEquals(0xFF15803D.toInt(), t.color); assertTrue(t.light)
        assertEquals(ThemeCfg(), cfg("queue-duo").theme)
        assertEquals(ThemeCfg(), cfg("queue-duo", extra = ""","theme":{"color":"azul"}""").theme)
        // texto legível sobre a cor principal (WCAG 4,5)
        assertTrue(QueueColors.contrast(ThemeCfg().onColor, ThemeCfg().color) >= 4.5)
        assertTrue(QueueColors.contrast(ThemeCfg(light = true).text, ThemeCfg(light = true).bg) >= 4.5)
    }

    private val snapJson = """{"current":{"id":5,"ticket":"C047","desk":"Consultório 2","priority":false,"risk":"amarelo","service":"Clínica geral","at":1},
        "last":[{"id":4,"ticket":"T010","desk":"Sala 1","service":"Triagem"}],"waiting":{"total":3},
        "byService":[{"id":3,"name":"Clínica geral","color":"#2563eb","current":{"id":5,"ticket":"C047","desk":"Consultório 2","risk":"amarelo"},"waiting":2},
                     {"id":9,"name":"Triagem","color":"zzz","current":null,"waiting":1},{"name":""},{"id":7,"name":"Raio X","waiting":0}]}"""

    @Test
    fun `byService lido com a cor da fila e a fila de cada chamada`() {
        val s = QueueParser.snapshot(snapJson)!!
        assertEquals("Clínica geral", s.current!!.service)
        assertEquals(listOf("Clínica geral", "Triagem", "Raio X"), s.byService!!.map { it.name })
        assertEquals(0xFF2563EB.toInt(), s.byService!![0].color)
        assertEquals("cor inválida = a da posição", QueueLayout.SERVICE_COLORS[1], s.byService!![1].color)
        assertNull(QueueParser.snapshot("""{"current":null,"last":[]}""")!!.byService)
        val st = QueueReducer.onSnapshot(QueueState(), s)
        assertEquals(3, st.byService!!.size)
        // a chamada nova já aparece na fila dela, antes do state do servidor
        val call = QueueParser.call("""{"id":6,"ticket":"T011","desk":"Sala 2","service":"Triagem","at":2}""")!!
        val after = QueueReducer.onCall(st, call, 0L).state
        assertEquals("T011", after.byService!![1].current!!.ticket)
        assertEquals("C047", after.byService!![0].current!!.ticket)
        assertEquals(listOf("C047", "T010"), QueueLayout.previous(after, 5).map { it.ticket })
    }

    @Test
    fun `duas filas escolhidas ou as primeiras e grade com as de chamada mais recente`() {
        val rows = (1..10).map { QueueServiceRow(it.toLong(), "F$it", 0, if (it % 2 == 0) QueueCall(it.toLong(), "A$it", "", null, false, at = it * 10L) else null, 0) }
        assertEquals(listOf(7L, 2L), QueueLayout.duo(rows, listOf(7L, 2L)).map { it.id })
        assertEquals(listOf(5L, 1L), QueueLayout.duo(rows, listOf(5L, 99L)).map { it.id }, )
        assertEquals(listOf(1L, 2L), QueueLayout.duo(rows, emptyList()).map { it.id })
        assertEquals(emptyList<QueueServiceRow>(), QueueLayout.duo(null, listOf(1L)))
        val g = QueueLayout.grid(rows)
        assertEquals(8, g.size)
        // as 5 com chamada (2, 4, 6, 8, 10) entram; das sem chamada, as 3 primeiras; na ordem da repartição
        assertTrue(listOf(2L, 4L, 6L, 8L, 10L).all { id -> g.any { it.id == id } })
        assertEquals(g.map { it.id }.sorted(), g.map { it.id })
        assertEquals(rows.take(3), QueueLayout.grid(rows.take(3)))
    }

    @Test
    fun `tipo da senha so pelo nivel do risco e nome so com showName`() {
        val c = QueueCall(1, "P012", "Guichê 3", "Ana S.", true, 0, risk = null)
        assertEquals("PREFERENCIAL", QueueLayout.kind(c))
        assertEquals("URGENTE", QueueLayout.kind(c.copy(risk = "amarelo")))
        assertEquals("EMERGÊNCIA", QueueLayout.kind(c.copy(risk = "vermelho")))
        assertEquals("NORMAL", QueueLayout.kind(c.copy(priority = false)))
        assertEquals("SENHA", QueueLayout.kind(null, "SENHA"))
        assertEquals("P012", QueueLayout.who(c, showName = false))
        assertEquals("P012 · Ana S.", QueueLayout.who(c, showName = true))
        assertEquals("", QueueLayout.hhmm(0L))
        assertEquals("14:32", QueueLayout.hhmm((14 * 60 + 32) * 60_000L, java.util.TimeZone.getTimeZone("UTC")))
    }
}
