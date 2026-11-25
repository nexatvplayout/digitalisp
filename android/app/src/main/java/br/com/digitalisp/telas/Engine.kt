package br.com.digitalisp.telas

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.SystemClock
import br.com.digitalisp.telas.core.Alert
import br.com.digitalisp.telas.core.Alerts
import br.com.digitalisp.telas.core.Brand
import br.com.digitalisp.telas.core.BrandUpdate
import br.com.digitalisp.telas.core.Brands
import br.com.digitalisp.telas.core.ApiErrors
import br.com.digitalisp.telas.core.ApiFailure
import br.com.digitalisp.telas.core.Jpeg
import br.com.digitalisp.telas.core.ConfigParser
import br.com.digitalisp.telas.core.Hex
import br.com.digitalisp.telas.core.ClockAnchor
import br.com.digitalisp.telas.core.ClockCheck
import br.com.digitalisp.telas.core.FallbackImages
import br.com.digitalisp.telas.core.HardwareId
import br.com.digitalisp.telas.core.RecoverStep
import br.com.digitalisp.telas.core.Recovery
import br.com.digitalisp.telas.core.QueueCache
import br.com.digitalisp.telas.core.TrustedClock
import br.com.digitalisp.telas.core.LockCfg
import br.com.digitalisp.telas.core.EmergencyCode
import br.com.digitalisp.telas.core.Missing
import br.com.digitalisp.telas.core.MissingCase
import br.com.digitalisp.telas.core.Internal
import br.com.digitalisp.telas.core.NetErrors
import br.com.digitalisp.telas.core.OfflineItem
import br.com.digitalisp.telas.core.OfflineFetch
import br.com.digitalisp.telas.core.OfflinePlan
import br.com.digitalisp.telas.core.OfflineResponse
import br.com.digitalisp.telas.core.OfflineTransport
import br.com.digitalisp.telas.core.QueueCall
import br.com.digitalisp.telas.core.QueueReducer
import br.com.digitalisp.telas.core.QueueSnapshot
import br.com.digitalisp.telas.core.QueueState
import br.com.digitalisp.telas.core.Pin
import br.com.digitalisp.telas.core.PlayLog
import br.com.digitalisp.telas.core.Signage
import br.com.digitalisp.telas.core.SignageCache
import br.com.digitalisp.telas.core.SignageFile
import br.com.digitalisp.telas.core.RecentAlert
import br.com.digitalisp.telas.core.TelaConfig
import br.com.digitalisp.telas.core.Urls
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.system.exitProcess

/**
 * O "motor" do app, um por processo: configuração em vigor, conversa com o servidor (modo gerenciado), alertas,
 * comandos e o download do conteúdo guardado. A tela ([MainActivity]) só desenha e toca.
 */
object Engine {
    /** O que o motor pede à tela. Sempre chamado na thread principal. */
    interface Ui {
        fun onConfigChanged()
        fun onAlertsChanged()
        fun onUnauthorized()
        fun onOfflineChanged()
        fun reloadPlayer()
        fun captureScreen(done: (ByteArray?) -> Unit)
        fun onQueueChanged(announce: QueueCall?)
        fun onMissingChanged()
        fun onCodesChanged()
        /** TV Corporativa: um arquivo novo ficou pronto no aparelho (imagem, logomarca, foto). */
        fun onSignageFiles() {}
        /** A marca da revenda mudou (nome, cores ou a logo ficou pronta no aparelho). */
        fun onBrandChanged() {}
        /** Comando `identify`: mostrar por 10 s o nome da tela e a posição no conjunto. */
        fun identify() {}
    }

    private const val CLOCK_FLOOR = 1_735_689_600_000L // 2025-01-01: antes disso o relógio do aparelho não é confiável
    private const val OFFLINE_RESERVE = 300L * 1024 * 1024
    private const val PREFIX_QUEDA = "Queda do app: "

    private lateinit var app: Context
    lateinit var store: Store
        private set
    private val ready = AtomicBoolean(false)
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private val startedAt = SystemClock.elapsedRealtime()
    private val loopLock = Object()
    private var loop: Thread? = null
    private val offlineBusy = AtomicBoolean(false)
    @Volatile private var offlineAgain = false
    @Volatile private var forceConfig = false
    @Volatile private var lastOfflineSync = 0L

    @Volatile var ui: Ui? = null
    @Volatile var config: TelaConfig? = null
        private set
    @Volatile var alerts: List<Alert> = emptyList()
        private set
    @Volatile private var recent: RecentAlert? = null

    /** Códigos de emergência hospitalar em vigor (só na tela interna, contrato §17.2). Não ficam guardados: no
     *  reinício, o sinal de vida ou o tempo real trazem de novo. */
    @Volatile var codes: List<EmergencyCode> = emptyList()
        private set


    /** Pessoas desaparecidas em vigor para este aparelho (contrato §8). */
    @Volatile var missing: List<MissingCase> = emptyList()
        private set
    private val photoBusy = AtomicBoolean(false)
    @Volatile private var photoAgain = false
    private val photoRetryAt = java.util.concurrent.ConcurrentHashMap<String, Long>()

    // ---- diagnóstico do sinal de vida e do relógio ----
    /** Hora (relógio do aparelho) da última tentativa de sinal de vida e o que deu. */
    @Volatile var heartbeatTriedAt = 0L
        private set
    @Volatile var heartbeatResult = "nenhuma tentativa ainda"
        private set

    /** Hora do servidor (cabeçalho Date) menos a do aparelho, medida na última resposta; null = ainda sem resposta. */
    @Volatile var serverSkewMs: Long? = null
        private set

    /** Chamada de senha (contrato §7.2). Só muda na thread principal. */
    @Volatile var queueState = QueueState()
        private set

    fun onQueueSnapshot(snap: QueueSnapshot) {
        val old = queueState
        queueState = QueueReducer.onSnapshot(queueState, snap)
        saveQueue(old)
        ui?.onQueueChanged(null)
    }

    fun onQueueCall(call: QueueCall) {
        val old = queueState
        val r = QueueReducer.onCall(queueState, call, SystemClock.uptimeMillis())
        queueState = r.state
        saveQueue(old)
        ui?.onQueueChanged(r.announce)
    }

    /** Guarda o painel de senha como está (sem rede, ele volta assim na partida). */
    private fun saveQueue(old: QueueState) {
        if (QueueCache.same(old, queueState)) return
        store.queueJson = QueueCache.toJson(queueState, config?.queue?.showName == true)
    }

    /** Na partida: o painel de senha guardado, até o servidor responder. */
    private fun restoreQueue() {
        val q = config?.queue ?: return
        if (!q.enabled) return
        QueueCache.restore(store.queueJson, q.showName)?.let { queueState = it }
    }

    /** Preenchidos pela tela a cada segundo; vão no sinal de vida. */
    @Volatile var playerState = "idle"
    @Volatile var playerSource = "hls"
    @Volatile var locked = false

    /** Hora do servidor menos a do aparelho (TV box costuma ligar com o relógio errado). */
    @Volatile private var clockOffset = 0L
    @Volatile var offlineNote = ""
        private set

    val isReady: Boolean get() = ready.get()

    fun init(ctx: Context) {
        if (!ready.compareAndSet(false, true)) return
        app = ctx.applicationContext
        store = Store(app)
        config = store.loadConfig()
        alerts = store.alerts
        recent = store.recentAlert
        missing = store.missing
        brand = Brands.fromStore(store.brandJson)
        clockAnchor = store.clockAnchor
        bootCount = try {
            android.provider.Settings.Global.getInt(app.contentResolver, android.provider.Settings.Global.BOOT_COUNT, -1)
        } catch (_: Exception) {
            -1
        }
        restoreQueue()
        ensureRunning()
        syncOffline()
        syncFallbackImage()
        syncMissingPhotos()
        syncBrandLogo()
        loadPlays()
        syncSignage()
        QueueLink.sync()
        InternalLink.sync()
    }

    // ---- estado ----
    val standalone: Boolean get() = store.mode == Store.MODE_STANDALONE
    val managed: Boolean get() = store.mode == Store.MODE_MANAGED

    /** Pronto para tocar: avulso com endereço, ou gerenciado com token e configuração. */
    val configured: Boolean
        get() = when (store.mode) {
            Store.MODE_STANDALONE -> config != null
            Store.MODE_MANAGED -> config != null && store.token != null
            else -> false
        }

    /** A trava (PIN e sequência) que vale agora, mesmo com o aparelho desativado no painel. */
    fun lockCfg(): LockCfg? = config?.lock ?: store.loadConfig()?.lock

    // ---- hora confiável (core/TrustedClock) ----
    @Volatile private var clockAnchor: ClockAnchor? = null
    @Volatile private var bootCount = -1

    /** A hora certa, ou null se o aparelho não tem como saber (reiniciou sem rede e sem bateria de relógio). */
    fun trustedNow(): Long? =
        TrustedClock.now(System.currentTimeMillis() + clockOffset, SystemClock.elapsedRealtime(), bootCount, clockAnchor)

    /** A hora certa; sem ela, a do aparelho (só para quem não depende dela: confira [clockOk] antes). */
    fun now(): Long = trustedNow() ?: (System.currentTimeMillis() + clockOffset)

    /** Dá para confiar na hora (para mostrar a hora e o horário de ligar/desligar)? */
    fun clockOk(): Boolean = trustedNow() != null

    /**
     * A hora para os vencimentos (alertas, desaparecidos, clima): a certa; sem ela, o mínimo que a hora pode ser (a última
     * boa + o tempo desde que o aparelho ligou); sem nada, 0. Assim o que estava na tela continua até a hora voltar, e só
     * some o que com certeza já venceu.
     */
    fun expiryNow(): Long =
        TrustedClock.forExpiry(trustedNow(), TrustedClock.floor(SystemClock.elapsedRealtime(), bootCount, clockAnchor))

    /** Guarda a última hora boa (a tela chama a cada segundo; o sinal de vida também); grava no disco no máximo 1×/min. */
    fun noteClock() {
        if (!ready.get()) return
        val wall = System.currentTimeMillis() + clockOffset
        if (ClockCheck.wrong(wall)) return
        val next = ClockAnchor(wall, SystemClock.elapsedRealtime(), bootCount)
        if (!TrustedClock.shouldSave(clockAnchor, next)) return
        clockAnchor = next
        store.clockAnchor = next
    }

    /**
     * O servidor não responde por falha de rede (a internet caiu, mesmo com o Wi-Fi/cabo ligado). O vigia do vídeo usa
     * para ir direto aos vídeos guardados. Só o modo gerenciado sabe disso; no avulso, só a falta de rede conta.
     */
    @Volatile var serverUnreachable = false
        private set

    /**
     * O relógio do aparelho está absurdo (TV box sem bateria de relógio: liga em 1970, 2015…)?
     * Nesse estado o https é recusado (certificado "ainda não é válido"); a tela e os ajustes avisam com todas as letras.
     */
    fun deviceClockWrong(): Boolean = ClockCheck.wrong(System.currentTimeMillis())

    /** O último https falhou pela data do aparelho? (Volta a false na primeira resposta e quando o relógio é acertado.) */
    @Volatile var certTimeFail = false

    /** Relógio errado na partida = "Carregando…"; passado o prazo, a frase do relógio (core/StartupClock). */
    fun clockView(): br.com.digitalisp.telas.core.ClockView = br.com.digitalisp.telas.core.StartupClock.view(
        SystemClock.elapsedRealtime(), SystemClock.elapsedRealtime() - startedAt, deviceClockWrong(), certTimeFail,
    )

    /** O relógio do aparelho mudou (acerto pela rede, à mão, fuso): tenta de novo na hora o servidor e a senha. */
    fun onClockChanged() {
        certTimeFail = false
        wake()
        QueueLink.retryNow()
        InternalLink.retryNow()
    }

    fun uptimeSec(): Long = (SystemClock.elapsedRealtime() - startedAt) / 1000

    @Volatile private var netCache: String = "none"
    @Volatile private var netAt = 0L

    /**
     * O tipo de rede. O tique de 1 s e os ajustes perguntam várias vezes seguidas: a resposta vale por 500 ms (cada
     * pergunta ao Android é uma chamada entre processos, que pesa numa TV box fraca; 22/11).
     */
    fun net(): String {
        val now = SystemClock.elapsedRealtime()
        if (netAt != 0L && now - netAt < 500) return netCache
        return readNet().also { netCache = it; netAt = now }
    }

    private fun readNet(): String {
        return try {
            val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> "wifi"
                else -> "none"
            }
        } catch (_: Exception) {
            "none"
        }
    }

    private fun unmetered(): Boolean = try {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        net() != "none" && !cm.isActiveNetworkMetered
    } catch (_: Exception) {
        false
    }

    fun recentAlert(): RecentAlert? {
        // sem hora certa: o último aviso guardado fica como estava, até a hora voltar (ou o mínimo dela passar dos 30 min)
        if (!clockOk()) return recent?.takeIf { expiryNow() - it.endedAt < Alerts.RECENT_MS }
        val r = Alerts.recentAfter(recent, alerts, alerts, now())
        if (r != recent) {
            recent = r
            store.recentAlert = r
        }
        return r
    }

    private fun toUi(block: (Ui) -> Unit) {
        main.post { ui?.let(block) }
    }

    fun noteError(msg: String?) {
        store.lastError = msg?.replace('\n', ' ')?.take(200) ?: ""
    }

    // ---- modo avulso ----
    /** Grava o endereço e o PIN digitados no aparelho. PIN vazio mantém o que já existe. */
    fun saveStandalone(url: String, pin: String?) {
        store.standaloneUrl = url
        if (!pin.isNullOrEmpty()) {
            val salt = Pin.newSalt()
            store.setStandalonePin(salt, Pin.hash(salt, pin))
        }
        store.mode = Store.MODE_STANDALONE
        config = store.loadConfig()
        alerts = emptyList()
        store.alerts = emptyList()
        setMissing(emptyList())
        setCodes(emptyList())
        toUi { it.onConfigChanged() }
    }

    // ---- modo gerenciado ----
    /** Chave de acesso do painel: 8 caracteres A-Z/2-9, com ou sem hífen. Devolve "ABCD-EFGH" ou null. */
    fun normalizeKey(raw: String): String? {
        val k = raw.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
        if (k.length != 8 || k.any { it == '0' || it == '1' }) return null
        return k.substring(0, 4) + "-" + k.substring(4)
    }

    /** Ativa o aparelho (chamar fora da thread principal). Lança [ApiException]/[IOException] com mensagem para a tela. */
    fun activate(server: String, key: String) {
        val origin = Urls.origin(server) ?: throw IOException("Endereço do servidor inválido.")
        if (!Urls.apiAllowed(origin, BuildConfig.DEBUG)) throw IOException("O endereço do servidor precisa começar com https://")
        val res = Api(origin, null).activate(key, deviceInfo())
        synchronized(activationLock) { adopt(origin, res) }
        try {
            fetchConfig(Api(origin, store.token), force = true)
        } catch (e: ApiException) {
            if (e.code == 401) throw e
        } catch (_: Exception) {
            // a configuração vem no próximo sinal de vida
        }
        ensureRunning()
        QueueLink.sync()
        InternalLink.sync()
        wake()
    }

    /** O que vai em `device` na ativação e na recuperação; o hwid (§32) só se o aparelho tiver um ANDROID_ID que sirva. */
    private fun deviceInfo(): JSONObject = JSONObject()
        .put("model", Build.MODEL ?: "")
        .put("android", Build.VERSION.RELEASE ?: "")
        .put("appVersion", BuildConfig.VERSION_NAME)
        .apply { hwid()?.let { put("hwid", it) } }

    private fun hwid(): String? = hwidValue

    // o ANDROID_ID não muda com o app aberto: calcula uma vez
    private val hwidValue: String? by lazy {
        try {
            HardwareId.of(android.provider.Settings.Secure.getString(app.contentResolver, android.provider.Settings.Secure.ANDROID_ID), app.packageName)
        } catch (_: Exception) {
            null
        }
    }

    private val activationLock = Any()

    /** Grava o que a ativação (ou a recuperação) devolveu e passa ao modo gerenciado. */
    private fun adopt(origin: String, res: JSONObject) {
        val token = res.optString("token", "")
        if (token.length < 16) throw IOException("O servidor não devolveu o token do aparelho.")
        store.server = origin
        store.token = token
        store.deviceName = res.optString("name", "")
        store.channel = res.optString("channel", "")
        store.configJson = null
        store.mode = Store.MODE_MANAGED
        config = null
        setBrand(Brands.update(res))
    }

    // ---- licença que sobrevive à reinstalação (§32, core/Recovery) ----
    @Volatile private var recoverGaveUp = false
    private var recoverAttempts = 0

    /** Perguntando ao servidor se este aparelho já tinha uma tela (a tela da chave mostra "procurando…"). */
    @Volatile var recovering = false
        private set

    /**
     * App sem token (reinstalado, ou nunca ativado): pergunta pelo hwid. Chamar na thread do servidor. Devolve quanto esperar
     * até tentar de novo, ou null quando não há mais o que perguntar (voltou, nenhuma tela, ou ativado pela chave no meio).
     */
    private fun tryRecover(): Long? {
        if (!Recovery.shouldTry(store.mode, store.token != null, recoverGaveUp)) return null.also { recovering = false }
        val hw = hwid()
        if (hw == null) {
            recoverGaveUp = true
            recovering = false
            return null
        }
        recovering = true
        val steps = mutableListOf<RecoverStep>()
        for (origin in Recovery.servers(store.server, Store.DEFAULT_SERVER)) {
            if (!Urls.apiAllowed(origin, BuildConfig.DEBUG)) continue
            val step = try {
                val res = Api(origin, null).recover(hw, deviceInfo())
                val took = synchronized(activationLock) {
                    // a chave foi digitada enquanto isso: vale a ativação
                    if (store.token != null) false else { adopt(origin, res); true }
                }
                if (took) {
                    store.wizardDone = true // o aparelho já tinha sido configurado
                    noteError("")
                    try { fetchConfig(Api(origin, store.token), force = true) } catch (_: Exception) { }
                    QueueLink.sync()
                    InternalLink.sync()
                    toUi { it.onConfigChanged() }
                }
                RecoverStep.DONE
            } catch (e: ApiException) {
                Recovery.step(e.code)
            } catch (_: Exception) {
                Recovery.step(null)
            }
            steps += step
            if (step == RecoverStep.DONE) break
        }
        return when (val step = Recovery.combine(steps)) {
            RecoverStep.DONE -> {
                recovering = false
                1L // segue direto para o sinal de vida
            }
            RecoverStep.NONE -> {
                recoverGaveUp = true
                recovering = false // a tela da chave tira o "procurando…" no próximo tique
                null
            }
            else -> Recovery.delayMs(step, ++recoverAttempts)
        }
    }

    private fun fetchConfig(api: Api, force: Boolean) {
        val body = api.config(if (force) null else config?.rev) ?: return
        val parsed = ConfigParser.parse(body)
        setBrand(Brands.update(body))
        // o último clima bom fica guardado (até 6 h) para a tela não perder a zona de clima numa configuração sem ele
        if (parsed.weather != null) try { store.weatherJson = JSONObject(body).optJSONObject("weather")?.toString() } catch (_: Exception) { }
        store.configJson = body
        if (parsed.device.name.isNotEmpty()) store.deviceName = parsed.device.name
        config = parsed
        toUi { it.onConfigChanged() }
        QueueLink.sync()
        InternalLink.sync()
        syncOffline()
        syncFallbackImage()
        syncSignage()
        Updater.maybeUpdate(app, store, parsed)
    }

    /**
     * O botão "Procurar atualização" dos ajustes (chamar fora da thread principal): busca a configuração agora e confere o
     * `update` sem esperar o intervalo entre tentativas. Devolve a frase para a tela.
     */
    fun checkUpdateNow(): String {
        val c = config
        val token = store.token
        if (!managed || token == null || c == null) return "Sem servidor (modo avulso ou sem ativação): a atualização vem pelo painel."
        try {
            fetchConfig(Api(store.server, token), force = true)
        } catch (e: Exception) {
            return "Sem resposta do servidor (${e.javaClass.simpleName}). Confira a internet e tente de novo."
        }
        val action = Updater.maybeUpdate(app, store, config ?: c, manual = true)
        if (action == br.com.digitalisp.telas.core.UpdateAction.DOWNLOAD && !Kiosk.canInstall(app)) {
            return Updater.status + " O Android vai pedir para permitir que este app instale apps: permita uma vez."
        }
        return Updater.status
    }

    fun ensureRunning() {
        synchronized(loopLock) {
            if (loop?.isAlive == true) return
            loop = Thread({ runLoop() }, "telas-servidor").apply {
                isDaemon = true
                start()
            }
        }
    }

    /** Adianta o próximo sinal de vida (depois de ativar, de "recarregar"…). */
    fun wake() {
        synchronized(loopLock) { loopLock.notifyAll() }
    }

    fun requestConfig() {
        forceConfig = true
        wake()
    }

    private fun pause(ms: Long) {
        synchronized(loopLock) {
            try { loopLock.wait(ms) } catch (_: InterruptedException) { }
        }
    }

    private fun runLoop() {
        while (true) {
            val token = if (managed) store.token else null
            if (token == null) {
                // sem token: talvez o app tenha sido reinstalado num aparelho que já tinha tela (§32)
                pause(tryRecover() ?: 60_000L)
                continue
            }
            var waitSec = config?.heartbeatSec ?: ConfigParser.DEFAULT_HEARTBEAT
            heartbeatTriedAt = System.currentTimeMillis()
            try {
                val api = Api(store.server, token)
                if (config == null || forceConfig) {
                    val force = forceConfig || config == null
                    forceConfig = false
                    fetchConfig(api, force)
                }
                heartbeat(api)
                QueueLink.sync() // religa o tempo real da senha se a thread tiver morrido
                InternalLink.sync()
                // baixar de novo o que falhou ou ficou esperando rede
                if (SystemClock.elapsedRealtime() - lastOfflineSync > 10 * 60_000L) {
                    syncOffline()
                    syncFallbackImage()
                    syncBrandLogo()
                    syncSignage()
                }
                waitSec = config?.heartbeatSec ?: waitSec
                heartbeatResult = "respondido (HTTP 200)"
                certTimeFail = false
                serverUnreachable = false
                noteClock()
            } catch (e: ApiException) {
                heartbeatResult = "o servidor respondeu com erro ${e.code}: ${e.message}"
                serverUnreachable = false
                when (e.failure) {
                    ApiFailure.REVOKED -> unauthorized()
                    // modo desligado para o cliente: o token e a última configuração ficam; segue tocando e tenta mais tarde
                    ApiFailure.UNAVAILABLE -> {
                        noteError("Servidor: serviço das telas indisponível para este cliente (403); segue a última configuração.")
                        waitSec = maxOf(waitSec, ApiErrors.UNAVAILABLE_RETRY_SEC)
                    }
                    ApiFailure.OTHER -> noteError("Servidor: ${e.message}")
                }
            } catch (e: Exception) {
                val causes = NetErrors.causes(e)
                serverUnreachable = true
                val clockWrong = ClockCheck.wrong(System.currentTimeMillis())
                certTimeFail = NetErrors.dateRelated(causes, clockWrong)
                val why = NetErrors.describe(causes, clockWrong)
                heartbeatResult = "sem resposta: $why"
                // na partida, relógio ainda acertando: não é erro (StartupClock), só "carregando"
                if (clockView() != br.com.digitalisp.telas.core.ClockView.LOADING) noteError("Sem resposta do servidor: $why")
            }
            savePlays() // sem rede a conta de exibição também fica no disco
            // relógio errado: tenta de novo logo (na partida a cada 2,5 s; depois a cada 10 s no máximo)
            when (clockView()) {
                br.com.digitalisp.telas.core.ClockView.LOADING -> pause(br.com.digitalisp.telas.core.StartupClock.RETRY_MS)
                br.com.digitalisp.telas.core.ClockView.MESSAGE -> pause(minOf(waitSec * 1000L, 10_000L))
                else -> pause(waitSec * 1000L)
            }
        }
    }

    /** 401: o aparelho foi desativado no painel. Apaga o token e volta à tela da chave. */
    private fun unauthorized() {
        store.wipeToken()
        alerts = emptyList()
        store.alerts = emptyList()
        setMissing(emptyList())
        setCodes(emptyList())
        noteError("Aparelho desativado no painel (401).")
        QueueLink.sync()
        InternalLink.sync()
        toUi { it.onUnauthorized() }
    }

    private fun heartbeat(api: Api) {
        val body = JSONObject()
            .put("rev", config?.rev ?: "")
            .put("state", playerState)
            .put("source", playerSource)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("uptimeSec", uptimeSec())
            .put("net", net())
            .put("lastError", store.lastError.ifEmpty { null } ?: JSONObject.NULL)
            .put("locked", locked)
        // o vínculo da licença com o aparelho para a tela ativada antes dele (§32); o servidor grava uma vez
        hwid()?.let { body.put("hwid", it) }
        // TV Corporativa (§4.3): o relatório de exibição; só é descontado depois do 200
        val playBatch = plays.pending()
        if (playBatch != null) body.put("plays", PlayLog.wire(playBatch)).put("playsDay", playBatch.day)
        val (res, dateMs) = api.heartbeat(body)
        if (playBatch != null) plays.commit(playBatch)
        savePlays()
        store.lastHeartbeatAt = System.currentTimeMillis()
        if (dateMs > CLOCK_FLOOR) {
            val off = dateMs - System.currentTimeMillis()
            serverSkewMs = off
            clockOffset = if (kotlin.math.abs(off) > 120_000L) off else 0L
        }
        if (store.lastError.startsWith("Sem resposta") || store.lastError.startsWith("Servidor:")) store.lastError = ""

        val fresh = Alerts.parse(res.optJSONArray("alerts"))
        val old = alerts
        recent = Alerts.recentAfter(recent, old, fresh, expiryNow())
        store.recentAlert = recent
        if (fresh != old) {
            alerts = fresh
            store.alerts = fresh
            toUi { it.onAlertsChanged() }
        }

        // pessoas desaparecidas: campo ausente = recurso desligado (servidor antigo)
        setMissing(Missing.parse(res.optJSONArray("missing")))
        // códigos de emergência (§17.2): só a tela interna recebe a chave; sem ela, nada
        val codeList = if (res.has("codes")) Internal.codes(res.optJSONArray("codes")) else emptyList()
        main.post { setCodes(codeList) }
        syncMissingPhotos()

        val rev = ConfigParser.str(res, "rev")
        if (rev != null && rev != config?.rev) fetchConfig(api, force = true)

        val cmds = res.optJSONArray("commands")
        if (cmds != null) for (i in 0 until cmds.length()) {
            val c = cmds.optJSONObject(i) ?: continue
            runCommand(api, c.optLong("id", 0L), ConfigParser.str(c, "type") ?: "")
        }
    }

    private fun done(api: Api, id: Long, ok: Boolean, detail: String) {
        try { api.commandDone(id, ok, detail) } catch (e: ApiException) { if (e.failure != ApiFailure.OTHER) throw e } catch (_: Exception) { }
    }

    private fun runCommand(api: Api, id: Long, type: String) {
        when (type) {
            "reload" -> {
                try {
                    fetchConfig(api, force = true)
                    toUi { it.reloadPlayer() }
                    done(api, id, true, "Configuração e vídeo recarregados.")
                } catch (e: ApiException) {
                    if (e.code == 401) throw e
                    done(api, id, false, "Falha ao buscar a configuração: ${e.message}")
                }
            }
            "restart-app" -> {
                done(api, id, true, "Reiniciando o app.")
                restartApp()
            }
            "reboot" -> {
                if (!Kiosk.isOwner(app)) {
                    done(api, id, false, Kiosk.reboot(app) ?: "Recusado.")
                } else {
                    // responde antes: depois do pedido o aparelho cai
                    done(api, id, true, "Reiniciando o aparelho.")
                    val err = Kiosk.reboot(app)
                    if (err != null) noteError(err)
                }
            }
            "screenshot" -> {
                val jpeg = capture()
                if (jpeg == null) {
                    done(api, id, false, "Não foi possível capturar a tela (app fora da tela ou captura recusada).")
                } else if (!Jpeg.valid(jpeg)) {
                    done(api, id, false, "A captura não saiu como um JPEG válido de até 400 KB.")
                } else {
                    try {
                        api.screenshot(jpeg)
                        done(api, id, true, "Captura enviada (${jpeg.size / 1024} KB).")
                    } catch (e: ApiException) {
                        // 413, 415 e 429 (mais de 12 por minuto): só responde ao comando, sem virar "último erro"
                        if (e.failure != ApiFailure.OTHER) throw e
                        done(api, id, false, "Envio da captura recusado (${e.code}): ${e.message}")
                    }
                }
            }
            "identify" -> {
                toUi { it.identify() }
                done(api, id, true, "Identificação na tela por 10 s.")
            }
            else -> done(api, id, false, "Comando desconhecido nesta versão do app: ${type.take(40)}")
        }
    }

    private fun capture(): ByteArray? {
        val latch = CountDownLatch(1)
        var out: ByteArray? = null
        main.post {
            val u = ui
            if (u == null) latch.countDown()
            else u.captureScreen { bytes ->
                out = bytes
                latch.countDown()
            }
        }
        latch.await(15, TimeUnit.SECONDS)
        return out
    }

    /** Fecha o processo e reabre a tela em seguida. */
    fun restartApp() {
        Alarms.scheduleRestart(app, 1500)
        main.postDelayed({
            android.os.Process.killProcess(android.os.Process.myPid())
            exitProcess(0)
        }, 300)
    }

    /** Registra a queda e agenda a reabertura; quedas em série esperam mais para não virar laço. */
    fun onCrash(ctx: Context, e: Throwable) {
        try {
            val s = if (ready.get()) store else Store(ctx)
            val now = System.currentTimeMillis()
            val times = (s.crashTimes + now).filter { now - it < 5 * 60_000L }
            s.crashTimes = times
            s.lastError = PREFIX_QUEDA + e.javaClass.simpleName
            Alarms.scheduleRestart(ctx.applicationContext, if (times.size >= 5) 60_000L else 2_000L)
        } catch (_: Throwable) {
        }
    }

    // ---- conferência do ao vivo por fora do player ----
    /** O endereço responde como um HLS (ou, se não for .m3u8, pelo menos com 200)? */
    fun probe(url: String?): Boolean {
        val u = Urls.clean(url) ?: return false
        if (!Urls.streamAllowed(u, standalone)) return false
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(u).openConnection() as HttpURLConnection
            conn.connectTimeout = 6000
            conn.readTimeout = 6000
            conn.useCaches = false
            conn.setRequestProperty("Range", "bytes=0-1023")
            val code = conn.responseCode
            if (code != 200 && code != 206) return false
            val buf = ByteArray(16)
            val n = conn.inputStream.use { it.read(buf) }
            val head = if (n > 0) String(buf, 0, n, Charsets.ISO_8859_1) else ""
            !u.substringBefore('?').lowercase().endsWith(".m3u8") || head.contains("#EXTM3U")
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    // ---- conteúdo guardado ----
    private fun offlineDir(): File = File(app.filesDir, "offline").apply { mkdirs() }

    /** Os vídeos já baixados e conferidos, na ordem da configuração. */
    fun offlineFiles(): List<File> {
        val cfg = config ?: return emptyList()
        val dir = offlineDir()
        return cfg.offline.filter(OfflinePlan::valid).distinctBy { it.sha256 }.mapNotNull { item ->
            File(dir, OfflinePlan.fileName(item)).takeIf { it.isFile && it.length() == item.bytes }
        }
    }

    /** Baixa em segundo plano o que falta e apaga o que saiu da lista. Só em Wi-Fi/cabo sem franquia. */
    fun syncOffline() {
        if (!ready.get()) return
        lastOfflineSync = SystemClock.elapsedRealtime()
        if (!offlineBusy.compareAndSet(false, true)) {
            offlineAgain = true
            return
        }
        Thread({
            try {
                do {
                    offlineAgain = false
                    syncOfflineOnce()
                } while (offlineAgain)
            } catch (e: Exception) {
                offlineNote = "Falha ao baixar (${e.javaClass.simpleName})"
            } finally {
                offlineBusy.set(false)
            }
        }, "telas-guardados").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    private fun syncOfflineOnce() {
        val items = config?.offline ?: emptyList()
        val dir = offlineDir()
        val existing = (dir.listFiles() ?: emptyArray()).filter { it.isFile }.associate { it.name to it.length() }
        val plan = OfflinePlan.reconcile(items, existing, dir.usableSpace, OFFLINE_RESERVE)
        var changed = false
        for (name in plan.delete) if (File(dir, name).delete()) changed = true
        if (changed) toUi { it.onOfflineChanged() }
        var failed = 0
        for (item in plan.download) {
            if (offlineAgain) return
            if (!unmetered()) {
                offlineNote = "Esperando Wi-Fi ou cabo para baixar ${plan.download.size} vídeo(s)."
                return
            }
            if (download(item, dir)) toUi { it.onOfflineChanged() } else failed++
        }
        offlineNote = buildString {
            append("${plan.keep.size + plan.download.size - failed} de ${plan.keep.size + plan.download.size + plan.skipped.size} guardados")
            if (plan.skipped.isNotEmpty()) append("; ${plan.skipped.size} sem espaço")
            if (failed > 0) append("; $failed com falha")
        }
    }

    /** Transporte de verdade para o [OfflineFetch]: HttpURLConnection, com Range para continuar. */
    /** O último motivo de um arquivo não ter baixado (HTTP 403 em host…), para o diagnóstico e o sinal de vida. */
    @Volatile private var lastFetchError: String? = null

    private fun host(url: String): String = try { URL(url).host } catch (_: Exception) { "?" }

    /** Arquivos da grade (TV Corporativa): quantos dos pedidos estão prontos e o último erro de download. */
    @Volatile var signageNote = ""
        private set

    private val httpTransport = OfflineTransport { url, from ->
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.instanceFollowRedirects = true
        if (from > 0) conn.setRequestProperty("Range", "bytes=$from-")
        val code = try { conn.responseCode } catch (e: IOException) {
            lastFetchError = "${e.javaClass.simpleName} em ${host(url)}"
            throw e
        }
        if (code != 200 && code != 206) {
            conn.disconnect()
            lastFetchError = "HTTP $code em ${host(url)}"
            throw IOException("HTTP $code")
        }
        OfflineResponse(code, conn.inputStream)
    }

    /** Baixa um item. sha256 que não confere apaga o arquivo; a lista é repassada a cada 10 min e ele baixa de novo. */
    private fun download(item: OfflineItem, dir: File): Boolean {
        val r = OfflineFetch.fetch(item, dir, httpTransport) {
            offlineAgain && config?.offline?.none { it.sha256 == item.sha256 } == true
        }
        if (r == OfflineFetch.Result.BAD_HASH) noteError("Vídeo guardado não confere (sha256); será baixado de novo.")
        return r == OfflineFetch.Result.OK
    }

    fun sha256(file: File): String = OfflineFetch.sha256(file)

    // ---- códigos de emergência da tela interna ----
    /** O tempo real da tela interna trouxe a lista nova de códigos (thread principal). */
    fun onCodes(list: List<EmergencyCode>) = setCodes(list)

    private fun setCodes(fresh: List<EmergencyCode>) {
        if (fresh == codes) return
        codes = fresh
        toUi { it.onCodesChanged() }
    }

    // ---- pessoas desaparecidas: lista e fotos ----
    private fun setMissing(fresh: List<MissingCase>) {
        if (fresh == missing) return
        missing = fresh
        store.missing = fresh
        toUi { it.onMissingChanged() }
    }

    private fun missingDir(): File = File(app.filesDir, "missing").apply { mkdirs() }

    /** A foto do caso, só se já foi baixada e conferida (sha256 e tamanho). Sem ela, a tela desenha a silhueta. */
    fun missingPhotoFile(c: MissingCase): File? {
        val p = c.photo ?: return null
        return File(missingDir(), p.fileName).takeIf { it.isFile && it.length() == p.bytes }
    }

    fun missingPhotoCount(): Int = missing.mapNotNull { missingPhotoFile(it)?.name }.distinct().size

    /**
     * Baixa (uma vez por foto) as fotos que faltam, confere o sha256 e o tamanho, e apaga as de quem saiu da lista.
     * Foto que não confere é apagada e só é tentada de novo depois de 30 min; falha de rede, depois de 2 min.
     */
    fun syncMissingPhotos() {
        if (!ready.get()) return
        if (!photoBusy.compareAndSet(false, true)) {
            photoAgain = true
            return
        }
        Thread({
            try {
                do {
                    photoAgain = false
                    val dir = missingDir()
                    val existing = (dir.listFiles() ?: emptyArray()).filter { it.isFile }.associate { it.name to it.length() }
                    val plan = Missing.photoPlan(missing, existing)
                    for (name in plan.delete) File(dir, name).delete()
                    var got = false
                    for (p in plan.download) {
                        val now = SystemClock.elapsedRealtime()
                        if (now < (photoRetryAt[p.sha256] ?: 0L) || net() == "none") continue
                        when (OfflineFetch.fetchAs(p.fileName, p.asItem(), dir, httpTransport)) {
                            OfflineFetch.Result.OK -> {
                                photoRetryAt.remove(p.sha256)
                                got = true
                            }
                            OfflineFetch.Result.BAD_HASH -> {
                                photoRetryAt[p.sha256] = now + 30 * 60_000L
                                noteError("Foto de pessoa desaparecida não confere (sha256 ou tamanho); o caso aparece sem foto.")
                            }
                            else -> photoRetryAt[p.sha256] = now + 2 * 60_000L
                        }
                    }
                    if (got || plan.delete.isNotEmpty()) toUi { it.onMissingChanged() }
                } while (photoAgain)
            } catch (_: Exception) {
            } finally {
                photoBusy.set(false)
            }
        }, "telas-fotos").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    /** Apaga tudo e volta à escolha do modo. */
    fun resetAll() {
        store.wipeAll()
        config = null
        queueState = QueueState()
        QueueLink.sync()
        InternalLink.sync()
        alerts = emptyList()
        recent = null
        missing = emptyList()
        codes = emptyList()
        offlineDir().listFiles()?.forEach { it.delete() }
        missingDir().listFiles()?.forEach { it.delete() }
        fallbackDir().listFiles()?.forEach { it.delete() }
        fallbackShown = null
        brand = null
        brandDir().listFiles()?.forEach { it.delete() }
        brandShown = null
        toUi { it.onBrandChanged() }
        signageDir().listFiles()?.forEach { it.delete() }
        plays.load(null)
        playsFile().delete()
    }

    // ---- imagem para quando nada toca (offline.image, 14/11) ----
    private fun fallbackDir(): File = File(app.filesDir, "imagem").apply { mkdirs() }
    private val fallbackBusy = AtomicBoolean(false)
    @Volatile private var fallbackAgain = false
    @Volatile private var fallbackShown: String? = null
    @Volatile private var fallbackRetryAt = 0L

    /** A imagem guardada para a área do vídeo (a pedida ou, enquanto ela não baixa, a anterior); null = nenhuma. */
    fun fallbackImageFile(): File? = fallbackShown?.let { File(fallbackDir(), it) }?.takeIf { it.isFile }

    /** Baixa a imagem pedida, confere o sha256 e só então troca a anterior. Sem imagem na configuração, apaga a guardada. */
    fun syncFallbackImage() {
        if (!ready.get()) return
        if (!fallbackBusy.compareAndSet(false, true)) {
            fallbackAgain = true
            return
        }
        Thread({
            try {
                do {
                    fallbackAgain = false
                    // sem configuração ainda (ou modo avulso), não mexe na guardada
                    val cfg = config ?: break
                    if (!managed) break
                    val dir = fallbackDir()
                    fun existing() = (dir.listFiles() ?: emptyArray()).filter { it.isFile }.associate { it.name to it.length() }
                    var plan = FallbackImages.plan(cfg.offlineImage, existing())
                    val img = plan.download
                    if (img != null && net() != "none" && SystemClock.elapsedRealtime() >= fallbackRetryAt) {
                        when (OfflineFetch.fetchAs(img.fileName, img.asItem(), dir, httpTransport)) {
                            OfflineFetch.Result.OK -> fallbackRetryAt = 0L
                            OfflineFetch.Result.BAD_HASH -> {
                                fallbackRetryAt = SystemClock.elapsedRealtime() + 30 * 60_000L
                                noteError("Imagem de fora do ar não confere (sha256 ou tamanho); segue a anterior.")
                            }
                            else -> fallbackRetryAt = SystemClock.elapsedRealtime() + 2 * 60_000L
                        }
                        plan = FallbackImages.plan(cfg.offlineImage, existing())
                    }
                    for (name in plan.delete) File(dir, name).delete()
                    if (plan.show != fallbackShown) {
                        fallbackShown = plan.show
                        toUi { it.onOfflineChanged() }
                    }
                } while (fallbackAgain)
            } catch (_: Exception) {
            } finally {
                fallbackBusy.set(false)
            }
        }, "telas-imagem").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    // ---- marca da revenda (docs/CONTRATO-APP-MARCA.md) ----
    /** A marca guardada; null = neutro (antes do cadastro, ou o servidor não mandou). */
    @Volatile var brand: Brand? = null
        private set
    private fun brandDir(): File = File(app.filesDir, "marca").apply { mkdirs() }
    private val brandBusy = AtomicBoolean(false)
    @Volatile private var brandAgain = false
    @Volatile private var brandShown: String? = null
    @Volatile private var brandRetryAt = 0L

    private fun setBrand(u: BrandUpdate) {
        val next = Brands.apply(brand, u)
        if (next == brand) return
        brand = next
        store.brandJson = next?.toJson()?.toString()
        toUi { it.onBrandChanged() }
        syncBrandLogo()
    }

    /** A logo guardada (a pedida ou, enquanto ela não baixa, a anterior); null = nenhuma. */
    fun brandLogoFile(): File? = brandShown?.let { File(brandDir(), it) }?.takeIf { it.isFile }

    /** Baixa a logo pedida, confere tamanho e SHA-256 e só então troca a anterior. Marca sem logo: apaga a guardada. */
    fun syncBrandLogo() {
        if (!ready.get()) return
        if (!brandBusy.compareAndSet(false, true)) {
            brandAgain = true
            return
        }
        Thread({
            try {
                do {
                    brandAgain = false
                    val logo = brand?.logo
                    val dir = brandDir()
                    fun existing() = (dir.listFiles() ?: emptyArray()).filter { it.isFile }.associate { it.name to it.length() }
                    var plan = Brands.plan(logo, existing())
                    val want = plan.download
                    if (want != null && net() != "none" && SystemClock.elapsedRealtime() >= brandRetryAt) {
                        when (OfflineFetch.fetchAs(want.fileName, want.asItem(), dir, httpTransport)) {
                            OfflineFetch.Result.OK -> brandRetryAt = 0L
                            OfflineFetch.Result.BAD_HASH -> {
                                brandRetryAt = SystemClock.elapsedRealtime() + 30 * 60_000L
                                noteError("Logo da revenda não confere (SHA-256 ou tamanho); segue a anterior.")
                            }
                            else -> brandRetryAt = SystemClock.elapsedRealtime() + 2 * 60_000L
                        }
                        plan = Brands.plan(logo, existing())
                    }
                    for (name in plan.delete) File(dir, name).delete()
                    if (plan.show != brandShown) {
                        brandShown = plan.show
                        toUi { it.onBrandChanged() }
                    }
                } while (brandAgain)
            } catch (_: Exception) {
            } finally {
                brandBusy.set(false)
            }
        }, "telas-marca").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    // ---- TV Corporativa (docs/TV-CORPORATIVA.md §4): arquivos guardados e o relatório de exibição ----
    private fun signageDir(): File = File(app.filesDir, "signage").apply { mkdirs() }
    private val signageBusy = AtomicBoolean(false)
    @Volatile private var signageAgain = false
    private val signageRetryAt = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /** Contagem do que apareceu nas zonas (vai no sinal de vida como `plays`). */
    val plays = PlayLog()
    private fun playsFile(): File = File(app.filesDir, "plays.json")

    private fun loadPlays() {
        try {
            val f = playsFile()
            if (f.isFile) plays.load(f.readText())
        } catch (_: Exception) {
        }
    }

    /** Grava a conta no disco (no máximo uma vez por sinal de vida; só se mudou). */
    private fun savePlays() {
        if (!plays.dirty) return
        try {
            val f = playsFile()
            val tmp = File(f.path + ".tmp")
            tmp.writeText(plays.toJson())
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (_: Exception) {
        }
    }

    /** O clima que vale: o da configuração ou, sem ele, o último bom guardado (até 6 h). */
    fun weather(): br.com.digitalisp.telas.core.WeatherCfg? {
        config?.weather?.let { return it }
        val saved = try { store.weatherJson?.let { ConfigParser.weather(JSONObject(it)) } } catch (_: Exception) { null } ?: return null
        return saved.takeIf { it.at > 0L && it.fresh(now()) }
    }

    /** O dia (no fuso do modo) para a conta de exibição. */
    fun playsDay(): String = Signage.dayOf(now(), config?.signage?.tz ?: Signage.DEFAULT_TZ)

    /** O arquivo da TV Corporativa já baixado e conferido; null = ainda não (a tela pula o item). */
    fun signageFile(f: SignageFile): File? = if (ready.get()) SignageCache.ready(signageDir(), f) else null

    /** Baixa (em segundo plano) as imagens da TV Corporativa e apaga o que passou do teto. Sem `signage`, só arruma a pasta. */
    fun syncSignage() {
        if (!ready.get()) return
        if (!signageBusy.compareAndSet(false, true)) {
            signageAgain = true
            return
        }
        Thread({
            try {
                do {
                    signageAgain = false
                    val cfg = config ?: break
                    if (!managed) break
                    val wx = weather()
                    val wanted = cfg.signage?.files().orEmpty() + listOfNotNull(wx?.art, wx?.artPort)
                    val dir = signageDir()
                    if (cfg.signage == null) {
                        // modo desligado (ou servidor sem ele): nada guardado
                        dir.listFiles()?.forEach { it.delete() }
                        break
                    }
                    SignageCache.sync(
                        dir, wanted, httpTransport, System.currentTimeMillis(),
                        skip = { f -> net() == "none" || SystemClock.elapsedRealtime() < (signageRetryAt[f.sha256] ?: 0L) },
                        onResult = { f, r ->
                            when (r) {
                                OfflineFetch.Result.OK -> signageRetryAt.remove(f.sha256)
                                OfflineFetch.Result.BAD_HASH -> {
                                    signageRetryAt[f.sha256] = SystemClock.elapsedRealtime() + 30 * 60_000L
                                    noteError("Imagem da TV Corporativa não confere (sha256 ou tamanho); o item fica de fora.")
                                }
                                else -> {
                                    signageRetryAt[f.sha256] = SystemClock.elapsedRealtime() + 2 * 60_000L
                                    // vai no sinal de vida (lastError): o painel vê por que a imagem não aparece
                                    noteError("Arquivo da grade não baixou (${lastFetchError ?: "sem conexão"}); tento de novo em 2 min.")
                                }
                            }
                            if (r == OfflineFetch.Result.OK) toUi { it.onSignageFiles() }
                        },
                        cancelled = { signageAgain },
                    )
                    val ready = wanted.count { signageFile(it) != null }
                    signageNote = "$ready de ${wanted.size} arquivo(s) prontos" + (if (ready < wanted.size) lastFetchError?.let { " · último erro: $it" }.orEmpty() else "")
                } while (signageAgain)
            } catch (_: Exception) {
            } finally {
                signageBusy.set(false)
            }
        }, "telas-signage").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }
}
