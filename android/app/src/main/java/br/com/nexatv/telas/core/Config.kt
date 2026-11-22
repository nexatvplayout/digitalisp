package br.com.nexatv.telas.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Layouts que o app desenha. `lbar` (em L) = vídeo, coluna lateral à direita e a faixa de avisos embaixo, na largura
 * toda. Desconhecido vira FULL.
 */
enum class Layout { FULL, TICKER, SIDE, LBAR, PORTRAIT, QUEUE }

data class DeviceCfg(val id: Long, val name: String, val office: String, val officeType: String, val region: String)
data class StreamCfg(val hls: String?, val backup: String?, val volume: Int, val muted: Boolean)
data class TickerCfg(val items: List<String>, val speed: Int)
data class SideCfg(val widgets: List<String>, val qrUrl: String?, val title: String?)
data class LockCfg(val pinHash: String, val pinSalt: String, val exitSeq: List<String>) {
    val hasPin: Boolean get() = pinHash.isNotEmpty()
}
data class OfflineItem(val url: String, val sha256: String, val bytes: Long)

/** Minutos desde a meia-noite; `days` com 0 = domingo … 6 = sábado (7 também vale como domingo). Vazio = todo dia. */
data class ScheduleCfg(val onMin: Int, val offMin: Int, val days: Set<Int>)

/** Clima (contrato §7.1). `icon`: clear | cloudy | partly | rain | storm | fog. `at` = quando o servidor mediu (epoch ms). */
data class WeatherCfg(val city: String, val tempC: Int?, val condition: String, val icon: String, val at: Long) {
    /** Clima velho demais (aparelho dias sem rede) engana: some depois de 3 h. Sem `at`, vale. */
    fun fresh(now: Long): Boolean = at <= 0L || now - at < MAX_AGE_MS

    companion object {
        const val MAX_AGE_MS = 3 * 60 * 60 * 1000L
        val ICONS = setOf("clear", "cloudy", "partly", "rain", "storm", "fog")
    }
}

/** Cartão de informação da repartição (merenda, escala, avisos), já em texto. */
data class CardCfg(val id: String, val title: String, val lines: List<String>, val seconds: Int)

/** Chamada de senha. Ausente = desligada. */
data class QueueCfg(val enabled: Boolean = false, val voice: Boolean = false, val title: String = "", val showName: Boolean = false, val pair: List<Long> = emptyList())

/** Atualização do próprio app (campo opcional do /config, só https). Sem o campo, nada acontece. */
data class UpdateCfg(val url: String, val sha256: String, val versionCode: Int)

data class TelaConfig(
    val rev: String,
    val device: DeviceCfg,
    val stream: StreamCfg,
    val layoutRaw: String,
    val layout: Layout,
    val ticker: TickerCfg,
    val side: SideCfg,
    val lock: LockCfg,
    val offline: List<OfflineItem>,
    val schedule: ScheduleCfg?,
    val heartbeatSec: Int,
    val update: UpdateCfg?,
    val weather: WeatherCfg? = null,
    val cards: List<CardCfg> = emptyList(),
    val queue: QueueCfg = QueueCfg(),
    /** Legendas da programação (contrato §14); ausente = desligadas. */
    val captions: CaptionsCfg = CaptionsCfg(),
    /** Imagem para a área do vídeo quando nada toca (`offline.image`, 14/11); null = sem imagem. */
    val offlineImage: FallbackImage? = null,
    /** Tema dos painéis de senha do §15 (cor e claro/escuro); ausente = azul escuro. */
    val theme: ThemeCfg = ThemeCfg(),
    /** Comunicação interna (§17): só na tela interna; null = tela pública. Os avisos já entram em [cards]. */
    val internal: InternalCfg? = null,
    /** Som da chamada de senha (§16); null = servidor sem o campo. */
    val callSound: CallSoundCfg? = null,
    /** TV Corporativa (docs/TV-CORPORATIVA.md §4): layout por zonas e playlists; null = o layout de sempre. */
    val signage: SignageCfg? = null,
) {
    /** Layout `queue` sem a senha ligada na repartição é desenhado como `side`. */
    val effectiveLayout: Layout get() = if (layout == Layout.QUEUE && !queue.enabled) Layout.SIDE else layout

    /** A faixa de avisos aparece? Só nos layouts que têm faixa e com pelo menos um aviso (`lbar` sem aviso fica igual ao `side`). */
    val showsTicker: Boolean
        get() = ticker.items.isNotEmpty() && effectiveLayout.let { it == Layout.TICKER || it == Layout.LBAR || it == Layout.PORTRAIT }

    /** A coluna lateral aparece? (O layout `queue` monta a dele à parte.) */
    val showsSide: Boolean
        get() = effectiveLayout.let { it == Layout.SIDE || it == Layout.LBAR || it == Layout.PORTRAIT }
}

object Urls {
    /** Devolve o endereço limpo se for http(s) com host; senão null. */
    fun clean(raw: String?): String? {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty() || s.any { it.isWhitespace() || it.code < 0x20 }) return null
        return try {
            val u = URI(s)
            val scheme = u.scheme?.lowercase()
            if ((scheme == "http" || scheme == "https") && !u.host.isNullOrEmpty()) s else null
        } catch (_: Exception) {
            null
        }
    }

    fun isHttps(url: String?): Boolean = clean(url)?.lowercase()?.startsWith("https://") == true

    /** Vídeo: https sempre; http só no modo avulso (digitado por quem instalou). */
    fun streamAllowed(url: String?, standalone: Boolean): Boolean =
        clean(url) != null && (isHttps(url) || standalone)

    /** API: sempre https; http só em build de depuração e para localhost ou 10.x (teste de bancada). */
    fun apiAllowed(url: String?, debug: Boolean): Boolean {
        val s = clean(url) ?: return false
        if (isHttps(s)) return true
        if (!debug) return false
        val host = try { URI(s).host.orEmpty() } catch (_: Exception) { "" }
        return host == "localhost" || host == "127.0.0.1" || Regex("""10\.\d{1,3}\.\d{1,3}\.\d{1,3}""").matches(host)
    }

    /** Origem do servidor sem barra no fim nem caminho solto. */
    fun origin(raw: String?): String? = clean(raw)?.trimEnd('/')
}

object ConfigParser {
    const val DEFAULT_HEARTBEAT = 30
    const val DEFAULT_CARD_SECONDS = 10
    const val MAX_CARDS = 12
    val DEFAULT_SEQ = listOf("UP", "UP", "DOWN", "DOWN", "OK")

    fun str(o: JSONObject?, k: String): String? {
        if (o == null || !o.has(k) || o.isNull(k)) return null
        val v = o.opt(k)
        if (v is JSONObject || v is JSONArray) return null
        return v.toString().trim().ifEmpty { null }
    }

    private fun strings(a: JSONArray?): List<String> {
        if (a == null) return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until a.length()) {
            if (a.isNull(i)) continue
            val v = a.opt(i)
            if (v is String || v is Number) v.toString().trim().takeIf { it.isNotEmpty() }?.let(out::add)
        }
        return out
    }

    fun layoutOf(raw: String?): Layout = when (raw?.trim()?.lowercase()) {
        "ticker" -> Layout.TICKER
        "lbar" -> Layout.LBAR
        "side" -> Layout.SIDE
        "queue" -> Layout.QUEUE
        in QueueLayout.KEYS -> Layout.QUEUE // §15: os painéis de senha novos (o desenho sai de QueueLayout.of(layoutRaw))
        "portrait" -> Layout.PORTRAIT
        else -> Layout.FULL
    }

    fun parse(json: String): TelaConfig = parse(JSONObject(json))

    fun parse(o: JSONObject): TelaConfig {
        val d = o.optJSONObject("device")
        val s = o.optJSONObject("stream")
        val t = o.optJSONObject("ticker")
        val sd = o.optJSONObject("side")
        val l = o.optJSONObject("lock")
        val off = o.optJSONObject("offline")
        val sch = o.optJSONObject("schedule")
        val up = o.optJSONObject("update")
        val layoutRaw = str(o, "layout") ?: "full"

        val weather = o.optJSONObject("weather")?.let {
            val temp = it.optDouble("tempC", Double.NaN)
            val w = WeatherCfg(
                city = (str(it, "city") ?: "").take(60),
                tempC = if (temp.isNaN() || temp < -90 || temp > 70) null else Math.round(temp).toInt(),
                condition = (str(it, "condition") ?: "").take(60),
                icon = str(it, "icon")?.lowercase()?.takeIf { i -> i in WeatherCfg.ICONS } ?: "cloudy",
                at = it.optLong("at", 0L).coerceAtLeast(0L),
            )
            if (w.tempC == null && w.condition.isEmpty()) null else w
        }

        val cards = ArrayList<CardCfg>()
        o.optJSONArray("cards")?.let { arr ->
            for (i in 0 until arr.length()) {
                if (cards.size >= MAX_CARDS) break
                val it = arr.optJSONObject(i) ?: continue
                val title = (str(it, "title") ?: "").take(60)
                val lines = strings(it.optJSONArray("lines")).take(8).map { l -> l.take(90) }
                if (title.isEmpty() && lines.isEmpty()) continue
                val sec = it.optInt("seconds", DEFAULT_CARD_SECONDS).let { s -> if (s <= 0) DEFAULT_CARD_SECONDS else s.coerceIn(3, 120) }
                cards.add(CardCfg(str(it, "id") ?: i.toString(), title, lines, sec))
            }
        }

        val queue = o.optJSONObject("queue")?.let {
            QueueCfg(it.optBoolean("enabled", false), it.optBoolean("voice", false), (str(it, "title") ?: "").take(60), it.optBoolean("showName", false), QueueLayout.pair(it.optJSONArray("pair")))
        } ?: QueueCfg()

        // comunicação interna (§17): os avisos internos na frente do revezamento dos cartões
        val internal = Internal.parse(o.optJSONObject("internal"))
        val allCards = (Internal.asCards(internal) + cards).take(MAX_CARDS)

        val items = ArrayList<OfflineItem>()
        off?.optJSONArray("items")?.let { arr ->
            for (i in 0 until arr.length()) {
                val it = arr.optJSONObject(i) ?: continue
                val url = Urls.clean(str(it, "url")) ?: continue
                val sha = str(it, "sha256")?.lowercase() ?: continue
                items.add(OfflineItem(url, sha, it.optLong("bytes", 0L)))
            }
        }

        val schedule = sch?.let {
            val on = Schedule.parseHm(str(it, "tvOn"))
            val offM = Schedule.parseHm(str(it, "tvOff"))
            if (on == null || offM == null) null
            else {
                val days = HashSet<Int>()
                it.optJSONArray("days")?.let { a ->
                    for (i in 0 until a.length()) {
                        val n = a.optInt(i, -1)
                        if (n in 0..7) days.add(n % 7)
                    }
                }
                ScheduleCfg(on, offM, days)
            }
        }

        val update = up?.let {
            val url = Urls.clean(str(it, "url"))
            val sha = str(it, "sha256")?.lowercase()
            val vc = it.optInt("versionCode", 0)
            if (url != null && Urls.isHttps(url) && sha != null && sha.matches(Regex("[0-9a-f]{64}")) && vc > 0) UpdateCfg(url, sha, vc) else null
        }

        return TelaConfig(
            rev = str(o, "rev") ?: "",
            device = DeviceCfg(
                id = d?.optLong("id", 0L) ?: 0L,
                name = str(d, "name") ?: "",
                office = str(d, "office") ?: "",
                officeType = str(d, "officeType") ?: "",
                region = str(d, "region") ?: "",
            ),
            stream = StreamCfg(
                hls = Urls.clean(str(s, "hls")),
                backup = Urls.clean(str(s, "backup")),
                volume = (s?.optInt("volume", 100) ?: 100).coerceIn(0, 100),
                muted = s?.optBoolean("muted", false) ?: false,
            ),
            layoutRaw = layoutRaw,
            layout = layoutOf(layoutRaw),
            ticker = TickerCfg(strings(t?.optJSONArray("items")), (t?.optInt("speed", 60) ?: 60).coerceIn(20, 200)),
            side = SideCfg(
                widgets = if (sd?.has("widgets") == true) strings(sd.optJSONArray("widgets")).map { it.lowercase() } else listOf("clock", "qr"),
                qrUrl = Urls.clean(str(sd, "qrUrl")),
                title = str(sd, "title"),
            ),
            lock = LockCfg(
                pinHash = str(l, "pinHash")?.lowercase() ?: "",
                pinSalt = str(l, "pinSalt") ?: "",
                exitSeq = ExitSequence.normalize(strings(l?.optJSONArray("exitSeq"))),
            ),
            offline = items,
            schedule = schedule,
            heartbeatSec = o.optInt("heartbeatSec", DEFAULT_HEARTBEAT).let { if (it <= 0) DEFAULT_HEARTBEAT else it.coerceIn(10, 300) },
            update = update,
            weather = weather,
            cards = allCards,
            queue = queue,
            captions = CaptionsPolicy.parse(o.optJSONObject("captions")),
            offlineImage = FallbackImages.parse(off?.optJSONObject("image")),
            theme = ThemeCfg.parse(o.optJSONObject("theme")),
            internal = internal,
            callSound = CallSound.parse(o.optJSONObject("callSound")),
            signage = Signage.parse(o.optJSONObject("signage")),
        )
    }

    /** Configuração do modo avulso: só o endereço e o PIN guardados no aparelho. */
    fun standalone(hls: String?, pinSalt: String, pinHash: String): TelaConfig = TelaConfig(
        rev = "", device = DeviceCfg(0, "", "", "", ""),
        stream = StreamCfg(Urls.clean(hls), null, 100, false),
        layoutRaw = "full", layout = Layout.FULL,
        ticker = TickerCfg(emptyList(), 60), side = SideCfg(emptyList(), null, null),
        lock = LockCfg(pinHash.lowercase(), pinSalt, DEFAULT_SEQ),
        offline = emptyList(), schedule = null, heartbeatSec = DEFAULT_HEARTBEAT, update = null,
    )
}
