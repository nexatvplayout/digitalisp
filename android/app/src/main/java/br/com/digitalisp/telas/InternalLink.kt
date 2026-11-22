package br.com.digitalisp.telas

import android.os.Handler
import android.os.Looper
import br.com.digitalisp.telas.core.Backoff
import br.com.digitalisp.telas.core.Internal
import br.com.digitalisp.telas.core.SseParser
import java.io.InputStreamReader
import java.net.HttpURLConnection

/**
 * Códigos de emergência em tempo real na tela interna (contrato §17.2): /api/telas/internal/stream (Server-Sent Events,
 * evento `codes` com a lista inteira). Só roda no modo gerenciado e com `internal` na configuração (tela interna); a tela
 * pública nem conecta. O sinal de vida também traz `codes` (a cada 30 s), então uma queda daqui atrasa, não perde.
 */
object InternalLink {
    private val main = Handler(Looper.getMainLooper())
    private val lock = Object()
    private var thread: Thread? = null
    @Volatile private var want = false
    @Volatile private var conn: HttpURLConnection? = null

    /** Para a tela de diagnóstico. */
    @Volatile var status = "desligada (tela pública)"
        private set

    fun sync() {
        val on = Engine.isReady && Engine.managed && Engine.store.token != null && Engine.config?.internal != null
        synchronized(lock) {
            if (on == want && (!on || thread?.isAlive == true)) return
            want = on
            if (!on) {
                status = "desligada (tela pública)"
                try { conn?.disconnect() } catch (_: Exception) { }
                thread?.interrupt()
                thread = null
                return
            }
            thread = Thread({ run() }, "telas-interna").apply {
                isDaemon = true
                start()
            }
        }
    }

    private fun active(): Boolean = want && Thread.currentThread() === thread

    fun retryNow() {
        synchronized(lock) { thread?.interrupt() }
    }

    private fun run() {
        var wait = Backoff.FIRST_MS
        while (active()) {
            var c: HttpURLConnection? = null
            try {
                val token = Engine.store.token ?: break
                status = "conectando"
                c = Api(Engine.store.server, token).openInternalStream()
                conn = c
                if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}")
                status = "conectada"
                val parser = SseParser()
                val reader = InputStreamReader(c.inputStream, Charsets.UTF_8)
                val buf = CharArray(2048)
                while (active()) {
                    val n = reader.read(buf)
                    if (n < 0) break
                    wait = Backoff.FIRST_MS
                    for (ev in parser.feed(String(buf, 0, n))) {
                        if (ev.event == "codes") Internal.codesEvent(ev.data)?.let { list -> main.post { if (want) Engine.onCodes(list) } }
                    }
                }
            } catch (_: Exception) {
                // rede ou servidor fora: tenta de novo; o sinal de vida segue trazendo os códigos
            } finally {
                conn = null
                try { c?.disconnect() } catch (_: Exception) { }
            }
            if (!active()) break
            status = "reconectando (espera de ${wait / 1000} s)"
            try { Thread.sleep(wait) } catch (_: InterruptedException) { }
            wait = Backoff.next(wait)
        }
    }
}
