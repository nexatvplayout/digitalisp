package br.com.digitalisp.instalador.lg

import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoConexao
import br.com.digitalisp.instalador.instalacao.Conexao
import br.com.digitalisp.instalador.instalacao.ConectoresReais
import br.com.digitalisp.instalador.instalacao.CredenciaisLg
import br.com.digitalisp.instalador.instalacao.Instalacao
import br.com.digitalisp.instalador.pacotes.Pacote
import br.com.digitalisp.instalador.rede.Plataforma
import br.com.digitalisp.instalador.rede.TvEncontrada
import org.apache.sshd.server.Environment
import org.apache.sshd.server.ExitCallback
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.channel.ChannelSession
import org.apache.sshd.server.command.Command
import org.apache.sshd.server.keyprovider.SimpleGeneratorHostKeyProvider
import org.apache.sshd.sftp.server.SftpSubsystemFactory
import org.apache.sshd.common.file.virtualfs.VirtualFileSystemFactory
import org.bouncycastle.openssl.jcajce.JcaPEMWriter
import org.bouncycastle.openssl.jcajce.JcePEMEncryptorBuilder
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.StringWriter
import java.net.ServerSocket
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.util.Collections
import kotlin.concurrent.thread

class SaidaLgTest {
    @Test fun linhasDoLunaSendDaInstalacao() {
        assertEquals(PassoLuna.Seguindo, SaidaLg.lerLinhaInstalacao("""{"subscribed":true,"returnValue":true}"""))
        assertEquals(PassoLuna.Seguindo, SaidaLg.lerLinhaInstalacao("""{"details":{"state":"installing","progress":40}}"""))
        assertEquals(PassoLuna.Instalado, SaidaLg.lerLinhaInstalacao("""{"details":{"state":"installed"},"returnValue":true}"""))
        assertEquals(PassoLuna.Instalado, SaidaLg.lerLinhaInstalacao("""{"details":{"state":"SUCCESS"}}"""))
        val f = SaidaLg.lerLinhaInstalacao("""{"details":{"state":"FAILED","reason":"not enough space"}}""") as PassoLuna.Falhou
        assertTrue(f.motivo.contains("sem espaço"))
        assertTrue(SaidaLg.lerLinhaInstalacao("""{"returnValue":false,"errorText":"Denied"}""") is PassoLuna.Falhou)
        assertEquals(PassoLuna.Seguindo, SaidaLg.lerLinhaInstalacao("lixo"))
    }

    @Test fun comandosIguaisAoAresInstall() {
        assertEquals(
            "/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/media/developer/temp/a.ipk\",\"subscribe\":true}'",
            SaidaLg.instalar(SaidaLg.caminho("a.ipk")).replace("\\/", "/"),
        )
        assertEquals("/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"br.com.digitalisp.telas\"}'",
            SaidaLg.abrir("br.com.digitalisp.telas"))
        for (ruim in listOf("a b.ipk", "../x.ipk", "x.apk", "a';reboot;'.ipk")) {
            try { SaidaLg.caminho(ruim); throw AssertionError(ruim) } catch (_: IllegalArgumentException) {}
        }
        try { SaidaLg.abrir("br.com.x' ; reboot"); throw AssertionError() } catch (_: IllegalArgumentException) {}
        assertTrue(SaidaLg.abriu("""{"returnValue":true,"processId":""}"""))
        assertFalse(SaidaLg.abriu("""{"returnValue":false}"""))
    }

    @Test fun fraseTokenETempo() {
        assertEquals("A1B2C3", SaidaLg.normalizarFrase(" a1b 2c3 "))
        assertNull(SaidaLg.normalizarFrase("a1"))
        assertNull(SaidaLg.normalizarFrase("A1B2C3;"))
        assertEquals("abcDEF123456", SaidaLg.lerToken("abcDEF123456\n"))
        assertNull(SaidaLg.lerToken("cat: no such file"))
        assertEquals("1199:59:01", SaidaLg.lerTempoRestante("""{"result":"success","errorMsg":"1199:59:01"}"""))
        assertNull(SaidaLg.lerTempoRestante("""{"result":"fail","errorMsg":"Invalid token"}"""))
        assertEquals("49 dia(s) e 23 hora(s)", SaidaLg.tempoAmigavel("1199:59:01"))
        assertEquals("5 hora(s) e 30 minuto(s)", SaidaLg.tempoAmigavel("5:30:00"))
    }

    @Test fun respostaHttpDoKeyServer() {
        val pem = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n"
        assertEquals(pem, String(ClienteLg.lerRespostaHttp(ByteArrayInputStream("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n$pem".toByteArray()))!!))
        assertNull(ClienteLg.lerRespostaHttp(ByteArrayInputStream("HTTP/1.1 404 Not Found\r\n\r\nnada".toByteArray())))
        assertNull(ClienteLg.lerRespostaHttp(ByteArrayInputStream("HTTP/1.1 200 OK\r\n\r\n<html>".toByteArray())))
    }
}

/**
 * Uma "TV LG" de mentira: servidor SSH (Apache MINA) na porta do modo desenvolvedor com o usuário "prisoner", só a chave
 * certa entra, SFTP com a raiz numa pasta temporária, e os comandos que o ares-install usa (luna-send-pub fica aberto
 * como o de verdade com -i). Mais o Key Server (HTTP) que entrega a chave cifrada com a frase-senha.
 */
class TvLgFalsa(raiz: File, private val chave: KeyPair, frase: String, val instalacaoOk: Boolean = true) : AutoCloseable {
    val comandos: MutableList<String> = Collections.synchronizedList(ArrayList())
    private val raizFs = raiz
    val pem: ByteArray = StringWriter().also { w ->
        JcaPEMWriter(w).use { it.writeObject(chave, JcePEMEncryptorBuilder("AES-128-CBC").setProvider(org.bouncycastle.jce.provider.BouncyCastleProvider()).build(frase.toCharArray())) }
    }.toString().toByteArray()

    val ssh: SshServer = SshServer.setUpDefaultServer().apply {
        port = 0
        keyPairProvider = SimpleGeneratorHostKeyProvider(raiz.toPath().resolve("hostkey.ser")).apply { algorithm = "RSA" }
        publickeyAuthenticator = org.apache.sshd.server.auth.pubkey.PublickeyAuthenticator { usuario: String, k: PublicKey, _ ->
            usuario == "prisoner" && k == chave.public
        }
        subsystemFactories = listOf(SftpSubsystemFactory())
        fileSystemFactory = VirtualFileSystemFactory(raiz.toPath())
        commandFactory = org.apache.sshd.server.command.CommandFactory { _, linha -> Comando(linha) }
        start()
    }

    private val keyServer = ServerSocket(0)
    val portaChave: Int get() = keyServer.localPort
    init {
        thread(isDaemon = true) {
            while (!keyServer.isClosed) {
                val s = runCatching { keyServer.accept() }.getOrNull() ?: break
                runCatching {
                    s.getInputStream().read(ByteArray(1024))
                    s.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n".toByteArray() + pem)
                }
                s.close()
            }
        }
    }

    private fun naRaiz(caminho: String) = File(raizFs, caminho.trim('"').removePrefix("/"))

    inner class Comando(private val linha: String) : Command {
        private lateinit var saida: OutputStream
        private lateinit var fim: ExitCallback
        override fun setInputStream(i: InputStream) {}
        override fun setOutputStream(o: OutputStream) { saida = o }
        override fun setErrorStream(e: OutputStream) {}
        override fun setExitCallback(c: ExitCallback) { fim = c }
        override fun destroy(channel: ChannelSession) {}
        override fun start(channel: ChannelSession, env: Environment) {
            comandos.add(linha)
            thread(isDaemon = true) {
                fun diz(t: String) { saida.write(t.toByteArray()); saida.flush() }
                when {
                    linha == SaidaLg.CRIAR_PASTA -> { naRaiz(SaidaLg.PASTA).mkdirs(); fim.onExit(0) }
                    linha.startsWith("/usr/bin/wc -c < ") -> { diz("${naRaiz(linha.removePrefix("/usr/bin/wc -c < ")).length()}\n"); fim.onExit(0) }
                    linha.startsWith("/bin/rm -f ") -> { naRaiz(linha.removePrefix("/bin/rm -f ")).delete(); fim.onExit(0) }
                    linha.contains("appInstallService/dev/install") -> {
                        val ipk = Regex("\"ipkUrl\":\"([^\"]+)\"").find(linha.replace("\\/", "/"))!!.groupValues[1]
                        diz("{\"subscribed\":true,\"returnValue\":true}\n")
                        if (!naRaiz(ipk).isFile) diz("{\"details\":{\"state\":\"FAILED\",\"reason\":\"file not found\"}}\n")
                        else if (instalacaoOk) { diz("{\"details\":{\"state\":\"installing\",\"progress\":50}}\n"); diz("{\"details\":{\"state\":\"installed\"}}\n") }
                        else diz("{\"details\":{\"state\":\"FAILED\",\"reason\":\"not enough space\"}}\n")
                        // como o luna-send -i de verdade: não termina sozinho
                    }
                    linha.contains("applicationManager/launch") -> { diz("{\"returnValue\":true,\"processId\":\"1001\"}\n"); fim.onExit(0) }
                    linha == SaidaLg.LER_TOKEN -> { diz("TOKENdeTESTE1234567890\n"); fim.onExit(0) }
                    else -> fim.onExit(127, "comando não esperado")
                }
            }
        }
    }

    override fun close() { runCatching { ssh.stop(true) }; runCatching { keyServer.close() } }
}

class ClienteLgTest {
    @get:Rule val pasta = TemporaryFolder()
    private val abertos = ArrayList<AutoCloseable>()
    @After fun fechar() = abertos.forEach { runCatching { it.close() } }

    private val chave: KeyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val pacote = Pacote(Plataforma.LG, "1.0.27", "b".repeat(64), 1, "https://x/latest.ipk", "br.com.digitalisp.telas", "br.com.digitalisp.telas_1.0.27_all.ipk")

    private fun tvFalsa(ok: Boolean = true) = TvLgFalsa(pasta.newFolder(), chave, "A1B2C3", ok).also { abertos.add(it) }

    private val adbNada = object : AdbGateway {
        override fun conectar(host: String, porta: Int, tempoMs: Long) = ResultadoConexao.Falhou("sem adb")
        override fun parear(host: String, porta: Int, codigo: String) = Unit
        override fun shell(comando: String) = ""
        override fun enviar(origem: InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit) = Unit
        override fun desconectar() = Unit
    }

    private fun conectores(t: TvLgFalsa, cred: CredenciaisLg, renovou: MutableList<String> = ArrayList()) = ConectoresReais(
        adb = adbNada, lerPacote = { null }, credenciaisLg = cred,
        baixarChaveLg = { host -> ClienteLg.baixarChave(host, t.portaChave) },
        renovarLg = { token -> renovou.add(token); "1199:59:01" },
        portaLg = t.ssh.port,
    )

    @Test fun baixaAChaveEntraEnviaInstalaAbreERenova() {
        val t = tvFalsa()
        val cred = CredenciaisLg(pasta.newFolder("cred"))
        val renovou = ArrayList<String>()
        val tv = TvEncontrada("127.0.0.1", Plataforma.LG, portaDev = 9922)
        val c = conectores(t, cred, renovou)

        // sem frase e sem nada guardado: pede a frase
        assertEquals(Conexao.PrecisaFrase(null), c.lg(tv, null))
        // frase errada
        assertTrue((c.lg(tv, "ZZZZZZ") as Conexao.PrecisaFrase).aviso!!.contains("não confere"))
        // frase certa (minúscula e com espaço, como o técnico digita)
        val s = (c.lg(tv, " a1b2c3 ") as Conexao.Ok).sessao
        val ipk = ByteArray(200_000) { (it % 251).toByte() }
        val f = pasta.newFile("br.com.digitalisp.telas_1.0.27_all.ipk").apply { writeBytes(ipk) }
        val destino = s.destino(pacote)
        assertEquals("/media/developer/temp/br.com.digitalisp.telas_1.0.27_all.ipk", destino)
        var ultimo = 0L
        s.enviar(f, destino) { ultimo = it }
        assertEquals(200_000L, ultimo)
        assertEquals(Instalacao.Ok("br.com.digitalisp.telas"), s.instalar(destino, pacote, f))
        assertTrue(s.abrir("br.com.digitalisp.telas"))
        val obs = s.observacao()!!
        assertTrue(obs, obs.contains("renovada") && obs.contains("49 dia(s)"))
        assertEquals(listOf("TOKENdeTESTE1234567890"), renovou)
        s.fechar()
        assertTrue("apagou o .ipk da TV depois de instalar", t.comandos.any { it.startsWith("/bin/rm -f") })

        // segunda visita: entra com a chave e a frase guardadas, sem perguntar
        val s2 = (c.lg(tv, null) as Conexao.Ok).sessao
        s2.fechar()
    }

    @Test fun envioChegaInteiroNaTv() {
        val t = tvFalsa()
        val r = ClienteLg.conectar("127.0.0.1", t.pem, "A1B2C3", t.ssh.port) as ResultadoLg.Conectado
        val dados = ByteArray(70_000) { (it * 7).toByte() }
        r.cliente.executar(SaidaLg.CRIAR_PASTA)
        r.cliente.enviar({ ByteArrayInputStream(dados) }, dados.size.toLong(), "/media/developer/temp/x.ipk") {}
        assertEquals("70000", r.cliente.executar(SaidaLg.tamanho("/media/developer/temp/x.ipk")).trim())
        r.cliente.close()
    }

    @Test fun tvSemEspacoExplica() {
        val t = tvFalsa(ok = false)
        val c = conectores(t, CredenciaisLg(pasta.newFolder("c2")))
        val s = (c.lg(TvEncontrada("127.0.0.1", Plataforma.LG), "A1B2C3") as Conexao.Ok).sessao
        val f = pasta.newFile("a.ipk").apply { writeBytes(ByteArray(10)) }
        val d = s.destino(pacote.copy(nomeArquivo = "a.ipk"))
        s.enviar(f, d) {}
        val r = s.instalar(d, pacote, f) as Instalacao.Falha
        assertTrue(r.mensagem.contains("sem espaço"))
        s.fechar()
    }

    @Test fun fraseConfereSemRede() {
        val t = tvFalsa()
        assertTrue(ClienteLg.fraseAbre(t.pem, "A1B2C3"))
        assertFalse(ClienteLg.fraseAbre(t.pem, "XXXXXX"))
        assertEquals(ResultadoLg.FraseErrada, ClienteLg.conectar("127.0.0.1", t.pem, "XXXXXX", t.ssh.port))
    }

    @Test fun keyServerDesligadoPedeParaLigar() {
        val t = tvFalsa()
        val livre = ServerSocket(0).use { it.localPort }
        val c = ConectoresReais(adbNada, { null }, CredenciaisLg(pasta.newFolder("c3")), baixarChaveLg = { ClienteLg.baixarChave(it, livre) }, portaLg = t.ssh.port)
        val r = c.lg(TvEncontrada("127.0.0.1", Plataforma.LG), "A1B2C3") as Conexao.PrecisaFrase
        assertTrue(r.aviso!!.contains("Key Server"))
    }

    @Test fun modoDevDesligadoQuandoA9922EstaFechada() {
        val t = tvFalsa()
        val livre = ServerSocket(0).use { it.localPort }
        assertEquals(ResultadoLg.ModoDevDesligado, ClienteLg.conectar("127.0.0.1", t.pem, "A1B2C3", livre, 3000))
    }

    @Test fun credenciaisGuardadas() {
        val cred = CredenciaisLg(pasta.newFolder("c4"))
        assertNull(cred.ler("10.0.0.5"))
        cred.gravar("10.0.0.5", byteArrayOf(1, 2), "A1B2C3")
        assertArrayEquals(byteArrayOf(1, 2), cred.ler("10.0.0.5")!!.first)
        cred.apagar("10.0.0.5")
        assertNull(cred.ler("10.0.0.5"))
    }
}
