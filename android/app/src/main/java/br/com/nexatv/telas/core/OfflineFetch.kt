package br.com.nexatv.telas.core

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

/** Resposta do servidor de arquivos: 200 (arquivo inteiro) ou 206 (a partir do ponto pedido). */
class OfflineResponse(val status: Int, val body: InputStream)

/** Quem abre a conexão (HttpURLConnection no app; de mentira nos testes). `from` > 0 pede "Range: bytes=from-". */
fun interface OfflineTransport {
    fun open(url: String, from: Long): OfflineResponse
}

/**
 * Baixa um vídeo guardado para a pasta do app, sem Android dentro (testável na JVM).
 * Escreve em `<nome>.part`, continua de onde parou, confere tamanho e sha256 e só então dá o nome final.
 * Arquivo que não confere é APAGADO: a próxima passada (o app repassa a lista a cada 10 min) baixa de novo do zero.
 */
object OfflineFetch {
    enum class Result { OK, BAD_HASH, FAILED, CANCELLED }

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { ins ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return Hex.of(md.digest())
    }

    fun fetch(item: OfflineItem, dir: File, transport: OfflineTransport, cancelled: () -> Boolean = { false }): Result =
        fetchAs(OfflinePlan.fileName(item), item, dir, transport, cancelled)

    /** Igual ao [fetch], com o nome do arquivo escolhido por quem chama (as fotos dos desaparecidos usam o delas). */
    fun fetchAs(name: String, item: OfflineItem, dir: File, transport: OfflineTransport, cancelled: () -> Boolean = { false }): Result {
        val part = File(dir, name + OfflinePlan.PART)
        try {
            var have = if (part.isFile) part.length() else 0L
            if (have > item.bytes) {
                part.delete()
                have = 0L
            }
            if (have < item.bytes) {
                val res = transport.open(item.url, have)
                res.body.use { ins ->
                    if (res.status == 200) have = 0L // o servidor ignorou o Range: recomeça
                    else if (res.status != 206 || have == 0L) return Result.FAILED
                    FileOutputStream(part, have > 0).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var total = have
                        while (true) {
                            val n = ins.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > item.bytes) {
                                out.close()
                                part.delete()
                                return Result.BAD_HASH // veio maior que o anunciado
                            }
                            out.write(buf, 0, n)
                            if (cancelled()) return Result.CANCELLED
                        }
                    }
                }
            }
            if (part.length() < item.bytes) return Result.FAILED // conexão caiu no meio: o .part fica para continuar
            if (sha256(part) != item.sha256) {
                part.delete()
                return Result.BAD_HASH
            }
            val dest = File(dir, name)
            if (dest.exists()) dest.delete()
            return if (part.renameTo(dest)) Result.OK else Result.FAILED
        } catch (_: Exception) {
            return Result.FAILED // o .part fica para continuar depois
        }
    }
}
