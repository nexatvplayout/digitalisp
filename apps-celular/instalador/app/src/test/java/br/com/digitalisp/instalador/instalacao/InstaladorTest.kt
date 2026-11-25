package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoConexao
import br.com.digitalisp.instalador.pacotes.Pacote
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

/** ADB falso: registra o que o instalador pediu e responde como a TV box responderia. */
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

/** Sessão falsa de Samsung/LG para conferir a ordem dos passos do instalador. */
class SessaoFalsa(private val falhaInstalar: String? = null, private val abre: Boolean = true) : SessaoTv {
    val passos: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun destino(pacote: Pacote) = "/tmp/${pacote.nomeArquivo}"
    override fun enviar(arquivo: File, destino: String, progresso: (Long) -> Unit) { passos.add("enviar $destino ${arquivo.length()}"); progresso(arquivo.length()) }
    override fun instalar(destino: String, pacote: Pacote, arquivo: File): Instalacao {
        passos.add("instalar $destino")
        return if (falhaInstalar != null) Instalacao.Falha(falhaInstalar) else Instalacao.Ok(pacote.appId!!)
    }
    override fun abrir(appId: String): Boolean { passos.add("abrir $appId"); return abre }
    override fun observacao() = "recado"
    override fun fechar() { passos.add("fechar") }
}

class InstaladorTest {
    @get:Rule val pasta = TemporaryFolder()

    private val box = TvEncontrada("192.168.0.50", Plataforma.ANDROID, portaAdb = 5555)
    private val box11 = TvEncontrada("192.168.0.51", Plataforma.ANDROID, portaPareamento = 40001)
    private val samsung = TvEncontrada("192.168.0.60", Plataforma.SAMSUNG, portaDev = 26101)
    private val lg = TvEncontrada("192.168.0.70", Plataforma.LG, portaDev = 9922)

    private fun pacoteDe(p: Plataforma) = when (p) {
        Plataforma.ANDROID -> Pacote(p, "0.3.3", "a".repeat(64), 1004, "https://x/a.apk", null, "telas.apk")
        Plataforma.SAMSUNG -> Pacote(p, "1.0.27", "b".repeat(64), 1004, "https://x/a.wgt", "DgIspTela1.Telas", "DigitalISP.wgt")
        Plataforma.LG -> Pacote(p, "1.0.27", "c".repeat(64), 1004, "https://x/a.ipk", "br.com.digitalisp.telas", "telas.ipk")
    }

    /** Conectores falsos: Android pelo AdbFalso (com a SessaoAndroid de verdade); Samsung e LG por respostas prontas. */
    private inner class ConectoresFalsos(
        val adb: AdbFalso = AdbFalso(),
        val samsungRespostas: MutableList<Conexao> = mutableListOf(),
        val lgRespostas: MutableList<Conexao> = mutableListOf(),
        val pacote: String? = "br.com.digitalisp.telas",
    ) : Conectores {
        val frases = ArrayList<String?>()
        private val reais = ConectoresReais(adb, { pacote }, CredenciaisLg(pasta.newFolder()))
        override fun android(tv: TvEncontrada, porta: Int, tempoMs: Long) = reais.android(tv, porta, tempoMs)
        override fun parearAndroid(host: String, porta: Int, codigo: String) = reais.parearAndroid(host, porta, codigo)
        override fun samsung(tv: TvEncontrada) = samsungRespostas.removeAt(0)
        override fun lg(tv: TvEncontrada, frase: String?): Conexao { frases.add(frase); return lgRespostas.removeAt(0) }
    }

    private fun instalador(
        c: Conectores,
        historico: MutableList<Estado> = Collections.synchronizedList(ArrayList()),
        baixarFalha: String? = null,
        portaTls: (String) -> Int? = { null },
    ): Instalador {
        val apk = pasta.newFile().apply { writeBytes(byteArrayOf(0x50, 0x4B, 3, 4) + ByteArray(1000) { it.toByte() }) }
        return Instalador(
            conectores = c,
            baixar = { p, prog -> if (baixarFalha != null) throw IOException(baixarFalha); prog(apk.length(), apk.length()); PacoteLocal(pacoteDe(p), apk) },
            portaTlsAtual = portaTls,
            io = Dispatchers.IO,
            esperaAceiteMs = 50,
            tempoConexaoMs = 1000,
            esperaPortaTlsMs = 600,
            observador = { historico.add(it) },
        )
    }

    // ---------- Android ----------

    @Test fun instalaEAbreNaTvBox() = runBlocking {
        val c = ConectoresFalsos()
        val hist = Collections.synchronizedList(ArrayList<Estado>())
        val inst = instalador(c, hist)
        inst.instalar(box)

        val fim = inst.estado.value as Estado.Concluido
        assertEquals("br.com.digitalisp.telas", fim.pacote)
        assertTrue(fim.abriu)
        assertEquals(listOf("Conectando", "Baixando", "Enviando", "Instalando", "Abrindo", "Concluido"), hist.map { it::class.simpleName }.distinct())
        assertEquals(
            listOf(
                "conectar 192.168.0.50:5555",
                "enviar ${Config.DESTINO_NA_TV} 1004",
                "shell pm install -r -g \"${Config.DESTINO_NA_TV}\"",
                "shell rm -f \"${Config.DESTINO_NA_TV}\"",
                "shell monkey -p br.com.digitalisp.telas -c android.intent.category.LEANBACK_LAUNCHER 1",
                "desconectar",
            ),
            c.adb.chamadas,
        )
    }

    @Test fun conexaoDemoradaMostraOlheATv() = runBlocking {
        val hist = Collections.synchronizedList(ArrayList<Estado>())
        instalador(ConectoresFalsos(AdbFalso(demoraConexaoMs = 300)), hist).instalar(box)
        assertTrue(hist.any { it is Estado.AguardandoAceite })
    }

    @Test fun tvAntigaSemOpcaoGRepeteSemEla() = runBlocking {
        val adb = AdbFalso(respostasShell = { cmd ->
            when {
                cmd.startsWith("pm install -r -g") -> "Error: Unknown option: -g\n"
                cmd.startsWith("pm install") -> "Success\n"
                else -> "Events injected: 1"
            }
        })
        val inst = instalador(ConectoresFalsos(adb))
        inst.instalar(box)
        assertTrue(inst.estado.value is Estado.Concluido)
        assertTrue(adb.chamadas.contains("shell pm install -r \"${Config.DESTINO_NA_TV}\""))
    }

    @Test fun falhaDoPmViraMensagemEmPortugues() = runBlocking {
        val adb = AdbFalso(respostasShell = { cmd -> if (cmd.startsWith("pm install")) "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]" else "" })
        val inst = instalador(ConectoresFalsos(adb))
        inst.instalar(box)
        val e = inst.estado.value as Estado.Falhou
        assertEquals(Etapa.INSTALACAO, e.etapa)
        assertTrue(e.mensagem.contains("Desinstale"))
        assertEquals("desconecta mesmo com erro", "desconectar", adb.chamadas.last())
    }

    @Test fun pacoteIlegivelUsaOPadrao() = runBlocking {
        val inst = instalador(ConectoresFalsos(pacote = null))
        inst.instalar(box)
        assertEquals(Config.PACOTE_APP_TELA_PADRAO, (inst.estado.value as Estado.Concluido).pacote)
    }

    @Test fun servidorSemOAppParaNoDownload() = runBlocking {
        val c = ConectoresFalsos()
        val inst = instalador(c, baixarFalha = "O servidor ainda não tem o app de tela para TV box Android.")
        inst.instalar(box)
        val e = inst.estado.value as Estado.Falhou
        assertEquals(Etapa.DOWNLOAD, e.etapa)
        assertTrue(c.adb.chamadas.none { it.startsWith("enviar") })
    }

    @Test fun android11PareiaEDepoisConectaNaPortaDoMdns() = runBlocking {
        val c = ConectoresFalsos()
        val inst = instalador(c, portaTls = { if (it == box11.host) 37123 else null })
        inst.instalar(box11)
        assertEquals(Estado.PedindoCodigo(box11), inst.estado.value)
        inst.informarCodigo("123 456", null, null)
        assertTrue(inst.estado.value is Estado.Concluido)
        assertEquals("parear 192.168.0.51:40001 123456", c.adb.chamadas[0])
        assertEquals("conectar 192.168.0.51:37123", c.adb.chamadas[1])
    }

    @Test fun pareamentoRecusadoVoltaAPedirCodigo() = runBlocking {
        val inst = instalador(ConectoresFalsos(AdbFalso(pareamentoFalha = true)))
        inst.instalar(box11)
        inst.informarCodigo("654321", null, null)
        assertTrue((inst.estado.value as Estado.PedindoCodigo).aviso!!.contains("Não pareou"))
    }

    @Test fun naoAutorizadoFalhaNaConexao() = runBlocking {
        val inst = instalador(ConectoresFalsos(AdbFalso(respostasConexao = mutableListOf(ResultadoConexao.NaoAutorizado))))
        inst.instalar(box)
        assertEquals(Etapa.CONEXAO, (inst.estado.value as Estado.Falhou).etapa)
    }

    // ---------- Samsung ----------

    @Test fun samsungPedeOHostPcEDepoisInstala() = runBlocking {
        val sessao = SessaoFalsa()
        val c = ConectoresFalsos(samsungRespostas = mutableListOf(Conexao.PrecisaHostPc("não aceitou"), Conexao.Ok(sessao)))
        val hist = Collections.synchronizedList(ArrayList<Estado>())
        val inst = instalador(c, hist)
        inst.instalar(samsung)
        assertEquals(Estado.PedindoHostPc(samsung, "não aceitou"), inst.estado.value)
        assertTrue("Samsung não mostra o \"Permitir depuração\"", hist.none { it is Estado.AguardandoAceite })
        inst.tentarDeNovoHostPc()
        assertEquals(Estado.Concluido(samsung, "DgIspTela1.Telas", true, "recado"), inst.estado.value)
        assertEquals(listOf("enviar /tmp/DigitalISP.wgt 1004", "instalar /tmp/DigitalISP.wgt", "abrir DgIspTela1.Telas", "fechar"), sessao.passos)
    }

    @Test fun samsungCertificadoSemATvFalhaNaInstalacao() = runBlocking {
        val sessao = SessaoFalsa(falhaInstalar = "A TV recusou a assinatura do app (DUID desta TV: ABC).")
        val inst = instalador(ConectoresFalsos(samsungRespostas = mutableListOf(Conexao.Ok(sessao))))
        inst.instalar(samsung)
        val e = inst.estado.value as Estado.Falhou
        assertEquals(Etapa.INSTALACAO, e.etapa)
        assertTrue(e.mensagem.contains("DUID"))
        assertEquals("fechar", sessao.passos.last())
    }

    // ---------- LG ----------

    @Test fun lgPedeAFraseEUsaANaConexao() = runBlocking {
        val sessao = SessaoFalsa()
        val c = ConectoresFalsos(lgRespostas = mutableListOf(Conexao.PrecisaFrase(null), Conexao.PrecisaFrase("A frase-senha não confere."), Conexao.Ok(sessao)))
        val inst = instalador(c)
        inst.instalar(lg)
        assertEquals(Estado.PedindoFrase(lg, null), inst.estado.value)
        inst.informarFrase("")
        assertTrue((inst.estado.value as Estado.PedindoFrase).aviso!!.contains("Digite"))
        inst.informarFrase("ERRADA")
        assertEquals(Estado.PedindoFrase(lg, "A frase-senha não confere."), inst.estado.value)
        inst.informarFrase("A1B2C3")
        assertEquals(Estado.Concluido(lg, "br.com.digitalisp.telas", true, "recado"), inst.estado.value)
        assertEquals(listOf(null, "ERRADA", "A1B2C3"), c.frases)
    }

    @Test fun lgNaoAbriuAindaEInstalado() = runBlocking {
        val inst = instalador(ConectoresFalsos(lgRespostas = mutableListOf(Conexao.Ok(SessaoFalsa(abre = false)))))
        inst.instalar(lg)
        assertEquals(false, (inst.estado.value as Estado.Concluido).abriu)
    }

    @Test fun naoComecaOutraEnquantoOcupado() = runBlocking {
        val c = ConectoresFalsos()
        val inst = instalador(c)
        inst.enviar(Evento.Escolher(box))
        inst.instalar(samsung)
        assertEquals(Estado.Conectando(box), inst.estado.value)
        assertTrue(c.adb.chamadas.isEmpty())
    }
}
