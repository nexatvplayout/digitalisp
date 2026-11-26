package br.com.digitalisp.telas

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.ActionMode
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import br.com.digitalisp.telas.core.Alert
import br.com.digitalisp.telas.core.Alerts
import br.com.digitalisp.telas.core.Brands
import br.com.digitalisp.telas.core.CardRotation
import br.com.digitalisp.telas.core.ClockCheck
import br.com.digitalisp.telas.core.DiagReport
import br.com.digitalisp.telas.core.Missing
import br.com.digitalisp.telas.core.MissingCase
import br.com.digitalisp.telas.core.MissingSchedule
import br.com.digitalisp.telas.core.VideoMode
import br.com.digitalisp.telas.core.ProgressSignal
import br.com.digitalisp.telas.core.QueueCall
import br.com.digitalisp.telas.core.VoicePlan
import br.com.digitalisp.telas.core.QueueCallCard
import br.com.digitalisp.telas.core.QueueColors
import br.com.digitalisp.telas.core.CaptionLook
import br.com.digitalisp.telas.core.CaptionsCfg
import br.com.digitalisp.telas.core.CaptionsPolicy
import br.com.digitalisp.telas.core.LocalCaptions
import br.com.digitalisp.telas.core.RiskColors
import br.com.digitalisp.telas.core.ClockView
import br.com.digitalisp.telas.core.StartupClock
import br.com.digitalisp.telas.core.Insets
import br.com.digitalisp.telas.core.Overscan
import br.com.digitalisp.telas.core.QueueLayout
import br.com.digitalisp.telas.core.QueueReducer
import br.com.digitalisp.telas.core.SpeechText
import br.com.digitalisp.telas.core.CallSound
import br.com.digitalisp.telas.core.CallSoundChoice
import br.com.digitalisp.telas.core.CallSoundMode
import br.com.digitalisp.telas.core.EmergencyCode
import br.com.digitalisp.telas.core.Internal
import br.com.digitalisp.telas.core.ConfigParser
import br.com.digitalisp.telas.core.ErrorKind
import br.com.digitalisp.telas.core.ExitSequence
import br.com.digitalisp.telas.core.FallbackImages
import br.com.digitalisp.telas.core.VideoArea
import br.com.digitalisp.telas.core.Layout
import br.com.digitalisp.telas.core.Schedule
import br.com.digitalisp.telas.core.Signage
import br.com.digitalisp.telas.core.SignageBlock
import br.com.digitalisp.telas.core.minutesUntilOn
import br.com.digitalisp.telas.core.Source
import br.com.digitalisp.telas.core.TelaConfig
import br.com.digitalisp.telas.core.Urls
import br.com.digitalisp.telas.core.Watchdog
import br.com.digitalisp.telas.core.WdAction
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * A tela única do app: o vídeo, a composição (faixa, coluna lateral), o alerta em tela cheia e, por cima, as telas
 * de configuração/PIN/ajustes. É também a tela inicial (HOME) do aparelho.
 */
class MainActivity : Activity(), Engine.Ui {
    companion object {
        /** A tela está na frente? (O serviço e o alarme usam para decidir se reabrem o app.) */
        @Volatile var visible = false
        private const val IDLE_MS = 90_000L
        private const val MAINTENANCE_MS = 10 * 60_000L
        private const val SHOT_MAX_BYTES = br.com.digitalisp.telas.core.Jpeg.MAX_BYTES
        private const val ERROR_DELAY_MS = 3000L
        /** Caixas das senhas (15/11): o fundo e a borda, e quantas "em atendimento" cabem na fileira do painel. */
        private const val BOX_PANEL = 0xFF10294D.toInt()
        private const val BOX_LINE = 0xFF2A4A78.toInt()
        private const val SERVING_ROW = 3
    }

    private val handler = Handler(Looper.getMainLooper())
    private val ptBr = Locale("pt", "BR")
    private val hourFmt = SimpleDateFormat("HH:mm", ptBr)
    private val dateFmt = SimpleDateFormat("EEEE, d 'de' MMMM", ptBr)

    private lateinit var root: FrameLayout
    private lateinit var stage: FrameLayout
    private lateinit var compHost: FrameLayout
    private lateinit var blackout: View
    private lateinit var status: TextView
    private lateinit var alertBox: LinearLayout
    private lateinit var alertLevel: TextView
    private lateinit var alertTitle: TextView
    private lateinit var alertText: TextView
    private lateinit var screenHost: FrameLayout
    private lateinit var player: PlayerHost

    private val wd = Watchdog()
    private val signal = ProgressSignal()
    private var loggedByPosition = false
    private var exitSeq = ExitSequence(ConfigParser.DEFAULT_SEQ)
    private var screen: Screen? = null
    private var lastKeyAt = 0L

    private var cfg: TelaConfig? = null
    private var wasConfigured = false
    private var streamKey = ""
    private var compKey = ""
    private var playing = false
    private var errorPending = false
    private var scheduleOn = true
    private var generation = 0
    private var offlineIndex = 0
    private var shownAlert: Alert? = null
    private var notPlayingSince = 0L
    private var kioskIssues: List<String> = emptyList()

    private var ticker: TickerView? = null
    private var clockView: TextView? = null
    private var dateView: TextView? = null
    private var recentView: TextView? = null

    private var weatherView: View? = null
    private var cardTitle: TextView? = null
    private var cardLines: TextView? = null
    private var shownCard = -2
    private var compBuiltAt = 0L

    /** As vistas da senha em uso (painel grande ou o widget da coluna). */
    private class QueueViews(
        val box: View, val label: TextView, val ticket: TextView, val desk: TextView, val name: TextView,
        val lastBox: LinearLayout?, val waitBox: LinearLayout?,
        val ticketPx: Float, val boxW: Int, val unit: Float, val idleBg: Int,
        /** Título da lista do painel ("EM ATENDIMENTO" ou, com servidor antigo, "ÚLTIMAS CHAMADAS"). */
        val listTitle: TextView? = null,
        /** Coluna lateral: a lista em miniatura (até 3 anteriores) e só a contagem de quem está em atendimento. */
        val servingOnly: Boolean = false,
        /** Painel: a fileira das senhas em atendimento, em caixas (15/11). */
        val servingBox: LinearLayout? = null,
    )
    private var queueViews: QueueViews? = null
    /** O painel de senha do §15 em uso (QueueLayouts.kt); null nos outros layouts. */
    private var board: QueueBoard? = null
    private var queueHighlight: Boolean? = null

    /** Cartão da chamada por cima do vídeo, nos layouts sem painel de senha (QueueCallCard). */
    private lateinit var callCard: FrameLayout
    private lateinit var callBox: LinearLayout
    private lateinit var callLabel: TextView
    private lateinit var callTicket: TextView
    private lateinit var callName: TextView
    private lateinit var callDesk: TextView
    private var callTicketPx = 0f
    private var callInnerW = 0
    private var callCardOn = false
    private var captionView: TextView? = null

    /** As falas da legenda, numa caixa escura translúcida só (como na TV Samsung e na web; core/CaptionLook). */
    private fun showCues(text: String) {
        val v = captionView ?: return
        if (text.isEmpty()) {
            v.text = ""
            v.visibility = View.GONE
            return
        }
        v.text = text
        v.visibility = View.VISIBLE
    }

    /** Legendas: o que o painel manda e, até a próxima mudança dele, a escolha feita aqui no aparelho. */
    private fun captionsNow(): CaptionsCfg {
        val panel = cfg?.captions ?: CaptionsCfg()
        val local = CaptionsPolicy.decode(Engine.store.captionsLocal)
        if (CaptionsPolicy.stale(panel, local)) Engine.store.captionsLocal = ""
        return CaptionsPolicy.effective(panel, local)
    }

    fun applyCaptions() {
        val c = captionsNow()
        player.setCaptions(c.on, c.lang)
    }

    /** Ajustes: liga/desliga ou troca o idioma neste aparelho (vale até a próxima mudança do painel). */
    fun setLocalCaptions(on: Boolean, lang: String?) {
        Engine.store.captionsLocal = CaptionsPolicy.encode(LocalCaptions(on, lang, cfg?.captions ?: CaptionsCfg()))
        applyCaptions()
    }

    fun captionsState(): CaptionsCfg = captionsNow()

    fun captionLanguages(): List<String?> = player.textLanguages()

    fun captionsSummary(): String {
        val c = captionsNow()
        val panel = cfg?.captions ?: CaptionsCfg()
        val from = if (c == panel) "pelo painel" else "escolhida neste aparelho, até a próxima mudança do painel"
        val langs = captionLanguages().map { CaptionsPolicy.name(it) }.distinct()
        return (if (c.on) "ligadas, idioma ${CaptionsPolicy.name(c.lang)}" else "desligadas") + " ($from)" +
            if (langs.isEmpty()) "; o fluxo não traz legenda agora" else "; no fluxo: ${langs.joinToString(", ")}"
    }
    private var callLabelPx = 0f
    private var lastWall = 0L
    private var lastMono = 0L
    private var lastClockRetry = 0L
    private val clockReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = onClockChanged()
    }

    /** O relógio do aparelho mudou: servidor, senha e vídeo tentam de novo na hora. */
    private fun onClockChanged() {
        Engine.onClockChanged()
        if (cfg != null && scheduleOn && !player.isPlaying) startPlayback()
        (screen as? SetupScreen)?.refreshClock()
    }
    /** Margem de segurança (overscan) da composição atual. */
    private var insets = Insets(0, 0, 0, 0)
    private var overscanGuide: View? = null
    private lateinit var speaker: Speaker
    private lateinit var clips: VoiceClips
    private var chimeId = 0

    private var soundPool: SoundPool? = null
    private var soundId = 0

    private lateinit var alertIcon: AlertIcon
    private lateinit var alertHead: LinearLayout
    private lateinit var alertStamp: TestStamp
    // código de emergência hospitalar (tela interna, contrato §17.2): por cima de tudo, na cor do código
    private lateinit var codeBox: LinearLayout
    private lateinit var codeLabel: TextView
    private lateinit var codeMeaning: TextView
    private lateinit var codePlace: TextView
    private lateinit var codeMore: TextView
    private var shownCode: EmergencyCode? = null
    private var codeStream = 0
    private var codeAlarmToken = 0
    private lateinit var missingFull: MissingFullView
    private lateinit var missingBanner: MissingBannerView
    private val missingBitmaps = HashMap<String, Bitmap>()
    private var missingGen = 0

    /** Imagem de fora do ar (offline.image) na área do vídeo, quando nada toca; o arquivo e o bitmap já lido dele. */
    private var fallbackView: ImageView? = null
    private var fallbackBmp: Bitmap? = null
    private var fallbackPath: String? = null
    private var fallbackGen = 0

    /** Marca da revenda (white-label, docs/CONTRATO-APP-MARCA.md): a logo já lida e a abertura por cima de tudo. */
    private var brandBmp: Bitmap? = null
    private var brandPath: String? = null
    private var brandGen = 0
    private lateinit var splash: FrameLayout
    private lateinit var splashLogo: ImageView
    private val openedAt = SystemClock.uptimeMillis()

    /** TV Corporativa (docs/TV-CORPORATIVA.md §4): a composição por zonas em uso e o bloco dela; null = o layout de sempre. */
    private var signage: SignageBuilt? = null
    private var signBlock: SignageBlock? = null
    /** Bloco sem zona de vídeo: o som do canal fica mudo (o player continua o mesmo). */
    private var signMuted = false

    /** DIGITAL ISP: o vídeo ao vivo do YouTube na zona de vídeo (a página do servidor numa WebView, por cima do player). */
    private var ytView: android.webkit.WebView? = null

    // ------------------------------------------------------------------ ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Engine.init(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
        }
        volumeControlStream = AudioManager.STREAM_MUSIC
        // relógio acertado pela rede ou à mão: tentar de novo na hora (TV box liga com a data errada)
        registerReceiver(clockReceiver, android.content.IntentFilter().apply {
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        })
        buildViews()
        setContentView(root)
        player = PlayerHost(
            this,
            VideoMode.of(Engine.store.videoMode),
            { mode, auto ->
                Engine.store.videoMode = mode.wire
                if (auto) Engine.noteError("O decodificador de vídeo falhou de novo; o vídeo passou para: ${mode.label}.")
            },
        ) { kind, code -> onPlayerError(kind, code) }
        player.onCues = { text -> showCues(text) }
        loadSound()
        speaker = Speaker(this)
        clips = VoiceClips(this)
        maxSystemVolume()

        kioskIssues = Kiosk.apply(this)
        Launcher.startService(this)
        Alarms.scheduleWatchdog(this)

        Engine.ui = this
        root.addOnLayoutChangeListener { _, l, t, r, b, oldL, oldT, oldR, oldB ->
            if (r - l != oldR - oldL || b - t != oldB - oldT) root.post { buildComposition() }
        }
        applyConfig()
        loadMissingPhotos()
        loadBrandLogo()
        handler.postDelayed(tick, 1000)
    }

    override fun onStart() {
        super.onStart()
        if (cfg != null && !playing && scheduleOn) startPlayback()
    }

    override fun onResume() {
        super.onResume()
        visible = true
        hideSystemUi()
        Engine.store.maintenanceUntil = 0L
        Kiosk.enterLockTask(this)
        Launcher.startService(this)
    }

    override fun onPause() {
        visible = false
        super.onPause()
    }

    override fun onStop() {
        // fora da frente (técnico nas configurações do Android): não deixar som tocando por trás
        stopPlayback()
        super.onStop()
    }

    override fun onDestroy() {
        try { unregisterReceiver(clockReceiver) } catch (_: Exception) { }
        handler.removeCallbacksAndMessages(null)
        if (Engine.ui === this) Engine.ui = null
        player.release()
        stopRadio()
        soundPool?.release()
        speaker.shutdown()
        clips.stop()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    private fun hideSystemUi() {
        // As marcas antigas de tela cheia continuam valendo no Android 11 e seguintes, e TV box com Android 11 de
        // fabricante nem sempre obedece só ao controle novo (WindowInsetsController): o app pede dos dois jeitos.
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                window.insetsController?.let {
                    it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    it.hide(WindowInsets.Type.systemBars())
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun maxSystemVolume() {
        // As teclas de volume ficam bloqueadas; o volume do canal vem da configuração (stream.volume).
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0)
        } catch (_: Exception) {
        }
    }

    private fun loadSound() {
        try {
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            soundPool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build().also {
                soundId = it.load(this, R.raw.alerta, 1)
                chimeId = it.load(this, R.raw.chamada, 1)
            }
        } catch (_: Exception) {
        }
    }

    // ------------------------------------------------------------------ montagem das telas

    private fun match() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    private fun buildViews() {
        // Sem fundo nos contêineres do vídeo: o preto vem da janela (a captura da tela conta com isso).
        root = FrameLayout(this)
        stage = FrameLayout(this)
        compHost = FrameLayout(this)
        blackout = View(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }
        status = TextView(this).apply {
            setTextColor(0xCCFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setShadowLayer(4f, 0f, 1f, Color.BLACK)
            val p = Ui.dp(this@MainActivity, 16f)
            setPadding(p, p, p, p)
            visibility = View.GONE
        }
        alertLevel = TextView(this).apply {
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            letterSpacing = 0.12f
        }
        alertTitle = TextView(this).apply {
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        alertText = TextView(this).apply { gravity = Gravity.CENTER }
        alertBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            isClickable = true
            // linha de cima: o ícone da categoria (se houver) e o cabeçalho
            alertIcon = AlertIcon(this@MainActivity).apply { visibility = View.GONE }
            alertHead = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                addView(alertIcon, LinearLayout.LayoutParams(1, 1))
                addView(alertLevel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            }
            addView(alertHead, Ui.lp())
            addView(alertTitle, Ui.lp())
            addView(alertText, Ui.lp())
        }
        alertStamp = TestStamp(this).apply { visibility = View.GONE }
        screenHost = FrameLayout(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // com o teclado na tela, deixar os campos acima dele
            screenHost.setOnApplyWindowInsetsListener { v, insets ->
                v.setPadding(0, 0, 0, insets.getInsets(WindowInsets.Type.ime()).bottom)
                insets
            }
        }
        stage.addView(compHost, match())
        stage.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START))
        stage.addView(blackout, match())
        // chamada de senha nos layouts sem painel: acima do vídeo e da faixa, abaixo dos desaparecidos e do alerta
        buildCallCard()
        stage.addView(callCard, match())
        // pessoas desaparecidas: acima do layout e abaixo do alerta (alerta em tela cheia > desaparecido > o resto)
        missingFull = MissingFullView(this).apply { visibility = View.GONE }
        missingBanner = MissingBannerView(this).apply { visibility = View.GONE }
        stage.addView(missingBanner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1, Gravity.BOTTOM))
        stage.addView(missingFull, match())
        stage.addView(alertBox, match())
        stage.addView(alertStamp, match())
        // o código de emergência fica acima do alerta (só existe na tela interna; a pública nunca recebe código)
        codeLabel = TextView(this).apply { typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER; letterSpacing = 0.06f }
        codeMeaning = TextView(this).apply { typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER }
        codePlace = TextView(this).apply { typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER }
        codeMore = TextView(this).apply { gravity = Gravity.CENTER }
        codeBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            isClickable = true
            addView(codeLabel, Ui.lp())
            addView(codeMeaning, Ui.lp())
            addView(codePlace, Ui.lp())
            addView(codeMore, Ui.lp())
        }
        stage.addView(codeBox, match())
        stage.addView(screenHost, match())
        root.addView(stage, match())
        // abertura: a logo da revenda sobre a cor dela (sem marca: preto com um ícone neutro), por cima de tudo
        splashLogo = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER; isFocusable = false }
        splash = FrameLayout(this).apply {
            isClickable = true
            addView(splashLogo, match())
        }
        root.addView(splash, match())
        paintSplash()
    }

    private val DIGITAL_ISP_BG = 0xFF0A2150.toInt()

    /** Pinta a abertura com a marca guardada; sem logo pronta, o nome da revenda não entra (a tela fica só na cor). */
    private fun paintSplash() {
        val b = Engine.brand
        splash.setBackgroundColor(b?.background ?: DIGITAL_ISP_BG)
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels
        val bmp = brandBmp
        if (bmp != null) {
            splashLogo.setImageBitmap(bmp)
            splashLogo.setPadding(w / 4, h * 3 / 10, w / 4, h * 3 / 10)
        } else if (b == null) {
            // sem revenda (antes do cadastro): o logo DIGITAL ISP (decisão do dono, 23/11/2026)
            splashLogo.setImageResource(R.drawable.banner)
            splashLogo.setPadding(w / 5, h / 5, w / 5, h / 5)
        } else {
            splashLogo.setImageDrawable(null)
        }
    }

    private fun refreshSplash(now: Long) {
        val content = cfg != null && scheduleOn && (player.isPlaying || signBlock?.layout?.hasVideo == false)
        val show = Brands.splashVisible(now - openedAt, Engine.configured, content)
        val v = if (show) View.VISIBLE else View.GONE
        if (splash.visibility != v) splash.visibility = v
    }

    /** Lê (fora da thread principal) a logo guardada da revenda, se mudou. */
    private fun loadBrandLogo() {
        val f = Engine.brandLogoFile()
        val path = f?.path
        if (path == brandPath) {
            paintSplash()
            paintFallback()
            return
        }
        brandPath = path
        val gen = ++brandGen
        if (f == null) {
            brandBmp = null
            paintSplash()
            paintFallback()
            return
        }
        val dm = resources.displayMetrics
        val max = maxOf(dm.widthPixels, dm.heightPixels, 1280) / 2
        Thread({
            val bmp = ImageArt.decode(f, max, max, alpha = true)
            handler.post {
                if (gen == brandGen) {
                    brandBmp = bmp
                    paintSplash()
                    paintFallback()
                    (screen as? BrandedScreen)?.onBrandChanged()
                }
            }
        }, "telas-marca-tela").start()
    }

    /** A logo da revenda para as telas de cadastro (null = ainda não baixou ou não há). */
    fun brandLogo(): Bitmap? = brandBmp

    override fun onBrandChanged() {
        loadBrandLogo()
        (screen as? BrandedScreen)?.onBrandChanged()
    }

    /**
     * A imagem da área do vídeo quando nada toca: a do cliente (`offline.image`), cobrindo a área; sem ela, a logo da
     * revenda no meio, sobre a cor de fundo dela; sem as duas, preto.
     */
    private fun paintFallback() {
        val v = fallbackView ?: return
        val img = fallbackBmp
        val logo = brandBmp
        when {
            img != null -> {
                v.scaleType = ImageView.ScaleType.CENTER_CROP
                v.setPadding(0, 0, 0, 0)
                v.setBackgroundColor(Color.BLACK)
                v.setImageBitmap(img)
            }
            logo != null -> {
                v.scaleType = ImageView.ScaleType.FIT_CENTER
                v.setBackgroundColor(Engine.brand?.background ?: Color.BLACK)
                v.setImageBitmap(logo)
                v.post { v.setPadding(v.width / 4, v.height * 3 / 10, v.width / 4, v.height * 3 / 10) }
            }
            else -> {
                v.setBackgroundColor(Color.BLACK)
                v.setImageBitmap(null)
            }
        }
    }

    /** Monta (ou remonta) a composição conforme o layout e o tamanho/posição da tela. */
    private fun buildComposition() {
        val w = root.width
        val h = root.height
        if (w == 0 || h == 0) {
            root.post { if (root.width > 0) buildComposition() }
            return
        }
        val c = cfg
        val layout = c?.effectiveLayout ?: Layout.FULL
        val displayPortrait = h > w
        // TV Corporativa: o bloco de agora (sem `signage`, null e nada muda)
        val block = pickBlock(c)
        // TV em pé com a saída do aparelho deitada: gira a composição inteira
        val rotate = (if (block != null) block.layout.portrait else layout == Layout.PORTRAIT) && !displayPortrait
        val angle = if (rotate) Engine.store.rotation else 0
        val key = listOf(w, h, layout, angle, c?.ticker, c?.side, c?.weather, c?.cards, c?.queue, Engine.store.overscanPct, c?.layoutRaw, c?.theme, c?.stream?.youtube).joinToString("|") +
            (if (block != null) "|signage:" + System.identityHashCode(block) else "")
        if (key == compKey) return
        compKey = key

        val sw = if (rotate) h else w
        val sh = if (rotate) w else h
        stage.layoutParams = FrameLayout.LayoutParams(sw, sh, Gravity.CENTER)
        stage.rotation = angle.toFloat()
        val portraitStage = sh > sw
        // §15: qual painel de senha desenhar (em pé, o "queue" de sempre)
        val qStyle = if (c != null && layout == Layout.QUEUE) QueueLayout.forScreen(c, portraitStage) else QueueLayout.CLASSIC
        // margem de segurança (overscan): o vídeo vai até a borda; texto fica dentro dela
        val ins = Overscan.insets(sw, sh, Engine.store.overscanPct)
        insets = ins

        compHost.removeAllViews()
        ytView?.let { try { it.destroy() } catch (_: Throwable) { } }
        ytView = null
        ticker = null
        clockView = null
        dateView = null
        recentView = null
        weatherView = null
        cardTitle = null
        cardLines = null
        queueViews = null
        board = null
        shownCard = -2
        queueHighlight = null
        signage = null
        signBlock = block
        compBuiltAt = SystemClock.uptimeMillis()
        val frame = VideoFrame(this)
        val wantTicker = c?.showsTicker == true
        val wantSide = c?.showsSide == true

        // Faixa do desaparecido: embaixo, por cima do vídeo e no lugar do texto rolante. No painel de senha deitado ela
        // fica só na coluna da direita (embaixo do canal), para nunca cobrir o painel.
        val queueWide = c != null && layout == Layout.QUEUE && !portraitStage && qStyle == QueueLayout.CLASSIC
        val bannerLeft = if (queueWide) (sw * 0.68f).toInt() else 0
        missingBanner.screenHeight = sh
        missingBanner.layoutParams = FrameLayout.LayoutParams(sw - bannerLeft, (minOf(sw, sh) * (if (queueWide) 0.2f else 0.17f)).toInt() + ins.bottom, Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = bannerLeft
        }
        missingBanner.setPadding(if (bannerLeft == 0) ins.left else 0, 0, ins.right, ins.bottom)
        missingFull.setPadding(ins.left, ins.top, ins.right, ins.bottom)
        status.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = ins.left
            // acima da faixa de avisos (antes a frase ficava por cima do texto rolante)
            bottomMargin = ins.bottom + if (c?.showsTicker == true && layout != Layout.FULL) (sh * (if (portraitStage) 0.05f else 0.09f)).toInt() else 0
        }

        if (c != null && block != null) {
            // TV Corporativa: zonas por porcentagem; a zona `video` recebe esta mesma moldura (SignageLayout.kt)
            val s = SignageLayout.build(this, c.signage!!, block, sw, sh, ins, frame, signEnv(c), signHooks(c))
            signage = s
            compHost.addView(s.root, match())
        } else if (c == null || layout == Layout.FULL || (layout != Layout.QUEUE && !wantTicker && !wantSide)) {
            compHost.addView(frame, match())
        } else if (layout == Layout.QUEUE && qStyle != QueueLayout.CLASSIC) {
            // §15: os painéis de senha novos (QueueLayouts.kt)
            val b = QueueBoards.build(this, qStyle, c, sw, sh, ins, frame) { buildTicker(c) }
            board = b
            compHost.addView(b.root, match())
            clockView = b.clock
            dateView = b.date
        } else if (layout == Layout.QUEUE) {
            // painel de senha grande, com o canal pequeno no canto
            if (!portraitStage) {
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                val panelW = (sw * 0.68f).toInt()
                val sideW = sw - panelW
                // 1.2.4: o canal pequeno também dentro da área segura (a coluna escura vai até a borda)
                val videoH = (sideW - ins.right) * 9 / 16
                row.addView(buildQueuePanel(c, panelW, sh, Insets(ins.left, ins.top, 0, ins.bottom)), LinearLayout.LayoutParams(panelW, ViewGroup.LayoutParams.MATCH_PARENT))
                val right = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(0xFF0B1E3A.toInt())
                    setPadding(0, ins.top, ins.right, 0)
                }
                right.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, videoH))
                right.addView(buildSide(c, sideW - ins.right, sh - ins.top - videoH, withQueue = false, withCards = false, edge = Insets(0, 0, 0, ins.bottom)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                row.addView(right, LinearLayout.LayoutParams(sideW, ViewGroup.LayoutParams.MATCH_PARENT))
                compHost.addView(row, match())
            } else {
                val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                val videoH = (sw * 9f / 16f * 0.6f).toInt()
                col.addView(buildQueuePanel(c, sw, sh - videoH, Insets(ins.left, ins.top, ins.right, 0)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                col.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, videoH))
                compHost.addView(col, match())
            }
        } else if (!portraitStage) {
            // `side`: vídeo + coluna; `ticker`: vídeo + faixa; `lbar` (em L): vídeo e coluna em cima, e a faixa embaixo
            // ocupando a largura toda (por baixo do vídeo e da coluna)
            val tickerH = if (wantTicker) (sh * 0.09f).toInt() + ins.bottom else 0
            val top: View = if (wantSide) {
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                // coluna mais estreita (1.2.2, pedido do dono): o vídeo maior; a margem do overscan entra por dentro dela
                val sideW = (sw * 0.22f).toInt() + ins.right
                row.addView(frame, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
                row.addView(buildSide(c, sideW, sh - tickerH, withQueue = true, withCards = true, edge = Insets(0, ins.top, ins.right, if (wantTicker) 0 else ins.bottom)), LinearLayout.LayoutParams(sideW, ViewGroup.LayoutParams.MATCH_PARENT))
                row
            } else {
                frame
            }
            if (wantTicker) {
                val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                col.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                col.addView(buildTicker(c, ins), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, tickerH))
                compHost.addView(col, match())
            } else {
                compHost.addView(top, match())
            }
        } else {
            // tela em pé: vídeo em cima, coluna (relógio, clima, senha, QR, cartões) no meio, faixa embaixo
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            val videoH = (sw * 9f / 16f).toInt()
            val tickerH = if (wantTicker) (sh * 0.05f).toInt() + ins.bottom else 0
            if (wantSide) {
                col.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, videoH))
                col.addView(buildSide(c, sw, sh - videoH - tickerH, withQueue = true, withCards = true, edge = Insets(ins.left, 0, ins.right, if (wantTicker) 0 else ins.bottom)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            } else {
                col.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            }
            if (wantTicker) col.addView(buildTicker(c, ins), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, tickerH))
            compHost.addView(col, match())
        }
        player.attach(frame, useTexture = rotate || frame.forceTexture)
        val mute = block != null && !block.layout.hasVideo
        if (c != null && mute != signMuted) {
            signMuted = mute
            player.setVolume(c.stream.volume, c.stream.muted || mute)
        }
        updateRadio()
        // imagem de fora do ar: por cima do vídeo, na mesma área, cobrindo sem distorcer; só aparece quando nada toca
        fallbackView = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.BLACK)
            isFocusable = false
            visibility = View.GONE
        }
        frame.addView(fallbackView)
        paintFallback()
        // só no layout com zona de vídeo: no layout sem ela (o da rádio, o só de avisos) a moldura fica escondida e o som
        // do YouTube tocaria por baixo (dono, 26/11)
        if (!mute) c?.stream?.youtube?.let { page -> buildYoutube(frame, page, c) }
        // legenda (contrato §14): dentro da área do vídeo, por cima dele e longe das bordas (margem do overscan); a faixa
        // de avisos e o cartão da chamada ficam fora da moldura do vídeo ou por cima, então ela nunca os cobre
        // 1.2.6 (dono, 15/11): igual à legenda da TV Samsung e da web (core/CaptionLook): uma caixa escura translúcida
        // de cantos arredondados, texto branco médio, a 72 px (em 1080) da base do vídeo; medidas pela área do vídeo
        val capBox = GradientDrawable().apply { setColor(CaptionLook.BOX_COLOR) }
        val capText = TextView(this).apply {
            setTextColor(CaptionLook.TEXT_COLOR)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER_HORIZONTAL
            background = capBox
            includeFontPadding = false
            isFocusable = false
            visibility = View.GONE
        }
        val capHost = object : FrameLayout(this) {
            override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
                super.onSizeChanged(w, h, oldw, oldh)
                post { styleCaption(w, h) }
            }

            private fun styleCaption(w: Int, h: Int) {
                val b = CaptionLook.box(w, h)
                capText.setTextSize(TypedValue.COMPLEX_UNIT_PX, b.textPx)
                capText.setLineSpacing(b.lineExtraPx, 1f)
                capText.setPadding(b.padH, b.padV, b.padH, b.padV)
                capText.setShadowLayer(b.shadowRadiusPx, 0f, b.shadowDyPx, CaptionLook.SHADOW_COLOR)
                capText.maxWidth = minOf(b.maxWidthPx, w - ins.left - ins.right)
                capBox.cornerRadius = b.radiusPx
                capText.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
                    // longe das bordas: a margem do overscan entra por baixo dos 72 px
                    bottomMargin = b.bottomPx + ins.bottom
                }
            }
        }.apply { isFocusable = false }
        capHost.addView(capText, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
        captionView = capText
        frame.addView(capHost)

        // tamanhos do alerta em tela cheia, proporcionais à tela
        val base = minOf(sw, sh).toFloat()
        alertLevel.setTextSize(TypedValue.COMPLEX_UNIT_PX, base * 0.05f)
        alertTitle.setTextSize(TypedValue.COMPLEX_UNIT_PX, base * 0.10f)
        alertText.setTextSize(TypedValue.COMPLEX_UNIT_PX, base * 0.06f)
        alertIcon.layoutParams = LinearLayout.LayoutParams((base * 0.09f).toInt(), (base * 0.09f).toInt()).apply { rightMargin = (base * 0.025f).toInt() }
        val pad = (base * 0.07f).toInt()
        alertBox.setPadding(pad + ins.left, pad + ins.top, pad + ins.right, pad + ins.bottom)
        // cartão da chamada: a tela inteira amarela; o texto no centro, dentro da margem, sem encostar na faixa do
        // desaparecido (que fica por cima, embaixo)
        val cardPad = (base * 0.04f).toInt()
        callCard.setPadding(ins.left + cardPad, ins.top + cardPad, ins.right + cardPad, ins.bottom + cardPad)
        val cardW = sw - ins.left - ins.right - 2 * cardPad
        // (sem margem embaixo: no FrameLayout a margem desloca o centro e empurrava o rótulo para fora da tela)
        callBox.layoutParams = FrameLayout.LayoutParams(cardW, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        callInnerW = cardW
        callTicketPx = base * 0.32f
        callLabelPx = base * 0.06f
        callLabel.setTextSize(TypedValue.COMPLEX_UNIT_PX, callLabelPx)
        callName.setTextSize(TypedValue.COMPLEX_UNIT_PX, base * 0.085f)
        callDesk.setTextSize(TypedValue.COMPLEX_UNIT_PX, base * 0.10f)
        refreshClock()
        refreshQueue()
        refreshCallCard()
        refreshCard()
        refreshMissing()
    }

    // ------------------------------------------------------------------ TV Corporativa

    private fun pickBlock(c: TelaConfig?): SignageBlock? = Signage.pick(c?.signage, Engine.trustedNow(), Engine.clockOk())

    private fun signEnv(c: TelaConfig): SignEnv {
        val s = c.signage!!
        // conta no relatório de exibição só o que está mesmo na tela (ligada e sem alerta por cima)
        fun counting() = scheduleOn && visible && shownAlert == null
        return SignEnv(
            SignLook.of(s.brand.theme, signBlock?.layout?.background), s.tz,
            now = { Engine.now() }, clockOk = { Engine.clockOk() }, weather = { Engine.weather() },
            file = { Engine.signageFile(it) },
            onShown = { ref -> if (counting()) Engine.plays.shown(Engine.playsDay(), ref) },
            onTime = { ref, ms -> if (counting()) Engine.plays.addTime(Engine.playsDay(), ref, ms) },
            volume = { val s = cfg?.stream; if (s == null || s.muted) 0f else s.volume / 100f },
        )
    }

    private fun signHooks(c: TelaConfig) = object : SignageLayout.Hooks {
        override fun ticker(edge: br.com.digitalisp.telas.core.Insets): View? = if (c.ticker.items.isEmpty()) null else buildTicker(c, edge)
        override fun queue(w: Int, h: Int, edge: br.com.digitalisp.telas.core.Insets): View? =
            if (!c.queue.enabled) null else buildSide(c.copy(side = c.side.copy(widgets = listOf("queue"), title = null)), w, h, withQueue = true, withCards = false, edge = edge)
        override fun qrUrl(): String? = c.side.qrUrl
        override fun weather(): br.com.digitalisp.telas.core.WeatherCfg? = Engine.weather()
    }

    // ------------------------------------------------------------------ rádio de fundo (layout.audio, DIGITAL ISP)

    private var radio: androidx.media3.exoplayer.ExoPlayer? = null
    private var radioUrl = ""
    private var radioGen = 0

    /** Toca a rádio do bloco no ar (sem zona de vídeo), no volume da tela × o da rádio; para quando o bloco muda. */
    /** O som do programa abaixado (90%): na chamada da senha (voz ou bipe) e no código de emergência. */
    private var programDucked = false
    private fun duckProgram(on: Boolean) {
        programDucked = on
        youtubeVolume()
        player.duck(on) // o vídeo do canal
        SignVideo.duckAll(on) // os vídeos da playlist com som
        updateRadio() // a rádio de fundo do layout
    }

    /** A WebView com a página do YouTube, ocupando a moldura do vídeo (16:9). Sem WebView no aparelho, fica o player. */
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun buildYoutube(frame: VideoFrame, page: String, c: TelaConfig) {
        val wv = try {
            android.webkit.WebView(this).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                setBackgroundColor(Color.BLACK)
                isFocusable = false
                isFocusableInTouchMode = false
                webViewClient = object : android.webkit.WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): Boolean = false
                    override fun onPageFinished(view: android.webkit.WebView?, url: String?) { youtubeVolume() }
                }
            }
        } catch (_: Throwable) {
            null
        } ?: return
        val (vol, mudo) = youtubeLevel(c)
        frame.addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        wv.loadUrl(page + (if (page.contains("?")) "&" else "?") + "vol=" + vol + "&mute=" + (if (mudo) 1 else 0))
        ytView = wv
    }

    /** O volume do YouTube: o da tela, 10% na chamada da senha e no alerta; mudo como a tela. */
    private fun youtubeLevel(c: TelaConfig): Pair<Int, Boolean> {
        val vol = if (programDucked) c.stream.volume / 10 else c.stream.volume
        return vol to (c.stream.muted || c.stream.volume == 0)
    }

    private fun youtubeVolume() {
        val wv = ytView ?: return
        val c = cfg ?: return
        val (vol, mudo) = youtubeLevel(c)
        try { wv.evaluateJavascript("window.telasVolume&&telasVolume($vol,$mudo)", null) } catch (_: Throwable) { }
    }

    private fun updateRadio() {
        val c = cfg
        val a = if (c != null && scheduleOn) signBlock?.layout?.audio else null
        val url = a?.url.orEmpty()
        if (url != radioUrl) {
            stopRadio()
            radioUrl = url
            if (url.isNotEmpty()) startRadio(url)
        }
        radio?.volume = (if (c == null || a == null || c.stream.muted) 0f else (c.stream.volume / 100f) * (a.volume / 100f)) * (if (programDucked) 0.1f else 1f)
    }

    private fun startRadio(url: String) {
        val my = ++radioGen
        val p = try {
            androidx.media3.exoplayer.ExoPlayer.Builder(this).build()
        } catch (_: Throwable) {
            return
        }
        radio = p
        val item = androidx.media3.common.MediaItem.Builder().setUri(url).apply {
            if (url.lowercase().contains(".m3u8")) setMimeType(androidx.media3.common.MimeTypes.APPLICATION_M3U8)
        }.build()
        p.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // caiu: tenta de novo em 10 s, enquanto for a mesma rádio
                handler.postDelayed({ if (my == radioGen && radio === p) { p.setMediaItem(item); p.prepare(); p.playWhenReady = true } }, 10_000L)
            }
            override fun onPlaybackStateChanged(state: Int) {
                // stream ao vivo que "terminou" (o servidor fechou): reconecta
                if (state == androidx.media3.common.Player.STATE_ENDED) handler.postDelayed({ if (my == radioGen && radio === p) { p.seekToDefaultPosition(); p.prepare(); p.playWhenReady = true } }, 3_000L)
            }
        })
        p.setMediaItem(item)
        p.prepare()
        p.playWhenReady = true
    }

    private fun stopRadio() {
        radioGen++
        radio?.let { try { it.release() } catch (_: Throwable) { } }
        radio = null
    }

    // ------------------------------------------------------------------ identificar a tela (comando `identify`)

    private var identifyView: View? = null

    /** Por 10 s, por cima de tudo: o nome da tela e, num conjunto, o número grande da posição e o nome do conjunto. */
    override fun identify() {
        identifyView?.let { root.removeView(it) }
        val wall = cfg?.signage?.wall
        val name = cfg?.device?.name?.ifEmpty { null } ?: Engine.store.deviceName.ifEmpty { "Tela" }
        val h = resources.displayMetrics.heightPixels.toFloat()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xE6020617.toInt())
            isClickable = true
            if (wall != null) {
                addView(TextView(this@MainActivity).apply {
                    text = wall.pos.toString()
                    setTextColor(Color.WHITE)
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.45f)
                    includeFontPadding = false
                }, Ui.lp())
            }
            addView(TextView(this@MainActivity).apply {
                text = name
                setTextColor(Color.WHITE)
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.07f)
            }, Ui.lp())
            if (wall != null && wall.name.isNotEmpty()) addView(TextView(this@MainActivity).apply {
                text = wall.name + " · " + wall.cols + " × " + wall.rows
                setTextColor(0xFFCBD5E1.toInt())
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.045f)
            }, Ui.lp())
        }
        root.addView(box, match())
        identifyView = box
        handler.postDelayed({ if (identifyView === box) { root.removeView(box); identifyView = null } }, 10_000L)
    }

    private fun buildCallCard() {
        val dark = QueueColors.DARK
        fun line(bold: Boolean) = TextView(this).apply {
            setTextColor(dark)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }
        callLabel = line(true).apply { text = "SENHA"; letterSpacing = 0.15f; setTextColor(QueueColors.DARK_LABEL) }
        callTicket = line(true).apply { maxLines = 1; includeFontPadding = false }
        callName = line(true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        callDesk = line(true).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }
        callBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(callLabel, Ui.lp())
            addView(callTicket, Ui.lp())
            addView(callDesk, Ui.lp())
            addView(callName, Ui.lp())
        }
        callCard = FrameLayout(this).apply {
            visibility = View.GONE
            setBackgroundColor(QueueColors.HOT_BG)
            isClickable = true
            addView(callBox, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        }
    }

    /**
     * Mostra (ou tira) o cartão da chamada: em tela inteira, em todos os layouts, dentro do horário e nos 10 s do destaque.
     * Chamada nova ou repetida troca o texto e o prazo recomeça (o redutor já põe o novo highlightUntil).
     */
    private fun refreshCallCard() {
        val c = cfg
        val s = Engine.queueState
        val cur = s.current
        val on = cur != null && c != null && QueueCallCard.show(c, s, SystemClock.uptimeMillis(), scheduleOn, signBlock)
        callCardOn = on
        if (!on) {
            callCard.visibility = View.GONE
            return
        }
        val t = QueueCallCard.text(cur!!, c!!.queue.showName)
        // §13: a cor da classificação de risco no fundo e o nível em palavras (não depender só da cor);
        // sem risco, o amarelo; prioritária sem risco, "PREFERENCIAL" em destaque
        val st = RiskColors.style(cur)
        callCard.setBackgroundColor(st.bg)
        for (v in listOf(callTicket, callName, callDesk)) v.setTextColor(st.text)
        callLabel.setTextColor(st.label)
        callLabel.text = st.headline
        val loud = st.headline != "SENHA"
        callLabel.setTextSize(TypedValue.COMPLEX_UNIT_PX, if (loud) callLabelPx * 1.35f else callLabelPx)
        callLabel.letterSpacing = if (loud) 0.06f else 0.15f
        callTicket.text = t.ticket
        val len = maxOf(t.ticket.length, 3)
        callTicket.setTextSize(TypedValue.COMPLEX_UNIT_PX, minOf(callTicketPx, callInnerW / (len * 0.64f)))
        callName.text = t.name.orEmpty()
        callName.visibility = if (t.name != null) View.VISIBLE else View.GONE
        callDesk.text = t.desk
        callDesk.visibility = if (t.desk.isNotEmpty()) View.VISIBLE else View.GONE
        callCard.visibility = View.VISIBLE
        // o cartão é WRAP_CONTENT dentro da tela: se não couber (TV baixa, margem grande), a senha diminui
        fitTicket(callBox, callTicket) { callCardOn }
    }

    // ------------------------------------------------------------------ pessoas desaparecidas (contrato §8)

    /**
     * Decodifica, fora da thread principal e já reduzidas, as fotos conferidas dos casos em vigor; solta as dos casos
     * que saíram da lista. Enquanto a foto não está pronta (ou se não conferiu), o caso aparece com a silhueta.
     */
    private fun loadMissingPhotos() {
        val files = HashMap<String, java.io.File>()
        for (c in Engine.missing) Engine.missingPhotoFile(c)?.let { f -> files[c.photo!!.sha256] = f }
        missingBitmaps.keys.retainAll(files.keys)
        // os QR codes ficam guardados só enquanto o caso está na lista
        MissingArt.retainQr(Engine.missing.mapNotNull { it.qr?.data }.toSet())
        val todo = files.filterKeys { it !in missingBitmaps }
        val gen = ++missingGen
        if (todo.isEmpty()) return
        val dm = resources.displayMetrics
        val max = maxOf(dm.widthPixels, dm.heightPixels, 640) / 2
        Thread({
            val out = HashMap<String, Bitmap>()
            for ((sha, f) in todo) MissingArt.decode(f, max, max)?.let { out[sha] = it }
            handler.post {
                if (gen == missingGen) {
                    missingBitmaps.putAll(out)
                    refreshMissing()
                }
            }
        }, "telas-fotos-tela").start()
    }

    override fun onMissingChanged() {
        loadMissingPhotos()
        refreshMissing() // caso que saiu da lista some da tela na hora
    }

    override fun onCodesChanged() = refreshCode()

    /**
     * O código de emergência em vigor (só na tela interna): tela cheia na cor do código, texto grande e o som de alerta
     * pelo volume da tela (o volume do aparelho; o "sem som" do vídeo não cala o código). O som repete por até 90 s; a
     * tela fica até alguém encerrar ou o tempo definido no painel acabar.
     */
    private fun refreshCode() {
        val c = if (cfg?.internal != null) Internal.select(Engine.codes, Engine.expiryNow()) else null
        if (c == shownCode) return
        val isNew = c != null && c.id != shownCode?.id
        shownCode = c
        if (c == null) {
            codeBox.visibility = View.GONE
            stopCodeAlarm()
            return
        }
        val h = resources.displayMetrics.heightPixels.toFloat().coerceAtLeast(480f)
        codeBox.setBackgroundColor(c.color)
        for (v in listOf(codeLabel, codeMeaning, codePlace, codeMore)) v.setTextColor(c.textColor)
        codeLabel.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.13f)
        codeMeaning.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.065f)
        codePlace.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.09f)
        codeMore.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.04f)
        codeLabel.text = c.label.uppercase(Locale("pt", "BR"))
        codeMeaning.text = c.meaning
        codeMeaning.visibility = if (c.meaning.isEmpty()) View.GONE else View.VISIBLE
        codePlace.text = c.place
        codePlace.visibility = if (c.place.isEmpty()) View.GONE else View.VISIBLE
        val others = Internal.active(Engine.codes, Engine.expiryNow()).filter { it.id != c.id }
        codeMore.text = (if (c.firedAt > 0) "Disparado às " + hourFmt.format(Date(c.firedAt)) else "") +
            (if (others.isNotEmpty()) "\nE mais: " + others.joinToString(" · ") { listOf(it.label, it.place).filter { s -> s.isNotEmpty() }.joinToString(", ") } else "")
        codeBox.visibility = View.VISIBLE
        if (isNew) startCodeAlarm()
    }

    private fun startCodeAlarm() {
        stopCodeAlarm()
        try {
            codeStream = soundPool?.play(soundId, 1f, 1f, 3, -1, 1f) ?: 0
        } catch (_: Exception) {
        }
        duckProgram(true)
        val token = ++codeAlarmToken
        handler.postDelayed({ if (token == codeAlarmToken) stopCodeAlarm() }, 90_000L)
    }

    private fun stopCodeAlarm() {
        codeAlarmToken++
        if (codeStream != 0) try { soundPool?.stop(codeStream) } catch (_: Exception) { }
        codeStream = 0
        duckProgram(false)
    }

    /** O som da chamada que vale agora e de onde veio (painel > aparelho > bipe + falada). */
    fun callSound(): CallSoundChoice = CallSound.resolve(cfg?.callSound, CallSoundMode.of(Engine.store.callSoundLocal), cfg?.queue?.voice == true)

    /** Ajustes → "Som da chamada": bipe → falada → bipe + falada (vale se o painel não definir). */
    fun cycleCallSound() {
        val cur = CallSoundMode.of(Engine.store.callSoundLocal) ?: CallSoundMode.BOTH
        val next = CallSoundMode.values()[(cur.ordinal + 1) % CallSoundMode.values().size]
        Engine.store.callSoundLocal = next.key
    }

    /** Para o diagnóstico: o que vale, de onde veio e se a voz existe. */
    fun callSoundSummary(): String {
        val s = callSound()
        val v = VoiceClips.key(Engine.store.callVoice)
        val voiceNote = when {
            !s.mode.voice -> ""
            v == "android" && !speaker.ready -> " · voz do Android escolhida, mas o aparelho não tem voz em português: fala com a voz Coral"
            v == "android" -> " · voz do Android"
            !clips.ready -> " · a voz própria não carregou: " + (if (speaker.ready) "fala com a voz do Android" else "toca só o bipe")
            else -> " · voz ${VoiceClips.label(v)} (do app, gerada por IA)"
        }
        return "${s.mode.label} · volume da fala ${s.volume}% · vale o do ${s.source}$voiceNote"
    }

    fun internalSummary(): String {
        val i = cfg?.internal ?: return "não (tela pública)"
        val n = Internal.active(Engine.codes, Engine.expiryNow()).size
        return "sim" + (i.sector?.let { " · setor $it" } ?: "") + " · ${i.notices.size} aviso(s) · " + (if (n > 0) "$n código(s) em vigor" else "nenhum código") + " · tempo real: " + InternalLink.status
    }

    /** Os casos que valem agora: sem hora confiável no aparelho, continuam os guardados (só some o que com certeza venceu). */
    private fun activeMissing(): List<MissingCase> {
        val all = Engine.missing
        if (all.isEmpty()) return all
        return Missing.active(all, Engine.expiryNow())
    }

    /** Segundos desde a meia-noite no relógio do aparelho (sem correção): o ritmo é o mesmo em todas as telas do prédio. */
    private fun localSecOfDay(): Int {
        val cal = Calendar.getInstance()
        return cal.get(Calendar.HOUR_OF_DAY) * 3600 + cal.get(Calendar.MINUTE) * 60 + cal.get(Calendar.SECOND)
    }

    private fun refreshMissing() {
        val c = cfg
        // fora do horário a tela está apagada; com alerta em tela cheia no ar, os desaparecidos esperam
        val showing = if (c == null || !scheduleOn || shownAlert != null) null
        else MissingSchedule.at(activeMissing(), localSecOfDay(), c.effectiveLayout == Layout.QUEUE)
        if (showing == null) {
            missingFull.visibility = View.GONE
            missingBanner.visibility = View.GONE
            return
        }
        val bmp = showing.case.photo?.let { missingBitmaps[it.sha256] }
        if (showing.full) {
            missingFull.show(showing.case, bmp)
            missingFull.visibility = View.VISIBLE
            missingBanner.visibility = View.GONE
        } else {
            missingBanner.show(showing.case, bmp)
            missingBanner.visibility = View.VISIBLE
            missingFull.visibility = View.GONE
        }
    }

    /** Para o diagnóstico: "2 casos, 1 foto guardada, próxima exibição às 10:20". */
    fun missingSummary(): String {
        val active = activeMissing()
        if (Engine.missing.isEmpty()) return "nenhum caso"
        val next = MissingSchedule.nextStart(active, localSecOfDay(), cfg?.effectiveLayout == Layout.QUEUE)
        val photos = Engine.missingPhotoCount()
        return "${active.size} caso(s) em vigor, $photos foto(s) guardada(s), ${active.count { it.qr != null }} com QR code, " +
            (if (next == null) "sem próxima exibição" else "próxima exibição às ${MissingSchedule.hhmm(next)}") +
            (if (active.size != Engine.missing.size) " (${Engine.missing.size - active.size} vencido(s) ou sem hora confiável)" else "")
    }

    private fun buildTicker(c: TelaConfig, ins: Insets = Insets(0, 0, 0, 0)): TickerView = TickerView(this).also {
        it.setPadding(ins.left, 0, ins.right, ins.bottom)
        it.set(c.ticker.items, c.ticker.speed, c.ticker.style, c.ticker.rich)
        it.running = tickerShouldRun()
        ticker = it
    }

    private fun sized(px: Float, bold: Boolean = false, color: Int = Color.WHITE, center: Boolean = true) = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
        setTextColor(color)
        if (center) gravity = Gravity.CENTER
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    /** Coluna lateral: título, relógio, clima, senha atual, QR code (gerado no aparelho), cartões e o último aviso encerrado. */
    private fun buildSide(c: TelaConfig, w0: Int, h0: Int, withQueue: Boolean, withCards: Boolean, edge: Insets = Insets(0, 0, 0, 0)): View {
        // edge: a margem do overscan nos lados que encostam na borda da tela (o fundo vai até a borda, o texto não)
        val w = w0 - edge.left - edge.right
        val h = h0 - edge.top - edge.bottom
        val base = minOf(w.toFloat(), h * 0.8f)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(0xFF0B1E3A.toInt())
            val p = (base * 0.06f).toInt()
            setPadding(p + edge.left, p + edge.top, p + edge.right, p + edge.bottom)
        }
        val showQueue = withQueue && c.queue.enabled && "queue" in c.side.widgets
        val showCards = withCards && c.cards.isNotEmpty()
        val busy = showQueue || showCards
        c.side.title?.let { t -> col.addView(sized(base * 0.085f, true).apply { text = t }, Ui.lp()) }
        for (wdg in c.side.widgets.distinct()) {
            when (wdg) {
                "clock" -> {
                    clockView = sized(base * (if (busy) 0.2f else 0.26f), true).also { col.addView(it, Ui.lp(top = (base * 0.03f).toInt())) }
                    dateView = sized(base * 0.062f, color = Ui.MUTED).also { col.addView(it, Ui.lp()) }
                }
                "weather" -> c.weather?.let { wt ->
                    val row = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER
                    }
                    val icon = (base * 0.2f).toInt()
                    row.addView(WeatherIcon(this, wt.icon), LinearLayout.LayoutParams(icon, icon))
                    val txt = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                    wt.tempC?.let { t -> txt.addView(sized(base * 0.13f, true, center = false).apply { text = "$t°C" }) }
                    if (wt.condition.isNotEmpty()) txt.addView(sized(base * 0.05f, center = false).apply { text = wt.condition })
                    if (wt.city.isNotEmpty()) txt.addView(sized(base * 0.045f, color = Ui.MUTED, center = false).apply { text = wt.city })
                    row.addView(txt, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = (base * 0.04f).toInt() })
                    col.addView(row, Ui.lp(top = (base * 0.04f).toInt()))
                    weatherView = row
                }
                "queue" -> if (showQueue) {
                    val box = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        val p = (base * 0.03f).toInt()
                        setPadding(p, p, p, p)
                    }
                    val label = sized(base * 0.055f, true, Ui.MUTED).apply { text = c.queue.title.ifEmpty { "Senha" }; maxLines = 1 }
                    box.addView(label, Ui.lp())
                    val ticketPx = base * 0.2f
                    val ticket = sized(ticketPx, true).apply { maxLines = 1; includeFontPadding = false }
                    // guichê logo abaixo da senha e grande; o nome (só com showName) embaixo dele
                    val desk = sized(base * 0.09f, true).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
                    val name = sized(base * 0.08f, true).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
                    box.addView(ticket, Ui.lp())
                    box.addView(desk, Ui.lp())
                    box.addView(name, Ui.lp())
                    col.addView(box, Ui.lp(top = (base * 0.04f).toInt()))
                    // 15/11: até 3 anteriores em caixas menores, sob "Últimas chamadas" (e quantas estão em atendimento)
                    val lastTitle = sized(base * 0.05f, true, Ui.MUTED, center = false).apply { text = "ÚLTIMAS CHAMADAS"; maxLines = 1 }
                    col.addView(lastTitle, Ui.lp(top = (base * 0.03f).toInt()))
                    val serving = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                    col.addView(serving, Ui.lp(top = (base * 0.01f).toInt()))
                    queueViews = QueueViews(box, label, ticket, desk, name, serving, null, ticketPx, w - (base * 0.18f).toInt(), base * 0.06f, 0xFF10294D.toInt(), lastTitle, servingOnly = true)
                }
                "qr" -> c.side.qrUrl?.let { url ->
                    val size = (base * (if (busy) 0.42f else 0.62f)).toInt().coerceAtLeast(120)
                    Ui.qr(url, size)?.let { bmp ->
                        val img = ImageView(this).apply {
                            setImageBitmap(bmp)
                            scaleType = ImageView.ScaleType.FIT_CENTER
                            contentDescription = "QR code"
                        }
                        col.addView(img, LinearLayout.LayoutParams(size, size).apply { topMargin = (base * 0.05f).toInt() })
                    }
                }
            }
        }
        if (showCards) {
            col.addView(buildCard(base * 0.06f, base * 0.048f), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = (base * 0.05f).toInt() })
        } else {
            col.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        }
        recentView = sized(base * 0.055f).apply {
            setBackgroundColor(0x33FFFFFF)
            val p = (base * 0.03f).toInt()
            setPadding(p, p, p, p)
            visibility = View.GONE
        }.also { col.addView(it, Ui.lp()) }
        return col
    }

    /** Cartão de informação (cardápio, escala, avisos): um por vez, revezando. */
    private fun buildCard(titlePx: Float, linePx: Float): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0x22FFFFFF)
            val p = (titlePx * 0.6f).toInt()
            setPadding(p, p, p, p)
        }
        cardTitle = sized(titlePx, true, 0xFFFFD166.toInt(), center = false).also { box.addView(it, Ui.lp()) }
        cardLines = sized(linePx, center = false).apply { setLineSpacing(linePx * 0.25f, 1f) }.also { box.addView(it, Ui.lp(top = (titlePx * 0.3f).toInt())) }
        return box
    }

    /** Painel de senha grande: senha atual e guichê, últimas chamadas, quem espera e, embaixo, os cartões. */
    private fun buildQueuePanel(c: TelaConfig, w0: Int, h0: Int, edge: Insets = Insets(0, 0, 0, 0)): View {
        val w = w0 - edge.left - edge.right
        val h = h0 - edge.top - edge.bottom
        val u = minOf(h / 100f, w / 125f)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF071428.toInt())
            val p = (u * 3).toInt()
            setPadding(p + edge.left, p + edge.top, p + edge.right, p + edge.bottom)
        }
        panel.addView(sized(u * 4.5f, true, Ui.MUTED, center = false).apply { text = c.queue.title.ifEmpty { "Atendimento" } }, Ui.lp())

        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val cur = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val p = (u * 2).toInt()
            setPadding(p, p, p, p)
        }
        val ticketPx = u * 20
        val ticket = sized(ticketPx, true).apply { maxLines = 1; includeFontPadding = false }
        // guichê logo abaixo da senha e grande; o nome (só com showName) embaixo dele
        val desk = sized(u * 9f, true).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
        val name = sized(u * 7f, true).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        val label = sized(u * 3.6f, true, Ui.MUTED).apply { text = "SENHA" }
        cur.addView(label, Ui.lp())
        cur.addView(ticket, Ui.lp())
        cur.addView(desk, Ui.lp())
        cur.addView(name, Ui.lp())
        val curW = ((w - u * 6) * 1.5f / 2.5f).toInt()
        top.addView(cur, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1.5f))
        val lastCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (u * 2).toInt()
            setPadding(p * 2, p, p, p)
        }
        val listTitle = sized(u * 3.2f, color = Ui.MUTED, center = false).apply { text = "ÚLTIMAS CHAMADAS" }
        lastCol.addView(listTitle, Ui.lp())
        val lastBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        lastCol.addView(lastBox, Ui.lp(top = (u * 1.5f).toInt()))
        top.addView(lastCol, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        panel.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.6f).apply { topMargin = (u * 2).toInt() })

        // quem está em atendimento (§12), em caixas numa fileira; o que não cabe vira "+N em atendimento"
        val servingBox = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        panel.addView(servingBox, Ui.lp(top = (u * 2).toInt()))
        val waitBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        panel.addView(waitBox, Ui.lp(top = (u * 2).toInt()))
        if (c.cards.isNotEmpty()) {
            panel.addView(buildCard(u * 4.2f, u * 3.4f), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = (u * 2).toInt() })
        }
        queueViews = QueueViews(cur, label, ticket, desk, name, lastBox, waitBox, ticketPx, curW - (u * 6).toInt(), u * 4f, 0xFF10294D.toInt(), listTitle, servingBox = servingBox)
        return panel
    }

    /**
     * Põe na tela o estado da senha (atual, em atendimento, espera). Desde a 1.2.2 o destaque da chamada é o cartão em tela
     * inteira (refreshCallCard): o bloco da senha fica sempre no fundo escuro, com texto claro.
     */
    private fun refreshQueue() {
        cfg?.let { c -> board?.refresh(Engine.queueState, c) }
        val q = queueViews ?: return
        val c = cfg ?: return
        val s = Engine.queueState
        val cur = s.current
        val hot = QueueReducer.highlighted(s, SystemClock.uptimeMillis())
        queueHighlight = hot
        val colors = QueueColors.of(false, q.idleBg)
        // 19/11, do dono: a senha atual na cor da urgência (Manchester); sem risco, o fundo do tema
        val rc = RiskColors.of(cur?.risk)
        val fg = if (rc == null) colors.text else RiskColors.textOn(rc)
        q.box.background = QueueBoxes.rounded(rc ?: colors.bg, q.unit * 0.4f, BOX_LINE, maxOf(2, (q.unit * 0.08f).toInt()))
        q.label.setTextColor(if (rc == null) colors.label else fg)
        q.ticket.text = cur?.ticket ?: "—"
        riskDot(q.ticket, null, q.ticketPx * 0.3f) // a caixa já está na cor do risco
        val len = maxOf(cur?.ticket?.length ?: 1, 3)
        q.ticket.setTextSize(TypedValue.COMPLEX_UNIT_PX, minOf(q.ticketPx, q.boxW / (len * 0.64f)))
        q.ticket.setTextColor(fg)
        val t = cur?.let { QueueCallCard.text(it, c.queue.showName) }
        q.name.visibility = if (t?.name != null) View.VISIBLE else View.GONE
        q.name.text = t?.name.orEmpty()
        q.name.setTextColor(fg)
        q.desk.text = t?.desk ?: "Aguarde a chamada"
        q.desk.setTextColor(fg)
        q.desk.visibility = if (q.desk.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        fitTicket(q)

        q.lastBox?.let { box ->
            box.removeAllViews()
            // 15/11, do dono: ÚLTIMAS CHAMADAS (sem a atual), cada uma numa caixa
            val list = QueueLayout.previous(s, QueueReducer.MAX_LAST) // 20/11, do dono: a coluna mostra quantas couberem (fitList tira o que passa da altura)
            q.listTitle?.visibility = if (list.isEmpty() && q.servingOnly) View.GONE else View.VISIBLE
            if (q.servingOnly) {
                // coluna (20/11, do dono: "aproveitar ao máximo"): duas caixas por linha, código grande e o guichê embaixo,
                // centrados, na cor da urgência; as linhas que não cabem na altura saem (fitList), as mais antigas primeiro
                val gap = (q.unit * 0.3f).toInt()
                for (pair in list.chunked(2)) {
                    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    pair.forEachIndexed { k, call ->
                        row.addView(QueueBoxes.box(this, call, q.unit * 1.2f, BOX_PANEL, Color.WHITE, Ui.MUTED, BOX_LINE, center = true),
                            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { if (k > 0) leftMargin = gap })
                    }
                    if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = gap })
                    box.addView(row, Ui.lp(top = gap))
                }
            } else for (call in list) {
                box.addView(QueueBoxes.box(this, call, q.unit * 1.3f, BOX_PANEL, Color.WHITE, Ui.MUTED, BOX_LINE,
                    showName = c.queue.showName), Ui.lp(top = (q.unit * 0.35f).toInt()))
            }
            // coluna: quantas estão em atendimento (§12), numa linha
            val inService = s.serving?.size ?: 0
            if (q.servingOnly && inService > 0) box.addView(sized(q.unit * 0.8f, color = Ui.MUTED, center = false).apply { text = "$inService em atendimento"; maxLines = 1 }, Ui.lp(top = (q.unit * 0.35f).toInt()))
            // o que não cabe na altura sai da lista (as mais antigas), sem "+N": são só as anteriores
            fitList(box, q.unit, more = null) { queueViews === q }
        }
        q.servingBox?.let { row ->
            row.removeAllViews()
            val serving = s.serving.orEmpty()
            row.visibility = if (serving.isEmpty()) View.GONE else View.VISIBLE
            if (serving.isNotEmpty()) {
                row.addView(sized(q.unit * 0.8f, true, Ui.MUTED, center = false).apply { text = "EM ATENDIMENTO"; maxLines = 1 })
                val shown = serving.take(SERVING_ROW)
                for (call in shown) row.addView(QueueBoxes.box(this, call, q.unit * 0.95f, BOX_PANEL, Color.WHITE, Ui.MUTED, BOX_LINE, showName = c.queue.showName, horizontal = true),
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = (q.unit * 0.5f).toInt() })
                if (serving.size > shown.size) row.addView(sized(q.unit * 0.8f, color = Ui.MUTED, center = false).apply { text = "+${serving.size - shown.size} em atendimento"; maxLines = 1 },
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = (q.unit * 0.5f).toInt() })
            }
        }
        q.waitBox?.let { box ->
            box.removeAllViews()
            val wt = s.waiting
            if (wt != null) {
                val gap = (q.unit * 0.6f).toInt()
                // linha 1: quantos esperam e a espera média; linha 2: as cores do risco dividindo a largura (não passam da borda)
                val line1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                line1.addView(sized(q.unit, true, center = false).apply { text = "Aguardando: ${wt.total}" })
                wt.avgWaitMin?.let { m ->
                    line1.addView(sized(q.unit, color = Ui.MUTED, center = false).apply { text = "Espera média: $m min"; maxLines = 1 }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = gap * 2 })
                }
                box.addView(line1, Ui.lp())
                val line2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                if (!wt.byRisk.isNullOrEmpty()) box.addView(line2, Ui.lp(top = gap))
                wt.byRisk?.forEachIndexed { i, (risk, n) ->
                    val (bg, tx) = riskColors(risk)
                    val chip = sized(q.unit * 0.75f, true, tx).apply {
                        text = "${risk.replaceFirstChar { it.uppercase() }} $n"
                        setBackgroundColor(bg)
                        setPadding(gap / 2, gap / 2, gap / 2, gap / 2)
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                    }
                    line2.addView(chip, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { if (i > 0) leftMargin = gap })
                }
            }
        }
    }

    /**
     * Se a senha grande empurra o guichê para fora do bloco (tela baixa, cartões, faixa), diminui a senha até tudo caber:
     * o guichê nunca pode sumir. Recalcula a partir do tamanho cheio a cada vez, então não encolhe acumulando.
     */
    private fun fitTicket(q: QueueViews) = fitTicket(q.box, q.ticket) { queueViews === q }

    /**
     * Lista de "em atendimento" que passaria da altura do bloco (TV baixa, margem grande, muitas senhas): tira as mais
     * antigas (as últimas da lista) até caber e põe "+N em atendimento" no lugar. Nada fica cortado na borda.
     */
    private fun fitList(box: LinearLayout, unit: Float, tries: Int = 5, more: ((Int) -> String)? = { "+$it em atendimento" }, alive: () -> Boolean) {
        box.post {
            if (!alive()) return@post
            val col = box.parent as? View ?: return@post
            if (col.height == 0) {
                if (tries > 0) handler.postDelayed({ fitList(box, unit, tries - 1, more, alive) }, 200)
                return@post
            }
            val avail = col.height - col.paddingBottom - box.top
            val w = View.MeasureSpec.makeMeasureSpec(maxOf(box.width, 1), View.MeasureSpec.EXACTLY)
            val u = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            // o texto e os LayoutParams antes de medir (setText numa vista sem LayoutParams derruba o app)
            val label = more
            val moreView = sized(unit * 0.9f, color = Ui.MUTED, center = false).apply { text = label?.invoke(8) ?: ""; layoutParams = Ui.lp() }
            moreView.measure(w, u)
            var used = 0
            var keep = box.childCount
            for (i in 0 until box.childCount) {
                val v = box.getChildAt(i)
                v.measure(w, u)
                val top = (v.layoutParams as? ViewGroup.MarginLayoutParams)?.topMargin ?: 0
                val reserve = if (label != null && i < box.childCount - 1) moreView.measuredHeight else 0
                if (used + top + v.measuredHeight + reserve > avail) {
                    keep = i
                    break
                }
                used += top + v.measuredHeight
            }
            if (keep >= box.childCount) return@post
            val hidden = box.childCount - keep
            box.removeViews(keep, hidden)
            if (label != null) {
                box.addView(moreView)
                moreView.text = label(hidden)
            }
        }
    }

    private fun fitTicket(box: View, ticket: TextView, tries: Int = 5, alive: () -> Boolean) {
        box.post {
            val avail = box.height - box.paddingTop - box.paddingBottom
            if (box !is LinearLayout || !alive()) return@post
            if (avail <= 0 || ticket.height == 0) {
                if (tries > 0) handler.postDelayed({ fitTicket(box, ticket, tries - 1, alive) }, 200)
                return@post
            }
            var used = 0
            for (i in 0 until box.childCount) {
                val v = box.getChildAt(i)
                if (v.visibility == View.GONE) continue
                val lp = v.layoutParams as? ViewGroup.MarginLayoutParams
                // a altura que ele QUER (a LinearLayout espreme o último filho quando falta lugar)
                v.measure(View.MeasureSpec.makeMeasureSpec(maxOf(v.width, 1), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
                used += v.measuredHeight + (lp?.topMargin ?: 0) + (lp?.bottomMargin ?: 0)
            }
            val over = used - avail
            val th = ticket.measuredHeight
            if (over > 0 && th > 0) {
                val now = ticket.textSize
                val target = (now * (th - over).toFloat() / th).coerceAtLeast(now * 0.4f)
                if (target < now - 0.5f) ticket.setTextSize(TypedValue.COMPLEX_UNIT_PX, target)
            }
            box.requestLayout()
        }
    }

    /** Marcador pequeno da cor do risco (§13) à esquerda da senha; sem risco, nada. */
    private fun riskDot(tv: TextView, risk: String?, sizePx: Float) {
        val color = RiskColors.of(risk)
        if (color == null) {
            tv.setCompoundDrawables(null, null, null, null)
            return
        }
        val d = sizePx.toInt().coerceAtLeast(8)
        val dot = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
            setStroke((d / 10).coerceAtLeast(1), Color.WHITE)
            setBounds(0, 0, d, d)
        }
        tv.setCompoundDrawables(dot, null, null, null)
        tv.compoundDrawablePadding = (d * 0.5f).toInt()
    }

    private fun riskColors(risk: String): Pair<Int, Int> = when (risk) {
        "vermelho" -> 0xFFD32F2F.toInt() to Color.WHITE
        "laranja" -> 0xFFF57C00.toInt() to Color.WHITE
        "amarelo" -> 0xFFFBC02D.toInt() to 0xFF1A1A1A.toInt()
        "verde" -> 0xFF388E3C.toInt() to Color.WHITE
        "azul" -> 0xFF1976D2.toInt() to Color.WHITE
        else -> 0xFF546E7A.toInt() to Color.WHITE
    }

    private fun refreshCard() {
        val title = cardTitle ?: return
        val cards = cfg?.cards.orEmpty()
        val i = CardRotation.indexAt(cards, SystemClock.uptimeMillis() - compBuiltAt)
        if (i == shownCard || i < 0) return
        shownCard = i
        title.text = cards[i].title
        title.visibility = if (cards[i].title.isEmpty()) View.GONE else View.VISIBLE
        cardLines?.text = cards[i].lines.joinToString("\n")
    }

    /** Chamada nova ou repetida: toque, canal mais baixo e a voz (se ligada e se o aparelho tem voz em português). */
    override fun onQueueChanged(announce: QueueCall?) {
        refreshQueue()
        refreshCallCard()
        val c = cfg ?: return
        if (announce == null || !scheduleOn || !QueueCallCard.callsHere(c, signBlock) || !visible) return
        // 20/11, do dono: uma chamada não atropela a outra. Entra na fila e é anunciada depois que a anterior terminar
        // de tocar, com 2 s de intervalo. A mesma senha já esperando não entra de novo (salvo "Chamar de novo").
        if (announceQueue.none { it.id == announce.id && !announce.repeat }) announceQueue.addLast(announce)
        if (!announcing) nextAnnounce()
    }

    private val announceQueue = ArrayDeque<QueueCall>()
    private val ANNOUNCE_GAP_MS = 2_000L
    private var announcing = false
    private var announceToken = 0

    /** Toca a próxima chamada da fila: bipe e/ou voz; quando acaba, espera 2 s e segue. Fila vazia: o som do canal volta. */
    private fun nextAnnounce() {
        val c = cfg
        val call = announceQueue.removeFirstOrNull()
        if (call == null || c == null || !visible || !QueueCallCard.callsHere(c, signBlock)) {
            announceQueue.clear()
            announcing = false
            if (shownCode == null) duckProgram(false)
            return
        }
        announcing = true
        val token = ++announceToken
        var finished = false
        val finish = {
            if (!finished && token == announceToken) {
                finished = true
                handler.postDelayed({ if (token == announceToken) nextAnnounce() }, ANNOUNCE_GAP_MS)
            }
        }
        // contrato §16: bipe, falada ou bipe + falada (painel > aparelho > bipe + falada). Sem voz: só o bipe
        val snd = callSound()
        val voice = snd.mode.voice && (clips.ready || speaker.ready)
        if (snd.mode.beep || !voice) try {
            soundPool?.play(chimeId, 1f, 1f, 2, 0, 1f)
        } catch (_: Exception) {
        }
        duckProgram(true)
        if (voice) {
            handler.postDelayed({
                if (token == announceToken && !sayCall(call, c.queue.showName, snd.volume / 100f) { finish() }) finish()
            }, if (snd.mode.beep) 900L else 150L) // depois do bipe
            handler.postDelayed({ finish() }, 15_000L) // garantia: se a voz não avisar que terminou
        } else {
            handler.postDelayed({ finish() }, 1_500L) // o tempo do bipe
        }
    }

    /**
     * Fala a chamada (20/11): com a voz própria do app (Coral, Nova, Ash ou Onyx, Ajustes → "Voz da chamada"), que não depende do
     * Android; com "Voz do Android" (ou se a voz própria falhar), pelo TextToSpeech. O nome da pessoa só existe na voz do
     * Android: com o nome ligado e a voz do aparelho em português, a chamada sai pela voz do Android.
     */
    private fun sayCall(call: QueueCall, showName: Boolean, volume: Float, done: () -> Unit): Boolean {
        val v = VoiceClips.key(Engine.store.callVoice)
        val vocab = clips.vocab
        val wantName = showName && !call.name.isNullOrBlank() && speaker.ready
        if ((v == "android" || wantName || vocab == null) && speaker.ready &&
            speaker.speak(SpeechText.build(call, showName), volume, done)) return true
        if (vocab == null) return false
        val plan = VoicePlan.build(call, showName, vocab)
        if (plan.unknown.isNotEmpty()) lastUnknownWords = plan.unknown.joinToString(", ")
        return clips.speak(if (v == "android") VoiceClips.DEFAULT else v, plan.tokens, volume, done)
    }

    /** Palavras do último local chamado que a voz própria não tem (para o diagnóstico). */
    @Volatile private var lastUnknownWords = ""

    /** Ajustes → "Voz da chamada": Coral → Nova → Ash → Onyx → Voz do Android; toca um exemplo com a voz nova. */
    fun cycleCallVoice(): String {
        val keys = VoiceClips.VOICES.map { it.first }
        val next = keys[(keys.indexOf(VoiceClips.key(Engine.store.callVoice)) + 1) % keys.size]
        Engine.store.callVoice = next
        sayCall(QueueCall(id = 0, ticket = "A002", desk = "Consultório 3", name = null, priority = false, at = 0), false, callSound().volume / 100f) { }
        return next
    }

    fun voiceStatus(): String = speaker.status + (if (lastUnknownWords.isNotEmpty()) " · sem áudio para: $lastUnknownWords" else "")

    /**
     * Ajustes → "Margem da tela (overscan)": remonta a composição com a margem nova e mostra por 6 s, por cima de tudo
     * (inclusive dos ajustes), a moldura da área segura: se os cantos da moldura aparecem inteiros na TV, a margem basta.
     */
    fun applyOverscan() {
        compKey = ""
        buildComposition()
        overscanGuide?.let { root.removeView(it) }
        val pct = Engine.store.overscanPct
        val guide = object : View(this) {
            private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            override fun onDraw(canvas: Canvas) {
                val i = Overscan.insets(width, height, pct)
                val sw = minOf(width, height) * 0.006f + 2f
                paint.style = android.graphics.Paint.Style.STROKE
                paint.strokeWidth = sw
                paint.color = QueueColors.HOT_BG
                canvas.drawRect(i.left + sw / 2, i.top + sw / 2, width - i.right - sw / 2, height - i.bottom - sw / 2, paint)
                paint.style = android.graphics.Paint.Style.FILL
                paint.textSize = minOf(width, height) * 0.035f
                val txt = "Margem da tela: $pct%"
                canvas.drawText(txt, i.left + sw * 4, i.top + sw * 4 + paint.textSize, paint)
                canvas.drawText(txt, width - i.right - sw * 4 - paint.measureText(txt), height - i.bottom - sw * 4, paint)
            }
        }
        root.addView(guide, match())
        overscanGuide = guide
        handler.postDelayed({ if (overscanGuide === guide) { root.removeView(guide); overscanGuide = null } }, 6000)
    }

    // ------------------------------------------------------------------ configuração

    /** Lê a configuração em vigor e ajusta tudo: travas, layout, volume, vídeo. */
    fun applyConfig() {
        val configured = Engine.configured
        cfg = if (configured) Engine.config else null
        val c = cfg
        if (c == null) {
            wasConfigured = false
            stopPlayback()
            streamKey = ""
            shownAlert = null
            alertBox.visibility = View.GONE
            alertStamp.visibility = View.GONE
            if (shownCode != null) { shownCode = null; codeBox.visibility = View.GONE; stopCodeAlarm() }
            blackout.visibility = View.GONE
            scheduleOn = true
            compKey = ""
            buildComposition()
            if (screen !is SetupScreen && screen !is WizardScreen) {
                val needsKey = Engine.managed
                // primeiro uso (nunca ativado, assistente nunca concluído): a configuração inicial antes da chave
                if (!needsKey && Engine.store.configJson == null && !Engine.store.wizardDone) {
                    showScreen(WizardScreen(this, firstRun = true))
                    return
                }
                showScreen(
                    SetupScreen(
                        this,
                        if (needsKey) SetupScreen.MANAGED else SetupScreen.CHOOSE,
                        when {
                            needsKey && Engine.store.token != null -> "Aparelho ativado. Aguardando a configuração do servidor…"
                            needsKey && Engine.store.configJson != null -> "Este aparelho foi desativado no painel. Digite uma nova chave de acesso."
                            else -> ""
                        },
                    ),
                )
            }
            return
        }
        if (!wasConfigured) {
            wasConfigured = true
            if (screen is SetupScreen || screen is WizardScreen) closeScreen()
        }
        // DIGITAL ISP (26/11/2026): a mesma sequência em todos os apps, ↑ ↑ ↓ ↓ OK, que abre a senha do menu
        exitSeq = ExitSequence(ConfigParser.DEFAULT_SEQ)
        loadFallbackImage()
        applyCaptions()
        player.setVolume(c.stream.volume, c.stream.muted || signMuted)
        buildComposition()
        youtubeVolume()
        val key = "${c.stream.hls}|${c.stream.backup}|${c.stream.youtube}|${Engine.standalone}"
        if (key != streamKey || !playing) {
            streamKey = key
            if (scheduleOn) startPlayback()
        }
    }

    fun onActivated() = applyConfig()

    override fun onConfigChanged() = applyConfig()

    override fun onUnauthorized() = applyConfig()

    override fun onAlertsChanged() = refreshAlert()

    /** Lê (fora da thread principal) a imagem de fora do ar guardada, se mudou. */
    private fun loadFallbackImage() {
        val f = Engine.fallbackImageFile()
        val path = f?.path
        if (path == fallbackPath) return
        fallbackPath = path
        val gen = ++fallbackGen
        if (f == null) {
            fallbackBmp = null
            paintFallback()
            return
        }
        val dm = resources.displayMetrics
        val max = maxOf(dm.widthPixels, dm.heightPixels, 1280)
        Thread({
            val bmp = ImageArt.decode(f, max, max)
            handler.post {
                if (gen == fallbackGen) {
                    fallbackBmp = bmp
                    paintFallback()
                }
            }
        }, "telas-imagem-tela").start()
    }

    override fun onOfflineChanged() {
        loadFallbackImage()
        val has = Engine.offlineFiles().isNotEmpty()
        wd.hasOffline = has
        if (playing && wd.source == Source.OFFLINE) perform(WdAction.Play(Source.OFFLINE))
    }

    override fun reloadPlayer() {
        compKey = ""
        applyConfig()
        if (cfg != null && scheduleOn) startPlayback()
    }

    // ------------------------------------------------------------------ vídeo e vigia

    private fun usable(url: String?): Boolean = Urls.streamAllowed(url, Engine.standalone)

    private fun startPlayback() {
        val c = cfg ?: return
        generation++
        errorPending = false
        wd.hasMain = usable(c.stream.hls)
        wd.hasBackup = usable(c.stream.backup)
        wd.hasOffline = Engine.offlineFiles().isNotEmpty()
        wd.internetDown = internetDown()
        playing = true
        notPlayingSince = SystemClock.uptimeMillis()
        // sem rede (ou com a internet caída), os vídeos guardados entram direto, sem esperar as recargas
        perform(wd.start(SystemClock.uptimeMillis(), Engine.net() != "none"))
    }

    /** A internet caiu: sem rede no aparelho ou, no modo gerenciado, o servidor sem responder por falha de rede. */
    private fun internetDown(): Boolean = Engine.net() == "none" || (Engine.managed && Engine.serverUnreachable)

    /** Imagem de fora do ar: só quando nada toca (vídeo guardado > imagem > preto; core/FallbackImages). */
    private fun refreshFallback(isPlaying: Boolean, now: Long) {
        val v = fallbackView ?: return
        val area = FallbackImages.area(isPlaying, if (isPlaying || notPlayingSince == 0L) 0L else now - notPlayingSince, fallbackBmp != null || brandBmp != null)
        val show = scheduleOn && area == VideoArea.IMAGE
        v.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun stopPlayback() {
        playing = false
        errorPending = false
        generation++
        if (::player.isInitialized) player.stop()
    }

    private fun perform(action: WdAction) {
        val c = cfg ?: return
        when (action) {
            // o YouTube no lugar do canal: o player fica parado (a WebView toca)
            is WdAction.Play -> if (c.stream.youtube != null) player.stop() else when (action.source.also { signal.reload() }) {
                Source.HLS -> if (wd.hasMain) player.playLive(c.stream.hls!!) else player.stop()
                Source.BACKUP -> if (wd.hasBackup) player.playLive(c.stream.backup!!) else player.stop()
                Source.OFFLINE -> {
                    val files = Engine.offlineFiles()
                    wd.hasOffline = files.isNotEmpty()
                    if (files.isEmpty()) player.stop()
                    else {
                        player.playFiles(files, offlineIndex)
                        offlineIndex = (offlineIndex + 1) % files.size
                    }
                }
            }
            WdAction.ProbeLive -> {
                val gen = generation
                val main = c.stream.hls.takeIf { wd.hasMain }
                val backup = c.stream.backup.takeIf { wd.hasBackup }
                Thread {
                    val mainOk = main != null && Engine.probe(main)
                    val backupOk = backup != null && Engine.probe(backup)
                    handler.post {
                        if (gen == generation && playing) perform(wd.onProbe(SystemClock.uptimeMillis(), mainOk, backupOk))
                    }
                }.start()
            }
            WdAction.Resync -> player.resync()
            WdAction.None -> Unit
        }
    }

    /** Erro do player: espera 3 s antes de recarregar, para não martelar o servidor quando o endereço está fora. */
    private fun onPlayerError(kind: ErrorKind, code: String) {
        if (!playing || errorPending) return
        if (kind == ErrorKind.RESYNC) {
            // atrás da janela do ao vivo / lista parada ou reiniciada (o canal voltou depois da cartela de fora do ar):
            // volta à ponta na hora, sem contar para a troca de fonte
            val a = wd.onResync(SystemClock.uptimeMillis())
            if (a === WdAction.Resync) {
                player.resync()
                return
            }
        }
        Engine.noteError("Player: $code (${wd.source.wire})")
        errorPending = true
        val gen = generation
        handler.postDelayed({
            errorPending = false
            if (gen == generation && playing) perform(wd.onError(SystemClock.uptimeMillis()))
        }, ERROR_DELAY_MS)
    }

    fun playerSummary(): String = when {
        cfg == null -> "sem configuração"
        !scheduleOn -> "fora do horário (tela apagada)"
        else -> {
            val src = when (wd.source) {
                Source.HLS -> "canal principal"
                Source.BACKUP -> "endereço reserva"
                Source.OFFLINE -> "vídeos guardados"
            }
            val st = when {
                player.isPlaying -> "tocando"
                player.isBuffering -> "carregando"
                else -> "parado"
            }
            "$st · $src"
        }
    }

    /** Para os ajustes: por qual sinal o vigia está medindo "vídeo andando". */
    fun watchdogMode(): String = if (signal.byPosition) "por posição" else "por quadros decodificados"

    fun kioskIssues(): String = kioskIssues.joinToString(", ")

    // ------------------------------------------------------------------ tique de 1 s

    private val tick = object : Runnable {
        override fun run() {
            try {
                onTick()
            } finally {
                handler.postDelayed(this, 1000)
            }
        }
    }

    private fun onTick() {
        val now = SystemClock.uptimeMillis()
        refreshSplash(now)
        screen?.let { s ->
            s.onTick()
            if (s.autoClose && now - lastKeyAt > IDLE_MS) closeScreen()
        }
        val c = cfg
        if (c == null) {
            Engine.playerState = "idle"
            Engine.locked = false
            return
        }
        // horário de ligar/desligar (sem hora certa no aparelho, fica ligada)
        val on = !Engine.clockOk() || isOnNow(c)
        if (on != scheduleOn) setScheduleOn(on)

        refreshAlert()
        refreshCode()
        refreshClock()
        refreshCard()
        refreshMissing()
        // TV Corporativa: troca de bloco na hora certa e o tique das zonas com hora
        if (c.signage != null || signBlock != null) {
            if (pickBlock(c) !== signBlock) buildComposition()
            signage?.tick()
        }
        // o destaque de 10 s da chamada acabou (ou começou)? redesenha a senha
        if (queueViews != null && queueHighlight != QueueReducer.highlighted(Engine.queueState, now)) refreshQueue()
        if (callCardOn != QueueCallCard.show(c, Engine.queueState, now, scheduleOn, signBlock)) refreshCallCard()

        Engine.noteClock()
        wd.internetDown = internetDown()
        if (scheduleOn && playing && !errorPending) perform(wd.tick(now, signal.sample(player.progress(), player.position()), Engine.net() != "none"))
        if (signal.byPosition && !loggedByPosition) {
            loggedByPosition = true
            android.util.Log.i("Telas", "vigia: os contadores do decodificador não andam neste aparelho; valendo pela posição do player")
        }

        val isPlaying = scheduleOn && player.isPlaying
        if (isPlaying) notPlayingSince = 0L else if (notPlayingSince == 0L) notPlayingSince = now
        refreshFallback(isPlaying, now)
        Engine.playerSource = wd.source.wire
        Engine.playerState = when {
            !scheduleOn -> "idle"
            isPlaying && wd.source == Source.OFFLINE -> "offline-content"
            isPlaying -> "playing"
            player.isBuffering -> "buffering"
            else -> "error"
        }
        Engine.locked = screen == null

        // relógio acertado (pela rede ou à mão): tenta de novo na hora, sem esperar a próxima volta
        val wall = System.currentTimeMillis()
        val mono = SystemClock.elapsedRealtime()
        if (lastWall > 0 && StartupClock.jumped(lastWall, lastMono, wall, mono)) onClockChanged()
        lastWall = wall
        lastMono = mono
        val clockView = Engine.clockView()
        // na partida com o relógio ainda errado, o vídeo tenta de novo a cada 2,5 s
        if (clockView == ClockView.LOADING && scheduleOn && !isPlaying && now - lastClockRetry > StartupClock.RETRY_MS) {
            lastClockRetry = now
            if (playing) startPlayback()
        }

        // sem endereço de vídeo (layout só de playlist e gadgets, ou tela sem canal): nada de aviso por cima da tela, nunca
        val hasVideo = wd.hasMain || wd.hasBackup || wd.hasOffline
        val waiting = hasVideo && scheduleOn && !isPlaying && (now - notPlayingSince > 4000 || clockView == ClockView.LOADING)
        status.visibility = if (waiting) View.VISIBLE else View.GONE
        if (waiting) {
            status.text = when {
                // TV box sem bateria de relógio: na partida é "Carregando…" (o NTP acerta em segundos); passado o prazo,
                // a frase curta do relógio (o detalhe fica nos ajustes)
                clockView == ClockView.LOADING -> StartupClock.LOADING_TEXT
                clockView == ClockView.MESSAGE -> StartupClock.MESSAGE_TEXT
                Engine.net() == "none" -> "Sem rede. Tentando de novo…"
                else -> "Reconectando ao canal…"
            }
        }
    }

    private fun nowCal(): Calendar = Calendar.getInstance().apply { timeInMillis = Engine.now() }

    private fun isOnNow(c: TelaConfig): Boolean {
        val cal = nowCal()
        return Schedule.isOn(c.schedule, cal.get(Calendar.DAY_OF_WEEK) - 1, cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE))
    }

    private fun setScheduleOn(on: Boolean) {
        scheduleOn = on
        handler.post { updateRadio() }
        blackout.visibility = if (on) View.GONE else View.VISIBLE
        refreshCallCard()
        ticker?.running = tickerShouldRun()
        if (on) {
            wd.resume(SystemClock.uptimeMillis())
            if (visible || hasWindowFocus()) startPlayback()
        } else {
            stopPlayback()
            // Experimental, só Device Owner e só se ligado nos ajustes: pôr o aparelho em espera e acordar na hora de ligar.
            val s = cfg?.schedule
            if (s != null && Engine.store.standbyOffHours && Kiosk.isOwner(this)) {
                val cal = nowCal()
                val mins = Schedule.minutesUntilOn(s, cal.get(Calendar.DAY_OF_WEEK) - 1, cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE))
                if (mins != null) {
                    Alarms.scheduleWake(this, mins * 60_000L - cal.get(Calendar.SECOND) * 1000L)
                    Kiosk.standby(this)
                }
            }
        }
    }

    // ------------------------------------------------------------------ alerta, relógio

    private fun refreshAlert() {
        // sem hora certa, os alertas guardados continuam até a hora voltar (só some o que com certeza já venceu)
        val a = if (cfg != null) Alerts.select(Engine.alerts, Engine.expiryNow()) else null
        if (a == shownAlert) return
        val isNew = a != null && a.id != shownAlert?.id
        shownAlert = a
        if (a == null) {
            alertBox.visibility = View.GONE
            alertStamp.visibility = View.GONE
            refreshMissing()
            return
        }
        refreshMissing() // com alerta no ar, os desaparecidos esperam
        // a cor é sempre a do nível (azul, âmbar, vermelho), inclusive nos testes
        val (bg, fg) = when (a.level) {
            2 -> 0xFFC62828.toInt() to Color.WHITE
            1 -> 0xFFF9A825.toInt() to 0xFF1A1A1A.toInt()
            else -> 0xFF1565C0.toInt() to Color.WHITE
        }
        alertBox.setBackgroundColor(bg)
        for (v in listOf(alertLevel, alertTitle, alertText)) v.setTextColor(fg)
        // contrato §9: cabeçalho do servidor (ou o de sempre), ícone da categoria e a palavra TESTE nos simulados
        alertLevel.text = Alerts.headerFor(a)
        alertIcon.set(a.category, fg)
        alertIcon.visibility = if (a.category.isEmpty()) View.GONE else View.VISIBLE
        alertStamp.visibility = if (a.test) View.VISIBLE else View.GONE
        alertTitle.text = a.title
        alertTitle.visibility = if (a.title.isEmpty()) View.GONE else View.VISIBLE
        alertText.text = a.text
        alertText.visibility = if (a.text.isEmpty()) View.GONE else View.VISIBLE
        alertBox.visibility = View.VISIBLE
        if (isNew && a.sound) try {
            soundPool?.play(soundId, 1f, 1f, 1, 2, 1f) // o tom três vezes
        } catch (_: Exception) {
        }
    }

    private fun refreshClock() {
        val ok = Engine.clockOk()
        val d = Date(Engine.now())
        // sem hora confiável (reiniciou sem rede): "--:--", nunca 1970
        clockView?.text = if (ok) hourFmt.format(d) else "--:--"
        // clima medido há mais de 3 h (aparelho sem rede) some; sem hora certa, vale o mínimo que a hora pode ser
        weatherView?.visibility = if (cfg?.weather?.fresh(Engine.expiryNow()) != false) View.VISIBLE else View.GONE
        dateView?.text = if (ok) dateFmt.format(d) else ""
        recentView?.let { v ->
            val r = Engine.recentAlert()
            if (r == null) v.visibility = View.GONE
            else {
                v.text = "Aviso encerrado às ${hourFmt.format(Date(r.endedAt))}\n${listOf(r.alert.title, r.alert.text).filter { it.isNotEmpty() }.joinToString(": ")}"
                v.visibility = View.VISIBLE
            }
        }
    }

    // ------------------------------------------------------------------ telas por cima

    /**
     * A faixa rolante redesenha a tela inteira a cada quadro; com um menu aberto por cima ela para, e as setas, o
     * teclado do PIN e o da chave respondem na hora (22/11: TV box fraca ficava lenta para digitar).
     */
    private fun tickerShouldRun() = scheduleOn && screen == null

    fun showScreen(s: Screen) {
        screenHost.removeAllViews()
        screen = s
        ticker?.running = false
        lastKeyAt = SystemClock.uptimeMillis()
        (s.view.parent as? ViewGroup)?.removeView(s.view)
        screenHost.addView(s.view, match())
        s.onShown()
    }

    fun closeScreen() {
        if (cfg == null) return // sem configuração a tela de entrada não fecha
        screenHost.removeAllViews()
        screen = null
        ticker?.running = tickerShouldRun()
        exitSeq.reset()
        hideSystemUi()
    }

    /** Roda `then` depois do PIN (ou direto, se nenhum PIN foi definido). */
    /** O menu e as saídas pedem sempre a senha: a do menu (a mesma em todos os aparelhos) ou o PIN da tela, se houver. */
    fun requirePin(then: () -> Unit) {
        val prev = screen
        showScreen(PinScreen(this, { if (prev != null) showScreen(prev) else closeScreen() }, then))
    }

    fun showSettings() = showScreen(SettingsScreen(this))

    /** Saída autorizada pelo PIN: 10 minutos sem o app voltar por cima. Abrir o app de novo trava outra vez. */
    fun openAndroidSettings() {
        Engine.store.maintenanceUntil = System.currentTimeMillis() + MAINTENANCE_MS
        Kiosk.leaveLockTask(this)
        handler.postDelayed({
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {
                Engine.store.maintenanceUntil = 0L
                Engine.noteError("Este aparelho não abriu as configurações do Android.")
            }
        }, 400)
    }

    /**
     * Sai do app (com a janela de 10 minutos) para uma tela do Android. Tenta cada intenção na ordem, porque TV box
     * genérica costuma não ter todas as telas de configuração; se nenhuma abrir, registra `failMsg` como último erro.
     */
    private fun leaveTo(failMsg: String, vararg intents: Intent) {
        Engine.store.maintenanceUntil = System.currentTimeMillis() + MAINTENANCE_MS
        Kiosk.leaveLockTask(this)
        handler.postDelayed({
            for (i in intents) {
                try {
                    // a pergunta "tela inicial" do Android 10+ só aparece se for pedida "com resposta"
                    if (i.action == Kiosk.ACTION_REQUEST_ROLE) startActivityForResult(i, 71) else startActivity(i)
                    return@postDelayed
                } catch (_: Exception) {
                }
            }
            Engine.store.maintenanceUntil = 0L
            Engine.noteError(failMsg)
            // antes só ia para o diagnóstico: na tela, o botão parecia não fazer nada
            android.widget.Toast.makeText(this, failMsg, android.widget.Toast.LENGTH_LONG).show()
        }, 400)
    }

    fun openOverlayPermission() = leaveTo(
        "Este aparelho não tem a tela de \"sobrepor a outros apps\"; use o adb (ver docs/TELAS-APP.md).",
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )

    /** Escolher este app como tela inicial: a pergunta do Android (10+), a tela "app de início" ou as configurações. */
    fun openHomeChooser() {
        val list = ArrayList<Intent>()
        Kiosk.homeRoleIntent(this)?.let { list.add(it) }
        list.add(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        list.add(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        list.add(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        leaveTo("Este aparelho não abriu a escolha da tela inicial; aperte o botão Home do controle e escolha DIGITAL ISP > Sempre.", *list.toTypedArray())
    }

    fun openDateSettings() = leaveTo(
        "Este aparelho não abriu a tela de data e hora; procure nas configurações do Android.",
        Intent(Settings.ACTION_DATE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )

    @android.annotation.SuppressLint("BatteryLife") // quiosque ligado na tomada o dia inteiro: a isenção é o caso de uso
    fun openBatteryExemption() = leaveTo(
        "Este aparelho não tem a tela de economia de bateria (em TV box é comum; não faz falta).",
        *Kiosk.batteryIntents(this).filter { it.resolveActivity(packageManager) != null }
            .map { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }.toTypedArray(),
    )

    /** "Instalar apps desconhecidos" para este app (Android 8+), para ele instalar a própria atualização. */
    fun openInstallPermission() = leaveTo(
        "Este aparelho não abriu a permissão de instalar apps; procure \"Instalar apps desconhecidos\" nas configurações do Android.",
        Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )

    /** Rede (Wi-Fi) do Android. */
    fun openNetworkSettings() = leaveTo(
        "Este aparelho não abriu as configurações de rede.",
        Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )

    // ------------------------------------------------------------------ modo do vídeo e diagnóstico

    val videoMode: VideoMode get() = player.videoMode

    /** Troca o modo do vídeo nos ajustes (automático → fixo → fixo 720p) e recarrega. */
    fun cycleVideoMode(): VideoMode {
        player.setVideoMode(player.videoMode.next())
        if (cfg != null && scheduleOn) startPlayback()
        return player.videoMode
    }

    /** Tudo o que interessa no teste de campo, em linhas "rótulo: valor" (rótulo null = título de seção). */
    fun diagnostics(): List<Pair<String?, String?>> {
        val store = Engine.store
        val c = Engine.config
        val fmt = SimpleDateFormat("dd/MM/yyyy HH:mm:ss", ptBr)
        val out = ArrayList<Pair<String?, String?>>()
        fun sec(t: String) = out.add(null to t)
        fun line(k: String, v: String?) = out.add(k to v)

        sec("Aparelho")
        line("Modelo", "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE}, ${Build.HARDWARE})")
        line("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        line("Processador (ABIs)", Build.SUPPORTED_ABIS.joinToString(", "))
        try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val mi = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            line("Memória", "${mi.totalMem / (1024 * 1024)} MB no total, ${mi.availMem / (1024 * 1024)} MB livres" + if (am.isLowRamDevice) " (aparelho de pouca memória)" else "")
        } catch (_: Exception) {
        }
        line("Espaço livre", "${filesDir.usableSpace / (1024 * 1024)} MB")
        try {
            @Suppress("DEPRECATION")
            val d = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay
            val m = d?.mode
            val dm = resources.displayMetrics
            line("Tela (saída)", if (m == null) null else "${m.physicalWidth}×${m.physicalHeight} a ${"%.2f".format(Locale.US, m.refreshRate)} Hz")
            line("Tela (área do app)", "${root.width}×${root.height} px · densidade ${dm.densityDpi} dpi")
        } catch (_: Exception) {
        }
        line("App", "DIGITAL ISP ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" + if (BuildConfig.DEBUG) " depuração" else "")
        line("Ligado há", "${Engine.uptimeSec() / 60} min")

        sec("Quiosque")
        line("É a tela inicial (Home)", if (Kiosk.isHome(this)) "sim" else "NÃO (tela inicial atual: ${Kiosk.homePackage(this) ?: "desconhecida"})")
        line("Device Owner (nível 2)", if (Kiosk.isOwner(this)) "sim" else "não (nível 1)")
        kioskIssues().takeIf { it.isNotEmpty() }?.let { line("Travas recusadas", it) }
        line("Sobrepor a outros apps", if (Settings.canDrawOverlays(this)) "concedida" else "não concedida")
        line("Volta sozinho para a frente", if (Kiosk.canBringToFront(this)) "sim" else "não (só pelo Home ou ao religar)")
        line("Instalar atualização", if (Kiosk.canInstall(this)) "permitido" else "o Android vai perguntar (fontes desconhecidas não liberadas)")
        line("Economia de bateria", Kiosk.batteryStatus(this))
        line("Notificações", if (Kiosk.notificationsOn(this)) "permitidas" else "bloqueadas (não atrapalha)")

        sec("Vídeo")
        line("Player", playerSummary())
        line("Endereço", DiagReport.url(if (Engine.standalone) store.standaloneUrl else c?.stream?.hls))
        if (c?.stream?.backup != null) line("Reserva", DiagReport.url(c.stream.backup))
        out.addAll(player.diagnostics())
        line("Vigia", watchdogMode() + " · fonte: ${wd.source.wire}")
        line("Imagem de fora do ar", when {
            Engine.fallbackImageFile() == null -> if (c?.offlineImage != null) "baixando…" else "nenhuma"
            c?.offlineImage == null || Engine.fallbackImageFile()?.name != c.offlineImage.fileName -> "guardada (a anterior)"
            else -> "guardada"
        })
        line("Layout", c?.layoutRaw)

        sec("Servidor")
        line("Modo", if (Engine.managed) "gerenciado pelo painel" else "avulso")
        if (Engine.managed) {
            line("Endereço do servidor", store.server)
            line("Aparelho no painel", c?.device?.name?.ifEmpty { store.deviceName } ?: store.deviceName)
            line("Última tentativa de sinal de vida", if (Engine.heartbeatTriedAt > 0) "${fmt.format(Date(Engine.heartbeatTriedAt))}: ${Engine.heartbeatResult}" else Engine.heartbeatResult)
            line("Último sinal de vida respondido", if (store.lastHeartbeatAt > 0) fmt.format(Date(store.lastHeartbeatAt)) else "nenhum ainda")
            line("Chamada de senha (tempo real)", if (c?.queue?.enabled == true) QueueLink.status else "desligada")
            line("Conteúdo guardado", Engine.offlineNote.ifEmpty { "${Engine.offlineFiles().size} vídeo(s)" })
            line("Desaparecidos", missingSummary())
            if (c?.signage != null) line("Arquivos da grade", Engine.signageNote.ifEmpty { "conferindo…" })
        }
        line("Margem da tela (overscan)", "${Engine.store.overscanPct}%")
        line("Legendas", captionsSummary())
        line("Rede", when (Engine.net()) { "wifi" -> "Wi-Fi"; "ethernet" -> "cabo"; else -> "sem rede" })

        sec("Relógio e voz")
        val deviceNow = System.currentTimeMillis()
        line("Hora do aparelho", fmt.format(Date(deviceNow)) + " (" + java.util.TimeZone.getDefault().id + ")" + if (ClockCheck.wrong(deviceNow)) " · DATA ERRADA" else "")
        val skew = Engine.serverSkewMs
        line("Hora do servidor", if (skew == null) "ainda sem resposta do servidor" else fmt.format(Date(deviceNow + skew)) + " · " + ClockCheck.skewText(skew))
        line("Voz em português (pt-BR)", voiceStatus())
        line("Som da chamada", callSoundSummary())
        line("Tela interna", internalSummary())
        line("Último erro", store.lastError)
        return out
    }

    fun diagnosticsText(): String = DiagReport.text("DIGITAL ISP ${BuildConfig.VERSION_NAME} · diagnóstico", diagnostics())

    // ------------------------------------------------------------------ teclas e toques

    private fun keyName(code: Int): String? = when (code) {
        KeyEvent.KEYCODE_DPAD_UP -> "UP"
        KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> "OK"
        KeyEvent.KEYCODE_BACK -> "BACK"
        KeyEvent.KEYCODE_MENU -> "MENU"
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> (code - KeyEvent.KEYCODE_0).toString()
        in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> (code - KeyEvent.KEYCODE_NUMPAD_0).toString()
        else -> null
    }

    private val alwaysBlocked = setOf(
        KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE, KeyEvent.KEYCODE_MUTE,
        KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_ASSIST, KeyEvent.KEYCODE_VOICE_ASSIST,
        KeyEvent.KEYCODE_APP_SWITCH, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_TV_INPUT, KeyEvent.KEYCODE_GUIDE,
        KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_BOOKMARK, KeyEvent.KEYCODE_EXPLORER, KeyEvent.KEYCODE_NOTIFICATION,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_REWIND,
    )

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val s = screen
        if (s == null) {
            // Tocando: nenhuma tecla faz nada, a não ser a sequência de saída.
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                if (exitSeq.feed(keyName(code), SystemClock.uptimeMillis())) requirePin { showSettings() }
            }
            return true
        }
        lastKeyAt = SystemClock.uptimeMillis()
        if (code in alwaysBlocked) return true
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            // com o teclado aberto, o Voltar fecha o teclado (o sistema cuida antes de chegar aqui)
            if (event.action == KeyEvent.ACTION_UP) s.onBack()
            return true
        }
        if (s.onKey(event)) return true
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (screen == null) return true // controle com "mouse" ou tela de toque: nada a clicar enquanto toca
        lastKeyAt = SystemClock.uptimeMillis()
        return super.dispatchTouchEvent(ev)
    }

    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        if (screen == null) return true
        return super.dispatchGenericMotionEvent(ev)
    }

    /** Sem menus de contexto nem a barra de copiar/colar dentro do app. */
    override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? = null

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? = null

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // nada: o Voltar não sai do app
    }

    // ------------------------------------------------------------------ captura da tela

    /** Captura a composição (com o vídeo, quando o aparelho deixa) em JPEG de até 400 KB. */
    override fun captureScreen(done: (ByteArray?) -> Unit) {
        val w = stage.width
        val h = stage.height
        if (!visible || w == 0 || h == 0) {
            done(null)
            return
        }
        try {
            val ui = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            stage.draw(Canvas(ui))
            val v = player.videoView
            val rect = Rect()
            if (v != null && v.width > 0 && v.height > 0 && v.isAttachedToWindow) {
                rect.set(0, 0, v.width, v.height)
                stage.offsetDescendantRectToMyCoords(v, rect)
            }
            val finish = { video: Bitmap? ->
                Thread {
                    val bytes = try {
                        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        val cv = Canvas(out)
                        cv.drawColor(Color.BLACK)
                        if (video != null) cv.drawBitmap(video, null, rect, null)
                        cv.drawBitmap(ui, 0f, 0f, null)
                        encode(out)
                    } catch (_: Throwable) {
                        null
                    }
                    handler.post { done(bytes) }
                }.start()
            }
            val canCopy = v != null && !rect.isEmpty && scheduleOn && player.hasMedia
            when {
                !canCopy -> finish(null)
                v is TextureView -> finish(v.getBitmap(v.width / 2, v.height / 2))
                v is SurfaceView && v.holder.surface.isValid -> {
                    val bmp = Bitmap.createBitmap(v.width / 2, v.height / 2, Bitmap.Config.ARGB_8888)
                    PixelCopy.request(v, bmp, { result -> finish(if (result == PixelCopy.SUCCESS) bmp else null) }, handler)
                }
                else -> finish(null)
            }
        } catch (_: Throwable) {
            done(null)
        }
    }

    private fun encode(src: Bitmap): ByteArray? {
        var bmp = src
        val long = maxOf(bmp.width, bmp.height)
        if (long > 1280) {
            val k = 1280f / long
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt(), (bmp.height * k).toInt(), true)
        }
        repeat(4) {
            var q = 80
            while (q >= 40) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                if (out.size() <= SHOT_MAX_BYTES) return out.toByteArray().takeIf { br.com.digitalisp.telas.core.Jpeg.valid(it) }
                q -= 15
            }
            bmp = Bitmap.createScaledBitmap(bmp, bmp.width * 2 / 3, bmp.height * 2 / 3, true)
        }
        return null
    }
}
