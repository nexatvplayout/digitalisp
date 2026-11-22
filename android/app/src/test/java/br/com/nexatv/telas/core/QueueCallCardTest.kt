package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §7.2: a chamada aparece em destaque em qualquer layout (cartão por cima do vídeo onde não há painel). */
class QueueCallCardTest {
    private fun cfg(layout: String, queueOn: Boolean = true, widgets: String? = null, ticker: Boolean = true) = ConfigParser.parse(
        """{"layout":"$layout","queue":{"enabled":$queueOn,"showName":true}""" +
            (if (widgets != null) ""","side":{"widgets":[$widgets]}""" else "") +
            (if (ticker) ""","ticker":{"items":["Aviso"]}""" else "") + "}",
    )

    private fun call(id: Long = 1, ticket: String = "AP001", desk: String = "Consultorio 1", name: String? = null, priority: Boolean = false) =
        QueueCall(id, ticket, desk, name, priority, 0L)

    private val hot = QueueReducer.onCall(QueueState(), call(), 1000).state

    @Test fun semPainelMostraOCartao() {
        // o caso da TV box de 14/11: "Vídeo + avisos" (ticker), Chamar próxima, nada na tela
        for (l in listOf("full", "ticker", "lbar", "portrait")) {
            assertTrue(l, QueueCallCard.show(cfg(l), hot, 1000, scheduleOn = true))
        }
        assertTrue(QueueCallCard.show(cfg("side", widgets = "\"clock\",\"qr\""), hot, 1000, true))
        assertTrue(QueueCallCard.show(cfg("full", ticker = false), hot, 1000, true))
    }

    @Test fun comPainelTambemMostraEmTelaInteira() {
        // pedido do dono (14/11): na chamada, a tela inteira, inclusive no painel de senha e na coluna com o widget
        assertTrue(QueueCallCard.show(cfg("queue"), hot, 1000, true))
        assertTrue(QueueCallCard.show(cfg("side", widgets = "\"clock\",\"queue\""), hot, 1000, true))
        assertTrue(QueueCallCard.show(cfg("portrait", widgets = "\"queue\""), hot, 1000, true))
        assertTrue(QueueCallCard.show(cfg("lbar", widgets = "\"queue\""), hot, 1000, true))
    }

    @Test fun soNos10sDoDestaque() {
        val c = cfg("ticker")
        assertTrue(QueueCallCard.show(c, hot, 10_999, true))
        assertFalse(QueueCallCard.show(c, hot, 11_000, true))
        assertFalse(QueueCallCard.show(c, QueueState(), 1000, true))
        // estado vindo do GET ao conectar: sem destaque, sem cartão
        val snap = QueueReducer.onSnapshot(QueueState(), QueueSnapshot(call(), emptyList(), null))
        assertFalse(QueueCallCard.show(c, snap, 1000, true))
    }

    @Test fun chamadaSeguidaRecomecaOPrazo() {
        val c = cfg("ticker")
        val second = QueueReducer.onCall(hot, call(2, "AP002"), 8000).state
        assertEquals("AP002", second.current!!.ticket)
        assertTrue(QueueCallCard.show(c, second, 17_999, true))
        assertFalse(QueueCallCard.show(c, second, 18_000, true))
        // repetir a mesma senha também recomeça
        val again = QueueReducer.onCall(hot, call().copy(repeat = true), 9000).state
        assertTrue(QueueCallCard.show(c, again, 18_999, true))
    }

    @Test fun foraDoHorarioOuSemSenhaNaoMostra() {
        assertFalse(QueueCallCard.show(cfg("ticker"), hot, 1000, scheduleOn = false))
        assertFalse(QueueCallCard.show(cfg("ticker", queueOn = false), hot, 1000, true))
        // layout queue sem a senha ligada vira side (sem widget de senha), e a senha desligada não mostra nada
        assertFalse(QueueCallCard.show(cfg("queue", queueOn = false), hot, 1000, true))
        assertFalse(QueueCallCard.show(null, hot, 1000, true))
    }

    @Test fun textoDoCartao() {
        assertEquals(CallCardText("AP001", "Consultorio 1", null), QueueCallCard.text(call(), showName = false))
        assertEquals(CallCardText("AP001", "Consultorio 1 · preferencial", null), QueueCallCard.text(call(priority = true), false))
        assertEquals("Preferencial", QueueCallCard.text(call(desk = "", priority = true), false).desk)
        assertEquals("", QueueCallCard.text(call(desk = ""), false).desk)
        // nome só com showName e nome de verdade
        assertEquals("Maria S.", QueueCallCard.text(call(name = " Maria S. "), true).name)
        assertNull(QueueCallCard.text(call(name = "Maria S."), false).name)
        assertNull(QueueCallCard.text(call(name = "  "), true).name)
        assertNull(QueueCallCard.text(call(name = null), true).name)
    }
}

/** Retorno do dono (14/11): "amarelo com branco não deu para ler nada". */
class QueueColorsTest {
    private val idle = 0xFF10294D.toInt()

    @Test fun destaqueAmareloComTudoEscuro() {
        val h = QueueColors.of(hot = true, idleBg = idle)
        assertEquals(0xFFFFD166.toInt(), h.bg)
        // texto e rótulo legíveis a distância sobre o amarelo (WCAG AAA = 7)
        assertTrue(QueueColors.contrast(h.text, h.bg) >= 7.0)
        assertTrue(QueueColors.contrast(h.label, h.bg) >= 7.0)
        // o que dava errado: branco e o cinza-claro sobre o amarelo
        assertTrue(QueueColors.contrast(QueueColors.WHITE, h.bg) < 2.0)
        assertTrue(QueueColors.contrast(QueueColors.MUTED, h.bg) < 2.0)
    }

    @Test fun foraDoDestaqueFundoEscuroTextoClaro() {
        val n = QueueColors.of(hot = false, idleBg = idle)
        assertEquals(idle, n.bg)
        assertTrue(QueueColors.contrast(n.text, n.bg) >= 7.0)
        assertTrue(QueueColors.contrast(n.label, n.bg) >= 4.5)
    }

    @Test fun contrasteConhecido() {
        assertEquals(21.0, QueueColors.contrast(0xFF000000.toInt(), 0xFFFFFFFF.toInt()), 0.01)
        assertEquals(1.0, QueueColors.contrast(idle, idle), 0.0001)
    }
}
