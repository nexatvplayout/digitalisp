package br.com.digitalisp.instalador.samsung

import br.com.digitalisp.instalador.adb.ProtocoloSync
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/** Como terminou a tentativa de falar com a TV Samsung. */
sealed interface ResultadoSdb {
    data class Conectado(val cliente: SdbCliente) : ResultadoSdb
    /** A porta 26101 está fechada: o modo desenvolvedor da TV está desligado (ou a TV ainda não reiniciou). */
    data object ModoDevDesligado : ResultadoSdb
    /** A TV aceitou o TCP mas não respondeu ao CNXN: o "Host PC IP" do modo desenvolvedor não é o deste celular. */
    data object HostPcErrado : ResultadoSdb
    data class Falhou(val motivo: String) : ResultadoSdb
}

/**
 * Cliente sdb mínimo (o que o Tizen Studio faz para instalar um .wgt): conectar, `capability:`, `shell:` e `sync:` para
 * enviar o arquivo. Um fluxo por vez, tudo bloqueante — chame fora da thread principal.
 *
 * O sdbd de TV no modo desenvolvedor não pede chave: ele só aceita o computador cujo IP foi digitado na TV
 * ("Host PC IP"). Por isso o celular tem de ser esse "computador".
 */
class SdbCliente private constructor(private val socket: Socket) : Closeable {
    private val entrada = BufferedInputStream(socket.getInputStream())
    private val saida = BufferedOutputStream(socket.getOutputStream())
    private var proximoId = 1
    var modelo: String? = null; private set
    var maxDados: Int = 4096; private set

    companion object {
        fun conectar(host: String, porta: Int = SaidaSamsung.PORTA, tempoMs: Int = 8000): ResultadoSdb {
            val s = Socket()
            try {
                s.connect(InetSocketAddress(host, porta), tempoMs)
            } catch (e: ConnectException) {
                runCatching { s.close() }
                return ResultadoSdb.ModoDevDesligado
            } catch (e: SocketTimeoutException) {
                runCatching { s.close() }
                return ResultadoSdb.Falhou("A TV não respondeu. O celular está no mesmo Wi-Fi da TV?")
            } catch (e: IOException) {
                runCatching { s.close() }
                return ResultadoSdb.Falhou("Falha na conexão: ${e.message ?: e.javaClass.simpleName}")
            }
            s.soTimeout = tempoMs
            s.tcpNoDelay = true
            val c = SdbCliente(s)
            return try {
                c.handshake()
                s.soTimeout = 120_000
                ResultadoSdb.Conectado(c)
            } catch (e: SocketTimeoutException) {
                c.close(); ResultadoSdb.HostPcErrado
            } catch (e: EOFException) {
                c.close(); ResultadoSdb.HostPcErrado
            } catch (e: IOException) {
                c.close()
                if (e.message?.contains("reset", ignoreCase = true) == true) ResultadoSdb.HostPcErrado
                else ResultadoSdb.Falhou("A TV respondeu de um jeito inesperado: ${e.message}")
            }
        }
    }

    private fun mandar(m: MensagemSdb) {
        saida.write(m.codificar())
        saida.flush()
    }

    private fun receber(): MensagemSdb = MensagemSdb.ler(entrada)

    private fun handshake() {
        mandar(MensagemSdb(MensagemSdb.CNXN, MensagemSdb.VERSAO, MensagemSdb.MAX_DADOS, MensagemSdb.textoZ("host::")))
        while (true) {
            val m = receber()
            if (m.comando == MensagemSdb.CNXN) {
                modelo = SaidaSamsung.modeloDoCnxn(m.texto())
                maxDados = m.arg1.coerceIn(1024, MensagemSdb.MAX_DADOS)
                return
            }
            // AUTH ou outra coisa antes do CNXN: este cliente não sabe responder
            if (m.nome == "AUTH") throw IOException("a TV pediu autenticação (não é o modo desenvolvedor de TV)")
        }
    }

    /** Um fluxo aberto do lado da TV. */
    inner class Fluxo internal constructor(val local: Int, val remoto: Int) : Closeable {
        private val pendente = ByteArrayOutputStream()
        private var posicao = 0
        private var bufLeitura = ByteArray(0)
        var fechado = false; private set

        /** Manda dados e espera o OKAY da TV (o ADB/sdb não aceita duas escritas sem resposta). */
        fun escrever(b: ByteArray, off: Int = 0, len: Int = b.size) {
            var o = off
            var resta = len
            while (resta > 0) {
                val n = minOf(resta, maxDados)
                mandar(MensagemSdb(MensagemSdb.WRTE, local, remoto, b.copyOfRange(o, o + n)))
                esperarOkay()
                o += n; resta -= n
            }
        }

        private fun esperarOkay() {
            while (true) {
                if (fechado) throw IOException("a TV fechou o fluxo")
                val m = receber()
                if (tratar(m) == MensagemSdb.OKAY) return
            }
        }

        /** Trata uma mensagem que chegou; devolve o comando se ela era deste fluxo. */
        internal fun tratar(m: MensagemSdb): Int? {
            if (m.arg1 != local) {
                // mensagem de outro fluxo (já fechado): confirma WRTE para não travar a TV e segue
                if (m.comando == MensagemSdb.WRTE) mandar(MensagemSdb(MensagemSdb.OKAY, m.arg1, m.arg0))
                return null
            }
            when (m.comando) {
                MensagemSdb.WRTE -> {
                    pendente.write(m.dados)
                    mandar(MensagemSdb(MensagemSdb.OKAY, local, remoto))
                }
                MensagemSdb.CLSE -> fechado = true
            }
            return m.comando
        }

        /** Lê o próximo pedaço disponível (bloqueia até chegar algo); -1 quando a TV fechou o fluxo. */
        fun ler(destino: ByteArray, off: Int, len: Int): Int {
            while (posicao >= bufLeitura.size) {
                if (pendente.size() > 0) {
                    bufLeitura = pendente.toByteArray(); pendente.reset(); posicao = 0
                    break
                }
                if (fechado) return -1
                tratar(receber())
            }
            val n = minOf(len, bufLeitura.size - posicao)
            System.arraycopy(bufLeitura, posicao, destino, off, n)
            posicao += n
            return n
        }

        fun lerTudo(): ByteArray {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (true) {
                val n = ler(buf, 0, buf.size)
                if (n < 0) break
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }

        val comoEntrada: InputStream = object : InputStream() {
            override fun read(): Int {
                val b = ByteArray(1)
                return if (ler(b, 0, 1) < 0) -1 else (b[0].toInt() and 0xFF)
            }
            override fun read(b: ByteArray, off: Int, len: Int): Int = if (len == 0) 0 else ler(b, off, len)
        }

        val comoSaida: OutputStream = object : OutputStream() {
            override fun write(b: Int) = escrever(byteArrayOf(b.toByte()))
            override fun write(b: ByteArray, off: Int, len: Int) = escrever(b, off, len)
        }

        /** Fecha do nosso lado com CLSE(0, remoto), exatamente como o sdb.exe faz (feche a TV antes ou não). */
        override fun close() {
            runCatching { mandar(MensagemSdb(MensagemSdb.CLSE, 0, remoto)) }
            fechado = true
        }
    }

    fun abrir(destino: String): Fluxo {
        val local = proximoId++
        mandar(MensagemSdb(MensagemSdb.OPEN, local, 0, MensagemSdb.textoZ(destino)))
        while (true) {
            val m = receber()
            if (m.arg1 != local) {
                if (m.comando == MensagemSdb.WRTE) mandar(MensagemSdb(MensagemSdb.OKAY, m.arg1, m.arg0))
                continue
            }
            when (m.comando) {
                MensagemSdb.OKAY -> return Fluxo(local, m.arg0)
                MensagemSdb.CLSE -> throw IOException("a TV recusou \"${destino.substringBefore(':')}\"")
            }
        }
    }

    fun shell(comando: String): String = abrir("shell:$comando").use { String(it.lerTudo(), Charsets.UTF_8) }

    fun capacidades(): Map<String, String> =
        SaidaSamsung.lerCapacidades(abrir("capability:").use { String(it.lerTudo(), Charsets.UTF_8) })

    /** Envia um arquivo pelo `sync:` (SEND, DATA, DONE) e confere a resposta da TV. */
    fun enviar(origem: InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit) {
        SaidaSamsung.validarCaminho(destino)
        abrir("sync:").use { f ->
            ProtocoloSync.escrever(
                saida = f.comoSaida, origem = origem, tamanho = tamanho, destino = destino,
                porEscrita = maxDados, mtimeSegundos = (System.currentTimeMillis() / 1000).toInt(),
                progresso = progresso, modo = 33261, // 0100755, o modo que o sdb.exe manda
            )
            val erro = ProtocoloSync.lerResposta(f.comoEntrada)
            if (erro != null) throw IOException("A TV recusou o arquivo: $erro")
            runCatching { f.escrever(ProtocoloSync.cabecalho("QUIT", 0)) }
        }
    }

    override fun close() {
        runCatching { socket.close() }
    }
}
