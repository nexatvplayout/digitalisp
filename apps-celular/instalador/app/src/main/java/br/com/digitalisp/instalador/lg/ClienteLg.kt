package br.com.digitalisp.instalador.lg

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.Session
import com.jcraft.jsch.SftpProgressMonitor
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/** Como terminou a tentativa de entrar na TV LG. */
sealed interface ResultadoLg {
    data class Conectado(val cliente: ClienteLg) : ResultadoLg
    /** Porta 9922 fechada: o "Dev Mode Status" do app Developer Mode está desligado (ou a sessão expirou). */
    data object ModoDevDesligado : ResultadoLg
    /** Não deu para baixar a chave: o "Key Server" do app Developer Mode está desligado. */
    data object KeyServerDesligado : ResultadoLg
    /** A frase-senha não abre a chave (digitada errada, ou a chave da TV mudou). */
    data object FraseErrada : ResultadoLg
    data class Falhou(val motivo: String) : ResultadoLg
}

/**
 * O que o `ares-novacom --getkey` + `ares-install` + `ares-launch` fazem, a partir do celular:
 * baixa a chave da TV (http://TV:9991/webos_rsa, cifrada com a frase-senha que a TV mostra), entra por SSH na porta
 * 9922 como "prisoner", envia o .ipk por SFTP para /media/developer/temp e instala pelo luna-send.
 */
class ClienteLg private constructor(private val sessao: Session) : Closeable {

    companion object {
        /** Baixa a chave privada (PEM cifrado) do Key Server da TV. HTTP simples, sem a pilha do Android. */
        fun baixarChave(host: String, porta: Int = SaidaLg.PORTA_CHAVE, tempoMs: Int = 6000): ByteArray? = try {
            Socket().use { s ->
                s.connect(InetSocketAddress(host, porta), tempoMs)
                s.soTimeout = tempoMs
                s.getOutputStream().apply {
                    write("GET /webos_rsa HTTP/1.0\r\nHost: $host:$porta\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                    flush()
                }
                lerRespostaHttp(s.getInputStream())
            }
        } catch (_: IOException) {
            null
        }

        /** Corpo de uma resposta HTTP 200 com até 64 KiB; null em qualquer outra. */
        fun lerRespostaHttp(i: InputStream): ByteArray? {
            val tudo = ByteArrayOutputStream()
            val buf = ByteArray(4096)
            while (tudo.size() < 65_536 + 4096) {
                val n = i.read(buf)
                if (n < 0) break
                tudo.write(buf, 0, n)
            }
            val b = tudo.toByteArray()
            val fim = indexOf(b, "\r\n\r\n".toByteArray()).takeIf { it >= 0 } ?: return null
            val cab = String(b, 0, fim, Charsets.ISO_8859_1)
            if (!Regex("^HTTP/1\\.[01] 200").containsMatchIn(cab)) return null
            val corpo = b.copyOfRange(fim + 4, b.size)
            if (corpo.size > 65_536) return null
            return corpo.takeIf { String(it, Charsets.ISO_8859_1).contains("PRIVATE KEY") }
        }

        private fun indexOf(b: ByteArray, alvo: ByteArray): Int {
            outer@ for (i in 0..b.size - alvo.size) {
                for (j in alvo.indices) if (b[i + j] != alvo[j]) continue@outer
                return i
            }
            return -1
        }

        /** Confere se a frase abre a chave, sem rede. */
        fun fraseAbre(chave: ByteArray, frase: String): Boolean = try {
            val k = com.jcraft.jsch.KeyPair.load(JSch(), chave, null)
            !k.isEncrypted || k.decrypt(frase)
        } catch (_: JSchException) {
            false
        }

        fun conectar(host: String, chave: ByteArray, frase: String, porta: Int = SaidaLg.PORTA_SSH, tempoMs: Int = 15_000): ResultadoLg {
            if (!fraseAbre(chave, frase)) return ResultadoLg.FraseErrada
            val jsch = JSch()
            try {
                jsch.addIdentity("tv-lg", chave, null, frase.toByteArray(Charsets.UTF_8))
            } catch (e: JSchException) {
                return ResultadoLg.FraseErrada
            }
            val s = jsch.getSession(SaidaLg.USUARIO, host, porta)
            // A chave da TV muda a cada vez que o modo desenvolvedor é ligado: não dá para fixar a do servidor.
            s.setConfig("StrictHostKeyChecking", "no")
            // TVs LG mais antigas (dropbear) só falam ssh-rsa com SHA-1, desligado por padrão no JSch novo.
            s.setConfig("server_host_key", s.getConfig("server_host_key") + ",ssh-rsa")
            s.setConfig("PubkeyAcceptedAlgorithms", s.getConfig("PubkeyAcceptedAlgorithms") + ",ssh-rsa")
            s.setConfig("PreferredAuthentications", "publickey")
            return try {
                s.connect(tempoMs)
                ResultadoLg.Conectado(ClienteLg(s))
            } catch (e: JSchException) {
                val causa = e.cause
                when {
                    causa is ConnectException -> ResultadoLg.ModoDevDesligado
                    causa is SocketTimeoutException || e.message?.contains("timeout", true) == true ->
                        ResultadoLg.Falhou("A TV não respondeu. O celular está no mesmo Wi-Fi da TV?")
                    e.message?.contains("Auth fail", true) == true || e.message?.contains("Auth cancel", true) == true ->
                        ResultadoLg.Falhou("A TV não aceitou a chave. No app Developer Mode, desligue e ligue o Key Server e tente de novo.")
                    else -> ResultadoLg.Falhou("Falha no SSH: ${e.message}")
                }
            }
        }
    }

    /** Roda um comando e devolve stdout (e stderr junto). [aoLer] recebe cada linha, e devolve false para parar. */
    fun executar(comando: String, tempoMs: Long = 60_000, aoLer: ((String) -> Boolean)? = null): String {
        val c = sessao.openChannel("exec") as ChannelExec
        c.setCommand(comando)
        c.setErrStream(null)
        val saida = ByteArrayOutputStream()
        val entrada = c.inputStream
        val erros = c.errStream
        c.connect(15_000)
        try {
            val buf = ByteArray(4096)
            val linha = StringBuilder()
            val fim = System.currentTimeMillis() + tempoMs
            while (true) {
                var leu = false
                while (entrada.available() > 0) {
                    val n = entrada.read(buf); if (n < 0) break
                    leu = true
                    saida.write(buf, 0, n)
                    if (aoLer != null) {
                        for (ch in String(buf, 0, n, Charsets.UTF_8)) {
                            if (ch == '\n') { val l = linha.toString(); linha.clear(); if (!aoLer(l)) return saida.toString("UTF-8") }
                            else linha.append(ch)
                        }
                    }
                }
                while (erros.available() > 0) { val n = erros.read(buf); if (n < 0) break; saida.write(buf, 0, n); leu = true }
                if (c.isClosed && entrada.available() == 0) {
                    if (aoLer != null && linha.isNotEmpty()) aoLer(linha.toString())
                    break
                }
                if (System.currentTimeMillis() > fim) throw IOException("A TV demorou demais para responder.")
                if (!leu) Thread.sleep(50)
            }
            return saida.toString("UTF-8")
        } finally {
            c.disconnect()
        }
    }

    /** Envia por SFTP; se a TV não tiver SFTP, manda pelo `cat >` (como o ares-cli faz). */
    fun enviar(origem: () -> InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit) {
        val sftp = runCatching { (sessao.openChannel("sftp") as ChannelSftp).also { it.connect(15_000) } }.getOrNull()
        if (sftp != null) {
            try {
                origem().use { i ->
                    sftp.put(i, destino, object : SftpProgressMonitor {
                        var feito = 0L
                        override fun init(op: Int, src: String?, dest: String?, max: Long) {}
                        override fun count(n: Long): Boolean { feito += n; progresso(feito); return true }
                        override fun end() {}
                    }, ChannelSftp.OVERWRITE)
                }
                return
            } catch (e: Exception) {
                // segue para o cat
            } finally {
                sftp.disconnect()
            }
        }
        val c = sessao.openChannel("exec") as ChannelExec
        c.setCommand("/bin/cat > \"$destino\"")
        val out = c.outputStream
        c.connect(15_000)
        try {
            origem().use { i ->
                val buf = ByteArray(32 * 1024)
                var feito = 0L
                while (true) {
                    val n = i.read(buf); if (n < 0) break
                    out.write(buf, 0, n); feito += n; progresso(feito)
                }
            }
            out.close()
            val fim = System.currentTimeMillis() + 60_000
            while (!c.isClosed && System.currentTimeMillis() < fim) Thread.sleep(50)
        } finally {
            c.disconnect()
        }
    }

    override fun close() {
        runCatching { sessao.disconnect() }
    }
}
