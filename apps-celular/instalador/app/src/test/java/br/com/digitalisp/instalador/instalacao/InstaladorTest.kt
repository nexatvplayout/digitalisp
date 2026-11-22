package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoConexao
import br.com.digitalisp.instalador.rede.Plataforma
import br.com.digitalisp.instalador.rede.TvEncontrada
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.Collections

/** ADB falso: registra o que o instalador pediu e responde como a TV responderia. */
class AdbFalso(
    var respostasConexao: MutableList<ResultadoConexao> = mutableListOf(ResultadoConexao.Conectado),
    var demoraConexaoMs: Long = 0,
    var pareamentoFalha: Boolean = false,
    val respostasShell: (String) -> String = { cmd -> if (cmd.startsWith("pm install")) "Success\n" else "Events injected: 1\n" },
) : AdbGateway {
    val chamadas: MutableList<String> = Collections.synchronizedList(ArrayList())
    var recebido: ByteArray? = null

    override fun conectar(host: String, porta: Int, tempoMs: Long): ResultadoConexao {
        chamadas.add("conectar $host:$porta")
        if (demoraConexaoMs > 0) Thread.sleep(demoraConexaoMs)
        return if (respostasConexao.size > 1) respostasConexao.removeAt(0) else respostasConexao.first()
    }

    override fun parear(host: String, porta: Int, codigo: String) {
        chamadas.add("parear $host:$porta $codigo")
        if (pareamentoFalha) throw IOException("código errado")
    }

    override fun shell(comando: String): String {
        chamadas.add("shell $comando")
        return respostasShell(comando)
    }

    override fun enviar(origem: InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit) {
        chamadas.add("enviar $destino $tamanho")
        recebido = origem.readBytes()
        progresso(tamanho)
    }

    override fun desconectar() {
        chamadas.add("desconectar")
    }
}

class InstaladorTest {
    @get:Rule val pasta = TemporaryFolder()

    private val box = TvEncontrada("192.168.0.50", Plataforma.ANDROID, portaAdb = 5555)
    private val box11 = TvEncontrada("192.168.0.51", Plataforma.ANDROID, portaPareamento = 40001)

    private fun apkFalso(): File = pasta.newFile("telas.apk").apply { writeBytes(byteArrayOf(0x50, 0x4B, 3, 4) + ByteArray(1000) { it.toByte() }) }

    private fun instalador(
        adb: AdbFalso,
        historico: MutableList<Estado>,
        fonte: FonteApk? = null,
        pacote: String? = "br.com.digitalisp.telas",
        portaTls: (String) -> Int? = { null },
    ): Instalador {
        val apk = apkFalso()
        return Instalador(
            adb = adb,
            fonte = { fonte ?: FonteApk { p -> p(apk.length(), apk.length()); apk } },
            lerPacote = { pacote },
            portaTlsAtual = portaTls,
            io = Dispatchers.IO,
            esperaAceiteMs = 50,
            tempoConexaoMs = 1000,
            esperaPortaTlsMs = 600,
            observador = { historico.add(it) },
        )
    }

    @Test fun instalaEAbreNaTvBox() = runBlocking {
        val adb = AdbFalso()
        val hist = Collections.synchronizedList(ArrayList<Estado>())
        val inst = instalador(adb, hist)
        inst.instalar(box)

        assertEquals(Estado.Concluido(box, "br.com.digitalisp.telas", true), inst.estado.value)
        val tipos = hist.map { it::class.simpleName }.distinct()
        assertEquals(listOf("Conectando", "Baixando", "Enviando", "Instalando", "Abrindo", "Concluido"), tipos)
        assertEquals(
            listOf(
                "conectar 192.168.0.50:5555",
                "enviar ${Config.DESTINO_NA_TV} 1004",
                "shell pm install -r -g \"${Config.DESTINO_NA_TV}\"",
                "shell rm -f \"${Config.DESTINO_NA_TV}\"",
                "shell monkey -p br.com.digitalisp.telas -c android.intent.category.LEANBACK_LAUNCHER 1",
                "desconectar",
            ),
            adb.chamadas,
        )
        assertEquals(1004, adb.recebido!!.size)
    }

    @Test fun conexaoDemoradaMostraOlheATv() = runBlocking {
        val adb = AdbFalso(demoraConexaoMs = 300)
        val hist = Collections.synchronizedList(ArrayList<Estado>())
        instalador(adb, hist).instalar(box)
        assertTrue(hist.any { it is Estado.AguardandoAceite })
    }

    @Test fun tvAntigaSemOpcaoGRepeteSemEla() = runBlocking {
        val adb = AdbFalso(respostasShell = { cmd ->
            when {
                cmd.startsWith("pm install -r -g") -> "Error: Unknown option: -g\n"
                cmd.startsWith("pm install") -> "\tpkg: /data/local/tmp/x.apk\nSuccess\n"
                else -> "Events injected: 1"
            }
        })
        val inst = instalador(adb, ArrayList())
        inst.instalar(box)
        assertTrue(inst.estado.value is Estado.Concluido)
        assertTrue(adb.chamadas.contains("shell pm install -r \"${Config.DESTINO_NA_TV}\""))
    }

    @Test fun falhaDoPmViraMensagemEmPortugues() = runBlocking {
        val adb = AdbFalso(respostasShell = { cmd ->
            if (cmd.startsWith("pm install")) "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package br.com.digitalisp.telas signatures do not match]" else ""
        })
        val inst = instalador(adb, ArrayList())
        inst.instalar(box)
        val e = inst.estado.value as Estado.Falhou
        assertEquals(Etapa.INSTALACAO, e.etapa)
        assertTrue(e.mensagem.contains("Desinstale"))
        assertTrue("desconecta mesmo com erro", adb.chamadas.last() == "desconectar")
    }

    @Test fun semIconeDeTvAbrePeloIconeComum() = runBlocking {
        val adb = AdbFalso(respostasShell = { cmd ->
            when {
                cmd.startsWith("pm install") -> "Success"
                cmd.contains("LEANBACK") -> "** No activities found to run, monkey aborted."
                else -> "Events injected: 1"
            }
        })
        val inst = instalador(adb, ArrayList())
        inst.instalar(box)
        assertEquals(Estado.Concluido(box, "br.com.digitalisp.telas", true), inst.estado.value)
        assertTrue(adb.chamadas.any { it.contains("category.LAUNCHER") })
    }

    @Test fun pacoteIlegivelUsaOPadrao() = runBlocking {
        val inst = instalador(AdbFalso(), ArrayList(), pacote = null)
        inst.instalar(box)
        assertEquals(Config.PACOTE_APP_TELA_PADRAO, (inst.estado.value as Estado.Concluido).pacote)
    }

    @Test fun downloadQueFalhaParaNoDownload() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList(), fonte = FonteApk { throw IOException("O servidor respondeu 404 ao baixar o app.") })
        inst.instalar(box)
        val e = inst.estado.value as Estado.Falhou
        assertEquals(Etapa.DOWNLOAD, e.etapa)
        assertTrue(e.mensagem.contains("404"))
        assertTrue(adb.chamadas.none { it.startsWith("enviar") })
    }

    @Test fun naoAutorizadoFalhaSemDesconectarNadaInstalado() = runBlocking {
        val adb = AdbFalso(respostasConexao = mutableListOf(ResultadoConexao.NaoAutorizado))
        val inst = instalador(adb, ArrayList())
        inst.instalar(box)
        assertEquals(Etapa.CONEXAO, (inst.estado.value as Estado.Falhou).etapa)
        assertTrue(adb.chamadas.none { it.startsWith("shell") })
    }

    @Test fun android11PareiaEDepoisConectaNaPortaDoMdns() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList(), portaTls = { if (it == box11.host) 37123 else null })
        inst.instalar(box11)
        assertEquals(Estado.PedindoCodigo(box11), inst.estado.value)
        assertTrue("não conecta antes de parear", adb.chamadas.isEmpty())

        inst.informarCodigo("123 456", null, null)
        assertTrue(inst.estado.value is Estado.Concluido)
        assertEquals("parear 192.168.0.51:40001 123456", adb.chamadas[0])
        assertEquals("conectar 192.168.0.51:37123", adb.chamadas[1])
    }

    @Test fun codigoInvalidoNemTentaParear() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList())
        inst.instalar(box11)
        inst.informarCodigo("12", null, null)
        val e = inst.estado.value as Estado.PedindoCodigo
        assertTrue(e.aviso!!.contains("6 números"))
        assertTrue(adb.chamadas.isEmpty())
    }

    @Test fun pareamentoRecusadoVoltaAPedirCodigo() = runBlocking {
        val adb = AdbFalso(pareamentoFalha = true)
        val inst = instalador(adb, ArrayList())
        inst.instalar(box11)
        inst.informarCodigo("654321", null, null)
        val e = inst.estado.value as Estado.PedindoCodigo
        assertTrue(e.aviso!!.contains("Não pareou"))
    }

    @Test fun pareouMasSemPortaDeConexaoPedeAPorta() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList())
        inst.instalar(box11)
        inst.informarCodigo("654321", null, null)
        val e = inst.estado.value as Estado.Falhou
        assertTrue(e.mensagem.contains("porta"))
        assertTrue(adb.chamadas.none { it.startsWith("conectar") })
    }

    @Test fun portaDigitadaPeloTecnicoGanha() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList(), portaTls = { 11111 })
        inst.instalar(box11)
        inst.informarCodigo("654321", 40002, 42000)
        assertEquals("parear 192.168.0.51:40002 654321", adb.chamadas[0])
        assertEquals("conectar 192.168.0.51:42000", adb.chamadas[1])
    }

    @Test fun conexaoQuePedePareamentoParaNoCodigo() = runBlocking {
        val adb = AdbFalso(respostasConexao = mutableListOf(ResultadoConexao.PrecisaParear))
        val tv = box.copy(portaTls = 37000, portaAdb = null)
        val inst = instalador(adb, ArrayList())
        inst.instalar(tv)
        assertEquals(Estado.PedindoCodigo(tv), inst.estado.value)
    }

    @Test fun naoComecaOutraEnquantoOcupado() = runBlocking {
        val adb = AdbFalso()
        val inst = instalador(adb, ArrayList())
        inst.enviar(Evento.Escolher(box)) // simula uma instalação em andamento
        inst.instalar(box11)
        assertEquals(Estado.Conectando(box), inst.estado.value)
        assertTrue(adb.chamadas.isEmpty())
    }
}
