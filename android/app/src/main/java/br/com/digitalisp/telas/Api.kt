package br.com.digitalisp.telas

import br.com.digitalisp.telas.core.ApiErrors
import br.com.digitalisp.telas.core.ApiFailure
import br.com.digitalisp.telas.core.Urls
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Resposta do servidor com código de erro (400, 401, 403, 404, 429…). `apiCode` é o campo `code` do JSON, se veio. */
class ApiException(val code: Int, message: String, val apiCode: String? = null) : IOException(message) {
    val failure: ApiFailure get() = ApiErrors.classify(code, apiCode)
}

/**
 * Cliente da API do aparelho (as rotas /api/telas/…; a marca: docs/CONTRATO-APP-MARCA.md). Só https (http apenas em build de depuração, para
 * localhost e 10.x). O token nunca vai para log nem para mensagem de erro.
 */
class Api(base: String, private val token: String?) {
    private val base: String = Urls.origin(base) ?: throw IOException("Endereço do servidor inválido")

    init {
        if (!Urls.apiAllowed(this.base, BuildConfig.DEBUG)) throw IOException("O servidor precisa ser https://")
    }

    class Reply(val code: Int, val body: String, val dateMs: Long)

    private fun call(method: String, path: String, body: ByteArray?, contentType: String?, headers: Map<String, String> = emptyMap()): Reply {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 20_000
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "Telas/" + BuildConfig.VERSION_NAME)
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", contentType ?: "application/json; charset=utf-8")
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val text = stream?.use { s ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8192)
                while (out.size() < 2_000_000) {
                    val n = s.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
                out.toString("UTF-8")
            } ?: ""
            return Reply(code, text, conn.date)
        } finally {
            conn.disconnect()
        }
    }

    private fun fail(r: Reply): Nothing {
        val (msg, apiCode) = ApiErrors.parse(r.body)
        throw ApiException(r.code, msg ?: "Erro ${r.code}", apiCode)
    }

    private fun json(o: JSONObject) = o.toString().toByteArray(Charsets.UTF_8)

    /** POST /api/telas/activate → { deviceId, token, channel, name } */
    fun activate(key: String, device: JSONObject): JSONObject {
        val r = call("POST", "/api/telas/activate", json(JSONObject().put("key", key).put("device", device)), null)
        if (r.code != 200) fail(r)
        return JSONObject(r.body)
    }

    /** POST /api/telas/recover (app reinstalado, §32) → o mesmo { deviceId, token, channel, name } da ativação; 404 = sem tela. */
    fun recover(hwid: String, device: JSONObject): JSONObject {
        val r = call("POST", "/api/telas/recover", json(JSONObject().put("hwid", hwid).put("device", device)), null)
        if (r.code != 200) fail(r)
        return JSONObject(r.body)
    }

    /** GET /api/telas/config. Devolve null no 304 (nada mudou). */
    fun config(rev: String?): String? {
        val h = if (rev.isNullOrEmpty()) emptyMap() else mapOf("If-None-Match" to rev)
        val r = call("GET", "/api/telas/config", null, null, h)
        if (r.code == 304) return null
        if (r.code != 200) fail(r)
        return r.body
    }

    /** POST /api/telas/heartbeat → { rev, commands, alerts } (mais a hora do servidor, do cabeçalho Date). */
    fun heartbeat(body: JSONObject): Pair<JSONObject, Long> {
        val r = call("POST", "/api/telas/heartbeat", json(body), null)
        if (r.code != 200) fail(r)
        return JSONObject(r.body) to r.dateMs
    }

    /** GET /api/telas/queue → o estado inteiro da chamada de senha. */
    fun queue(): String {
        val r = call("GET", "/api/telas/queue", null, null)
        if (r.code != 200) fail(r)
        return r.body
    }

    /** GET /api/telas/queue/stream (Server-Sent Events). Quem chama lê o corpo e fecha a conexão. */
    fun openQueueStream(): HttpURLConnection = openStream("/api/telas/queue/stream")

    /** Os códigos de emergência da tela interna (contrato §17.2): o mesmo formato de SSE. */
    fun openInternalStream(): HttpURLConnection = openStream("/api/telas/internal/stream")

    private fun openStream(path: String): HttpURLConnection {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 10_000
        conn.readTimeout = 65_000 // o servidor manda ": ping" a cada 20 s
        conn.instanceFollowRedirects = false
        conn.useCaches = false
        conn.setRequestProperty("Accept", "text/event-stream")
        conn.setRequestProperty("Cache-Control", "no-cache")
        conn.setRequestProperty("User-Agent", "Telas/" + BuildConfig.VERSION_NAME)
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        return conn
    }

    fun commandDone(id: Long, ok: Boolean, detail: String) {
        val r = call("POST", "/api/telas/commands/$id/done", json(JSONObject().put("ok", ok).put("detail", detail.take(200))), null)
        if (r.code !in 200..299) fail(r)
    }

    fun screenshot(jpeg: ByteArray) {
        val r = call("POST", "/api/telas/screenshot", jpeg, "image/jpeg")
        if (r.code !in 200..299) fail(r)
    }
}
