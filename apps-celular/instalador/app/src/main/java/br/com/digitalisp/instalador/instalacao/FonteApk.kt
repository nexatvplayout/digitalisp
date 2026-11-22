package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** De onde vem o APK do app de tela. Bloqueia: chame fora da thread principal. */
fun interface FonteApk {
    /** Devolve o APK num arquivo local, informando o progresso (bytes feitos, total ou -1). */
    fun obter(progresso: (Long, Long) -> Unit): File
}

/** Baixa o APK de um endereço https para a pasta de cache do app. */
class FonteUrl(private val url: String, private val pastaCache: File) : FonteApk {
    override fun obter(progresso: (Long, Long) -> Unit): File {
        validar(url)
        val con = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
        }
        try {
            val codigo = con.responseCode
            if (codigo != 200) throw IOException("O servidor respondeu $codigo ao baixar o app.")
            val total = con.contentLengthLong
            return con.inputStream.use { copiarParaCache(it, total, pastaCache, progresso) }
        } finally {
            con.disconnect()
        }
    }

    companion object {
        fun validar(url: String) {
            if (Config.urlIndefinida(url)) {
                throw IOException("O endereço do app ainda não foi definido. Ajuste em \"Endereço do app\" ou escolha um APK do celular.")
            }
            if (!url.startsWith("https://")) throw IOException("O endereço do app precisa começar com https://")
        }
    }
}

/** Copia para o cache, num arquivo temporário renomeado no fim (nunca deixa um APK pela metade com o nome final). */
fun copiarParaCache(entrada: InputStream, total: Long, pastaCache: File, progresso: (Long, Long) -> Unit): File {
    pastaCache.mkdirs()
    val tmp = File(pastaCache, "telas.apk.parcial")
    val final = File(pastaCache, "telas.apk")
    var feito = 0L
    tmp.outputStream().use { saida ->
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = entrada.read(buf)
            if (n < 0) break
            saida.write(buf, 0, n)
            feito += n
            progresso(feito, total)
        }
    }
    if (total > 0 && feito != total) {
        tmp.delete()
        throw IOException("Download incompleto ($feito de $total bytes). Tente de novo.")
    }
    if (feito < 4 || !comecaComZip(tmp)) {
        tmp.delete()
        throw IOException("O arquivo baixado não é um app Android (APK). Confira o endereço.")
    }
    final.delete()
    if (!tmp.renameTo(final)) throw IOException("Não deu para gravar o app no celular.")
    return final
}

/** Todo APK é um ZIP: começa com "PK\u0003\u0004". */
fun comecaComZip(arquivo: File): Boolean = arquivo.inputStream().use { i ->
    val c = ByteArray(4)
    i.read(c) == 4 && c[0] == 'P'.code.toByte() && c[1] == 'K'.code.toByte() && c[2] == 3.toByte() && c[3] == 4.toByte()
}
