package br.com.nexatv.telas.core

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
    /** Zona `text`: o texto fixo; zona `qr`: o endereço; qualquer zona: um título opcional. */
    val text: String = "", val qr: String? = null, val title: String = "",
)

data class SignageLayoutCfg(val portrait: Boolean, val background: Int?, val zones: List<SignageZone>) {
    val hasVideo: Boolean get() = zones.any { it.kind == Signage.ZONE_VIDEO }
}

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
) {
    /** Arquivos que o item precisa (a imagem e as fotos). */
    val files: List<SignageFile> get() = listOfNotNull(file) + people.mapNotNull { it.photo }
}

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

data class SignageCfg(val tz: String, val brand: SignageBrand, val blocks: List<SignageBlock>, val fallback: String?) {
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
        "countdown", "safety", "worldclock", ZONE_QUEUE,
    )
    val ITEM_KINDS = setOf(
        "image", "slide", "post", "birthdays", "kpi", "news", "quotes", "menu",
        "countdown", "safety", "worldclock", "text", "clock", "weather", "qr", "logo",
    )
    val TEMPLATES = listOf(
        "comunicado", "boas-vindas", "aniversariantes", "reconhecimento", "seguranca", "evento",
        "vaga", "indicador", "cardapio", "qr", "imagem-com-legenda", "data-comemorativa",
    )
    /** Categoria do comunicado → modelo do slide. */
    val POST_TEMPLATE = mapOf(
        "comunicado" to "comunicado", "rh" to "comunicado", "beneficio" to "comunicado", "aviso" to "comunicado",
        "boas-vindas" to "boas-vindas", "reconhecimento" to "reconhecimento", "seguranca" to "seguranca",
        "vaga" to "vaga", "evento" to "evento",
    )

    // ---- tetos (§4.1) ----
    const val MAX_BLOCKS = 12
    const val MAX_ZONES = 6
    const val MAX_ITEMS = 60
    const val MAX_FILES = 200
    const val MAX_CACHE_BYTES = 80L * 1024 * 1024
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
        return SignageCfg(tz, brand, blocks, ConfigParser.str(o, "fallback")?.take(64))
    }

    private val TZ_IDS: Set<String> by lazy { TimeZone.getAvailableIDs().toHashSet() }

    fun validTz(id: String): Boolean = id.length <= 64 && id in TZ_IDS

    /** Arquivo do servidor: https, sha256 e tamanho de 1 byte ao teto. */
    fun file(o: JSONObject?): SignageFile? {
        if (o == null) return null
        val url = Urls.clean(ConfigParser.str(o, "url"))?.takeIf { Urls.isHttps(it) } ?: return null
        val sha = ConfigParser.str(o, "sha256")?.lowercase()?.takeIf { SHA.matches(it) } ?: return null
        val bytes = o.optLong("bytes", 0L)
        if (bytes !in 1..MAX_FILE_BYTES) return null
        return SignageFile(url, sha, bytes)
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
        return SignageZone(id, x, y, w, h, kind, txt(o, "text", MAX_TEXT), httpsOrNull(ConfigParser.str(o, "qr")), txt(o, "title", MAX_TITLE))
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
        return SignageLayoutCfg(portrait, color(ConfigParser.str(o, "background")), zones)
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
        val seconds = int(o, "seconds", DEFAULT_SECONDS).let { if (it <= 0) DEFAULT_SECONDS else it.coerceIn(3, 300) }
        val base = SignageItem(id, kind, seconds)
        return when (kind) {
            "image" -> {
                val f = file(o) ?: return null
                base.copy(file = f, label = txt(o, "caption", 120).replace('\n', ' '), contain = ConfigParser.str(o, "fit") == "contain")
            }
            "slide" -> {
                val f = o.optJSONObject("fields") ?: JSONObject()
                val tpl = ConfigParser.str(o, "template")?.lowercase()?.takeIf { it in TEMPLATES } ?: "comunicado"
                val lines = textLines(f.optJSONArray("lines"))
                base.copy(
                    template = tpl,
                    title = txt(f, "title", MAX_TITLE).replace('\n', ' '),
                    text = txt(f, "text", MAX_TEXT).ifEmpty { lines },
                    subtitle = txt(f, "subtitle", 90).replace('\n', ' ').ifEmpty { txt(f, "name", 60).replace('\n', ' ') },
                    label = txt(f, "label", 30).replace('\n', ' '),
                    qr = httpsOrNull(ConfigParser.str(f, "qr")),
                    file = file(f.optJSONObject("image")),
                    target = epoch(f, "target", tz).takeIf { it > 0 } ?: epoch(f, "date", tz),
                    menu = menu(f.optJSONArray("items")),
                    people = people(f.optJSONArray("people")),
                    kpi = f.optJSONObject("kpi")?.let { kpi(it) },
                ).takeIf { it.title.isNotEmpty() || it.text.isNotEmpty() || it.file != null || it.menu.isNotEmpty() || it.people.isNotEmpty() || it.kpi != null }
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
                if (n.isEmpty()) null else base.copy(news = n, label = txt(o, "source", 40), title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
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
                if (t <= 0) null else base.copy(target = t, title = txt(o, "title", MAX_TITLE).replace('\n', ' '), text = txt(o, "text", 120))
            }
            "safety" -> {
                val s = day(ConfigParser.str(o, "since"))
                if (s == null) null else base.copy(since = s, record = int(o, "record", 0).coerceIn(0, 100_000), goal = int(o, "goal", 0).coerceIn(0, 100_000), title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            }
            "worldclock" -> {
                val c = clocks(o.optJSONArray("clocks"))
                if (c.isEmpty()) null else base.copy(clocks = c, title = txt(o, "title", MAX_TITLE).replace('\n', ' '))
            }
            "text" -> base.copy(title = txt(o, "title", MAX_TITLE).replace('\n', ' '), text = txt(o, "text", MAX_TEXT))
                .takeIf { it.title.isNotEmpty() || it.text.isNotEmpty() }
            "qr" -> httpsOrNull(ConfigParser.str(o, "qr") ?: ConfigParser.str(o, "url"))?.let { base.copy(qr = it, title = txt(o, "title", MAX_TITLE).replace('\n', ' ')) }
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
