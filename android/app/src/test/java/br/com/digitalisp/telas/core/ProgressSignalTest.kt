package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressSignalTest {
    /** Roda o vigia de verdade em cima do sinal, um tique por segundo; devolve as ações. */
    private fun run(w: Watchdog, s: ProgressSignal, from: Long, seconds: Int, frames: (Int) -> Long, position: (Int) -> Long): List<WdAction> {
        val out = ArrayList<WdAction>()
        for (i in 0 until seconds) out.add(w.tick(from + i * 1000L, s.sample(frames(i), position(i)), true))
        return out
    }

    private fun wd() = Watchdog().apply { hasMain = true; hasBackup = true }.also { it.start(0) }

    @Test fun quadrosAndandoEOCaminhoNormal() {
        val s = ProgressSignal()
        val w = wd()
        val acts = run(w, s, 1000, 120, { it * 30L }, { it * 1000L })
        assertTrue(acts.all { it == WdAction.None })
        assertFalse(s.byPosition)
    }

    @Test fun contadorParadoComPosicaoAndandoETocando() {
        // decodificador que não informa quadros: o contador fica em 0 para sempre, mas a posição anda
        val s = ProgressSignal()
        val w = wd()
        val acts = run(w, s, 1000, 300, { 0L }, { it * 1000L })
        assertTrue(acts.all { it == WdAction.None }) // nada de recarregar a cada 10 s
        assertEquals(0, w.failedReloads)
        assertEquals(Source.HLS, w.source)
        assertTrue(s.byPosition)
    }

    @Test fun passaParaPosicaoDepoisDeTresTiques() {
        val s = ProgressSignal()
        s.sample(0, 0)      // primeira amostra não conta
        s.sample(0, 1000)
        s.sample(0, 2000)
        assertFalse(s.byPosition)
        s.sample(0, 3000)
        assertTrue(s.byPosition)
    }

    @Test fun umSaltoDePosicaoSemQuadroNaoTrocaOModo() {
        // volta à ponta do ao vivo: a posição salta num tique, os quadros retomam em seguida
        val s = ProgressSignal()
        s.sample(100, 5000)
        s.sample(130, 6000)
        s.sample(130, 90_000) // salto sem quadro novo
        s.sample(130, 90_000) // carregando
        s.sample(160, 91_000)
        s.sample(160, 92_000) // um tique sem quadro
        s.sample(190, 93_000)
        assertFalse(s.byPosition)
    }

    @Test fun soTravaComOsDoisParados() {
        val s = ProgressSignal()
        val w = wd()
        run(w, s, 1000, 20, { it * 30L }, { it * 1000L })
        // quadros parados, posição andando: segue tocando
        assertTrue(run(w, s, 21_000, 30, { 570L }, { 20_000L + it * 1000L }).all { it == WdAction.None })
        // posição parada, quadros andando (cartela com a janela parada): segue tocando
        assertTrue(run(w, s, 51_000, 30, { 600L + it * 30L }, { 49_000L }).all { it == WdAction.None })
        // os dois parados: recarrega aos 10 s
        val acts = run(w, s, 81_000, 10, { 1470L }, { 49_000L })
        assertTrue(acts.dropLast(1).all { it == WdAction.None })
        assertEquals(WdAction.Play(Source.HLS), acts.last())
        assertEquals(1, w.failedReloads)
    }

    @Test fun noModoPorPosicaoPosicaoParadaTrava() {
        val s = ProgressSignal()
        val w = wd()
        run(w, s, 1000, 20, { 0L }, { it * 1000L })
        assertTrue(s.byPosition)
        val acts = run(w, s, 21_000, 10, { 0L }, { 19_000L })
        assertEquals(WdAction.Play(Source.HLS), acts.last())
    }

    @Test fun posicaoQueSaltaParaTrasContaComoAndando() {
        // janela do ao vivo andando: a posição cai a cada atualização da lista; mudou, está andando
        val s = ProgressSignal()
        val w = wd()
        val acts = run(w, s, 1000, 120, { 0L }, { (it % 6) * 1000L })
        assertTrue(acts.all { it == WdAction.None })
    }

    @Test fun recargaEsqueceAsAmostrasMasNaoOModo() {
        val s = ProgressSignal()
        for (i in 0..5) s.sample(0, i * 1000L)
        assertTrue(s.byPosition)
        val before = s.sample(0, 5000) // parado
        s.reload()
        // primeira amostra depois da recarga sempre conta como mudança (dá o prazo novo ao vigia)
        assertEquals(before + 1, s.sample(0, 5000))
        assertEquals(before + 1, s.sample(0, 5000))
        assertTrue(s.byPosition)
    }

    @Test fun contadoresQueZeramNaRecargaNaoConfundem() {
        val s = ProgressSignal()
        val a = s.sample(900, 50_000)
        val b = s.sample(0, 0) // decodificador recriado
        val c = s.sample(30, 1000)
        assertTrue(b > a && c > b)
        assertFalse(s.byPosition)
    }
}
