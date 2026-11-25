package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.2.4: "Procurar atualização" e a decisão automática pelo `update` do /config. */
class UpdatePolicyTest {
    private val up = UpdateCfg("https://exemplo.test/telas/app/latest.apk?v=9", "a".repeat(64), 9)
    private val h = 3_600_000L

    @Test fun semOfertaOuJaAtualizado() {
        assertEquals(UpdateAction.NONE, UpdatePolicy.decide(8, null, manual = true, triedCode = 0, triedAgoMs = 0))
        assertEquals(UpdateAction.UP_TO_DATE, UpdatePolicy.decide(9, up, true, 0, 0))
        assertEquals(UpdateAction.UP_TO_DATE, UpdatePolicy.decide(10, up, false, 0, 0), "servidor com versão mais velha: nunca volta")
    }

    @Test fun automaticoEsperaOIntervaloOBotaoNao() {
        assertEquals(UpdateAction.DOWNLOAD, UpdatePolicy.decide(8, up, false, triedCode = 0, triedAgoMs = 0))
        assertEquals(UpdateAction.WAIT, UpdatePolicy.decide(8, up, false, triedCode = 9, triedAgoMs = h))
        assertEquals(UpdateAction.DOWNLOAD, UpdatePolicy.decide(8, up, false, triedCode = 9, triedAgoMs = 7 * h))
        assertEquals(UpdateAction.DOWNLOAD, UpdatePolicy.decide(8, up, manual = true, triedCode = 9, triedAgoMs = h))
        // tentativa de outra versão não segura esta; relógio que voltou no tempo (negativo) não segura
        assertEquals(UpdateAction.DOWNLOAD, UpdatePolicy.decide(8, up, false, triedCode = 8, triedAgoMs = h))
        assertEquals(UpdateAction.DOWNLOAD, UpdatePolicy.decide(8, up, false, triedCode = 9, triedAgoMs = -h))
    }

    @Test fun frases() {
        assertTrue(UpdatePolicy.text(UpdateAction.UP_TO_DATE, "1.2.4", 8).contains("1.2.4"))
        assertTrue(UpdatePolicy.text(UpdateAction.DOWNLOAD, "1.2.4", 9).contains("9"))
        assertTrue(UpdatePolicy.text(UpdateAction.NONE, "1.2.4", null).contains("Nenhuma"))
    }

    private fun assertEquals(expected: Any?, actual: Any?, msg: String) = org.junit.Assert.assertEquals(msg, expected, actual)
}

/** 1.2.4: o assistente de configuração inicial. */
class SetupPlanTest {
    private val fresh = SetupState(isHome = false, sdkQPlus = true, deviceOwner = false, canInstall = false, batteryExempt = false, online = true, clockOk = true, configured = false)

    @Test fun ordemEPular() {
        assertEquals(SetupStep.HOME, SetupPlan.next(fresh, emptySet()))
        assertEquals(SetupStep.INSTALL, SetupPlan.next(fresh, setOf(SetupStep.HOME, SetupStep.BOOT)))
        val done = fresh.copy(isHome = true, canInstall = true, batteryExempt = true)
        assertEquals(SetupStep.KEY, SetupPlan.next(done, emptySet()))
        assertNull(SetupPlan.next(done.copy(configured = true), emptySet()))
        assertEquals("pulado", SetupPlan.label(SetupStep.BATTERY, fresh, setOf(SetupStep.BATTERY)))
        assertEquals("falta", SetupPlan.label(SetupStep.BATTERY, fresh, emptySet()))
        assertEquals("OK", SetupPlan.label(SetupStep.NETWORK, fresh, emptySet()))
    }

    @Test fun abrirAoLigarDependeDaTelaInicialNoAndroid10() {
        assertEquals("falta", SetupPlan.label(SetupStep.BOOT, fresh, emptySet()))
        assertEquals("OK", SetupPlan.label(SetupStep.BOOT, fresh.copy(isHome = true), emptySet()))
        assertEquals("OK", SetupPlan.label(SetupStep.BOOT, fresh.copy(sdkQPlus = false), emptySet()), "Android 9 ou mais velho abre pelo aviso de boot")
        // Device Owner resolve tela inicial, abrir ao ligar e instalar
        val owner = fresh.copy(deviceOwner = true)
        for (s in listOf(SetupStep.HOME, SetupStep.BOOT, SetupStep.INSTALL)) assertEquals("OK", SetupPlan.label(s, owner, emptySet()))
    }

    @Test fun redeEHora() {
        assertEquals("falta", SetupPlan.label(SetupStep.NETWORK, fresh.copy(online = false), emptySet()))
        assertEquals("falta", SetupPlan.label(SetupStep.NETWORK, fresh.copy(clockOk = false), emptySet()))
    }

    private fun assertEquals(expected: Any?, actual: Any?, msg: String) = org.junit.Assert.assertEquals(msg, expected, actual)
}
