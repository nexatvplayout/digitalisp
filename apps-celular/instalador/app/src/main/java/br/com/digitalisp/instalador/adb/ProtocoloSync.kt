package br.com.digitalisp.instalador.adb

import java.io.DataInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * O serviço `sync:` do ADB (o que o `adb push` usa), só a parte de enviar arquivo:
 * `SEND <caminho>,<modo>` → vários `DATA <tamanho><bytes>` (até 64 KiB cada) → `DONE <mtime>` → resposta `OKAY` ou
 * `FAIL <mensagem>`. Todos os números em little-endian. Sem Android (testável na JVM).
 */
object ProtocoloSync {
    const val MAX_DADOS = 64 * 1024

    fun cabecalho(id: String, valor: Int): ByteArray {
        require(id.length == 4)
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            .put(id.toByteArray(Charsets.US_ASCII)).putInt(valor).array()
    }

    /** `SEND` + tamanho + "caminho,modo" (modo em decimal, como o adb faz: 0644 = 420). */
    fun send(caminho: String, modo: Int = 420): ByteArray {
        val corpo = "$caminho,$modo".toByteArray(Charsets.UTF_8)
        require(corpo.size <= 1024) { "caminho longo demais" }
        return cabecalho("SEND", corpo.size) + corpo
    }

    fun data(bytes: ByteArray, inicio: Int, tamanho: Int): ByteArray {
        require(tamanho in 0..MAX_DADOS)
        return cabecalho("DATA", tamanho) + bytes.copyOfRange(inicio, inicio + tamanho)
    }

    fun done(mtimeSegundos: Int): ByteArray = cabecalho("DONE", mtimeSegundos)

    /**
     * Escreve o arquivo inteiro. [porEscrita] é o maior pedaço que pode ir numa escrita do transporte (o ADB não aceita
     * duas mensagens seguidas sem resposta): cada DATA leva no máximo [porEscrita] - 8 bytes.
     */
    fun escrever(
        saida: OutputStream,
        origem: InputStream,
        tamanho: Long,
        destino: String,
        porEscrita: Int,
        mtimeSegundos: Int,
        progresso: (Long) -> Unit,
    ) {
        val bloco = minOf(MAX_DADOS, porEscrita - 8).also { require(it > 0) { "porEscrita pequeno demais" } }
        saida.write(send(destino))
        val buf = ByteArray(bloco)
        var enviado = 0L
        while (true) {
            val n = lerCheio(origem, buf)
            if (n <= 0) break
            saida.write(data(buf, 0, n))
            enviado += n
            progresso(enviado)
        }
        if (tamanho >= 0 && enviado != tamanho) throw IOException("arquivo incompleto: $enviado de $tamanho bytes")
        saida.write(done(mtimeSegundos))
        saida.flush()
    }

    /** Lê a resposta final do sync. Devolve null se OKAY, ou a mensagem de erro. */
    fun lerResposta(entrada: InputStream): String? {
        val d = DataInputStream(entrada)
        val cab = ByteArray(8)
        d.readFully(cab)
        val bb = ByteBuffer.wrap(cab).order(ByteOrder.LITTLE_ENDIAN)
        val id = String(cab, 0, 4, Charsets.US_ASCII)
        bb.position(4)
        val tam = bb.int
        return when (id) {
            "OKAY" -> null
            "FAIL" -> {
                if (tam !in 0..65536) return "falha sem mensagem"
                val msg = ByteArray(tam)
                d.readFully(msg)
                String(msg, Charsets.UTF_8)
            }
            else -> "resposta inesperada do sync: $id"
        }
    }

    private fun lerCheio(i: InputStream, buf: ByteArray): Int {
        var total = 0
        while (total < buf.size) {
            val n = i.read(buf, total, buf.size - total)
            if (n < 0) break
            total += n
        }
        return total
    }
}
