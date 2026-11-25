package br.com.nexatv.telas.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

/** Contrato §8: pessoas desaparecidas. Todos os dados aqui são inventados. */
class MissingTest {
    private val sha = "ab".repeat(32)

    private val exemplo = """
    [ {
      "id": 5, "kind": "crianca", "name": "Pessoa de Teste Um", "age": 8, "since": "2026-11-10",
      "lastSeen": "Praça de Teste, por volta das 16h", "description": "Blusa amarela, mochila rosa",
      "contact": "Ligue 199 ou 190",
      "photo": { "url": "https://midia.exemplo.test/fotos/a.jpg", "sha256": "${sha.uppercase()}", "bytes": 182344 },
      "show": "both", "fullSec": 15, "bannerSec": 20, "everyMin": 10, "until": 1794900000000
    } ]
    """

    private fun case(
        id: Long, show: MissingShow = MissingShow.BOTH, fullSec: Int = 15, bannerSec: Int = 20, everyMin: Int = 10, until: Long = 0L,
        photo: MissingPhoto? = null,
    ) = MissingCase(id, "adulto", "Pessoa de Teste $id", 30, null, "", "", "Ligue 199", photo, show, fullSec, bannerSec, everyMin, until)

    private fun sec(h: Int, m: Int, s: Int = 0) = h * 3600 + m * 60 + s

    // ---- leitura ----
    @Test fun casoCompleto() {
        val c = Missing.parse(exemplo).single()
        assertEquals(5L, c.id)
        assertEquals("crianca", c.kind)
        assertEquals("Pessoa de Teste Um", c.name)
        assertEquals(8, c.age)
        assertEquals("2026-11-10", c.since)
        assertEquals("Praça de Teste, por volta das 16h", c.lastSeen)
        assertEquals("Blusa amarela, mochila rosa", c.description)
        assertEquals("Ligue 199 ou 190", c.contact)
        assertEquals(MissingPhoto("https://midia.exemplo.test/fotos/a.jpg", sha, 182344L), c.photo)
        assertEquals(MissingShow.BOTH, c.show)
        assertEquals(15, c.fullSec)
        assertEquals(20, c.bannerSec)
        assertEquals(10, c.everyMin)
        assertEquals(1794900000000L, c.until)
    }

    @Test fun campoAusenteOuVazioEhRecursoDesligado() {
        assertTrue(Missing.parse(JSONObject("{}").optJSONArray("missing")).isEmpty())
        assertTrue(Missing.parse(JSONObject("""{"missing":[]}""").optJSONArray("missing")).isEmpty())
        assertTrue(Missing.parse(JSONObject("""{"missing":"nada"}""").optJSONArray("missing")).isEmpty())
        assertTrue(Missing.parse(null as String?).isEmpty())
        assertTrue(Missing.parse("isto não é json").isEmpty())
    }

    @Test fun padroesParaCamposAusentes() {
        val c = Missing.parse("""[{"id":1,"name":"Pessoa de Teste"}]""").single()
        assertEquals("adulto", c.kind)
        assertNull(c.age)
        assertNull(c.since)
        assertEquals("", c.lastSeen)
        assertEquals("", c.description)
        assertEquals("", c.contact)
        assertNull(c.photo)
        assertEquals(MissingShow.BOTH, c.show)
        assertEquals(15, c.fullSec)
        assertEquals(20, c.bannerSec)
        assertEquals(10, c.everyMin)
        assertEquals(0L, c.until)
    }

    @Test fun limitesDosTempos() {
        fun one(extra: String) = Missing.parse("""[{"id":1,"name":"Teste",$extra}]""").single()
        assertEquals(8, one(""""fullSec":1""").fullSec)
        assertEquals(60, one(""""fullSec":999""").fullSec)
        assertEquals(15, one(""""fullSec":0""").fullSec)
        assertEquals(15, one(""""fullSec":-3""").fullSec)
        assertEquals(15, one(""""fullSec":"muito"""").fullSec)
        assertEquals(15, one(""""fullSec":null""").fullSec)
        assertEquals(8, one(""""bannerSec":2""").bannerSec)
        assertEquals(120, one(""""bannerSec":500""").bannerSec)
        assertEquals(20, one(""""bannerSec":{}""").bannerSec)
        assertEquals(2, one(""""everyMin":1""").everyMin)
        assertEquals(60, one(""""everyMin":240""").everyMin)
        assertEquals(10, one(""""everyMin":[]""").everyMin)
        assertEquals(30, one(""""everyMin":"30"""").everyMin)
    }

    @Test fun tiposErradosNaoDerrubam() {
        val list = Missing.parse(
            """[ null, 7, "texto", {"id":"x","name":"Sem id"}, {"id":2}, {"id":3,"name":""},
                 {"id":4,"name":"Pessoa de Teste Quatro","kind":"ET","age":"doze","since":"10/11/2026","lastSeen":null,"description":77,
                  "contact":["a"],"photo":"foto.jpg","show":"holograma","until":"amanhã"},
                 {"id":4,"name":"Repetido"} ]""",
        )
        val c = list.single()
        assertEquals(4L, c.id)
        assertEquals("adulto", c.kind) // tipo desconhecido vira "PESSOA DESAPARECIDA"
        assertNull(c.age)
        assertNull(c.since)
        assertEquals("", c.lastSeen)
        assertEquals("77", c.description)
        assertEquals("", c.contact)
        assertNull(c.photo)
        assertEquals(MissingShow.BOTH, c.show)
        assertEquals(0L, c.until)
    }

    @Test fun idadeEData() {
        fun one(extra: String) = Missing.parse("""[{"id":1,"name":"Teste",$extra}]""").single()
        assertEquals(0, one(""""age":0""").age)
        assertEquals(72, one(""""age":72.9""").age)
        assertNull(one(""""age":-1""").age)
        assertNull(one(""""age":400""").age)
        assertNull(one(""""since":"2026-13-01"""").since)
        assertNull(one(""""since":"2026-11-1"""").since)
        assertEquals("2026-01-31", one(""""since":"2026-01-31"""").since)
    }

    @Test fun noMaximoCincoECortaTextoComprido() {
        val many = (1..9).joinToString(",") { """{"id":$it,"name":"Teste $it"}""" }
        val list = Missing.parse("[$many]")
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), list.map { it.id })
        val long = Missing.parse("""[{"id":1,"name":"${"n".repeat(300)}","lastSeen":"${"l".repeat(300)}","description":"${"d".repeat(300)}","contact":"${"c".repeat(300)}"}]""").single()
        assertEquals(80, long.name.length)
        assertEquals(120, long.lastSeen.length)
        assertEquals(200, long.description.length)
        assertEquals(80, long.contact.length)
    }

    @Test fun fotoSoHttpsComSha256EAteUmMega() {
        fun photo(p: String) = Missing.parse("""[{"id":1,"name":"Teste","photo":$p}]""").single().photo
        assertNotNull(photo("""{"url":"https://a.test/f.jpg","sha256":"$sha","bytes":600000}"""))
        assertNotNull(photo("""{"url":"https://a.test/f.jpg","sha256":"$sha","bytes":1048576}"""))
        assertNull(photo("""{"url":"https://a.test/f.jpg","sha256":"$sha","bytes":1048577}""")) // acima de 1 MB: nem baixa
        assertNull(photo("""{"url":"http://a.test/f.jpg","sha256":"$sha","bytes":1000}"""))
        assertNull(photo("""{"url":"https://a.test/f.jpg","sha256":"abc","bytes":1000}"""))
        assertNull(photo("""{"url":"https://a.test/f.jpg","sha256":"$sha"}"""))
        assertNull(photo("""{"url":"https://a.test/f.jpg","sha256":"$sha","bytes":0}"""))
        assertNull(photo("""{"sha256":"$sha","bytes":10}"""))
        assertNull(photo("null"))
    }

    @Test fun idaEVoltaDoQueFicaGuardado() {
        val list = Missing.parse(exemplo) + case(9, MissingShow.BANNER, until = 123L)
        assertEquals(list, Missing.parse(Missing.toJson(list)))
    }

    @Test fun vencidoNaoMostra() {
        val list = listOf(case(1, until = 1000L), case(2, until = 0L), case(3, until = 5000L))
        assertEquals(listOf(1L, 2L, 3L), Missing.active(list, 999L).map { it.id })
        assertEquals(listOf(2L, 3L), Missing.active(list, 1000L).map { it.id })
        assertEquals(listOf(2L), Missing.active(list, 9000L).map { it.id })
    }

    // ---- textos ----
    @Test fun cabecalhoPorTipo() {
        assertEquals("CRIANÇA DESAPARECIDA", Missing.header("crianca"))
        assertEquals("ADOLESCENTE DESAPARECIDO(A)", Missing.header("adolescente"))
        assertEquals("PESSOA DESAPARECIDA", Missing.header("adulto"))
        assertEquals("IDOSO(A) DESAPARECIDO(A)", Missing.header("idoso"))
        assertEquals("PESSOA DESAPARECIDA", Missing.header("outro"))
        assertEquals("DESAPARECIDA(O)", Missing.SHORT_HEADER)
    }

    @Test fun idadeDesdeEVistoPorUltimo() {
        assertEquals("8 anos", Missing.age(8))
        assertEquals("1 ano", Missing.age(1))
        assertEquals("0 anos", Missing.age(0))
        assertEquals("", Missing.age(null))
        assertEquals("Desde 10/11/2026", Missing.since("2026-11-10"))
        assertEquals("", Missing.since(null))
        assertEquals("", Missing.since("ontem"))
        assertEquals("Visto(a) por último: Praça de Teste", Missing.lastSeen("Praça de Teste"))
        assertEquals("", Missing.lastSeen(""))
        assertEquals("Pessoa de Teste 1, 30 anos", Missing.nameAndAge(case(1)))
        assertEquals("Pessoa de Teste 1", Missing.nameAndAge(case(1).copy(age = null)))
    }

    // ---- ritmo ----
    @Test fun bothTelaCheiaNoComecoDoCicloEFaixaNaMetade() {
        val list = listOf(case(1)) // both, 15 s cheia, 20 s faixa, a cada 10 min
        assertNull(MissingSchedule.at(list, sec(9, 59, 59), false))
        assertEquals(MissingShowing(list[0], true, 15), MissingSchedule.at(list, sec(10, 0, 0), false))
        assertEquals(MissingShowing(list[0], true, 1), MissingSchedule.at(list, sec(10, 0, 14), false))
        assertNull(MissingSchedule.at(list, sec(10, 0, 15), false))
        assertNull(MissingSchedule.at(list, sec(10, 4, 59), false))
        assertEquals(MissingShowing(list[0], false, 20), MissingSchedule.at(list, sec(10, 5, 0), false))
        assertEquals(MissingShowing(list[0], false, 1), MissingSchedule.at(list, sec(10, 5, 19), false))
        assertNull(MissingSchedule.at(list, sec(10, 5, 20), false))
        assertNotNull(MissingSchedule.at(list, sec(10, 10, 0), false))
        // meia-noite também é começo de ciclo
        assertNotNull(MissingSchedule.at(list, 0, false))
    }

    @Test fun fullSoTelaCheiaEBannerSoFaixaNoComecoDoCiclo() {
        val full = listOf(case(1, MissingShow.FULL))
        assertTrue(MissingSchedule.at(full, sec(8, 20), false)!!.full)
        assertNull(MissingSchedule.at(full, sec(8, 25), false))
        val banner = listOf(case(1, MissingShow.BANNER))
        assertEquals(MissingShowing(banner[0], false, 20), MissingSchedule.at(banner, sec(8, 20), false))
        assertNull(MissingSchedule.at(banner, sec(8, 25), false))
    }

    @Test fun variosCasosSaemUmDepoisDoOutroNaOrdemDaLista() {
        val list = listOf(case(1, fullSec = 10), case(2, fullSec = 20), case(3, MissingShow.BANNER, bannerSec = 30))
        val t0 = sec(14, 30)
        assertEquals(1L, MissingSchedule.at(list, t0, false)!!.case.id)
        assertEquals(1L, MissingSchedule.at(list, t0 + 9, false)!!.case.id)
        assertEquals(MissingShowing(list[1], true, 20), MissingSchedule.at(list, t0 + 10, false))
        assertEquals(MissingShowing(list[2], false, 30), MissingSchedule.at(list, t0 + 30, false))
        assertNull(MissingSchedule.at(list, t0 + 60, false))
        // na metade: só a faixa dos "both" (1 e 2), 20 s cada
        assertEquals(MissingShowing(list[0], false, 20), MissingSchedule.at(list, t0 + 300, false))
        assertEquals(MissingShowing(list[1], false, 20), MissingSchedule.at(list, t0 + 320, false))
        assertNull(MissingSchedule.at(list, t0 + 340, false))
    }

    @Test fun conjuntoNuncaPassaDeMetadeDoCicloERodizia() {
        // ciclo de 2 min: metade = 60 s; cinco casos de 25 s só cabem dois por ciclo
        val list = (1L..5L).map { case(it, MissingShow.FULL, fullSec = 25, everyMin = 2) }
        fun idsDoCiclo(startMin: Int): List<Long> {
            val ids = ArrayList<Long>()
            for (s in 0 until 120) MissingSchedule.at(list, startMin * 60 + s, false)?.let { if (ids.lastOrNull() != it.case.id) ids.add(it.case.id) }
            return ids
        }
        // nada depois da metade do ciclo
        for (s in 60 until 120) assertNull(MissingSchedule.at(list, s, false))
        assertEquals(listOf(1L, 2L), idsDoCiclo(0))
        assertEquals(listOf(2L, 3L), idsDoCiclo(2))
        assertEquals(listOf(3L, 4L), idsDoCiclo(4))
        assertEquals(listOf(5L, 1L), idsDoCiclo(8))
        // em cinco ciclos seguidos todos apareceram
        val todos = (0 until 5).flatMap { idsDoCiclo(it * 2) }.toSet()
        assertEquals(setOf(1L, 2L, 3L, 4L, 5L), todos)
    }

    @Test fun exibicaoMaisCompridaQueMetadeDoCicloEhCortadaNaMetade() {
        val list = listOf(case(1, MissingShow.BANNER, bannerSec = 120, everyMin = 2))
        assertEquals(60, MissingSchedule.at(list, 0, false)!!.remainingSec)
        assertNull(MissingSchedule.at(list, 60, false))
    }

    @Test fun cadaCasoNoSeuRitmo() {
        // um a cada 10 min e outro a cada 30: o ciclo do aparelho é 10 e o segundo entra uma vez em cada três
        val list = listOf(case(1, MissingShow.FULL, everyMin = 10), case(2, MissingShow.FULL, everyMin = 30))
        assertEquals(2L, MissingSchedule.at(list, sec(9, 0, 15), false)!!.case.id)
        assertNull(MissingSchedule.at(list, sec(9, 10, 15), false))
        assertNull(MissingSchedule.at(list, sec(9, 20, 15), false))
        assertEquals(2L, MissingSchedule.at(list, sec(9, 30, 15), false)!!.case.id)
        assertEquals(1L, MissingSchedule.at(list, sec(9, 10, 0), false)!!.case.id)
    }

    @Test fun noLayoutQueueTudoViraFaixa() {
        val list = listOf(case(1, MissingShow.FULL), case(2, MissingShow.BOTH), case(3, MissingShow.BANNER))
        for (s in 0 until 600) {
            val sh = MissingSchedule.at(list, sec(11, 0) + s, queueLayout = true)
            if (sh != null) assertFalse("tela cheia no segundo $s", sh.full)
        }
        // o "full" sai como faixa, pelo tempo da faixa, no começo do ciclo
        assertEquals(MissingShowing(list[0], false, 20), MissingSchedule.at(list, sec(11, 0), true))
        // e o "both" ainda tem a faixa da metade
        assertEquals(MissingShowing(list[1], false, 20), MissingSchedule.at(list, sec(11, 5), true))
    }

    @Test fun relogioDoAparelhoErradoOSegundoDoDiaAindaMandaNoRitmo() {
        // O ritmo só olha os segundos desde a meia-noite do relógio local, seja qual for o ano que o aparelho acha
        // que é; quem compara com a hora de verdade é o `until` (Missing.active, com a hora acertada pelo servidor).
        val list = listOf(case(1, until = 1794900000000L))
        val horaCerta = 1794300000000L // antes do until
        val ativos = Missing.active(list, horaCerta)
        assertNotNull(MissingSchedule.at(ativos, sec(3, 20), false))
        // com a hora acertada depois do prazo, o caso sai mesmo com o relógio local parado em 2015
        assertTrue(Missing.active(list, 1794900000001L).isEmpty())
        assertNull(MissingSchedule.at(Missing.active(list, 1794900000001L), sec(3, 20), false))
    }

    @Test fun semCasosNaoHaNada() {
        assertNull(MissingSchedule.at(emptyList(), sec(10, 0), false))
        assertNull(MissingSchedule.nextStart(emptyList(), 0, false))
    }

    @Test fun proximaExibicao() {
        val list = listOf(case(1)) // both a cada 10 min
        assertEquals(sec(10, 5), MissingSchedule.nextStart(list, sec(10, 0), false))
        assertEquals(sec(10, 10), MissingSchedule.nextStart(list, sec(10, 5), false))
        assertEquals(sec(10, 10), MissingSchedule.nextStart(list, sec(10, 7, 30), false))
        assertEquals("10:10", MissingSchedule.hhmm(sec(10, 10)))
        // vira o dia
        assertEquals(0, MissingSchedule.nextStart(listOf(case(1, MissingShow.FULL)), sec(23, 55), false))
        assertEquals("00:00", MissingSchedule.hhmm(0))
    }

    // ---- fotos ----
    @Test fun planoDasFotos() {
        val a = MissingPhoto("https://a.test/a.jpg", "aa".repeat(32), 100)
        val b = MissingPhoto("https://a.test/b.jpg", "bb".repeat(32), 200)
        val c = MissingPhoto("https://a.test/c.jpg", "cc".repeat(32), 300)
        val cases = listOf(case(1, photo = a), case(2, photo = b), case(3, photo = c), case(4), case(5, photo = a))
        val existing = mapOf(
            a.fileName to 100L, // pronta
            b.fileName to 150L, // tamanho errado: lixo
            c.fileName + ".part" to 120L, // pela metade: continua
            "dd".repeat(32) + ".jpg" to 50L, // de um caso que saiu da lista
        )
        val plan = Missing.photoPlan(cases, existing)
        assertEquals(listOf(b, c), plan.download)
        assertEquals(listOf(b.fileName, "dd".repeat(32) + ".jpg"), plan.delete)
        // lista vazia apaga tudo
        assertEquals(existing.keys.sorted(), Missing.photoPlan(emptyList(), existing).delete)
        assertEquals("aa".repeat(32) + ".jpg", a.fileName)
    }

    @Test fun fotoBaixadaEConferidaComOTransporteDeMentira() {
        val dir: File = Files.createTempDirectory("nexa-telas-missing").toFile()
        try {
            val bytes = ByteArray(5000) { (it % 251).toByte() } // não é foto de ninguém: bytes de teste
            val good = MissingPhoto("https://a.test/a.jpg", Hex.of(MessageDigest.getInstance("SHA-256").digest(bytes)), bytes.size.toLong())
            val transport = OfflineTransport { _, _ -> OfflineResponse(200, ByteArrayInputStream(bytes)) }
            assertEquals(OfflineFetch.Result.OK, OfflineFetch.fetchAs(good.fileName, good.asItem(), dir, transport))
            assertEquals(bytes.size.toLong(), File(dir, good.fileName).length())

            // sha256 que não confere: o arquivo não fica (o caso é mostrado com a silhueta)
            val bad = MissingPhoto("https://a.test/b.jpg", "00".repeat(32), bytes.size.toLong())
            assertEquals(OfflineFetch.Result.BAD_HASH, OfflineFetch.fetchAs(bad.fileName, bad.asItem(), dir, transport))
            assertFalse(File(dir, bad.fileName).exists())
            assertFalse(File(dir, bad.fileName + ".part").exists())

            // servidor manda mais do que anunciou: recusado
            val short = MissingPhoto("https://a.test/c.jpg", good.sha256, 100)
            assertEquals(OfflineFetch.Result.BAD_HASH, OfflineFetch.fetchAs("c.jpg", short.asItem(), dir, transport))
            assertFalse(File(dir, "c.jpg").exists())
        } finally {
            dir.deleteRecursively()
        }
    }

    // ---- contrato §10: cabeçalho pronto e cartela de pedido de informação ----
    @Test fun headerPresenteAusenteELongoDemais() {
        fun one(extra: String) = Missing.parse("""[{"id":1,"name":"Pessoa de Teste",$extra}]""").single()
        assertEquals("", one(""""kind":"adulto"""").header)
        assertEquals("PROCURADO PELA JUSTIÇA", one(""""header":"Procurado pela Justiça"""").header)
        assertEquals("A POLÍCIA PEDE INFORMAÇÕES", one(""""header":"  a polícia\n pede   informações  """").header)
        assertEquals(40, one(""""header":"${"x".repeat(100)}"""").header.length)
        for (bad in listOf("null", "7", "true", "[\"A\"]", "{}", "\"\"", "\"   \"")) {
            assertEquals("header $bad", "", one(""""header":$bad""").header)
        }
    }

    @Test fun cabecalhoDoServidorSubstituiODoTipoNaTelaCheiaENaFaixa() {
        val semHeader = case(1).copy(kind = "crianca")
        assertEquals("CRIANÇA DESAPARECIDA", Missing.headerFor(semHeader))
        assertEquals("DESAPARECIDA(O)", Missing.shortHeaderFor(semHeader))
        val comHeader = semHeader.copy(header = "CRIANÇA PROCURADA PELA FAMÍLIA")
        assertEquals("CRIANÇA PROCURADA PELA FAMÍLIA", Missing.headerFor(comHeader))
        assertEquals("CRIANÇA PROCURADA PELA FAMÍLIA", Missing.shortHeaderFor(comHeader))
    }

    @Test fun cartelaDePedidoDeInformacao() {
        val c = Missing.parse(
            """[{"id":7,"kind":"informacao","name":"Pessoa Fictícia de Teste","age":null,"since":null,"lastSeen":"","photo":null,
                 "description":"Não aborde. Ligue 190 ou 181.","contact":"Disque 181","header":"A POLÍCIA PEDE INFORMAÇÕES","show":"full"}]""",
        ).single()
        assertEquals("informacao", c.kind)
        assertNull(c.age)
        assertNull(c.since)
        assertNull(c.photo)
        assertTrue(c.textOnly) // sem foto: o texto ocupa a largura
        assertEquals("Não aborde. Ligue 190 ou 181.", c.description) // frase fixa: só é desenhada, sem tratamento
        assertEquals("A POLÍCIA PEDE INFORMAÇÕES", Missing.headerFor(c))
        // linhas vazias não são desenhadas (o texto delas é "")
        assertEquals("", Missing.age(c.age))
        assertEquals("", Missing.since(c.since))
        assertEquals("", Missing.lastSeen(c.lastSeen))
        assertEquals("Pessoa Fictícia de Teste", Missing.nameAndAge(c))
        // sem header, a cartela ainda tem cabeçalho próprio
        val semHeader = c.copy(header = "")
        assertEquals("A POLÍCIA PEDE INFORMAÇÕES", Missing.headerFor(semHeader))
        assertEquals("PEDIDO DE INFORMAÇÕES", Missing.shortHeaderFor(semHeader))
        // com foto conferível, a cartela mostra a foto como os outros casos
        assertFalse(c.copy(photo = MissingPhoto("https://a.test/a.jpg", sha, 10)).textOnly)
        // o ritmo é o mesmo dos outros casos
        assertTrue(MissingSchedule.at(listOf(c), sec(10, 0), false)!!.full)
    }

    @Test fun kindDesconhecidoValeComoAdultoEUsaOHeaderSeHouver() {
        val c = Missing.parse("""[{"id":1,"name":"Teste","kind":"novidade","header":"AVISO DA GUARDA"}]""").single()
        assertEquals("adulto", c.kind)
        assertEquals("AVISO DA GUARDA", Missing.headerFor(c))
        assertFalse(c.textOnly) // sem foto, adulto mostra a silhueta
        val d = Missing.parse("""[{"id":1,"name":"Teste","kind":"novidade"}]""").single()
        assertEquals("PESSOA DESAPARECIDA", Missing.headerFor(d))
        assertEquals("PESSOA DESAPARECIDA", Missing.headerFor(Missing.parse("""[{"id":1,"name":"Teste","kind":7}]""").single()))
    }

    @Test fun idaEVoltaComHeaderEInformacao() {
        val list = Missing.parse("""[{"id":7,"kind":"informacao","name":"Teste","header":"PROCURADO PELA JUSTIÇA","until":5},{"id":8,"name":"Outro Teste"}]""")
        assertEquals(list, Missing.parse(Missing.toJson(list)))
        assertEquals("PROCURADO PELA JUSTIÇA", Missing.parse(Missing.toJson(list))[0].header)
    }
}
