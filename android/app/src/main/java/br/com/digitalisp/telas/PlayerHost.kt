package br.com.digitalisp.telas

import android.content.Context
import android.media.MediaCodecList
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.text.CueGroup
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import br.com.digitalisp.telas.core.CodecNames
import br.com.digitalisp.telas.core.DecoderGuard
import br.com.digitalisp.telas.core.DiagReport
import br.com.digitalisp.telas.core.ErrorKind
import br.com.digitalisp.telas.core.PlayerErrors
import br.com.digitalisp.telas.core.VideoMode
import br.com.digitalisp.telas.core.VideoPolicy
import java.io.File

/**
 * O player (Media3 ExoPlayer) e a superfície do vídeo.
 * Superfície comum (SurfaceView) é a mais leve numa TV box fraca; quando a composição precisa girar
 * (TV em pé com a saída deitada) usa TextureView, que aceita rotação.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class PlayerHost(
    private val ctx: Context,
    startMode: VideoMode,
    private val onModeChanged: (VideoMode, auto: Boolean) -> Unit,
    private val onError: (ErrorKind, String) -> Unit,
) {
    private companion object {
        // DIGITAL ISP (26/11/2026): na chamada da senha (voz ou bipe) e no código, o som do programa cai 90% (antes 80%)
        const val DUCK = 0.1f
    }

    /**
     * Decodificador: o do aparelho (hardware) primeiro; se ele não abrir, o player tenta o seguinte da lista do
     * Android (em geral o de software) em vez de desistir. TV box barata costuma ter decodificador que falha ao abrir.
     */
    private val player: ExoPlayer = ExoPlayer.Builder(ctx, DefaultRenderersFactory(ctx).setEnableDecoderFallback(true)).build()
    private val guard = DecoderGuard(startMode)
    private var frame: VideoFrame? = null

    // ---- diagnóstico (só lido na thread principal) ----
    private var decoderName: String? = null
    private var audioDecoderName: String? = null
    private var droppedTotal = 0L
    private var decoderErrors = 0

    val videoMode: VideoMode get() = guard.mode

    /** Escolha feita nos ajustes. */
    fun setVideoMode(m: VideoMode) {
        guard.set(m)
        applyVideoMode()
        onModeChanged(m, false)
    }

    /**
     * Teto de resolução = o tamanho da tela (não adianta decodificar 1080p numa saída 720p), som só estéreo (o canal
     * tem uma trilha 5.1 que a TV box não deve escolher) e, nos modos fixos, uma qualidade só, sem troca de resolução
     * no meio (há decodificador que trava nessa troca).
     */
    private fun applyVideoMode() {
        val size = try { Util.getCurrentDisplayModeSize(ctx) } catch (_: Exception) { null }
        val cap = VideoPolicy.cap(guard.mode, size?.x ?: 0, size?.y ?: 0)
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setMaxVideoSize(cap.width, cap.height)
            .setMaxAudioChannelCount(2)
            .setForceHighestSupportedBitrate(guard.mode != VideoMode.AUTO)
            .build()
    }

    private var hardwareOf: Pair<String, Boolean?>? = null

    /** O Android 10+ informa se o decodificador é de hardware; antes disso vale o nome (CodecNames). */
    private fun hardware(name: String?): Boolean? {
        if (name.isNullOrEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        hardwareOf?.let { if (it.first == name) return it.second }
        val hw = try {
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { it.name == name }?.isHardwareAccelerated
        } catch (_: Exception) {
            null
        }
        hardwareOf = name to hw
        return hw
    }

    /** Linhas do vídeo para a tela de diagnóstico. */
    fun diagnostics(): List<Pair<String?, String?>> {
        val f = player.videoFormat
        val a = player.audioFormat
        val c = player.videoDecoderCounters
        c?.ensureUpdated()
        val fps = f?.frameRate?.takeIf { it > 0f }?.let { " a ${Math.round(it)} q/s" }.orEmpty()
        return listOf(
            "Modo do vídeo" to guard.mode.label,
            "Decodificador de vídeo" to CodecNames.describe(decoderName, hardware(decoderName)),
            "Vídeo tocando" to if (f == null) "nenhum" else "${f.width}×${f.height}$fps · ${DiagReport.bitrate(f.bitrate)} · ${f.codecs ?: f.sampleMimeType ?: "?"}",
            "Quadros perdidos" to "$droppedTotal desde que o app abriu" + (c?.let { " (${it.droppedBufferCount} nesta carga, ${it.renderedOutputBufferCount} mostrados)" } ?: ""),
            "Erros de decodificador" to decoderErrors.toString(),
            "Decodificador de som" to (audioDecoderName ?: "nenhum ainda"),
            "Som tocando" to if (a == null) "nenhum" else "${a.channelCount} canais · ${a.sampleRate} Hz · ${a.codecs ?: a.sampleMimeType ?: "?"}",
            "Superfície" to if (texture) "TextureView (composição girada)" else "SurfaceView",
        )
    }
    var videoView: View? = null
        private set
    private var texture = false
    private var volume = 1f
    private var ducked = false

    init {
        applyVideoMode()
        player.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
                this@PlayerHost.decoderName = decoderName
            }

            override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
                audioDecoderName = decoderName
            }

            override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
                droppedTotal += droppedFrames
            }
        })
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                val causes = ArrayList<String>()
                var t: Throwable? = error
                while (t != null && causes.size < 8) {
                    causes.add(t.javaClass.simpleName)
                    t = t.cause
                }
                if (VideoPolicy.isDecoderError(error.errorCode)) {
                    decoderErrors++
                    // decodificador que falha de novo e de novo: para de trocar de resolução (e depois desce para 720p)
                    if (guard.onDecoderError(SystemClock.elapsedRealtime())) {
                        applyVideoMode()
                        onModeChanged(guard.mode, true)
                    }
                }
                onError(PlayerErrors.classify(error.errorCode, causes), error.errorCodeName)
            }

            override fun onPlaybackStateChanged(state: Int) {
                // ao vivo que "termina" (lista encerrada) é tratado como queda
                if (state == Player.STATE_ENDED && player.repeatMode == Player.REPEAT_MODE_OFF) onError(ErrorKind.RELOAD, "FIM_DO_SINAL")
            }

            override fun onCues(cueGroup: CueGroup) {
                onCues?.invoke(cueGroup.cues.mapNotNull { it.text?.toString()?.trim() }.filter { it.isNotEmpty() }.joinToString("\n"))
            }

            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) {
                    frame?.aspect = size.width * size.pixelWidthHeightRatio / size.height
                }
            }
        })
    }

    /** As falas da legenda em uso (vazio = nada na tela). */
    var onCues: ((String) -> Unit)? = null

    /**
     * Legendas (contrato §14): liga a faixa de texto (o CEA-608 do ar vem como faixa sem idioma, "und") e prefere o idioma
     * pedido; sem ele no fluxo, fica a do canal.
     */
    fun setCaptions(on: Boolean, lang: String?) {
        val b = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !on)
            .setSelectUndeterminedTextLanguage(true)
        // o idioma pedido e, sem ele no fluxo, o do canal (o CC1 do ar é declarado como português)
        if (lang != null && lang != "pt") b.setPreferredTextLanguages(lang, "pt") else b.setPreferredTextLanguages("pt")
        player.trackSelectionParameters = b.build()
        if (!on) onCues?.invoke("")
    }

    /** O endereço do ao vivo tocando agora (null = vídeos guardados ou nada). */
    var liveUrl: String? = null
        private set

    /**
     * O horário (ms de época) da imagem que está na tela, pelo EXT-X-PROGRAM-DATE-TIME do HLS; null se o fluxo não traz.
     * É ele que sincroniza a legenda traduzida do guia (core/GuideCaptions).
     */
    fun programTimeMs(): Long? = try {
        val tl = player.currentTimeline
        if (tl.isEmpty) null else {
            val w = androidx.media3.common.Timeline.Window()
            tl.getWindow(player.currentMediaItemIndex, w)
            if (w.windowStartTimeMs == C.TIME_UNSET) null else w.windowStartTimeMs + player.currentPosition
        }
    } catch (_: Throwable) {
        null
    }

    /** Os idiomas das faixas de legenda do que está tocando (null/"und" = sem idioma declarado: o CC do ar). */
    fun textLanguages(): List<String?> = player.currentTracks.groups
        .filter { it.type == C.TRACK_TYPE_TEXT }
        .flatMap { g -> (0 until g.length).map { g.getTrackFormat(it).language } }

    /** Põe a superfície do vídeo dentro da moldura (recria se o tipo mudou). */
    fun attach(target: VideoFrame, useTexture: Boolean) {
        val current = videoView
        if (current != null && texture == useTexture) {
            if (current.parent !== target) {
                (current.parent as? ViewGroup)?.removeView(current)
                target.addView(current)
            }
        } else {
            if (current != null) {
                (current.parent as? ViewGroup)?.removeView(current)
                if (texture) player.clearVideoTextureView(current as TextureView) else player.clearVideoSurfaceView(current as SurfaceView)
            }
            texture = useTexture
            val v: View = if (useTexture) TextureView(ctx).also { player.setVideoTextureView(it) } else SurfaceView(ctx).also { player.setVideoSurfaceView(it) }
            v.isFocusable = false
            videoView = v
            target.addView(v)
        }
        val size = player.videoSize
        if (size.width > 0 && size.height > 0) target.aspect = size.width * size.pixelWidthHeightRatio / size.height
        frame = target
    }

    val usesTexture: Boolean get() = texture

    private fun item(url: String): MediaItem {
        val path = url.substringBefore('?').substringBefore('#').lowercase()
        val progressive = listOf(".mp4", ".m4v", ".webm", ".mkv", ".mov", ".mp3", ".aac").any { path.endsWith(it) }
        val b = MediaItem.Builder().setUri(url)
        if (!progressive) {
            b.setMimeType(MimeTypes.APPLICATION_M3U8)
            // ao vivo uns 12 s atrás da ponta (o padrão é 3 pedaços, ~6 s): mais reserva para a rede que oscila, sem
            // cair do começo da lista (o canal do NEXA guarda 30 s); dono, 27/11: "o hls está caindo e voltando"
            b.setLiveConfiguration(MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(12_000).setMinOffsetMs(6_000).setMaxOffsetMs(20_000).build())
        }
        return b.build()
    }

    /**
     * HLS com a legenda CEA-608 do ar (contrato §14). A mestre do canal não declara CLOSED-CAPTIONS e, nesse caso, o Media3
     * monta as faixas só com vídeo, áudio e ID3 (as falas do 608 que chegam no SEI do H.264 são descartadas). A mestre
     * lida passa a declarar o CC1 em português, o mesmo que o hls.js do site e da TV decodifica.
     */
    private class CcPlaylistParserFactory(private val inner: androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory = androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory()) :
        androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory {
        private val cc = androidx.media3.common.Format.Builder().setSampleMimeType(MimeTypes.APPLICATION_CEA608)
            .setAccessibilityChannel(1).setLanguage("pt").build()

        override fun createPlaylistParser() = wrap(inner.createPlaylistParser())

        override fun createPlaylistParser(multivariantPlaylist: androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist, previousMediaPlaylist: androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist?) =
            wrap(inner.createPlaylistParser(multivariantPlaylist, previousMediaPlaylist))

        private fun wrap(p: androidx.media3.exoplayer.upstream.ParsingLoadable.Parser<androidx.media3.exoplayer.hls.playlist.HlsPlaylist>) =
            androidx.media3.exoplayer.upstream.ParsingLoadable.Parser<androidx.media3.exoplayer.hls.playlist.HlsPlaylist> { uri, input -> withCc(p.parse(uri, input)) }

        private fun withCc(pl: androidx.media3.exoplayer.hls.playlist.HlsPlaylist): androidx.media3.exoplayer.hls.playlist.HlsPlaylist =
            if (pl is androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist && pl.muxedCaptionFormats == null) androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist(
                pl.baseUri, pl.tags, pl.variants, pl.videos, pl.audios, pl.subtitles, pl.closedCaptions, pl.muxedAudioFormat,
                listOf(cc), pl.hasIndependentSegments, pl.variableDefinitions, pl.sessionKeyDrmInitData,
            ) else pl
    }

    private val hlsFactory by lazy {
        androidx.media3.exoplayer.hls.HlsMediaSource.Factory(androidx.media3.datasource.DefaultDataSource.Factory(ctx))
            .setPlaylistParserFactory(CcPlaylistParserFactory())
    }

    /** Ao vivo (ou reserva): um endereço só, sem repetir. */
    fun playLive(url: String) {
        liveUrl = url
        player.repeatMode = Player.REPEAT_MODE_OFF
        val it = item(url)
        if (it.localConfiguration?.mimeType == MimeTypes.APPLICATION_M3U8) player.setMediaSource(hlsFactory.createMediaSource(it)) else player.setMediaItem(it)
        player.prepare()
        player.playWhenReady = true
    }

    /** Vídeos guardados, em laço, começando pelo de número `startIndex`. */
    fun playFiles(files: List<File>, startIndex: Int) {
        liveUrl = null
        if (files.isEmpty()) {
            stop()
            return
        }
        player.repeatMode = Player.REPEAT_MODE_ALL
        player.setMediaItems(files.map { MediaItem.fromUri(Uri.fromFile(it)) }, startIndex % files.size, 0L)
        player.prepare()
        player.playWhenReady = true
    }

    fun stop() {
        player.stop()
        player.clearMediaItems()
    }

    fun pause() {
        player.playWhenReady = false
    }

    fun setVolume(percent: Int, muted: Boolean) {
        volume = if (muted) 0f else percent.coerceIn(0, 100) / 100f
        player.volume = if (ducked) volume * DUCK else volume
    }

    /** Baixa o som do canal enquanto a senha é chamada. */
    fun duck(on: Boolean) {
        ducked = on
        player.volume = if (on) volume * DUCK else volume
    }

    /** Um número que muda enquanto o vídeo anda (item da lista + posição). */
    fun position(): Long = player.currentMediaItemIndex * 1_000_000_000_000L + player.currentPosition

    /**
     * Um número que muda enquanto o vídeo anda de verdade: quadros que saíram do decodificador (ou, sem vídeo, blocos
     * de áudio). A posição do player não serve para isso num HLS ao vivo: ela salta quando a janela anda e nas
     * descontinuidades (a cartela de fora do ar tem uma a cada 8 s), e imagem congelada também tem de contar.
     */
    fun progress(): Long {
        val c = player.videoDecoderCounters ?: player.audioDecoderCounters ?: return 0L
        c.ensureUpdated()
        return c.renderedOutputBufferCount.toLong() + c.droppedBufferCount + c.skippedOutputBufferCount
    }

    /** Volta à ponta do ao vivo sem trocar de fonte (atrás da janela, lista parada ou reiniciada). */
    fun resync() {
        player.seekToDefaultPosition()
        player.prepare()
        player.playWhenReady = true
    }

    val currentIndex: Int get() = player.currentMediaItemIndex
    val isPlaying: Boolean get() = player.isPlaying
    val isBuffering: Boolean get() = player.playbackState == Player.STATE_BUFFERING
    val hasMedia: Boolean get() = player.mediaItemCount > 0

    fun release() {
        player.release()
    }
}
