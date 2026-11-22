package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayLogTest {
    private val d1 = "2026-11-20"
    private val d2 = "2026-11-21"

    @Test fun contaExibicoesETempo() {
        val p = PlayLog()
        p.shown(d1, "m45")
        p.addTime(d1, "m45", 10_400)
        p.shown(d1, "m45")
        p.addTime(d1, "m45", 9_700)
        p.shown(d1, "p7")
        val b = p.pending()!!
        assertEquals(d1, b.day)
        assertEquals(listOf(PlayLog.Entry("m45", 2, 20), PlayLog.Entry("p7", 1, 0)), b.entries)
        val w = PlayLog.wire(b)
        assertEquals("m45", w.getJSONObject(0).getString("ref"))
        assertEquals(2, w.getJSONObject(0).getInt("n"))
        assertEquals(20, w.getJSONObject(0).getInt("sec"))
    }

    @Test fun soZeraDepoisDo200() {
        val p = PlayLog()
        p.shown(d1, "m45")
        p.addTime(d1, "m45", 5_000)
        val b = p.pending()!!
        // o envio falhou (sem commit): a mesma conta sai de novo, somada ao que veio depois
        p.shown(d1, "m45")
        assertEquals(PlayLog.Entry("m45", 2, 5), p.pending()!!.entries.single())
        // agora o 200 do primeiro envio: desconta só o que foi mandado
        p.commit(b)
        assertEquals(PlayLog.Entry("m45", 1, 0), p.pending()!!.entries.single())
        p.commit(p.pending()!!)
        assertNull(p.pending())
        assertTrue(p.isEmpty())
    }

    @Test fun guardaOsMilissegundosQueSobram() {
        val p = PlayLog()
        p.shown(d1, "a")
        p.addTime(d1, "a", 2_600)
        p.commit(p.pending()!!) // mandou n=1, sec=2; sobram 600 ms
        p.addTime(d1, "a", 500)
        assertEquals(PlayLog.Entry("a", 0, 1), p.pending()!!.entries.single())
    }

    @Test fun umDiaPorSinalDeVidaOMaisAntigoPrimeiro() {
        val p = PlayLog()
        p.shown(d2, "b")
        p.shown(d1, "a")
        assertEquals(d1, p.pending()!!.day)
        p.commit(p.pending()!!)
        assertEquals(d2, p.pending()!!.day)
    }

    @Test fun teto100PorSinalDeVida() {
        val p = PlayLog()
        for (i in 0 until 130) p.shown(d1, "i$i")
        val b = p.pending()!!
        assertEquals(PlayLog.MAX_PER_BEAT, b.entries.size)
        p.commit(b)
        assertEquals(30, p.pending()!!.entries.size)
    }

    @Test fun recusaDiaOuRefInvalidos() {
        val p = PlayLog()
        p.shown("20/11/2026", "a")
        p.shown(d1, "")
        p.shown(d1, "x".repeat(65))
        p.addTime(d1, "a", -5)
        assertNull(p.pending())
    }

    @Test fun guardaNoDiscoEVolta() {
        val p = PlayLog()
        p.shown(d1, "m45")
        p.addTime(d1, "m45", 12_345)
        p.shown(d2, "p7")
        assertTrue(p.dirty)
        val json = p.toJson()
        assertTrue(!p.dirty)
        val q = PlayLog()
        q.load(json)
        assertEquals(PlayLog.Entry("m45", 1, 12), q.pending()!!.entries.single())
        // arquivo estragado: começa do zero, sem quebrar
        val r = PlayLog()
        r.load("{lixo")
        assertNull(r.pending())
    }

    @Test fun guardaNoMaximo31Dias() {
        val p = PlayLog()
        for (d in 1..40) p.shown(String.format("2026-10-%02d", d.coerceAtMost(31)).let { if (d > 31) "2026-11-%02d".format(d - 31) else it }, "a")
        assertEquals("2026-10-10", p.pending()!!.day)
    }

    @Test fun tempoAbsurdoELimitado() {
        val p = PlayLog()
        p.shown(d1, "a")
        p.addTime(d1, "a", 5 * 3_600_000L) // relógio pulou: no máximo 10 min por vez
        assertEquals(600L, p.pending()!!.entries.single().sec)
    }
}
