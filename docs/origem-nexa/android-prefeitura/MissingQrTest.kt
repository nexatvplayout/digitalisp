package br.com.nexatv.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato §11: QR code no card de desaparecido. Dados inventados (telefones com zeros). */
class MissingQrTest {
    private fun one(qr: String): MissingCase = Missing.parse("""[{"id":1,"name":"Pessoa de Teste","contact":"Ligue 199","qr":$qr}]""").single()

    @Test fun osTresComecosAceitos() {
        assertEquals(MissingQr("https://wa.me/5521000000000", "Aponte a câmera e fale agora"), one("""{"data":"https://wa.me/5521000000000","label":"Aponte a câmera e fale agora"}""").qr)
        assertEquals("tel:+5521000000000", one("""{"data":"tel:+5521000000000"}""").qr!!.data)
        assertEquals("sms:+5521000000000", one("""{"data":"sms:+5521000000000"}""").qr!!.data)
        // o começo pode vir em maiúsculas; o conteúdo vai para o código como veio
        assertEquals("HTTPS://exemplo.test/a", one("""{"data":"HTTPS://exemplo.test/a"}""").qr!!.data)
        assertEquals("https://exemplo.test/a", one("""{"data":"  https://exemplo.test/a  "}""").qr!!.data)
    }

    @Test fun ausenteNuloOuTipoErradoEhSemQrEOCasoContinua() {
        val sem = Missing.parse("""[{"id":1,"name":"Pessoa de Teste"}]""").single()
        assertNull(sem.qr)
        for (bad in listOf("null", "7", "true", "\"https://exemplo.test\"", "[]", "{}", """{"data":null}""", """{"data":7}""", """{"data":["https://a.test"]}""", """{"data":""}""", """{"label":"só a frase"}""")) {
            val c = one(bad)
            assertNull("qr $bad", c.qr)
            assertEquals("Pessoa de Teste", c.name) // o caso não cai por causa do qr
            assertEquals("Ligue 199", c.contact)
        }
    }

    @Test fun outrosComecosSaoIgnorados() {
        for (data in listOf(
            "http://exemplo.test/a", "ftp://exemplo.test", "javascript:alert(1)", "tel:21000000000", "sms:21000000000", "mailto:a@exemplo.test",
            "wa.me/5521000000000", "intent://x", "https://", "tel:+", "sms:+", "https://a.test/com espaço", "https://a.test/\\nlinha",
        )) {
            assertNull(data, one("""{"data":"$data"}""").qr)
        }
    }

    @Test fun dataAteTrezentosCaracteres() {
        val base = "https://exemplo.test/"
        assertEquals(300, one("""{"data":"${base + "a".repeat(300 - base.length)}"}""").qr!!.data.length)
        // comprido demais é recusado, não cortado (um endereço cortado levaria a outro lugar)
        assertNull(one("""{"data":"${base + "a".repeat(301 - base.length)}"}""").qr)
    }

    @Test fun fraseAoLado() {
        assertEquals("Aponte a câmera do celular", one("""{"data":"tel:+5521000000000"}""").qr!!.label)
        for (bad in listOf("null", "7", "[]", "{}", "\"\"", "\"   \"")) {
            assertEquals("label $bad", "Aponte a câmera do celular", one("""{"data":"tel:+5521000000000","label":$bad}""").qr!!.label)
        }
        assertEquals(40, one("""{"data":"tel:+5521000000000","label":"${"x".repeat(90)}"}""").qr!!.label.length)
        assertEquals("Fale com a Defesa Civil", one("""{"data":"tel:+5521000000000","label":" Fale com a\n Defesa   Civil "}""").qr!!.label)
        assertEquals("Aponte a câmera do celular", MissingQr.DEFAULT_LABEL)
    }

    @Test fun idaEVoltaDoQueFicaGuardado() {
        val list = Missing.parse(
            """[{"id":1,"name":"Com QR","qr":{"data":"https://wa.me/5521000000000","label":"Fale agora"}},
                {"id":2,"name":"Com QR e frase padrão","qr":{"data":"sms:+5521000000000"}},
                {"id":3,"name":"Sem QR"}]""",
        )
        assertEquals(list, Missing.parse(Missing.toJson(list)))
        assertNotNull(Missing.parse(Missing.toJson(list))[0].qr)
        assertNull(Missing.parse(Missing.toJson(list))[2].qr)
    }

    @Test fun tamanhoNaTelaCheiaPeloMenosVinteEDoisPorCentoDaAltura() {
        for ((w, h) in listOf(1920 to 1080, 1280 to 720, 3840 to 2160, 1366 to 768)) {
            val side = MissingQrSize.full(w, h)
            assertTrue("$w×$h: $side", side >= Math.ceil(h * 0.22).toInt())
            assertTrue("$w×$h: $side", side <= h * 0.25)
        }
        assertEquals(249, MissingQrSize.full(1920, 1080))
        // TV em pé: limitado pela largura, para a frase caber ao lado
        assertEquals(442, MissingQrSize.full(1080, 1920))
        assertEquals(324, MissingQrSize.full(720, 1920))
        assertEquals(0, MissingQrSize.full(0, 0))
    }

    @Test fun faixaSoDesenhaOCodigoSeDerParaLer() {
        // tela deitada 1080p: faixa de 17% da altura -> o código passa de 12% da altura da tela
        val deitada = MissingQrSize.banner(183, 1080)
        assertEquals(159, deitada)
        assertTrue(deitada >= 1080 * 0.12)
        // painel de senha deitado: faixa de 20%
        assertEquals(187, MissingQrSize.banner(216, 1080))
        // TV em pé: a faixa (17% da largura) é baixa demais perto da altura da tela -> sem código, só o contato
        assertEquals(0, MissingQrSize.banner(183, 1920))
        // no limite
        assertEquals(0, MissingQrSize.banner(100, 1000)) // 87 < 120
        assertEquals(120, MissingQrSize.banner(138, 1000))
        assertEquals(0, MissingQrSize.banner(0, 1080))
        assertEquals(0, MissingQrSize.banner(183, 0))
    }
}
