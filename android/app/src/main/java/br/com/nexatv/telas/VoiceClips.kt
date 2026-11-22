package br.com.nexatv.telas

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import br.com.nexatv.telas.core.MuLaw
import br.com.nexatv.telas.core.VoicePlan
import br.com.nexatv.telas.core.VoiceVocab

/**
 * A voz própria da chamada (20/11): toca os pedaços de assets/voz/<voz>/ em sequência, num AudioTrack só (sem os buracos
 * de tocar arquivo por arquivo). Não usa a voz do Android: funciona em qualquer TV box.
 */
class VoiceClips(ctx: Context) {
    companion object {
        const val RATE = 16000
        /** As vozes que o app traz (Ajustes → "Voz da chamada"); "android" = a voz do aparelho (TextToSpeech). */
        val VOICES = listOf("coral" to "Coral (feminina)", "nova" to "Nova (feminina)", "ash" to "Ash (masculina)", "onyx" to "Onyx (masculina)", "android" to "Voz do Android")
        const val DEFAULT = "coral"
        /** A voz guardada, ou a padrão (a 1.2.13 guardava "cadu"/"jeff", que saíram). */
        fun key(stored: String) = if (VOICES.any { it.first == stored }) stored else DEFAULT
        fun label(key: String) = VOICES.first { it.first == key(key) }.second
        private const val GAP_MS = 50
        private const val PAUSE_MS = 250
    }

    private val assets = ctx.applicationContext.assets
    private val main = Handler(Looper.getMainLooper())
    private val cache = HashMap<String, ShortArray>()
    private var track: AudioTrack? = null

    val vocab: VoiceVocab? = try {
        VoiceVocab.parse(assets.open("voz/vocabulario.tsv").bufferedReader(Charsets.UTF_8).readText())
    } catch (_: Exception) {
        null
    }

    val ready: Boolean get() = vocab != null

    private fun clip(voice: String, token: String): ShortArray? = synchronized(cache) {
        cache.getOrPut("$voice/$token") {
            try { MuLaw.decode(assets.open("voz/$voice/$token.ulaw").use { it.readBytes() }) } catch (_: Exception) { return null }
        }
    }

    /** Toca os pedaços (PAUSE = pausa). Devolve false se não deu (sem a voz, sem nenhum pedaço). done() quando acaba. */
    fun speak(voice: String, tokens: List<String>, volume: Float, done: () -> Unit): Boolean {
        stop()
        val parts = ArrayList<ShortArray>()
        val gap = ShortArray(RATE * GAP_MS / 1000)
        val pause = ShortArray(RATE * PAUSE_MS / 1000)
        for (t in tokens) {
            if (t == VoicePlan.PAUSE) { parts += pause; continue }
            val c = clip(voice, t) ?: continue
            if (parts.isNotEmpty()) parts += gap
            parts += c
        }
        if (parts.none { it !== gap && it !== pause }) return false
        val tail = ShortArray(RATE / 10) // um respiro no fim: o AudioTrack não corta a última sílaba
        val total = parts.sumOf { it.size } + tail.size
        val pcm = ShortArray(total)
        var at = 0
        for (p in parts) { System.arraycopy(p, 0, pcm, at, p.size); at += p.size }
        return try {
            val t = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(total * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            t.write(pcm, 0, total)
            t.setVolume(volume.coerceIn(0f, 1f))
            t.play()
            track = t
            main.postDelayed({
                if (track === t) stop()
                done()
            }, total * 1000L / RATE + 150)
            true
        } catch (_: Exception) {
            stop()
            false
        }
    }

    fun stop() {
        val t = track ?: return
        track = null
        try { t.stop() } catch (_: Exception) { }
        try { t.release() } catch (_: Exception) { }
    }
}
