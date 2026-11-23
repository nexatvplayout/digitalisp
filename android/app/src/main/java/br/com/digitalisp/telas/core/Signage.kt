package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/*
 * TV Corporativa (docs/TV-CORPORATIVA.md §4): a chave `signage` do /config. Sem Android aqui dentro (testável na JVM).
 *
 * Formato lido (o que a §4.1 não detalha segue o que está escrito em cada classe abaixo):
 *   signage.tz, signage.brand { logo {url, sha256, bytes}, color, mode }, signage.fallback (id de um bloco),
 *   signage.blocks[] { id, layout { orientation, background, zones[] {id, x, y, w, h, kind, text?, title?, qr?} },
 *                      days[], from, to, dateFrom, dateTo, zones { idDaZona: [itens] } }
 * Ausente ou sem nenhum bloco válido = null: o app fica exatamente como sem o modo.
 */

/** Arquivo que o servidor indica (só https, sha256 de 64 hex, tamanho conhecido). O app baixa, confere e guarda. */
data class SignageFile(val url: String, val sha256: String, val bytes: Long) {
    /** Nome no aparelho (pasta própria do modo). */
    val fileName: String get() = "$sha256.img"

    fun asItem(): OfflineItem = OfflineItem(url, sha256, bytes)
}

/** Zona do layout, em porcentagem inteira da tela (0 a 100). */
data class SignageZone(
    val id: String, val x: Int, val y: Int, val w: Int, val h: Int, val kind: String,
    /** Zona `text`: o texto fixo; zona `qr`: o conteúdo (endereço, Wi-Fi ou vCard); qualquer zona: um título opcional. */
    val text: String = "", val qr: String? = null, val title: String = "",
    /** Recorte (core/Shapes; "" = retângulo) e o filete na borda: cor e largura em % da altura da tela (0 = sem). */
    val shape: String = "", val edgeColor: Int = 0, val edgeWidth: Float = 0f,
    /** Camada de cima (um gadget sobre a imagem ou o vídeo), com o fundo escuro translúcido em [opacity]% (0 a 100). */
    val overlay: Boolean = false, val opacity: Int = 60,
)

data class SignageLayoutCfg(val portrait: Boolean, val background: Int?, val zones: List<SignageZone>, val audio: SignAudio? = null) {
    val hasVideo: Boolean get() = zones.any { it.kind == Signage.ZONE_VIDEO }
}

/** Rádio de fundo do bloco sem zona de vídeo (`layout.audio`): o stream (http ou https) e o volume (10 a 100). */
data class SignAudio(val id: String, val name: String, val url: String, val volume: Int)

/** Clima de um item `weather` (DIGITAL ISP): o de agora, os próximos dias e a foto do tempo. */
data class SignWeather(
    val city: String, val tempC: Int?, val min: Int?, val max: Int?, val cond: String, val text: String,
    val days: List<SignWeatherDay>, val source: String, val art: SignageFile?, val artPort: SignageFile?,
    /** quando o servidor mediu (epoch ms; 0 = sem data): passado o teto do clima, a zona fica sem ele */
    val at: Long = 0L,
)

data class SignWeatherDay(val label: String, val min: Int?, val max: Int?, val cond: String, val text: String)

/** Relógio do gadget: digital ou de ponteiros, o fuso (null = o do modo), o rótulo, os segundos e a data. */
data class SignClockFace(val analog: Boolean, val tz: String?, val label: String, val seconds: Boolean, val date: Boolean)

/** Compromisso da agenda: dia (YYYY-MM-DD), hora e fim ("" = sem), o que é e onde. */
data class SignEvent(val date: String, val time: String, val end: String, val title: String, val place: String)

/** Avaliação de cliente: o nome, o texto e as estrelas (1 a 5). */
data class SignReview(val name: String, val text: String, val stars: Int)

/** Como chegar: endereço, referência, horário e telefone. */
data class SignPlace(val address: String, val reference: String, val hours: String, val phone: String)

/** Aniversariante: só nome e dia/mês (sem ano, LGPD). Foto só quando o servidor manda (consentimento marcado). */
data class SignPerson(val name: String, val day: Int, val month: Int, val sector: String = "", val photo: SignageFile? = null)

/** Manchete: título, fonte e hora (epoch ms; 0 = sem hora). */
data class SignHeadline(val title: String, val source: String, val at: Long = 0L, val qr: String? = null)

/** Cotação: nome (Dólar, Euro, Ibovespa), valor já em número, variação em % (null = sem variação), prefixo (R$). */
data class SignQuote(val label: String, val value: Double, val change: Double?, val prefix: String = "", val decimals: Int = 2)

/** Linha do cardápio: o prato e o preço opcional (texto já pronto, "R$ 18,90"). */
data class SignMenuLine(val name: String, val price: String = "")

/** Relógio mundial: rótulo (São Paulo, Lisboa) e o fuso (IANA). */
data class SignClock(val label: String, val tz: String)

/** Indicador: valor, meta, unidade, faixa (`ok` | `warn` | `bad`) e o sentido (`up` = maior é melhor). */
data class SignKpi(val name: String, val value: Double, val target: Double?, val unit: String, val band: String, val up: Boolean = true)

/**
 * Um item de playlist. `kind`: image, slide, post, birthdays, kpi, news, quotes, menu, countdown, safety, worldclock,
 * text, clock, weather, qr, logo. Cada tipo usa só os campos dele; o resto fica vazio.
 */
data class SignageItem(
    val id: String,
    val kind: String,
    val seconds: Int,
    /** imagem do item (image) ou do slide/comunicado (opcional) */
    val file: SignageFile? = null,
    /** modelo do slide (ver [Signage.TEMPLATES]); no comunicado, sai da categoria */
    val template: String = "",
    val title: String = "",
    val text: String = "",
    val subtitle: String = "",
    /** rótulo: categoria do comunicado, fonte das notícias/cotações, legenda da imagem */
    val label: String = "",
    val qr: String? = null,
    /** hora do dado (notícias, cotações) ou o alvo do contador (epoch ms) */
    val at: Long = 0L,
    val target: Long = 0L,
    val people: List<SignPerson> = emptyList(),
    val news: List<SignHeadline> = emptyList(),
    val quotes: List<SignQuote> = emptyList(),
    val menu: List<SignMenuLine> = emptyList(),
    val clocks: List<SignClock> = emptyList(),
    val kpi: SignKpi? = null,
    /** dias sem acidente: o dia do último acidente (YYYY-MM-DD), o recorde e a meta em dias */
    val since: String? = null,
    val record: Int = 0,
    val goal: Int = 0,
    /** imagem: `contain` (inteira, com fundo) ou `cover` (cobre a zona, cortando) */
    val contain: Boolean = false,
    /** slide: a arte de fundo (`fields.artFile`); sem ela, o fundo é a cor da paleta ou do tema */
    val art: SignageFile? = null,
    /** a arte é foto (leva o véu escuro e o texto claro) */
    val artPhoto: Boolean = false,
    /** o texto sobre a arte é escuro (`tone: light`) */
    val artLight: Boolean = false,
    /** slide: a chave de [Signage.PALETTES] ("" = a cor do tema) */
    val palette: String = "",
    /** modelos do comércio (oferta, combo, vitrine de preços, horário, redes) */
    val price: String = "",
    val oldPrice: String = "",
    val unit: String = "",
    val tag: String = "",
    val note: String = "",
    val handle: String = "",
    val site: String = "",
    /** oferta: válido até (YYYY-MM-DD) */
    val until: String? = null,
    /** vitrine de preços e horário: as linhas "nome | preço" já separadas */
    val rows: List<Pair<String, String>> = emptyList(),
    /** troca para este item: fade (padrão), slide ou zoom; e o zoom lento na imagem (kenburns) */
    val transition: String = "fade",
    val kenburns: Boolean = false,
    /** slide em pé (`orient: port`): desenha tudo em coluna */
    val portrait: Boolean = false,
    /** escalas dos elementos do slide (qrSize, priceSize, photoSize, titleSize: s 0,7; l 1,4; xl 1,8; médio 1) */
    val qrScale: Float = 1f,
    val priceScale: Float = 1f,
    val photoScale: Float = 1f,
    val titleScale: Float = 1f,
    /** notícia sozinha: a foto em tela cheia e a faixa com uma manchete */
    val single: Boolean = false,
    /** vídeo próprio: com som? (sem: mudo) */
    val sound: Boolean = false,
    /** contador: até quando dura o evento (epoch ms; 0 = sem fim) */
    val endAt: Long = 0L,
    /** dias sem acidente: há recorde? (`record: null` = "Dias desde", sem recorde) */
    val hasRecord: Boolean = true,
    val weather: SignWeather? = null,
    val clockFace: SignClockFace? = null,
    val events: List<SignEvent> = emptyList(),
    /** agenda: o dia de hoje no fuso do servidor (YYYY-MM-DD) */
    val today: String = "",
    val reviews: List<SignReview> = emptyList(),
    val kpis: List<SignKpi> = emptyList(),
    val place: SignPlace? = null,
    /** página da internet: o endereço e a recarga (minutos; 0 = não recarrega) */
    val webUrl: String? = null,
    val refreshMin: Int = 0,
) {
    /** Arquivos que o item precisa (a imagem ou o vídeo, a arte de fundo, a foto do clima e as fotos). */
    val files: List<SignageFile> get() = listOfNotNull(file, art, weather?.art, weather?.artPort) + people.mapNotNull { it.photo }
}

/** Cores de uma paleta do slide (as mesmas de `.th-<chave>` em public/shared/tvcorp-previa.css): destaque, começo do fundo escuro e canto do fundo claro. */
data class SignPalette(val accent: Int, val darkStart: Int, val lightCorner: Int)

data class SignageBlock(
    val id: String,
    val layout: SignageLayoutCfg,
    /** 0 = domingo … 6 = sábado; vazio = todo dia */
    val days: Set<Int>,
    /** minutos do dia; [to] menor que [from] = vira a meia-noite; from == to = o dia inteiro */
    val from: Int,
    val to: Int,
    val dateFrom: String?,
    val dateTo: String?,
    val zones: Map<String, List<SignageItem>>,
)

data class SignageBrand(val logo: SignageFile?, val theme: ThemeCfg)

data class SignageCfg(val tz: String, val brand: SignageBrand, val blocks: List<SignageBlock>, val fallback: String?, val wall: WallCfg? = null) {
    /** Todos os arquivos (logomarca, imagens, fotos), sem repetir, até o teto do cache. */
    fun files(): List<SignageFile> {
        val out = LinkedHashMap<String, SignageFile>()
        brand.logo?.let { out[it.sha256] = it }
        for (b in blocks) for (items in b.zones.values) for (i in items) for (f in i.files) out.putIfAbsent(f.sha256, f)
        return out.values.take(Signage.MAX_FILES)
    }
}

/** Hora local no fuso do modo: dia da semana, minuto do dia e a data, de hoje e de ontem (para a faixa que vira a noite). */
data class SignageLocal(val dow: Int, val minute: Int, val date: String, val prevDow: Int, val prevDate: String)

object Signage {
    // ---- catálogo (§4.2; os mesmos nomes de public/shared/tvcorp-tipos.js) ----
    const val ZONE_VIDEO = "video"
    const val ZONE_PLAYLIST = "playlist"
    const val ZONE_TICKER = "ticker"
    const val ZONE_QUEUE = "queue"
    val ZONE_KINDS = setOf(
        ZONE_VIDEO, ZONE_PLAYLIST, ZONE_TICKER, "clock", "weather", "qr", "logo", "text", "news", "quotes",
        "countdown", "safety", "worldclock", ZONE_QUEUE, "widget",
    )
    val ITEM_KINDS = setOf(
        "image", "slide", "post", "birthdays", "kpi", "news", "quotes", "menu",
        "countdown", "safety", "worldclock", "text", "clock", "weather", "qr", "logo",
        // DIGITAL ISP
        "video", "agenda", "reviews", "dashboard", "directions", "web",
    )
    val TRANSITIONS = setOf("fade", "slide", "zoom")
    val WEATHER_CONDS = setOf("clear", "partly", "cloudy", "fog", "rain", "storm")
    val TEMPLATES = listOf(
        "comunicado", "boas-vindas", "aniversariantes", "reconhecimento", "seguranca", "evento",
        "vaga", "indicador", "cardapio", "qr", "imagem-com-legenda", "data-comemorativa",
        // DIGITAL ISP: os modelos do comércio
        "oferta", "precos", "combo", "horario", "redes",
    )

    /** As paletas do slide (`fields.palette`), conferidas com TVC_PALETTES e tvcorp-previa.css. */
    val PALETTES: Map<String, SignPalette> = mapOf(
        "azul" to SignPalette(0xFF1D4ED8.toInt(), 0xFF1D4ED8.toInt(), 0xFFBFDBFE.toInt()),
        "verde" to SignPalette(0xFF15803D.toInt(), 0xFF166534.toInt(), 0xFFBBF7D0.toInt()),
        "petroleo" to SignPalette(0xFF0F766E.toInt(), 0xFF115E59.toInt(), 0xFF99F6E4.toInt()),
        "vinho" to SignPalette(0xFF9F1239.toInt(), 0xFF9F1239.toInt(), 0xFFFECDD3.toInt()),
        "roxo" to SignPalette(0xFF6D28D9.toInt(), 0xFF6D28D9.toInt(), 0xFFDDD6FE.toInt()),
        "laranja" to SignPalette(0xFFC2410C.toInt(), 0xFF9A3412.toInt(), 0xFFFED7AA.toInt()),
        "grafite" to SignPalette(0xFF334155.toInt(), 0xFF334155.toInt(), 0xFFCBD5E1.toInt()),
        "vermelho" to SignPalette(0xFFB91C1C.toInt(), 0xFF991B1B.toInt(), 0xFFFECACA.toInt()),
        "marrom" to SignPalette(0xFF92400E.toInt(), 0xFF92400E.toInt(), 0xFFFDE68A.toInt()),
        "rosa" to SignPalette(0xFFBE185D.toInt(), 0xFF9D174D.toInt(), 0xFFFBCFE8.toInt()),
        "dourado" to SignPalette(0xFFA16207.toInt(), 0xFF854D0E.toInt(), 0xFFFEF08A.toInt()),
    )

    /** "nome | preço" por linha (até [MAX_LINES]); o último "|" separa. Igual ao rowsOf da prévia. */
    fun rows(text: String): List<Pair<String, String>> = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }.take(MAX_LINES).map {
        val i = it.lastIndexOf('|')
        if (i < 0) it to "" else it.substring(0, i).trim() to it.substring(i + 1).trim()
    }

    /** A arte de fundo do slide: `fields.artFile` (só imagem que o Android abre: foto JPEG/PNG/WebP; SVG não). */
    private fun art(f: JSONObject): Triple<SignageFile, Boolean, Boolean>? {
        val o = f.optJSONObject("artFile") ?: return null
        val file = file(o) ?: return null
        val key = ConfigParser.str(f, "art")?.lowercase().orEmpty()
        val photo = (o.opt("photo") as? Boolean) ?: key.startsWith("foto-")
        val light = ConfigParser.str(o, "tone")?.lowercase() == "light"
        return Triple(file, photo, light)
    }
    /** Categoria do comunicado → modelo do slide. */
    val POST_TEMPLATE = mapOf(
        "comunicado" to "comunicado", "rh" to "comunicado", "beneficio" to "comunicado", "aviso" to "comunicado",
        "boas-vindas" to "boas-vindas", "reconhecimento" to "reconhecimento", "seguranca" to "seguranca",
        "vaga" to "vaga", "evento" to "evento",
    )

    // ---- tetos (§4.1) ----
    const val MAX_BLOCKS = 12
    const val MAX_ZONES = 16
    const val MAX_ITEMS = 60
    const val MAX_FILES = 200
    const val MAX_CACHE_BYTES = 1024L * 1024 * 1024
    /** Um vídeo próprio (MP4 até 1080p) não passa disto. */
    const val MAX_VIDEO_BYTES = 400L * 1024 * 1024
    /** Um arquivo só não passa disto (imagem já vem com até 2 MB; logomarca e foto são menores). */
    const val MAX_FILE_BYTES = 8L * 1024 * 1024
    const val MAX_TITLE = 60
    const val MAX_TEXT = 280
    const val MAX_LINES = 8
    const val DEFAULT_SECONDS = 10
    const val DEFAULT_TZ = "America/Sao_Paulo"

    private val SHA = Regex("[0-9a-f]{64}")
    private val DAY = Regex("""\d{4}-\d{2}-\d{2}""")

    // ------------------------------------------------------------------ leitura

    fun parse(o: JSONObject?): SignageCfg? {
        if (o == null) return null
        val tz = ConfigParser.str(o, "tz")?.takeIf { validTz(it) } ?: DEFAULT_TZ
        val b = o.optJSONObject("brand")
        val brand = SignageBrand(file(b?.optJSONObject("logo")), ThemeCfg.parse(b))
        val blocks = ArrayList<SignageBlock>()
        val seen = HashSet<String>()
        o.optJSONArray("blocks")?.let { arr ->
            for (i in 0 until arr.length()) {
                if (blocks.size >= MAX_BLOCKS) break
                val blk = block(arr.optJSONObject(i), tz) ?: continue
                if (seen.add(blk.id)) blocks.add(blk)
            }
        }
        if (blocks.isEmpty()) return null
        return SignageCfg(tz, brand, blocks, ConfigParser.str(o, "fallback")?.take(64), Wall.parse(o.optJSONObject("wall")))
    }

    private val TZ_IDS: Set<String> by lazy { TimeZone.getAvailableIDs().toHashSet() }

    fun validTz(id: String): Boolean = id.length <= 64 && id in TZ_IDS

    /** Arquivo do servidor: https, sha256 e tamanho de 1 byte ao teto. */
    fun file(o: JSONObject?, max: Long = MAX_FILE_BYTES): SignageFile? {
        if (o == null) return null
        val url = Urls.clean(ConfigParser.str(o, "url"))?.takeIf { Urls.isHttps(it) } ?: return null
        val sha = ConfigParser.str(o, "sha256")?.lowercase()?.takeIf { SHA.matches(it) } ?: return null
        val bytes = o.optLong("bytes", 0L)
        if (bytes !in 1..max) return null
        return SignageFile(url, sha, bytes)
    }

    /**
     * O conteúdo de um QR code: endereço https, rede Wi-Fi ("WIFI:...;;") ou cartão de contato ("BEGIN:VCARD ... END:VCARD"),
     * codificado como veio (até 1000 caracteres). Outro texto = null.
     */
    fun qrText(raw: String?): String? {
        val s = raw?.replace("\r\n", "\n")?.trim() ?: return null
        if (s.isEmpty() || s.length > 1000) return null
        if (s.startsWith("WIFI:") && s.contains("S:") && s.endsWith(";") && !s.contains('\n')) return s
        if (s.startsWith("BEGIN:VCARD\n") && s.endsWith("\nEND:VCARD")) return s
        return httpsOrNull(s)
    }

    private fun txt(o: JSONObject?, k: String, max: Int): String =
        clean(ConfigParser.str(o, k) ?: "").take(max)

    /** Tira caracteres de controle (menos a quebra de linha) e limita as linhas. */
    fun clean(s: String): String =
        s.replace("\r\n", "\n").filter { it == '\n' || it.code >= 0x20 }.lines().map { it.trim() }
            .take(MAX_LINES).joinToString("\n").trim()

    private fun httpsOrNull(raw: String?): String? = Urls.clean(raw)?.takeIf { Urls.isHttps(it) }

    private fun color(raw: String?): Int? = raw?.let { QueueLayout.parseHex(it) }

    private fun int(o: JSONObject, k: String, def: Int): Int {
        val v = o.opt(k)
        return if (v is Number) v.toInt() else def
    }

    private fun zone(o: JSONObject?): SignageZone? {
        if (o == null) return null
        val id = ConfigParser.str(o, "id")?.take(32) ?: return null
        val kind = ConfigParser.str(o, "kind")?.lowercase()?.takeIf { it in ZONE_KINDS } ?: return null
        val x = int(o, "x", -1)
        val y = int(o, "y", -1)
        if (x !in 0..99 || y !in 0..99) return null
        val w = int(o, "w", 0).coerceAtMost(100 - x)
        val h = int(o, "h", 0).coerceAtMost(100 - y)
        if (w <= 0 || h <= 0) return null
        val shape = ConfigParser.str(o, "shape")?.lowercase()?.takeIf { it in Shapes.KEYS }.orEmpty()
        val edge = if (shape.isEmpty()) null else o.optJSONObject("edge")
        val edgeColor = color(ConfigParser.str(edge, "color")) ?: 0
        val edgeWidth = (edge?.opt("width") as? Number)?.toFloat()?.takeIf { !it.isNaN() && edgeColor != 0 }?.coerceIn(Shapes.EDGE_MIN, Shapes.EDGE_MAX) ?: 0f
        val overlay = o.opt("overlay") == true && kind != ZONE_VIDEO // o vídeo nunca vem por cima
        return SignageZone(
            id, x, y, w, h, kind, txt(o, "text", MAX_TEXT), qrText(ConfigParser.str(o, "qr")), txt(o, "title", MAX_TITLE),
            shape = shape, edgeColor = edgeColor, edgeWidth = edgeWidth,
            overlay = overlay, opacity = int(o, "opacity", 60).coerceIn(0, 100),
        )
    }

    private fun layout(o: JSONObject?): SignageLayoutCfg? {
        if (o == null) return null
        val zones = ArrayList<SignageZone>()
        val ids = HashSet<String>()
        var video = false
        o.optJSONArray("zones")?.let { arr ->
            for (i in 0 until arr.length()) {
                if (zones.size >= MAX_ZONES) break
                val z = zone(arr.optJSONObject(i)) ?: continue
                if (z.kind == ZONE_VIDEO) {
                    if (video) continue // no máximo uma zona de vídeo: o player é um só
                    video = true
                }
                if (ids.add(z.id)) zones.add(z)
            }
        }
        if (zones.isEmpty()) return null
        val portrait = ConfigParser.str(o, "orientation")?.lowercase() == "port"
        // rádio de fundo: só no bloco sem vídeo (o som do canal manda); http aceito (muitas rádios não têm https)
        val audio = o.optJSONObject("audio")?.takeIf { !video && ConfigParser.str(it, "kind")?.lowercase() == "radio" }?.let { a ->
            Urls.clean(ConfigParser.str(a, "url"))?.let { url ->
                SignAudio(ConfigParser.str(a, "id")?.take(64) ?: url, txt(a, "name", 60), url, int(a, "volume", 100).coerceIn(10, 100))
            }
        }
        return SignageLayoutCfg(portrait, color(ConfigParser.str(o, "background")), zones, audio)
    }

    private fun day(raw: String?): String? = raw?.trim()?.takeIf { DAY.matches(it) }

    private fun block(o: JSONObject?, tz: String): SignageBlock? {
        if (o == null) return null
        val id = ConfigParser.str(o, "id")?.take(64) ?: return null
        val lay = layout(o.optJSONObject("layout")) ?: return null
        val days = HashSet<Int>()
        o.optJSONArray("days")?.let { a ->
            for (i in 0 until a.length()) {
                val n = a.optInt(i, -1)
                if (n in 0..7) days.add(n % 7)
            }
        }
        val from = int(o, "from", 0).coerceIn(0, 1440)
        val to = int(o, "to", 1440).coerceIn(0, 1440)
        val zoneIds = lay.zones.map { it.id }.toSet()
        val items = LinkedHashMap<String, List<SignageItem>>()
        o.optJSONObject("zones")?.let { zo ->
            for (k in zo.keys()) {
                if (k !in zoneIds) continue
                val arr = zo.optJSONArray(k) ?: continue
                val list = ArrayList<SignageItem>()
                for (i in 0 until arr.length()) {
                    if (list.size >= MAX_ITEMS) break
                    item(arr.optJSONObject(i), tz)?.let(list::add)
                }
                if (list.isNotEmpty()) items[k] = list
            }
        }
        return SignageBlock(id, lay, days, from, to, day(ConfigParser.str(o, "dateFrom")), day(ConfigParser.str(o, "dateTo")), items)
    }

    private val ISO = Regex("""(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?""")

    /**
     * Data em epoch ms: número, "YYYY-MM-DD" (meia-noite no fuso do modo) ou "YYYY-MM-DDTHH:mm[:ss][Z|±HH:MM]" (sem
     * fuso = o do modo). Inválida = 0. (Sem java.time: o app roda no Android 7.)
     */
    fun epochOf(s: String, tz: String): Long {
        val m = ISO.matchEntire(s.trim()) ?: return 0L
        val g = m.groupValues
        val zone = when {
            g[7].isEmpty() -> TimeZone.getTimeZone(tz)
            g[7] == "Z" -> TimeZone.getTimeZone("UTC")
            else -> TimeZone.getTimeZone("GMT" + g[7].let { if (it.contains(':')) it else it.substring(0, 3) + ":" + it.substring(3) })
        }
        val mo = g[2].toInt()
        val d = g[3].toInt()
        if (mo !in 1..12 || d !in 1..31) return 0L
        val c = Calendar.getInstance(zone, Locale.ROOT)
        c.clear()
        c.set(g[1].toInt(), mo - 1, d, g[4].ifEmpty { "0" }.toInt(), g[5].ifEmpty { "0" }.toInt(), g[6].ifEmpty { "0" }.toInt())
        return c.timeInMillis.coerceAtLeast(0L)
    }

    private fun epoch(o: JSONObject, k: String, tz: String): Long {
        val v = o.opt(k)
        if (v is Number) return v.toLong().coerceAtLeast(0L)
        return (v as? String)?.let { epochOf(it, tz) } ?: 0L
    }

    private fun people(a: JSONArray?): List<SignPerson> {
        if (a == null) return emptyList()
        val out = ArrayList<SignPerson>()
        for (i in 0 until a.length()) {
            if (out.size >= 40) break
            val p = a.optJSONObject(i) ?: continue
            val name = txt(p, "name", 60).replace('\n', ' ')
            val d = int(p, "day", 0)
            val m = int(p, "month", 0)
            if (name.isEmpty() || d !in 1..31 || m !in 1..12) continue
            out.add(SignPerson(name, d, m, txt(p, "sector", 40).replace('\n', ' '), file(p.optJSONObject("photo"))))
        }
        return out
    }

    private fun news(a: JSONArray?, tz: String): List<SignHeadline> {
        if (a == null) return emptyList()
        val out = ArrayList<SignHeadline>()
        for (i in 0 until a.length()) {
            if (out.size >= 12) break
            val n = a.optJSONObject(i) ?: continue
            val t = txt(n, "title", 160).replace('\n', ' ')
            if (t.isEmpty()) continue
            out.add(SignHeadline(t, txt(n, "source", 40), epoch(n, "at", tz), httpsOrNull(ConfigParser.str(n, "qr") ?: ConfigParser.str(n, "url"))))
        }
        return out
    }

    /** s 0,7 · l 1,4 · xl 1,8 · ausente ou outro valor 1 (o médio). */
    fun sizeOf(f: JSONObject, k: String): Float = when (ConfigParser.str(f, k)?.lowercase()) {
        "s" -> 0.7f
        "l" -> 1.4f
        "xl" -> 1.8f
        else -> 1f
    }

    private fun deg(o: JSONObject?, k: String): Int? {
        val v = (o?.opt(k) as? Number)?.toDouble() ?: return null
        return if (v.isNaN() || v < -90 || v > 70) null else Math.round(v).toInt()
    }

    private fun cond(o: JSONObject?): String = ConfigParser.str(o, "cond")?.lowercase()?.takeIf { it in WEATHER_CONDS } ?: "partly"

    private fun weatherItem(o: JSONObject): SignWeather? {
        val days = ArrayList<SignWeatherDay>()
        o.optJSONArray("days")?.let { a ->
            for (i in 0 until a.length()) {
                if (days.size >= 4) break
                val d = a.optJSONObject(i) ?: continue
                val label = txt(d, "weekday", 12).replace('\n', ' ').ifEmpty {
                    day(ConfigParser.str(d, "date"))?.let { it.substring(8, 10) + "/" + it.substring(5, 7) }.orEmpty()
                }
                days.add(SignWeatherDay(label, deg(d, "min"), deg(d, "max"), cond(d), txt(d, "text", 40).replace('\n', ' ')))
            }
        }
        val w = SignWeather(
            city = listOf(txt(o, "city", 40), txt(o, "uf", 2)).filter { it.isNotEmpty() }.joinToString(" · ").replace('\n', ' '),
            tempC = deg(o, "tempC"), min = deg(o, "min"), max = deg(o, "max"), cond = cond(o),
            text = txt(o, "text", 60).replace('\n', ' '), days = days, source = txt(o, "source", 40).replace('\n', ' '),
            art = file(o.optJSONObject("art")), artPort = file(o.optJSONObject("artPort")),
        )
        return if (w.tempC == null && w.min == null && w.max == null && w.days.isEmpty()) null else w
    }

    private val HHMM = Regex("[0-9]{1,2}:[0-9]{2}")

    private fun events(a: JSONArray?): List<SignEvent> {
        if (a == null) return emptyList()
        val out = ArrayList<SignEvent>()
        for (i in 0 until a.length()) {
            if (out.size >= 6) break
            val e = a.optJSONObject(i) ?: continue
            val d = day(ConfigParser.str(e, "date")) ?: continue
            val t = txt(e, "title", 80).replace('\n', ' ')
            if (t.isEmpty()) continue
            out.add(SignEvent(d, ConfigParser.str(e, "time")?.takeIf { HHMM.matches(it) }.orEmpty(), ConfigParser.str(e, "end")?.takeIf { HHMM.matches(it) }.orEmpty(), t, txt(e, "place", 60).replace('\n', ' ')))
        }
        return out
    }

    private fun reviews(a: JSONArray?): List<SignReview> {
        if (a == null) return emptyList()
        val out = ArrayList<SignReview>()
        for (i in 0 until a.length()) {
            if (out.size >= 3) break
            val r = a.optJSONObject(i) ?: continue
            val t = txt(r, "text", 200).replace('\n', ' ')
            if (t.isEmpty()) continue
            out.add(SignReview(txt(r, "name", 40).replace('\n', ' ').ifEmpty { "Cliente" }, t, int(r, "stars", 5).coerceIn(1, 5)))
        }
        return out
    }

    private fun quotes(a: JSONArray?): List<SignQuote> {
        if (a == null) return emptyList()
        val out = ArrayList<SignQuote>()
        for (i in 0 until a.length()) {
            if (out.size >= 8) break
            val q = a.optJSONObject(i) ?: continue
            val label = txt(q, "label", 30).ifEmpty { txt(q, "name", 30) }.replace('\n', ' ')
            val v = q.optDouble("value", Double.NaN)
            if (label.isEmpty() || v.isNaN() || v.isInfinite()) continue
            val ch = q.optDouble("change", Double.NaN).takeIf { !it.isNaN() && !it.isInfinite() }
            out.add(SignQuote(label, v, ch, txt(q, "prefix", 4), int(q, "decimals", 2).coerceIn(0, 4)))
        }
        return out
    }

    private fun menu(a: JSONArray?): List<SignMenuLine> {
        if (a == null) return emptyList()
        val out = ArrayList<SignMenuLine>()
        for (i in 0 until a.length()) {
            if (out.size >= 12) break
            val v = a.opt(i)
            val line = when (v) {
                is JSONObject -> SignMenuLine(txt(v, "name", 60).replace('\n', ' '), txt(v, "price", 16))
                is String -> SignMenuLine(clean(v).replace('\n', ' ').take(60))
                else -> null
            } ?: continue
            if (line.name.isNotEmpty()) out.add(line)
        }
        return out
    }

    private fun clocks(a: JSONArray?): List<SignClock> {
        if (a == null) return emptyList()
        val out = ArrayList<SignClock>()
        for (i in 0 until a.length()) {
            if (out.size >= 6) break
            val c = a.optJSONObject(i) ?: continue
            val tz = ConfigParser.str(c, "tz")?.takeIf { validTz(it) } ?: continue
            out.add(SignClock(txt(c, "label", 24).ifEmpty { tz.substringAfterLast('/').replace('_', ' ') }, tz))
        }
        return out
    }

    private fun kpi(o: JSONObject): SignKpi? {
        val v = o.optDouble("value", Double.NaN)
        if (v.isNaN() || v.isInfinite()) return null
        val t = o.optDouble("target", Double.NaN).takeIf { !it.isNaN() && !it.isInfinite() && it != 0.0 }
        val band = ConfigParser.str(o, "band")?.lowercase()?.takeIf { it in setOf("ok", "warn", "bad") } ?: ""
        return SignKpi(txt(o, "name", MAX_TITLE).replace('\n', ' '), v, t, txt(o, "unit", 8), band, ConfigParser.str(o, "direction") != "down")
    }

    /** Linhas de texto de uma lista (cardápio por texto, linhas extras de slide). */
    private fun textLines(a: JSONArray?): String {
        if (a == null) return ""
        val out = ArrayList<String>()
        for (i in 0 until a.length()) {
            val v = a.opt(i)
            if (v is String) clean(v).replace('\n', ' ').take(90).takeIf { it.isNotEmpty() }?.let(out::add)
            if (out.size >= MAX_LINES) break
        }
        return out.joinToString("\n")
    }

    fun item(o: JSONObject?, tz: String = DEFAULT_TZ): SignageItem? {
        if (o == null) return null
        val id = ConfigParser.str(o, "id")?.take(64) ?: return null
        val kind = ConfigParser.str(o, "kind")?.lowercase()?.takeIf { it in ITEM_KINDS } ?: return null
        val seconds = int(o, "seconds", DEFAULT_SECONDS).let { if (it <= 0) DEFAULT_SECONDS else it.coerceIn(3, if (kind == "video") 3600 else 300) }
        val base = SignageItem(
            id, kind, seconds,
            transition = ConfigParser.str(o, "transition")?.lowercase()?.takeIf { it in TRANSITIONS } ?: "fade",
            kenburns = o.opt("kenburns") == true,
        )
        return when (kind) {
            "image" -> {
                val f = file(o) ?: return null
                base.copy(file = f, label = txt(o, "caption", 120).replace('\n', ' '), contain = ConfigParser.str(o, "fit") == "contain")
            }
            "video" -> {
                val f = file(o, MAX_VIDEO_BYTES) ?: return null
                base.copy(file = f, sound = o.opt("sound") == true, contain = ConfigParser.str(o, "fit") != "cover")
            }
            "weather" -> base.copy(weather = weatherItem(o), title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            "clock" -> if (o.has("face") || o.has("tz") || o.has("label")) base.copy(
                clockFace = SignClockFace(
                    analog = ConfigParser.str(o, "face")?.lowercase() == "analog",
                    tz = ConfigParser.str(o, "tz")?.takeIf { validTz(it) },
                    label = txt(o, "label", 40).replace('\n', ' '),
                    seconds = o.opt("seconds") != false && o.opt("showSeconds") != false,
                    date = o.opt("date") != false,
                ),
            ) else base
            "agenda" -> base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), today = day(ConfigParser.str(o, "today")).orEmpty(), events = events(o.optJSONArray("events")))
            "reviews" -> reviews(o.optJSONArray("items")).takeIf { it.isNotEmpty() }?.let {
                base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), reviews = it, qr = qrText(ConfigParser.str(o, "qr")))
            }
            "dashboard" -> {
                val a = o.optJSONArray("items")
                val list = ArrayList<SignKpi>()
                if (a != null) for (i in 0 until a.length()) { if (list.size >= 6) break; a.optJSONObject(i)?.let { kpi(it) }?.let(list::add) }
                if (list.isEmpty()) null else base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), kpis = list)
            }
            "directions" -> {
                val p = SignPlace(txt(o, "address", 160).replace('\n', ' '), txt(o, "reference", 120).replace('\n', ' '), txt(o, "hours", 120).replace('\n', ' '), txt(o, "phone", 40).replace('\n', ' '))
                if (p.address.isEmpty()) null else base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), place = p, qr = qrText(ConfigParser.str(o, "qr")))
            }
            "web" -> httpsOrNull(ConfigParser.str(o, "url"))?.let { base.copy(webUrl = it, refreshMin = int(o, "refreshMin", 0).coerceIn(0, 1440)) }
            "slide" -> {
                val f = o.optJSONObject("fields") ?: JSONObject()
                val tpl = ConfigParser.str(o, "template")?.lowercase()?.takeIf { it in TEMPLATES } ?: "comunicado"
                val lines = textLines(f.optJSONArray("lines"))
                val art = art(f)
                val commerce = tpl in setOf("oferta", "precos", "combo", "horario", "redes")
                val text = txt(f, "text", MAX_TEXT).ifEmpty { lines }
                base.copy(
                    art = art?.first,
                    artPhoto = art?.second == true,
                    artLight = art?.third == true,
                    palette = ConfigParser.str(f, "palette")?.lowercase()?.takeIf { it in PALETTES }.orEmpty(),
                    price = txt(f, "price", 20).replace('\n', ' '),
                    oldPrice = txt(f, "oldPrice", 20).replace('\n', ' '),
                    unit = txt(f, "unit", 20).replace('\n', ' '),
                    tag = txt(f, "tag", 30).replace('\n', ' '),
                    note = txt(f, "note", 80).replace('\n', ' '),
                    handle = txt(f, "handle", 40).replace('\n', ' '),
                    site = txt(f, "site", 60).replace('\n', ' '),
                    until = day(ConfigParser.str(f, "until")),
                    rows = if (tpl == "precos" || tpl == "horario" || tpl == "combo") rows(text) else emptyList(),
                    template = tpl,
                    title = txt(f, "title", MAX_TITLE).replace('\n', ' '),
                    text = txt(f, "text", MAX_TEXT).ifEmpty { lines },
                    subtitle = txt(f, "subtitle", 90).replace('\n', ' ').ifEmpty { txt(f, "name", 60).replace('\n', ' ') },
                    label = txt(f, "label", 30).replace('\n', ' '),
                    qr = qrText(ConfigParser.str(f, "qr")),
                    file = file(f.optJSONObject("image")),
                    portrait = ConfigParser.str(f, "orient")?.lowercase() == "port",
                    qrScale = sizeOf(f, "qrSize"),
                    priceScale = sizeOf(f, "priceSize"),
                    photoScale = sizeOf(f, "photoSize"),
                    titleScale = sizeOf(f, "titleSize"),
                    target = epoch(f, "target", tz).takeIf { it > 0 } ?: epoch(f, "date", tz),
                    menu = menu(f.optJSONArray("items")),
                    people = people(f.optJSONArray("people")),
                    kpi = f.optJSONObject("kpi")?.let { kpi(it) },
                ).takeIf { it.title.isNotEmpty() || it.text.isNotEmpty() || it.file != null || it.menu.isNotEmpty() || it.people.isNotEmpty() || it.kpi != null || (commerce && (it.price.isNotEmpty() || it.handle.isNotEmpty())) }
            }
            "post" -> {
                val cat = ConfigParser.str(o, "category")?.lowercase() ?: "comunicado"
                base.copy(
                    template = POST_TEMPLATE[cat] ?: "comunicado",
                    label = categoryLabel(cat),
                    title = txt(o, "title", MAX_TITLE).replace('\n', ' '),
                    text = txt(o, "body", MAX_TEXT).ifEmpty { txt(o, "text", MAX_TEXT) },
                    qr = httpsOrNull(ConfigParser.str(o, "qr") ?: ConfigParser.str(o, "qrUrl")),
                    file = file(o.optJSONObject("image") ?: o.optJSONObject("media")),
                    target = epoch(o, "date", tz),
                ).takeIf { it.title.isNotEmpty() || it.text.isNotEmpty() }
            }
            "birthdays" -> {
                val p = people(o.optJSONArray("people"))
                if (p.isEmpty()) null else base.copy(people = p, title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            }
            "kpi" -> kpi(o)?.let { base.copy(kpi = it, title = it.name, at = epoch(o, "at", tz)) }
            "news" -> {
                val n = news(o.optJSONArray("items") ?: o.optJSONArray("headlines"), tz)
                val single = o.opt("single") == true
                if (n.isEmpty()) null else base.copy(
                    news = if (single) n.take(1) else n, label = txt(o, "source", 40), title = txt(o, "title", MAX_TITLE).replace('\n', ' '),
                    single = single, file = if (single) file(o.optJSONObject("image")) else null,
                )
            }
            "quotes" -> {
                val q = quotes(o.optJSONArray("items"))
                if (q.isEmpty()) null else base.copy(quotes = q, at = epoch(o, "at", tz), label = txt(o, "source", 40), title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            }
            "menu" -> {
                val m = menu(o.optJSONArray("items") ?: o.optJSONArray("lines"))
                if (m.isEmpty()) null else base.copy(menu = m, title = txt(o, "title", MAX_TITLE).replace('\n', ' '), subtitle = txt(o, "day", 40).replace('\n', ' '))
            }
            "countdown" -> {
                val t = epoch(o, "target", tz)
                if (t <= 0) null else base.copy(
                    target = t, endAt = epoch(o, "until", tz).takeIf { it > t } ?: 0L,
                    title = txt(o, "title", MAX_TITLE).replace('\n', ' '), text = txt(o, "text", 120),
                )
            }
            "safety" -> {
                val s = day(ConfigParser.str(o, "since"))
                if (s == null) null else base.copy(
                    since = s, record = int(o, "record", 0).coerceIn(0, 100_000), hasRecord = !o.has("record") || !o.isNull("record"),
                    goal = int(o, "goal", 0).coerceIn(0, 100_000), title = txt(o, "title", MAX_TITLE).replace('\n', ' '),
                )
            }
            "worldclock" -> {
                val c = clocks(o.optJSONArray("clocks"))
                if (c.isEmpty()) null else base.copy(clocks = c, title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            }
            "text" -> base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), text = txt(o, "text", MAX_TEXT))
                .takeIf { it.title.isNotEmpty() || it.text.isNotEmpty() }
            "qr" -> qrText(ConfigParser.str(o, "qr") ?: ConfigParser.str(o, "url"))?.let { base.copy(qr = it, title = txt(o, "title", MAX_TITLE).replace('\n', ' ')) }
            else -> base // clock, weather, logo: desenhados com o que o app já tem
        }
    }

    fun categoryLabel(cat: String): String = when (cat) {
        "rh" -> "RH"
        "beneficio" -> "Benefícios"
        "boas-vindas" -> "Boas-vindas"
        "reconhecimento" -> "Reconhecimento"
        "seguranca" -> "Segurança"
        "vaga" -> "Vaga interna"
        "evento" -> "Evento"
        "aviso" -> "Aviso"
        else -> "Comunicado"
    }

    /** Rótulo do modelo do slide (o chapéu em cima do título). */
    fun templateLabel(tpl: String): String = when (tpl) {
        "boas-vindas" -> "Boas-vindas"
        "aniversariantes" -> "Aniversariantes"
        "reconhecimento" -> "Reconhecimento"
        "seguranca" -> "Segurança em primeiro lugar"
        "evento" -> "Evento"
        "vaga" -> "Vaga interna"
        "indicador" -> "Indicador"
        "cardapio" -> "Cardápio"
        "oferta" -> "Oferta"
        "precos" -> "Preços"
        "combo" -> "Combo"
        "horario" -> "Horário de funcionamento"
        "redes" -> "Siga a gente"
        "qr" -> "Aponte a câmera"
        "data-comemorativa" -> "Data comemorativa"
        "imagem-com-legenda" -> ""
        else -> "Comunicado"
    }

    // ------------------------------------------------------------------ hora e escolha do bloco

    fun local(nowMs: Long, tz: String): SignageLocal {
        val zone = TimeZone.getTimeZone(tz)
        val c = Calendar.getInstance(zone, Locale.ROOT).apply { timeInMillis = nowMs }
        val dow = c.get(Calendar.DAY_OF_WEEK) - 1
        val minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        val date = ymd(c)
        c.add(Calendar.DAY_OF_MONTH, -1)
        return SignageLocal(dow, minute, date, c.get(Calendar.DAY_OF_WEEK) - 1, ymd(c))
    }

    private fun ymd(c: Calendar): String =
        String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

    /** O dia (YYYY-MM-DD) no fuso do modo: a chave do `playsDay`. */
    fun dayOf(nowMs: Long, tz: String): String = local(nowMs, tz).date

    private fun dayOk(b: SignageBlock, dow: Int, date: String): Boolean =
        (b.days.isEmpty() || dow in b.days) && (b.dateFrom == null || date >= b.dateFrom) && (b.dateTo == null || date <= b.dateTo)

    /** O bloco vale nesta hora? A parte depois da meia-noite de uma faixa que vira a noite pertence ao dia anterior. */
    fun activeAt(b: SignageBlock, l: SignageLocal): Boolean = when {
        b.from == b.to || (b.from == 0 && b.to >= 1440) -> dayOk(b, l.dow, l.date)
        b.from < b.to -> l.minute >= b.from && l.minute < b.to && dayOk(b, l.dow, l.date)
        else -> (l.minute >= b.from && dayOk(b, l.dow, l.date)) || (l.minute < b.to && dayOk(b, l.prevDow, l.prevDate))
    }

    /**
     * O bloco de agora: o primeiro (a lista vem na ordem de prioridade) cujo dia e faixa valem; nenhum = o `fallback`;
     * sem ele, null (o layout de sempre). Sem hora confiável, só o `fallback` (nunca adivinha a faixa).
     */
    fun pick(s: SignageCfg?, nowMs: Long?, clockOk: Boolean = true): SignageBlock? {
        if (s == null) return null
        if (clockOk && nowMs != null) {
            val l = local(nowMs, s.tz)
            s.blocks.firstOrNull { activeAt(it, l) }?.let { return it }
        }
        return s.fallback?.let { f -> s.blocks.firstOrNull { it.id == f } }
    }

    // ------------------------------------------------------------------ contas dos widgets

    /** Quanto falta para o contador: dias, horas e minutos (tudo zero depois do alvo). */
    data class Remaining(val days: Long, val hours: Int, val minutes: Int, val done: Boolean)

    /** A fase do contador e quanto falta (dias, horas, minutos, segundos). */
    data class CountPhase(val label: String, val days: Long, val hours: Int, val minutes: Int, val seconds: Int)

    fun countPhase(target: Long, until: Long, now: Long): CountPhase {
        val (label, ms) = when {
            now < target -> "Começa em" to target - now
            until > 0 && now < until -> "Termina em" to until - now
            until > 0 -> "Encerrado" to 0L
            else -> "É hoje!" to 0L
        }
        val s = ms / 1000
        return CountPhase(label, s / 86400, ((s / 3600) % 24).toInt(), ((s / 60) % 60).toInt(), (s % 60).toInt())
    }

    fun remaining(target: Long, nowMs: Long): Remaining {
        val ms = target - nowMs
        if (ms <= 0) return Remaining(0, 0, 0, true)
        val totalMin = (ms + 59_999) / 60_000 // arredonda para cima: "faltam 1 min" até o último segundo
        return Remaining(totalMin / 1440, ((totalMin % 1440) / 60).toInt(), (totalMin % 60).toInt(), false)
    }

    /** Dias inteiros desde o último acidente (no fuso do modo); data no futuro = 0. */
    fun daysSince(since: String, nowMs: Long, tz: String): Long {
        val d0 = epochDay(since) ?: return 0L
        val today = epochDay(local(nowMs, tz).date) ?: return 0L
        return (today - d0).coerceAtLeast(0L)
    }

    /** Dias desde 1970-01-01 de uma data "YYYY-MM-DD" (conta no calendário, sem fuso). */
    fun epochDay(ymd: String): Long? {
        if (!DAY.matches(ymd)) return null
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT)
        c.clear()
        c.set(ymd.substring(0, 4).toInt(), ymd.substring(5, 7).toInt() - 1, ymd.substring(8, 10).toInt())
        return Math.floorDiv(c.timeInMillis, 86_400_000L)
    }

    /**
     * Quanto da meta já foi (0 a 1) para a barra. Sentido `down` (menor é melhor, ex.: perdas): na meta ou abaixo = 1;
     * acima, a meta dividida pelo valor. Sem meta = null (a barra não aparece).
     */
    fun kpiRatio(k: SignKpi): Float? {
        val t = k.target ?: return null
        val r = if (k.up) k.value / t else if (k.value <= t) 1.0 else t / k.value
        return r.coerceIn(0.0, 1.0).toFloat()
    }

    /** A faixa do indicador; sem a do servidor, pela meta (≥ 100% ok, ≥ 80% atenção, abaixo ruim). */
    fun kpiBand(k: SignKpi): String {
        if (k.band.isNotEmpty()) return k.band
        val r = kpiRatio(k) ?: return "ok"
        return when {
            r >= 1f -> "ok"
            r >= 0.8f -> "warn"
            else -> "bad"
        }
    }

    private val ptBr = Locale("pt", "BR")

    /** Número no jeito brasileiro (1.234,56), com as casas pedidas. */
    fun number(v: Double, decimals: Int): String = NumberFormat.getNumberInstance(ptBr).apply {
        minimumFractionDigits = decimals
        maximumFractionDigits = decimals
    }.format(v)

    /** Número do indicador: inteiro sem casas; quebrado com até 1 casa. */
    fun kpiNumber(v: Double): String = if (v == Math.floor(v) && kotlin.math.abs(v) < 1e12) number(v, 0) else number(v, 1)

    /** Variação da cotação: "+0,42%", "−1,10%" (sinal de menos de verdade) ou "0,00%". */
    fun change(ch: Double): String = when {
        ch > 0.004 -> "+" + number(ch, 2) + "%"
        ch < -0.004 -> "−" + number(-ch, 2) + "%"
        else -> number(0.0, 2) + "%"
    }

    /** "20/11" do aniversariante. */
    fun dayMonth(p: SignPerson): String = String.format(Locale.ROOT, "%02d/%02d", p.day, p.month)

    /** Iniciais para o círculo sem foto: "Ana S." → "AS". */
    fun initials(name: String): String {
        val parts = name.split(' ', '.').filter { it.isNotEmpty() && it[0].isLetter() }
        return when {
            parts.isEmpty() -> "?"
            parts.size == 1 -> parts[0].take(1).uppercase()
            else -> (parts.first().take(1) + parts.last().take(1)).uppercase()
        }
    }

    /** Hora "HH:mm" no fuso pedido. */
    fun hhmm(nowMs: Long, tz: String): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone(tz), Locale.ROOT).apply { timeInMillis = nowMs }
        return String.format(Locale.ROOT, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    }
}
