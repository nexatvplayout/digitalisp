package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleOfflineTest {
    // ---- horário ----
    private val util = ScheduleCfg(7 * 60, 19 * 60, setOf(1, 2, 3, 4, 5))

    @Test fun horaMinuto() {
        assertEquals(420, Schedule.parseHm("07:00"))
        assertEquals(425, Schedule.parseHm(" 7:05 "))
        assertEquals(1440, Schedule.parseHm("24:00"))
        assertNull(Schedule.parseHm("24:01"))
        assertNull(Schedule.parseHm("12:60"))
        assertNull(Schedule.parseHm("sete"))
        assertNull(Schedule.parseHm(null))
    }

    @Test fun semHorarioSempreLigada() {
        assertTrue(Schedule.isOn(null, 0, 3 * 60))
    }

    @Test fun diaUtilDentroEFora() {
        assertTrue(Schedule.isOn(util, 1, 7 * 60))        // segunda 07:00 em ponto liga
        assertFalse(Schedule.isOn(util, 1, 7 * 60 - 1))
        assertTrue(Schedule.isOn(util, 5, 19 * 60 - 1))
        assertFalse(Schedule.isOn(util, 5, 19 * 60))      // 19:00 em ponto desliga
    }

    @Test fun fimDeSemanaDesligada() {
        assertFalse(Schedule.isOn(util, 0, 12 * 60))
        assertFalse(Schedule.isOn(util, 6, 12 * 60))
    }

    @Test fun diasVaziosValemTodos() {
        val s = ScheduleCfg(8 * 60, 18 * 60, emptySet())
        for (d in 0..6) assertTrue(Schedule.isOn(s, d, 9 * 60))
    }

    @Test fun janelaQueViraANoite() {
        val s = ScheduleCfg(22 * 60, 6 * 60, setOf(5)) // sexta 22:00 até sábado 06:00
        assertTrue(Schedule.isOn(s, 5, 23 * 60))
        assertTrue(Schedule.isOn(s, 6, 5 * 60))   // madrugada de sábado ainda é a janela de sexta
        assertFalse(Schedule.isOn(s, 6, 7 * 60))
        assertFalse(Schedule.isOn(s, 5, 5 * 60))  // madrugada de sexta seria a janela de quinta
        assertFalse(Schedule.isOn(s, 6, 23 * 60))
        // domingo de madrugada pertence a sábado (ontem de 0 é 6)
        val sab = ScheduleCfg(22 * 60, 6 * 60, setOf(6))
        assertTrue(Schedule.isOn(sab, 0, 60))
    }

    @Test fun ligaEDesligaIguaisEODiaTodo() {
        val s = ScheduleCfg(0, 0, setOf(1))
        assertTrue(Schedule.isOn(s, 1, 0))
        assertTrue(Schedule.isOn(s, 1, 1439))
        assertFalse(Schedule.isOn(s, 2, 600))
    }

    @Test fun quantoFaltaParaLigar() {
        // sexta 19:00 → segunda 07:00 = 60 h
        assertEquals(60 * 60, Schedule.minutesUntilOn(util, 5, 19 * 60))
        // segunda 06:30 → 30 min
        assertEquals(30, Schedule.minutesUntilOn(util, 1, 6 * 60 + 30))
        // dias que não existem: nunca
        assertNull(Schedule.minutesUntilOn(ScheduleCfg(60, 120, setOf(9)), 1, 0))
    }

    // ---- conteúdo guardado ----
    private val shaA = "a".repeat(64)
    private val shaB = "b".repeat(64)
    private val shaC = "c".repeat(64)
    private fun item(sha: String, bytes: Long, url: String = "https://cdn.x/v/$sha.mp4") = OfflineItem(url, sha, bytes)

    @Test fun nomeDoArquivo() {
        assertEquals("$shaA.mp4", OfflinePlan.fileName(item(shaA, 1)))
        assertEquals("$shaA.webm", OfflinePlan.fileName(item(shaA, 1, "https://cdn.x/a/b.WEBM?token=1.2")))
        assertEquals("$shaA.mp4", OfflinePlan.fileName(item(shaA, 1, "https://cdn.x/semextensao")))
        assertEquals("$shaA.mp4", OfflinePlan.fileName(item(shaA, 1, "https://cdn.x/a.b%2F..%2Fc")))
    }

    @Test fun baixaOQueFalta() {
        val p = OfflinePlan.reconcile(listOf(item(shaA, 100), item(shaB, 200)), mapOf("$shaA.mp4" to 100L), 10_000, 1_000)
        assertEquals(listOf(shaA), p.keep.map { it.sha256 })
        assertEquals(listOf(shaB), p.download.map { it.sha256 })
        assertTrue(p.delete.isEmpty())
        assertTrue(p.skipped.isEmpty())
    }

    @Test fun apagaOQueSaiuDaLista() {
        val p = OfflinePlan.reconcile(
            listOf(item(shaA, 100)),
            mapOf("$shaA.mp4" to 100L, "$shaB.mp4" to 200L, "$shaC.mp4.part" to 50L, "lixo.txt" to 1L),
            10_000, 1_000,
        )
        assertEquals(listOf("$shaB.mp4", "$shaC.mp4.part", "lixo.txt").sorted(), p.delete)
        assertTrue(p.download.isEmpty())
    }

    @Test fun tamanhoErradoBaixaDeNovo() {
        val p = OfflinePlan.reconcile(listOf(item(shaA, 100)), mapOf("$shaA.mp4" to 99L), 10_000, 1_000)
        assertEquals(listOf("$shaA.mp4"), p.delete)
        assertEquals(1, p.download.size)
    }

    @Test fun parcialContinuaDeOndeParou() {
        // faltam 40; cabe mesmo com pouco espaço
        val p = OfflinePlan.reconcile(listOf(item(shaA, 100)), mapOf("$shaA.mp4.part" to 60L), 1_050, 1_000)
        assertTrue(p.delete.isEmpty())
        assertEquals(1, p.download.size)
        // parcial maior que o arquivo é lixo
        val q = OfflinePlan.reconcile(listOf(item(shaA, 100)), mapOf("$shaA.mp4.part" to 160L), 10_000, 1_000)
        assertEquals(listOf("$shaA.mp4.part"), q.delete)
    }

    @Test fun semEspacoPula() {
        val p = OfflinePlan.reconcile(listOf(item(shaA, 500), item(shaB, 300), item(shaC, 100)), emptyMap(), 1_450, 1_000)
        // 450 livres de verdade: A (500) não cabe, B (300) cabe, C (100) cabe
        assertEquals(listOf(shaB, shaC), p.download.map { it.sha256 })
        assertEquals(listOf(shaA), p.skipped.map { it.sha256 })
    }

    @Test fun oQueSeraApagadoContaComoEspaco() {
        val p = OfflinePlan.reconcile(listOf(item(shaA, 500)), mapOf("$shaB.mp4" to 400L), 1_100, 1_000)
        assertEquals(1, p.download.size)
    }

    @Test fun itensInvalidosERepetidos() {
        val p = OfflinePlan.reconcile(
            listOf(item(shaA, 100), item(shaA, 100), item("curto", 100), item(shaB, 0), item(shaC, 10, "http://cdn.x/c.mp4")),
            emptyMap(), 10_000, 1_000,
        )
        assertEquals(listOf(shaA), p.download.map { it.sha256 })
    }
}
