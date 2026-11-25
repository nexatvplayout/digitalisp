package br.com.digitalisp.instalador.pacotes

import br.com.digitalisp.instalador.rede.Plataforma
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** O app de tela publicado no servidor DIGITAL ISP para uma plataforma. */
data class Pacote(
    val plataforma: Plataforma,
    val versao: String,
    val sha256: String,
    val bytes: Long,
    val url: String,
    /** Id do app na TV (Samsung "DgIspTela1.Telas", LG "br.com.digitalisp.telas"); no Android, lido do APK. */
    val appId: String?,
    /** Nome com que o arquivo vai para a TV. */
    val nomeArquivo: String,
)

/**
 * Onde cada pacote fica no servidor (server/telas-app.js e server/telas-tv.js):
 * - Android: GET /telas/app/latest.json → { versionCode, versionName, sha256, bytes, url }
 * - Samsung e LG: GET /telas/tv/latest.json → { tizen: {...}, webos: {...} }, cada um com
 *   { version, appId, sha256, bytes, url, file }
 */
object Pacotes {
    fun enderecoIndice(servidor: String, p: Plataforma): String {
        val base = servidor.trim().trimEnd('/')
        return if (p == Plataforma.ANDROID) "$base/telas/app/latest.json" else "$base/telas/tv/latest.json"
    }

    fun ler(json: String, p: Plataforma, servidor: String): Pacote {
        val j = try { JSONObject(json) } catch (e: Exception) { throw IOException("O servidor respondeu algo que não é a lista de versões.") }
        val o = when (p) {
            Plataforma.ANDROID -> j
            Plataforma.SAMSUNG -> j.optJSONObject("tizen")
            Plataforma.LG -> j.optJSONObject("webos")
        } ?: throw IOException("O servidor ainda não tem o app de tela para ${nome(p)}.")
        val sha = o.optString("sha256").lowercase()
        val bytes = o.optLong("bytes", -1)
        val url = absoluta(o.optString("url"), servidor)
        if (!sha.matches(Regex("^[0-9a-f]{64}$")) || bytes <= 0 || url == null) {
            throw IOException("A versão do app de tela para ${nome(p)} no servidor está incompleta.")
        }
        val versao = if (p == Plataforma.ANDROID) o.optString("versionName").ifBlank { o.optString("versionCode") } else o.optString("version")
        val appId = o.optString("appId").takeIf { it.isNotBlank() }
        val padrao = when (p) {
            Plataforma.ANDROID -> "telas.apk"
            Plataforma.SAMSUNG -> "DigitalISP.wgt"
            Plataforma.LG -> "br.com.digitalisp.telas.ipk"
        }
        val arquivo = o.optString("file").takeIf { it.matches(Regex("^[A-Za-z0-9_.-]{1,80}$")) } ?: padrao
        return Pacote(p, versao.ifBlank { "?" }, sha, bytes, url, appId, arquivo)
    }

    /** Endereço do arquivo: só https (ou relativo ao servidor, que já é https). */
    fun absoluta(url: String, servidor: String): String? {
        val u = url.trim()
        if (u.isEmpty()) return null
        if (u.startsWith("https://")) return u
        if (u.startsWith("/") && !u.startsWith("//")) return servidor.trim().trimEnd('/') + u
        return null
    }

    fun nome(p: Plataforma) = when (p) {
        Plataforma.ANDROID -> "TV box Android"
        Plataforma.SAMSUNG -> "TV Samsung"
        Plataforma.LG -> "TV LG"
    }

    fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
}

/** Busca a versão atual no servidor e baixa o arquivo (com cache pelo SHA-256). Bloqueia: fora da thread principal. */
class Baixador(private val servidor: String, private val pastaCache: File) {

    init {
        require(servidor.startsWith("https://")) { "o servidor precisa ser https" }
    }

    fun versaoAtual(p: Plataforma): Pacote {
        val con = abrir(Pacotes.enderecoIndice(servidor, p))
        try {
            when (val c = con.responseCode) {
                200 -> Unit
                404 -> throw IOException("O servidor ainda não tem o app de tela para ${Pacotes.nome(p)}.")
                else -> throw IOException("O servidor respondeu $c ao pedir a versão do app.")
            }
            val txt = con.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            return Pacotes.ler(txt, p, servidor)
        } finally {
            con.disconnect()
        }
    }

    /** Baixa (ou reaproveita do cache) o pacote, conferindo tamanho e SHA-256. */
    fun baixar(pacote: Pacote, progresso: (Long, Long) -> Unit): File {
        val final = File(pastaCache, "${pacote.sha256}-${pacote.nomeArquivo}")
        if (final.isFile && final.length() == pacote.bytes && sha256(final) == pacote.sha256) {
            progresso(pacote.bytes, pacote.bytes)
            return final
        }
        val con = abrir(pacote.url)
        try {
            if (con.responseCode != 200) throw IOException("O servidor respondeu ${con.responseCode} ao baixar o app.")
            return con.inputStream.use { salvarConferindo(it, pacote, pastaCache, progresso) }
        } finally {
            con.disconnect()
        }
    }

    private fun abrir(url: String): HttpURLConnection {
        val u = URL(url)
        if (u.protocol != "https") throw IOException("O endereço do app precisa ser https.")
        return (u.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "DIGITAL-ISP-Instalador")
        }
    }

    companion object {
        fun sha256(f: File): String = f.inputStream().use { i ->
            val md = MessageDigest.getInstance("SHA-256")
            val buf = ByteArray(64 * 1024)
            while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) }
            Pacotes.hex(md.digest())
        }

        /** Grava no cache conferindo tamanho e SHA-256 (o que não confere é apagado). Sem rede: testável. */
        fun salvarConferindo(entrada: InputStream, pacote: Pacote, pasta: File, progresso: (Long, Long) -> Unit): File {
            pasta.mkdirs()
            // só um pacote por plataforma no cache: apaga as versões velhas deste arquivo
            pasta.listFiles()?.filter { it.name.endsWith("-${pacote.nomeArquivo}") || it.name.endsWith(".parcial") }?.forEach { it.delete() }
            val tmp = File(pasta, "${pacote.nomeArquivo}.parcial")
            val md = MessageDigest.getInstance("SHA-256")
            var feito = 0L
            var grande = false
            tmp.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = entrada.read(buf); if (n < 0) break
                    feito += n
                    if (feito > pacote.bytes) { grande = true; break }
                    out.write(buf, 0, n); md.update(buf, 0, n)
                    progresso(feito, pacote.bytes)
                }
            }
            if (grande) { tmp.delete(); throw IOException("O arquivo baixado é maior do que o esperado.") }
            if (feito != pacote.bytes) { tmp.delete(); throw IOException("Download incompleto ($feito de ${pacote.bytes} bytes). Tente de novo.") }
            if (Pacotes.hex(md.digest()) != pacote.sha256) { tmp.delete(); throw IOException("O arquivo baixado não confere (SHA-256). Tente de novo.") }
            val final = File(pasta, "${pacote.sha256}-${pacote.nomeArquivo}")
            final.delete()
            if (!tmp.renameTo(final)) throw IOException("Não deu para gravar o app no celular.")
            return final
        }
    }
}
