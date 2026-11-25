package br.com.digitalisp.instalador.samsung

import br.com.digitalisp.instalador.instalacao.Instalacao
import br.com.digitalisp.instalador.instalacao.SessaoSamsung
import br.com.digitalisp.instalador.pacotes.Pacote
import br.com.digitalisp.instalador.rede.Plataforma
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Collections
import kotlin.concurrent.thread

/** Conferido byte a byte com o tráfego do sdb.exe para a Samsung UN58TU7020 da recepção (25/11/2026). */
class MensagemSdbTest {
    @Test fun cnxnIgualAoDoSdbExe() {
        val m = MensagemSdb(MensagemSdb.CNXN, MensagemSdb.VERSAO, MensagemSdb.MAX_DADOS, MensagemSdb.textoZ("host::"))
        val b = ByteBuffer.wrap(m.codificar()).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("CNXN", MensagemSdb.nomeDe(b.int))
        assertEquals(0x100000, b.int)
        assertEquals(0x40000, b.int)
        assertEquals(7, b.int)
        assertEquals(0x232, b.int) // "chk=232" na captura
        assertEquals(0xb1a7b1bc.toInt(), b.int) // "magic=b1a7b1bc"
    }

    @Test fun idaEVolta() {
        val m = MensagemSdb(MensagemSdb.WRTE, 0x21, 6, "teste\n".toByteArray())
        assertEquals(m, MensagemSdb.ler(ByteArrayInputStream(m.codificar())))
        assertEquals("OPEN", MensagemSdb(MensagemSdb.OPEN, 1, 0).nome)
    }

    @Test(expected = java.io.IOException::class)
    fun recusaMagiaErrada() {
        val b = MensagemSdb(MensagemSdb.OKAY, 1, 2).codificar()
        b[20] = 0
        MensagemSdb.ler(ByteArrayInputStream(b))
    }
}

class SaidaSamsungTest {
    private val capability = "\u0002secure_protocol:enabled\nfilesync_support:pushpull\ncpu_arch:armv7\n" +
        "sdk_toolpath:/home/owner/share/tmp/sdk_tools\nprofile_name:tv\nvendor_name:Samsung\nplatform_version:5.5\n"

    @Test fun capacidadesEPastaTemporaria() {
        val c = SaidaSamsung.lerCapacidades(capability)
        assertEquals("enabled", c["secure_protocol"])
        assertEquals("5.5", c["platform_version"])
        assertEquals("/home/owner/share/tmp/sdk_tools/tmp", SaidaSamsung.pastaTemporaria(c))
        assertEquals("/home/owner/share/tmp/sdk_tools/tmp", SaidaSamsung.pastaTemporaria(mapOf("sdk_toolpath" to "../etc")))
    }

    @Test fun modeloDoCnxn() {
        assertEquals("UN58TU7020GXZD", SaidaSamsung.modeloDoCnxn("device::UN58TU7020GXZD::0\u0000"))
    }

    @Test fun saidaRealDeFalhaDeDownload() {
        // exatamente o que a TV respondeu a um id de teste com arquivo inexistente
        val saida = "\ninstall DgIspTst01.Teste\npackage_path /home/owner/share/tmp/sdk_tools/tmp/naoexiste.wgt\n" +
            "app_id[DgIspTst01.Teste] install start\napp_id[DgIspTst01.Teste] download failed[16]\nspend time for wascmd is [42]ms\n"
        val r = SaidaSamsung.lerInstalacao(saida, "RLCHYSD5UYU62") as ResultadoTizen.Falha
        assertEquals("16", r.codigo)
        assertTrue(r.explicacao.contains("não encontrou"))
    }

    @Test fun sucessoEAssinatura() {
        assertEquals(ResultadoTizen.Sucesso, SaidaSamsung.lerInstalacao("app_id[DgIspTela1.Telas] install start\napp_id[DgIspTela1.Telas] installing[61]\napp_id[DgIspTela1.Telas] install completed\n", null))
        val r = SaidaSamsung.lerInstalacao("app_id[DgIspTela1.Telas] install failed[118, -12], reason: Check certificate error : :Invalid certificate chain", "ABC123DEF4567") as ResultadoTizen.Falha
        assertTrue(r.certificado)
        assertTrue(r.explicacao.contains("ABC123DEF4567"))
    }

    @Test fun comandosValidados() {
        assertEquals("0 vd_appinstall DgIspTela1.Telas /home/owner/share/tmp/sdk_tools/tmp/a.wgt",
            SaidaSamsung.comandoInstalar("DgIspTela1.Telas", "/home/owner/share/tmp/sdk_tools/tmp/a.wgt"))
        assertEquals("0 execute DgIspTela1.Telas", SaidaSamsung.comandoAbrir("DgIspTela1.Telas"))
        for (ruim in listOf("DgIspTela1.Telas; reboot", "curto.App", "DgIspTela1.Tel as")) {
            try { SaidaSamsung.comandoAbrir(ruim); throw AssertionError(ruim) } catch (_: IllegalArgumentException) {}
        }
        try { SaidaSamsung.comandoInstalar("DgIspTela1.Telas", "/tmp/a b.wgt"); throw AssertionError() } catch (_: IllegalArgumentException) {}
        assertEquals("RLCHYSD5UYU62", SaidaSamsung.lerDuid("RLCHYSD5UYU62\r\n"))
        assertNull(SaidaSamsung.lerDuid("sh: getduid: not found"))
    }
}

/**
 * Uma "TV Samsung" de mentira que responde como a da recepção: CNXN "device::MODELO::0", capability, shell restrito
 * ("0 getduid", "0 vd_appinstall", "0 execute") e sync: só na pasta sdk_tools/tmp. Escreve cada WRTE e espera o OKAY.
 */
class SdbdFalso(private val aceitar: Boolean = true, private val instalacaoOk: Boolean = true) : AutoCloseable {
    private val servidor = ServerSocket(0)
    val porta: Int get() = servidor.localPort
    val arquivos: MutableMap<String, ByteArray> = Collections.synchronizedMap(HashMap())
    val comandos: MutableList<String> = Collections.synchronizedList(ArrayList())
    private val t = thread(isDaemon = true) {
        while (!servidor.isClosed) {
            val s = runCatching { servidor.accept() }.getOrNull() ?: break
            thread(isDaemon = true) { runCatching { atender(s) }; runCatching { s.close() } }
        }
    }

    private fun atender(s: Socket) {
        if (!aceitar) { s.close(); return } // sdbd que não reconhece o Host PC: fecha sem CNXN
        val i = s.getInputStream(); val o = s.getOutputStream()
        fun mandar(m: MensagemSdb) { o.write(m.codificar()); o.flush() }
        var id = 1
        while (true) {
            val m = MensagemSdb.ler(i)
            when (m.nome) {
                "CNXN" -> mandar(MensagemSdb(MensagemSdb.CNXN, 0x2000000, 0x3ff9c, MensagemSdb.textoZ("device::UN58TU7020GXZD::0")))
                "OPEN" -> {
                    val local = m.arg0; val remoto = id++
                    val destino = m.texto()
                    mandar(MensagemSdb(MensagemSdb.OKAY, remoto, local))
                    fun escrever(b: ByteArray) {
                        mandar(MensagemSdb(MensagemSdb.WRTE, remoto, local, b))
                        val ok = MensagemSdb.ler(i); check(ok.nome == "OKAY") { "esperava OKAY, veio ${ok.nome}" }
                    }
                    when {
                        destino == "capability:" -> escrever("\u0002secure_protocol:enabled\nsdk_toolpath:/home/owner/share/tmp/sdk_tools\nplatform_version:5.5\n".toByteArray())
                        destino.startsWith("shell:") -> {
                            val cmd = destino.removePrefix("shell:")
                            comandos.add(cmd)
                            val resp = when {
                                cmd == "0 getduid" -> "RLCHYSD5UYU62\r\n"
                                cmd.startsWith("0 vd_appinstall ") -> {
                                    val (_, _, app, caminho) = cmd.split(" ")
                                    if (caminho !in arquivos) "app_id[$app] download failed[16]\n"
                                    else if (instalacaoOk) "\ninstall $app\npackage_path $caminho\napp_id[$app] install start\napp_id[$app] installing[61]\napp_id[$app] install completed\nspend time for wascmd is [3001]ms\n"
                                    else "app_id[$app] install failed[118, -12], reason: Check certificate error\n"
                                }
                                cmd.startsWith("0 execute ") -> "... successfully launched pid = 1234 with result 0\n"
                                else -> "" // shell restrito: o resto não responde nada
                            }
                            if (resp.isNotEmpty()) escrever(resp.toByteArray())
                        }
                        destino == "sync:" -> {
                            // SEND <caminho>,<modo>  DATA...  DONE
                            val buf = ByteArrayOutputStream()
                            var caminho: String? = null
                            val dados = ByteArrayOutputStream()
                            loop@ while (true) {
                                val w = MensagemSdb.ler(i)
                                if (w.nome == "CLSE") break
                                check(w.nome == "WRTE")
                                buf.write(w.dados)
                                mandar(MensagemSdb(MensagemSdb.OKAY, remoto, local))
                                while (true) {
                                    val b = buf.toByteArray()
                                    if (b.size < 8) break
                                    val id4 = String(b, 0, 4); val n = ByteBuffer.wrap(b, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
                                    val precisa = if (id4 == "SEND" || id4 == "DATA") 8 + n else 8
                                    if (b.size < precisa) break
                                    when (id4) {
                                        "SEND" -> caminho = String(b, 8, n).substringBeforeLast(',')
                                        "DATA" -> dados.write(b, 8, n)
                                        "DONE" -> {
                                            val ok = caminho!!.startsWith("/home/owner/share/tmp/sdk_tools/tmp/")
                                            if (ok) arquivos[caminho!!] = dados.toByteArray()
                                            escrever(if (ok) ProtocoloSyncResp.okay() else ProtocoloSyncResp.fail("You cannot push files to this path."))
                                        }
                                        "QUIT" -> { buf.reset(); break@loop }
                                    }
                                    buf.reset(); buf.write(b, precisa, b.size - precisa)
                                }
                            }
                        }
                    }
                    mandar(MensagemSdb(MensagemSdb.CLSE, 0, local))
                }
                "CLSE", "OKAY" -> Unit
            }
        }
    }

    override fun close() { servidor.close() }
}

private object ProtocoloSyncResp {
    fun okay() = br.com.digitalisp.instalador.adb.ProtocoloSync.cabecalho("OKAY", 0)
    fun fail(msg: String): ByteArray = br.com.digitalisp.instalador.adb.ProtocoloSync.cabecalho("FAIL", msg.length) + msg.toByteArray()
}

class SdbClienteTest {
    @get:Rule val pasta = TemporaryFolder()
    private val abertos = ArrayList<AutoCloseable>()
    @After fun fechar() = abertos.forEach { runCatching { it.close() } }

    private fun tv(aceitar: Boolean = true, ok: Boolean = true) = SdbdFalso(aceitar, ok).also { abertos.add(it) }

    private val pacote = Pacote(Plataforma.SAMSUNG, "1.0.27", "a".repeat(64), 300_000, "https://x/latest.wgt", "DgIspTela1.Telas", "DigitalISP.wgt")

    @Test fun conectaLeDuidEnviaInstalaEAbre() {
        val t = tv()
        val r = SdbCliente.conectar("127.0.0.1", t.porta, 3000) as ResultadoSdb.Conectado
        assertEquals("UN58TU7020GXZD", r.cliente.modelo)
        val s = SessaoSamsung(r.cliente)
        assertEquals("RLCHYSD5UYU62", s.duid)
        val conteudo = ByteArray(300_000) { (it % 253).toByte() } // maior que um DATA de 64 KiB
        val f = pasta.newFile("DigitalISP.wgt").apply { writeBytes(conteudo) }
        val destino = s.destino(pacote)
        assertEquals("/home/owner/share/tmp/sdk_tools/tmp/DigitalISP.wgt", destino)
        var ultimo = 0L
        s.enviar(f, destino) { ultimo = it }
        assertEquals(300_000L, ultimo)
        assertArrayEquals(conteudo, t.arquivos[destino])
        assertEquals(Instalacao.Ok("DgIspTela1.Telas"), s.instalar(destino, pacote, f))
        assertTrue(s.abrir("DgIspTela1.Telas"))
        assertTrue(t.comandos.contains("0 vd_appinstall DgIspTela1.Telas /home/owner/share/tmp/sdk_tools/tmp/DigitalISP.wgt"))
        assertTrue(t.comandos.contains("0 execute DgIspTela1.Telas"))
        assertTrue(s.observacao().contains("RLCHYSD5UYU62"))
        s.fechar()
    }

    @Test fun certificadoSemEstaTvMostraODuid() {
        val t = tv(ok = false)
        val s = SessaoSamsung((SdbCliente.conectar("127.0.0.1", t.porta, 3000) as ResultadoSdb.Conectado).cliente)
        val f = pasta.newFile("a.wgt").apply { writeBytes(ByteArray(10)) }
        val d = s.destino(pacote)
        s.enviar(f, d) {}
        val r = s.instalar(d, pacote, f) as Instalacao.Falha
        assertTrue(r.mensagem, r.mensagem.contains("DUID desta TV: RLCHYSD5UYU62"))
        s.fechar()
    }

    @Test fun pastaProibidaERecusada() {
        val t = tv()
        val c = (SdbCliente.conectar("127.0.0.1", t.porta, 3000) as ResultadoSdb.Conectado).cliente
        try {
            c.enviar(ByteArrayInputStream(ByteArray(5)), 5, "/home/owner/outra.wgt") {}
            throw AssertionError("deveria recusar")
        } catch (e: java.io.IOException) {
            assertTrue(e.message!!.contains("cannot push"))
        }
        c.close()
    }

    @Test fun tvQueNaoReconheceOCelularEHostPcErrado() {
        val t = tv(aceitar = false)
        assertEquals(ResultadoSdb.HostPcErrado, SdbCliente.conectar("127.0.0.1", t.porta, 2000))
    }

    @Test fun portaFechadaEModoDevDesligado() {
        val livre = ServerSocket(0).use { it.localPort }
        assertEquals(ResultadoSdb.ModoDevDesligado, SdbCliente.conectar("127.0.0.1", livre, 2000))
    }
}

/**
 * Contra uma Samsung de verdade, só leitura e sem tocar no app instalado: rodar com
 * SAMSUNG_REAL=192.168.100.107 (o PC precisa ser o "Host PC IP" da TV). Envia um arquivo de 6 bytes para a pasta
 * temporária e pede a instalação de um id de teste inexistente com caminho inexistente ("download failed[16]").
 */
class SamsungRealTest {
    @Test fun protocoloContraATvDaRecepcao() {
        val host = System.getenv("SAMSUNG_REAL")
        Assume.assumeTrue("defina SAMSUNG_REAL para rodar", !host.isNullOrBlank())
        val c = (SdbCliente.conectar(host!!) as ResultadoSdb.Conectado).cliente
        try {
            println("modelo: ${c.modelo}, maxDados: ${c.maxDados}")
            val caps = c.capacidades()
            println("capacidades: platform_version=${caps["platform_version"]}, sdk_toolpath=${caps["sdk_toolpath"]}")
            val duid = SaidaSamsung.lerDuid(c.shell(SaidaSamsung.COMANDO_DUID))
            println("DUID: $duid")
            val pasta = SaidaSamsung.pastaTemporaria(caps)
            c.enviar(ByteArrayInputStream("teste\n".toByteArray()), 6, "$pasta/digitalisp-teste.txt") {}
            println("enviou $pasta/digitalisp-teste.txt")
            val saida = c.shell(SaidaSamsung.comandoInstalar("DgIspTst01.Teste", "$pasta/naoexiste.wgt"))
            println("vd_appinstall: $saida")
            val r = SaidaSamsung.lerInstalacao(saida, duid) as ResultadoTizen.Falha
            assertEquals("16", r.codigo)
            assertTrue(SaidaSamsung.appInstalado(c.shell(SaidaSamsung.COMANDO_APPS), "DgIspTela1.Telas"))
        } finally {
            c.close()
        }
    }
}
