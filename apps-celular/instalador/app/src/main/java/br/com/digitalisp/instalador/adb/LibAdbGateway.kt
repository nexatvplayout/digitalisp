package br.com.digitalisp.instalador.adb

import br.com.digitalisp.instalador.Config
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import io.github.muntashirakon.adb.AdbPairingRequiredException
import io.github.muntashirakon.adb.AdbStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.PrivateKey
import java.security.cert.Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * [AdbGateway] em cima da libadb-android (licença Apache-2.0, escolhida da dupla Apache-2.0/GPL-3.0).
 * É o único arquivo que conhece a biblioteca: trocar de biblioteca é trocar este arquivo.
 */
class LibAdbGateway(private val chaves: ChavesAdb) : AdbGateway {

    private val gerente = object : AbsAdbConnectionManager() {
        override fun getPrivateKey(): PrivateKey = chaves.obter().first
        override fun getCertificate(): Certificate = chaves.obter().second
        override fun getDeviceName(): String = Config.NOME_NO_ADB
    }.apply {
        // false: espera o técnico tocar em "Permitir" na TV em vez de desistir na primeira recusa.
        setThrowOnUnauthorised(false)
    }

    override fun conectar(host: String, porta: Int, tempoMs: Long): ResultadoConexao {
        runCatching { gerente.disconnect() }
        gerente.setTimeout(tempoMs, TimeUnit.MILLISECONDS)
        return try {
            if (gerente.connect(host, porta) || gerente.isConnected) ResultadoConexao.Conectado
            else ResultadoConexao.NaoAutorizado
        } catch (e: AdbPairingRequiredException) {
            ResultadoConexao.PrecisaParear
        } catch (e: SSLException) {
            ResultadoConexao.PrecisaParear
        } catch (e: InterruptedException) {
            ResultadoConexao.NaoAutorizado
        } catch (e: ConnectException) {
            ResultadoConexao.Falhou("A TV recusou a conexão na porta $porta. A depuração pela rede está ligada?")
        } catch (e: NoRouteToHostException) {
            ResultadoConexao.Falhou("A TV não responde. O celular está na mesma rede Wi-Fi da TV?")
        } catch (e: UnknownHostException) {
            ResultadoConexao.Falhou("Endereço inválido: $host")
        } catch (e: SocketTimeoutException) {
            ResultadoConexao.Falhou("A TV não respondeu a tempo.")
        } catch (e: IOException) {
            ResultadoConexao.Falhou("Falha na conexão: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    override fun parear(host: String, porta: Int, codigo: String) {
        gerente.pair(host, porta, codigo)
    }

    override fun shell(comando: String): String {
        val stream = gerente.openStream("shell:$comando")
        return stream.use { s -> s.openInputStream().use { it.readBytes().toString(Charsets.UTF_8) } }
    }

    override fun enviar(origem: InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit) {
        val porEscrita = gerente.adbConnection?.maxData ?: 4096
        val stream = gerente.openStream("sync:")
        stream.use { s ->
            ProtocoloSync.escrever(
                saida = SaidaDireta(s),
                origem = origem,
                tamanho = tamanho,
                destino = destino,
                porEscrita = porEscrita,
                mtimeSegundos = (System.currentTimeMillis() / 1000).toInt(),
                progresso = progresso,
            )
            val erro = ProtocoloSync.lerResposta(s.openInputStream())
            if (erro != null) throw IOException("A TV recusou o arquivo: $erro")
            // QUIT encerra o sync de forma limpa.
            runCatching { s.write(ProtocoloSync.cabecalho("QUIT", 0), 0, 8) }
        }
    }

    override fun desconectar() {
        // disconnect(), e não close(): close() destrói a chave privada guardada.
        runCatching { gerente.disconnect() }
    }

    /** Cada write() vira uma mensagem WRTE do ADB e espera o OKAY da TV antes da próxima. */
    private class SaidaDireta(private val s: AdbStream) : OutputStream() {
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
        override fun write(b: ByteArray, off: Int, len: Int) = s.write(b, off, len)
        override fun flush() = s.flush()
    }
}
