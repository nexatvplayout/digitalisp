package br.com.nexatv.telas

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import br.com.nexatv.telas.core.Backoff
import br.com.nexatv.telas.core.QueueParser
import br.com.nexatv.telas.core.SseParser
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.util.Locale

/**
 * Chamada de senha em tempo real (contrato §7.2): GET /api/telas/queue ao (re)conectar e depois o
 * /api/telas/queue/stream (Server-Sent Events) lido com HttpURLConnection. Reconecta com espera de 1 s a 30 s.
 * Só roda no modo gerenciado, com token e com `queue.enabled`; desligou na configuração, para.
 */
object QueueLink {
    private val main = Handler(Looper.getMainLooper())
    private val lock = Object()
    private var thread: Thread? = null
    @Volatile private var want = false
    @Volatile private var conn: HttpURLConnection? = null

    /** Para a tela de diagnóstico. */
    @Volatile var status = "desligada"
        private set

    /** Liga ou desliga conforme a configuração em vigor. Pode ser chamado de qualquer thread, quantas vezes for. */
    fun sync() {
        val on = Engine.isReady && Engine.managed && Engine.store.token != null && Engine.config?.queue?.enabled == true
        synchronized(lock) {
            if (on == want && (!on || thread?.isAlive == true)) return
            want = on
            if (!on) {
                status = "desligada"
                try { conn?.disconnect() } catch (_: Exception) { }
                thread?.interrupt()
                thread = null
                return
            }
            thread = Thread({ run() }, "telas-senha").apply {
                isDaemon = true
                start()
            }
        }
    }

    private fun active(): Boolean = want && Thread.currentThread() === thread

    /** Acorda a espera entre reconexões (o relógio do aparelho acabou de ser acertado). */
    fun retryNow() {
        synchronized(lock) { thread?.interrupt() }
    }

    private fun run() {
        var wait = Backoff.FIRST_MS
        while (active()) {
            var c: HttpURLConnection? = null
            try {
                val token = Engine.store.token ?: break
                val api = Api(Engine.store.server, token)
                status = "conectando"
                QueueParser.snapshot(api.queue())?.let { snap -> main.post { if (want) Engine.onQueueSnapshot(snap) } }
                c = api.openQueueStream()
                conn = c
                if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}")
                status = "conectada"
                val parser = SseParser()
                val reader = InputStreamReader(c.inputStream, Charsets.UTF_8)
                val buf = CharArray(2048)
                while (active()) {
                    val n = reader.read(buf) // o `: ping` a cada 20 s mantém a leitura viva; 65 s sem nada = caiu
                    if (n < 0) break
                    wait = Backoff.FIRST_MS
                    for (ev in parser.feed(String(buf, 0, n))) {
                        when (ev.event) {
                            "call" -> QueueParser.call(ev.data)?.let { call -> main.post { if (want) Engine.onQueueCall(call) } }
                            "state" -> QueueParser.snapshot(ev.data)?.let { snap -> main.post { if (want) Engine.onQueueSnapshot(snap) } }
                        }
                    }
                }
            } catch (_: Exception) {
                // rede fora, servidor fora, 401/403 (o sinal de vida cuida do token): tenta de novo depois
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

/** Voz da chamada (TextToSpeech do Android, pt-BR). Sem voz em português instalada, fica só o toque. */
class Speaker(ctx: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var onDone: (() -> Unit)? = null

    @Volatile var ready = false
        private set

    /** Para a tela de diagnóstico. */
    @Volatile var status = "iniciando a voz…"
        private set

    init {
        try {
            tts = TextToSpeech(ctx.applicationContext) { st ->
                val t = tts
                if (st != TextToSpeech.SUCCESS || t == null) {
                    status = "o aparelho não tem serviço de voz: a chamada toca só o aviso sonoro"
                } else {
                    val r = try { t.setLanguage(Locale("pt", "BR")) } catch (_: Exception) { TextToSpeech.LANG_NOT_SUPPORTED }
                    if (r >= TextToSpeech.LANG_AVAILABLE) {
                        ready = true
                        status = "voz em português instalada"
                        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) {}
                            override fun onDone(utteranceId: String?) = finished()

                            @Deprecated("Deprecated in Java")
                            override fun onError(utteranceId: String?) = finished()
                        })
                    } else {
                        status = "sem voz em português (pt-BR) instalada: a chamada toca só o aviso sonoro"
                    }
                }
            }
        } catch (_: Exception) {
            status = "o aparelho não tem serviço de voz: a chamada toca só o aviso sonoro"
        }
    }

    private fun finished() {
        main.post {
            val cb = onDone
            onDone = null
            cb?.invoke()
        }
    }

    /** Fala o texto (interrompe a fala anterior). Devolve false se não deu para falar. */
    fun speak(text: String, volume: Float = 1f, done: () -> Unit): Boolean {
        val t = tts
        if (!ready || t == null) return false
        onDone = done
        return try {
            // o volume da fala (0 a 1) é relativo ao volume do aparelho (contrato §16: volume por tela no painel)
            val params = android.os.Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume.coerceIn(0f, 1f)) }
            t.speak(text, TextToSpeech.QUEUE_FLUSH, params, "chamada") == TextToSpeech.SUCCESS
        } catch (_: Exception) {
            false
        }
    }

    fun shutdown() {
        try { tts?.shutdown() } catch (_: Exception) { }
        tts = null
        ready = false
    }
}
