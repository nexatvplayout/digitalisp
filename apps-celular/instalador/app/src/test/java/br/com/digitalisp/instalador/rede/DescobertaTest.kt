package br.com.digitalisp.instalador.rede

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

class SubredeTest {
    @Test fun barra24TemOs253VizinhosSemOProprioCelular() {
        val h = Subrede.hosts("192.168.0.37", 24)
        assertEquals(253, h.size)
        assertEquals("192.168.0.1", h.first())
        assertEquals("192.168.0.254", h.last())
        assertFalse("192.168.0.37" in h)
        assertFalse("192.168.0.0" in h)
        assertFalse("192.168.0.255" in h)
    }

    @Test fun redeGrandeViraA24DoCelular() {
        val h = Subrede.hosts("10.1.7.200", 16)
        assertEquals("10.1.7.1", h.first())
        assertEquals("10.1.7.254", h.last())
        assertTrue(h.size <= Subrede.MAX_HOSTS)
    }

    @Test fun redePequena() {
        assertEquals(listOf("192.168.1.2", "192.168.1.3", "192.168.1.4", "192.168.1.5", "192.168.1.6"),
            Subrede.hosts("192.168.1.1", 29))
        assertTrue(Subrede.hosts("192.168.1.1", 31).isEmpty())
        assertTrue(Subrede.hosts("192.168.1.1", 32).isEmpty())
    }

    @Test fun converteIdaEVolta() {
        for (ip in listOf("0.0.0.0", "255.255.255.255", "192.168.0.1", "10.0.0.138")) {
            assertEquals(ip, Subrede.paraTexto(Subrede.paraInt(ip)))
        }
    }

    @Test fun recusaIpInvalido() {
        for (ip in listOf("", "1.2.3", "1.2.3.4.5", "256.1.1.1", "a.b.c.d", "1.2.3.-1", "1..2.3", "1.2.3.4444")) {
            assertFalse(ip, Subrede.ipValido(ip))
        }
        assertTrue(Subrede.ipValido(" 192.168.0.10 "))
    }

    @Test fun ordenaNumericamente() {
        val ips = listOf("192.168.0.100", "192.168.0.9", "192.168.0.20")
        assertEquals(listOf("192.168.0.9", "192.168.0.20", "192.168.0.100"), ips.sortedBy { Subrede.ordenacaoIp(it) })
    }
}

class ServicosAdbTest {
    @Test fun conexaoTlsVaiParaPortaTls() {
        val tv = ServicosAdb.paraTv("._adb-tls-connect._tcp.", "adb-ABC123XYZ-aB3dE9", "192.168.0.50", 37123)!!
        assertEquals(Plataforma.ANDROID, tv.plataforma)
        assertEquals(37123, tv.portaTls)
        assertNull(tv.portaAdb)
        assertEquals("ABC123XYZ", tv.nome)
        assertEquals(37123, tv.portaConexao)
    }

    @Test fun pareamentoVaiParaPortaDePareamento() {
        val tv = ServicosAdb.paraTv("_adb-tls-pairing._tcp", "adb-ABC123XYZ-aB3dE9", "192.168.0.50", 40001)!!
        assertEquals(40001, tv.portaPareamento)
        assertTrue(tv.precisaParear)
    }

    @Test fun adbComumVaiParaPortaAdb() {
        val tv = ServicosAdb.paraTv("_adb._tcp.local.", "minha-box", "192.168.0.51", 5555)!!
        assertEquals(5555, tv.portaAdb)
        assertEquals("minha-box", tv.nome)
    }

    @Test fun ignoraTipoDesconhecidoEPortaRuim() {
        assertNull(ServicosAdb.paraTv("_http._tcp", "x", "192.168.0.1", 80))
        assertNull(ServicosAdb.paraTv(ServicosAdb.ADB, "x", "192.168.0.1", 0))
        assertNull(ServicosAdb.paraTv(ServicosAdb.ADB, "x", "", 5555))
    }
}

class CatalogoTest {
    @Test fun juntaMdnsEVarreduraDoMesmoIp() {
        val c = Catalogo()
        assertTrue(c.adicionar(TvEncontrada("192.168.0.50", Plataforma.ANDROID, portaPareamento = 40001)))
        assertTrue(c.adicionar(TvEncontrada("192.168.0.50", Plataforma.ANDROID, nome = "SALA", portaTls = 37123)))
        val tv = c.lista().single()
        assertEquals("SALA", tv.nome)
        assertEquals(37123, tv.portaTls)
        assertEquals(40001, tv.portaPareamento)
        assertFalse("tem porta de conexão: não precisa parear", tv.precisaParear)
    }

    @Test fun repetirAMesmaInformacaoNaoMudaALista() {
        val c = Catalogo()
        val tv = TvEncontrada("192.168.0.50", Plataforma.ANDROID, portaAdb = 5555)
        assertTrue(c.adicionar(tv))
        assertFalse(c.adicionar(tv))
    }

    @Test fun androidGanhaDeSamsungNoMesmoIp() {
        val c = Catalogo()
        c.adicionar(TvEncontrada("192.168.0.60", Plataforma.SAMSUNG))
        c.adicionar(TvEncontrada("192.168.0.60", Plataforma.ANDROID, portaAdb = 5555))
        assertEquals(Plataforma.ANDROID, c.obter("192.168.0.60")!!.plataforma)
    }

    @Test fun ordemAndroidPrimeiroDepoisIp() {
        val c = Catalogo()
        c.adicionar(TvEncontrada("192.168.0.5", Plataforma.LG))
        c.adicionar(TvEncontrada("192.168.0.100", Plataforma.ANDROID, portaAdb = 5555))
        c.adicionar(TvEncontrada("192.168.0.9", Plataforma.ANDROID, portaAdb = 5555))
        c.adicionar(TvEncontrada("192.168.0.2", Plataforma.SAMSUNG))
        assertEquals(listOf("192.168.0.9", "192.168.0.100", "192.168.0.2", "192.168.0.5"), c.lista().map { it.host })
    }

    @Test fun samsungELgNaoSaoInstalaveis() {
        assertFalse(TvEncontrada("1.1.1.1", Plataforma.SAMSUNG).instalavel)
        assertFalse(TvEncontrada("1.1.1.1", Plataforma.LG).instalavel)
        assertTrue(TvEncontrada("1.1.1.1", Plataforma.ANDROID, portaAdb = 5555).instalavel)
    }
}

class VarreduraTest {
    @Test fun classificaPelasPortasAbertas() = runBlocking {
        val abertas = mapOf(
            "10.0.0.2" to setOf(5555),
            "10.0.0.3" to setOf(8001, 8002),
            "10.0.0.4" to setOf(3000),
            "10.0.0.5" to setOf(80), // roteador: não é TV
        )
        val testadas = Collections.synchronizedList(ArrayList<Pair<String, Int>>())
        val sonda = Sonda { h, p -> testadas.add(h to p); p in (abertas[h] ?: emptySet()) }
        val achadas = Collections.synchronizedList(ArrayList<TvEncontrada>())
        Varredura(sonda, paralelo = 3).varrer(listOf("10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6")) { achadas.add(it) }

        val porHost = achadas.associateBy { it.host }
        assertEquals(3, achadas.size)
        assertEquals(Plataforma.ANDROID, porHost["10.0.0.2"]!!.plataforma)
        assertEquals(5555, porHost["10.0.0.2"]!!.portaAdb)
        assertEquals(Plataforma.SAMSUNG, porHost["10.0.0.3"]!!.plataforma)
        assertEquals(Plataforma.LG, porHost["10.0.0.4"]!!.plataforma)
        // a 5555 aberta encerra o teste daquele IP
        assertEquals(listOf(5555), testadas.filter { it.first == "10.0.0.2" }.map { it.second })
        // IP sem nada testa todas as portas conhecidas
        assertEquals(PortasConhecidas.TODAS.size, testadas.count { it.first == "10.0.0.6" })
    }

    @Test fun respeitaOLimiteDeParalelismo() = runBlocking {
        var agora = 0
        var maximo = 0
        val trava = Any()
        val sonda = Sonda { _, _ ->
            synchronized(trava) { agora++; maximo = maxOf(maximo, agora) }
            kotlinx.coroutines.delay(5)
            synchronized(trava) { agora-- }
            false
        }
        Varredura(sonda, paralelo = 4, portas = listOf(5555)).varrer((1..40).map { "10.0.0.$it" }) {}
        assertTrue("máximo em paralelo foi $maximo", maximo in 1..4)
    }
}
