package br.com.digitalisp.instalador.samsung

import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Uma mensagem do sdb (o "adb" da Samsung). Mesmo formato do ADB: cabeçalho de 24 bytes em little-endian
 * (comando, arg0, arg1, tamanho, soma dos bytes, comando xor 0xFFFFFFFF) e os dados.
 * Conferido com o tráfego real do sdb.exe do Tizen Studio para uma Samsung UN58TU7020 (Tizen 5.5) em 25/11/2026.
 */
data class MensagemSdb(val comando: Int, val arg0: Int, val arg1: Int, val dados: ByteArray = ByteArray(0)) {

    val nome: String get() = nomeDe(comando)

    fun codificar(): ByteArray {
        val bb = ByteBuffer.allocate(24 + dados.size).order(ByteOrder.LITTLE_ENDIAN)
        bb.putInt(comando).putInt(arg0).putInt(arg1).putInt(dados.size).putInt(soma(dados)).putInt(comando xor -1)
        bb.put(dados)
        return bb.array()
    }

    /** Os dados como texto, sem o zero do fim. */
    fun texto(): String = String(dados, Charsets.UTF_8).trimEnd('\u0000')

    override fun equals(other: Any?): Boolean =
        other is MensagemSdb && comando == other.comando && arg0 == other.arg0 && arg1 == other.arg1 && dados.contentEquals(other.dados)

    override fun hashCode(): Int = ((comando * 31 + arg0) * 31 + arg1) * 31 + dados.contentHashCode()

    override fun toString(): String = "$nome($arg0, $arg1, ${dados.size} bytes)"

    companion object {
        fun cmd(s: String): Int = ByteBuffer.wrap(s.toByteArray(Charsets.US_ASCII)).order(ByteOrder.LITTLE_ENDIAN).int
        val CNXN = cmd("CNXN")
        val OPEN = cmd("OPEN")
        val OKAY = cmd("OKAY")
        val WRTE = cmd("WRTE")
        val CLSE = cmd("CLSE")

        /** Versão e tamanho máximo que o sdb.exe manda no CNXN (0x00100000 e 256 KiB). */
        const val VERSAO = 0x00100000
        const val MAX_DADOS = 256 * 1024
        /** Tamanho máximo aceito do outro lado (proteção contra lixo na rede). */
        const val LIMITE_LEITURA = 1024 * 1024

        fun nomeDe(c: Int): String {
            val b = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(c).array()
            return if (b.all { it in 'A'.code..'Z'.code }) String(b, Charsets.US_ASCII) else "0x" + Integer.toHexString(c)
        }

        fun soma(b: ByteArray): Int {
            var s = 0
            for (x in b) s += (x.toInt() and 0xFF)
            return s
        }

        fun textoZ(s: String): ByteArray = (s + "\u0000").toByteArray(Charsets.UTF_8)

        fun ler(entrada: InputStream): MensagemSdb {
            val d = DataInputStream(entrada)
            val cab = ByteArray(24)
            try {
                d.readFully(cab)
            } catch (e: EOFException) {
                throw EOFException("a TV fechou a conexão")
            }
            val bb = ByteBuffer.wrap(cab).order(ByteOrder.LITTLE_ENDIAN)
            val c = bb.int; val a0 = bb.int; val a1 = bb.int; val tam = bb.int; val chk = bb.int; val magia = bb.int
            if (magia != (c xor -1)) throw IOException("mensagem sdb inválida (${nomeDe(c)})")
            if (tam < 0 || tam > LIMITE_LEITURA) throw IOException("mensagem sdb grande demais ($tam bytes)")
            val dados = ByteArray(tam)
            d.readFully(dados)
            // o sdbd antigo manda a soma; o novo pode mandar 0. Só confere quando vem.
            if (chk != 0 && chk != soma(dados)) throw IOException("soma errada na mensagem sdb")
            return MensagemSdb(c, a0, a1, dados)
        }
    }
}
