package br.com.digitalisp.telas.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Pessoas desaparecidas (contrato §8): a lista `missing` do sinal de vida, a foto conferida pelo sha256 e o ritmo da
 * exibição pelo relógio do aparelho. Tudo aqui é lógica pura, com teste na JVM.
 */

enum class MissingShow(val wire: String) {
    FULL("full"), BANNER("banner"), BOTH("both");

    companion object {
        fun of(raw: String?): MissingShow = entries.firstOrNull { it.wire == raw?.trim()?.lowercase() } ?: BOTH
    }
}

/** Foto do caso: sempre JPEG por https; o app só mostra depois de conferir o sha256. */
data class MissingPhoto(val url: String, val sha256: String, val bytes: Long) {
    /** O mesmo formato dos vídeos guardados, para reaproveitar o download com conferência ([OfflineFetch], com o nome [fileName]). */
    fun asItem(): OfflineItem = OfflineItem(url, sha256, bytes)

    /** Nome do arquivo no aparelho: só o sha256 (o endereço não entra no nome). */
    val fileName: String get() = "$sha256.jpg"
}

/**
 * `kind`: crianca | adolescente | adulto | idoso | informacao (cartela de pedido de informação da polícia, contrato §10).
 * `header`: cabeçalho pronto do servidor ("" = o cabeçalho pelo tipo). `until` em epoch ms; 0 = sem prazo.
 */
data class MissingCase(
    val id: Long,
    val kind: String,
    val name: String,
    val age: Int?,
    val since: String?,
    val lastSeen: String,
    val description: String,
    val contact: String,
    val photo: MissingPhoto?,
    val show: MissingShow,
    val fullSec: Int,
    val bannerSec: Int,
    val everyMin: Int,
    val until: Long,
    val header: String = "",
    val qr: MissingQr? = null,
) {
    /** Cartela policial sem foto: não há rosto para mostrar, então o texto ocupa a largura (sem silhueta). */
    val textOnly: Boolean get() = kind == "informacao" && photo == null

    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("kind", kind).put("name", name)
        .put("age", age ?: JSONObject.NULL).put("since", since ?: JSONObject.NULL)
        .put("lastSeen", lastSeen).put("description", description).put("contact", contact)
        .put("photo", photo?.let { JSONObject().put("url", it.url).put("sha256", it.sha256).put("bytes", it.bytes) } ?: JSONObject.NULL)
        .put("show", show.wire).put("fullSec", fullSec).put("bannerSec", bannerSec).put("everyMin", everyMin).put("until", until).put("header", header)
        .put("qr", qr?.let { JSONObject().put("data", it.data).put("label", it.label) } ?: JSONObject.NULL)
}

/**
 * QR code do caso (contrato §11), para contato imediato. `data` é o conteúdo do código: só `https://…`, `tel:+…` ou
 * `sms:+…`. O app só desenha o código: não abre o endereço nem o confere além do começo.
 */
data class MissingQr(val data: String, val label: String) {
    companion object {
        const val MAX_DATA = 300
        const val MAX_LABEL = 40
        const val DEFAULT_LABEL = "Aponte a câmera do celular"
        private val PREFIXES = listOf("https://", "tel:+", "sms:+")

        /**
         * Leitura tolerante: qualquer coisa fora do combinado = sem QR code (o caso continua valendo). `data` comprido
         * demais é recusado, não cortado: um endereço cortado viraria um código que leva a outro lugar.
         */
        fun of(raw: Any?): MissingQr? {
            val o = raw as? JSONObject ?: return null
            val data = (o.opt("data") as? String)?.trim() ?: return null
            if (data.isEmpty() || data.length > MAX_DATA || data.any { it.isWhitespace() || it.code < 0x20 }) return null
            val low = data.lowercase()
            if (PREFIXES.none { low.startsWith(it) && low.length > it.length }) return null
            val label = (o.opt("label") as? String)?.replace(Regex("\\s+"), " ")?.trim()?.take(MAX_LABEL).orEmpty()
            return MissingQr(data, label.ifEmpty { DEFAULT_LABEL })
        }
    }
}

/** Tamanho do QR code na tela, para um celular ler a uns 3 metros (contrato §11). Devolve o lado em pixels. */
object MissingQrSize {
    /**
     * Tela cheia: 23% da altura da tela (o contrato pede pelo menos 22%). Com a TV em pé a altura é o lado maior,
     * então o código é limitado a 45% da largura para caber ao lado da frase.
     */
    fun full(width: Int, height: Int): Int {
        if (width <= 0 || height <= 0) return 0
        val side = Math.ceil(height * 0.23).toInt()
        return if (height > width) minOf(side, (width * 0.45).toInt()) else side
    }

    /**
     * Faixa: a altura útil da faixa. Se o código ficar menor que 12% da altura da tela (faixa baixa numa TV em pé),
     * devolve 0: a faixa não desenha o código, só o contato.
     */
    fun banner(bannerHeight: Int, screenHeight: Int): Int {
        if (bannerHeight <= 0 || screenHeight <= 0) return 0
        val side = (bannerHeight * 0.87).toInt()
        return if (side < screenHeight * 0.12) 0 else side
    }
}

object Missing {
    const val MAX_CASES = 5
    const val MAX_PHOTO_BYTES = 1024L * 1024 // o contrato fala em até 600 KB; acima de 1 MB o app nem baixa
    val KINDS = listOf("crianca", "adolescente", "adulto", "idoso", "informacao")
    private val PT_BR = java.util.Locale("pt", "BR")

    /** Só texto de verdade vale (número, lista, objeto, null = ausente). Uma linha, caixa alta, até 40 caracteres. */
    fun headerOf(raw: Any?): String = (raw as? String)?.replace(Regex("\\s+"), " ")?.trim()?.take(40)?.uppercase(PT_BR).orEmpty()
    private val SHA = Regex("[0-9a-f]{64}")
    private val DATE = Regex("""(\d{4})-(\d{2})-(\d{2})""")

    /** Número dentro da faixa; ausente, zero, negativo ou que não é número = o padrão. */
    private fun bounded(o: JSONObject, key: String, min: Int, max: Int, default: Int): Int {
        val v = o.optDouble(key, Double.NaN)
        if (v.isNaN() || v <= 0) return default
        return v.coerceIn(min.toDouble(), max.toDouble()).toInt()
    }

    private fun photo(o: JSONObject?): MissingPhoto? {
        if (o == null) return null
        val url = Urls.clean(ConfigParser.str(o, "url")) ?: return null
        val sha = ConfigParser.str(o, "sha256")?.lowercase() ?: return null
        val bytes = o.optLong("bytes", 0L)
        if (!Urls.isHttps(url) || !SHA.matches(sha) || bytes !in 1..MAX_PHOTO_BYTES) return null
        return MissingPhoto(url, sha, bytes)
    }

    /** Leitura tolerante: caso sem `id` ou sem nome cai fora; o resto ganha o padrão. No máximo [MAX_CASES]. */
    fun parse(arr: JSONArray?): List<MissingCase> {
        if (arr == null) return emptyList()
        val out = ArrayList<MissingCase>()
        val seen = HashSet<Long>()
        for (i in 0 until arr.length()) {
            if (out.size >= MAX_CASES) break
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optLong("id", 0L)
            val name = (ConfigParser.str(o, "name") ?: "").take(80)
            if (id <= 0L || name.isEmpty() || !seen.add(id)) continue
            val age = o.optDouble("age", Double.NaN).let { if (it.isNaN() || it < 0 || it > 130) null else it.toInt() }
            val since = ConfigParser.str(o, "since")?.takeIf { s ->
                DATE.matchEntire(s)?.let { m -> m.groupValues[2].toInt() in 1..12 && m.groupValues[3].toInt() in 1..31 } == true
            }
            out.add(
                MissingCase(
                    id = id,
                    kind = ConfigParser.str(o, "kind")?.lowercase()?.takeIf { it in KINDS } ?: "adulto",
                    name = name,
                    age = age,
                    since = since,
                    lastSeen = (ConfigParser.str(o, "lastSeen") ?: "").take(120),
                    description = (ConfigParser.str(o, "description") ?: "").take(200),
                    contact = (ConfigParser.str(o, "contact") ?: "").take(80),
                    photo = photo(o.optJSONObject("photo")),
                    show = MissingShow.of(ConfigParser.str(o, "show")),
                    fullSec = bounded(o, "fullSec", 8, 60, 15),
                    bannerSec = bounded(o, "bannerSec", 8, 120, 20),
                    everyMin = bounded(o, "everyMin", 2, 60, 10),
                    until = o.optLong("until", 0L).coerceAtLeast(0L),
                    header = headerOf(o.opt("header")),
                    qr = MissingQr.of(o.opt("qr")),
                ),
            )
        }
        return out
    }

    fun parse(json: String?): List<MissingCase> = try {
        if (json.isNullOrEmpty()) emptyList() else parse(JSONArray(json))
    } catch (_: Exception) {
        emptyList()
    }

    fun toJson(list: List<MissingCase>): String = JSONArray().also { a -> list.forEach { a.put(it.toJson()) } }.toString()

    /** Os casos que ainda valem: `until` vencido não mostra, mesmo se o caso ainda estiver na lista. */
    fun active(list: List<MissingCase>, now: Long): List<MissingCase> = list.filter { it.until == 0L || it.until > now }

    // ---- textos (contrato §8.2 e §10) ----
    /** O cabeçalho da tela cheia: o `header` do servidor quando vem; senão, pelo tipo. */
    fun headerFor(c: MissingCase): String = c.header.ifEmpty { header(c.kind) }

    /** O cabeçalho curto da faixa: o `header` do servidor quando vem; senão "DESAPARECIDA(O)" (ou "INFORMAÇÕES" na cartela policial). */
    fun shortHeaderFor(c: MissingCase): String = c.header.ifEmpty { if (c.kind == "informacao") SHORT_INFO else SHORT_HEADER }

    fun header(kind: String): String = when (kind) {
        "informacao" -> "A POLÍCIA PEDE INFORMAÇÕES"
        "crianca" -> "CRIANÇA DESAPARECIDA"
        "adolescente" -> "ADOLESCENTE DESAPARECIDO(A)"
        "idoso" -> "IDOSO(A) DESAPARECIDO(A)"
        else -> "PESSOA DESAPARECIDA"
    }

    const val SHORT_HEADER = "DESAPARECIDA(O)"
    const val SHORT_INFO = "PEDIDO DE INFORMAÇÕES"

    fun age(age: Int?): String = when (age) {
        null -> ""
        1 -> "1 ano"
        else -> "$age anos"
    }

    /** "Desde 10/11/2026", ou vazio sem data. */
    fun since(since: String?): String {
        val m = DATE.matchEntire(since.orEmpty()) ?: return ""
        return "Desde ${m.groupValues[3]}/${m.groupValues[2]}/${m.groupValues[1]}"
    }

    fun lastSeen(text: String): String = if (text.isEmpty()) "" else "Visto(a) por último: $text"

    /** Nome e idade numa linha só, para a faixa. */
    fun nameAndAge(c: MissingCase): String = if (c.age == null) c.name else "${c.name}, ${age(c.age)}"

    // ---- fotos ----
    data class PhotoPlan(val download: List<MissingPhoto>, val delete: List<String>)

    /**
     * @param existing nome → tamanho dos arquivos na pasta das fotos.
     * Baixa o que falta (uma vez por sha256), apaga a foto de quem saiu da lista e qualquer arquivo de tamanho errado.
     * O `.part` de uma foto que ainda está na lista fica (o download continua de onde parou).
     */
    fun photoPlan(cases: List<MissingCase>, existing: Map<String, Long>): PhotoPlan {
        val wanted = LinkedHashMap<String, MissingPhoto>()
        for (c in cases) c.photo?.let { wanted.putIfAbsent(it.fileName, it) }
        val keep = HashSet<String>()
        val download = ArrayList<MissingPhoto>()
        for ((name, p) in wanted) {
            if (existing[name] == p.bytes) keep.add(name)
            else {
                download.add(p)
                val part = existing[name + OfflinePlan.PART]
                if (part != null && part <= p.bytes) keep.add(name + OfflinePlan.PART)
            }
        }
        return PhotoPlan(download, existing.keys.filter { it !in keep }.sorted())
    }
}

/** O que está na tela agora: um caso, em tela cheia ou em faixa, e quantos segundos ainda fica. */
data class MissingShowing(val case: MissingCase, val full: Boolean, val remainingSec: Int)

/**
 * O ritmo (contrato §8.2), pelo relógio do aparelho, para as telas de um mesmo prédio ficarem juntas.
 *
 * - O ciclo do aparelho é o menor `everyMin` entre os casos em vigor; ele começa quando
 *   `(minutos desde a meia-noite) % ciclo == 0`, no segundo 0.
 * - Um caso entra num ciclo quando um múltiplo do `everyMin` DELE cai dentro desse ciclo (caso com 30 min numa lista
 *   cujo ciclo é 10 min sai uma vez a cada três ciclos).
 * - No começo do ciclo saem, na ordem da lista: a tela cheia dos casos `full` e `both` e a faixa dos casos `banner`.
 *   Na metade do ciclo sai a faixa dos casos `both`.
 * - Cada bloco (o do começo e o da metade) nunca passa de metade do ciclo. O que não couber fica para o ciclo
 *   seguinte: a cada ciclo o bloco começa um caso adiante (rodízio).
 * - No layout `queue` a tela cheia nunca cobre o painel de senha: tudo vira faixa.
 */
object MissingSchedule {
    private class Item(val case: MissingCase, val full: Boolean, val sec: Int)

    private fun cycleMin(cases: List<MissingCase>): Int = cases.minOf { it.everyMin }

    /** Um múltiplo do `everyMin` do caso cai em [startMin, startMin + cycle)? */
    private fun due(c: MissingCase, startMin: Int, cycle: Int): Boolean {
        val next = ((startMin + c.everyMin - 1) / c.everyMin) * c.everyMin
        return next < startMin + cycle
    }

    private fun block(cases: List<MissingCase>, startMin: Int, cycle: Int, second: Boolean, queueLayout: Boolean): List<Item> {
        val half = cycle * 30
        val all = ArrayList<Item>()
        for (c in cases) {
            if (!due(c, startMin, cycle)) continue
            if (!second) {
                when {
                    c.show == MissingShow.BANNER || queueLayout -> all.add(Item(c, false, minOf(c.bannerSec, half)))
                    else -> all.add(Item(c, true, minOf(c.fullSec, half)))
                }
            } else if (c.show == MissingShow.BOTH) {
                all.add(Item(c, false, minOf(c.bannerSec, half)))
            }
        }
        if (all.isEmpty() || all.sumOf { it.sec } <= half) return all
        // não cabe tudo: rodízio, começando um caso adiante a cada ciclo
        val first = (startMin / cycle) % all.size
        val out = ArrayList<Item>()
        var used = 0
        for (k in all.indices) {
            val it = all[(first + k) % all.size]
            if (used + it.sec > half) break
            out.add(it)
            used += it.sec
        }
        return out
    }

    /**
     * @param cases os casos em vigor (já sem os vencidos), na ordem da lista
     * @param secOfDay segundos desde a meia-noite, no relógio e no fuso do aparelho
     */
    fun at(cases: List<MissingCase>, secOfDay: Int, queueLayout: Boolean): MissingShowing? {
        if (cases.isEmpty() || secOfDay < 0) return null
        val cycle = cycleMin(cases)
        val startMin = (secOfDay / 60 / cycle) * cycle
        val offset = secOfDay - startMin * 60
        val half = cycle * 30
        val second = offset >= half
        var t = if (second) offset - half else offset
        for (it in block(cases, startMin, cycle, second, queueLayout)) {
            if (t < it.sec) return MissingShowing(it.case, it.full, it.sec - t)
            t -= it.sec
        }
        return null
    }

    /** O segundo do dia em que começa a próxima exibição (depois de `secOfDay`), ou null se não há nada em 24 h. */
    fun nextStart(cases: List<MissingCase>, secOfDay: Int, queueLayout: Boolean): Int? {
        if (cases.isEmpty()) return null
        val cycle = cycleMin(cases)
        val half = cycle * 30
        var start = (secOfDay / 60 / cycle) * cycle * 60
        repeat(24 * 60 / cycle + 2) {
            for (s in intArrayOf(start, start + half)) {
                if (s > secOfDay && at(cases, s % 86_400, queueLayout) != null) return s % 86_400
            }
            start += cycle * 60
        }
        return null
    }

    fun hhmm(secOfDay: Int): String = String.format(java.util.Locale.US, "%02d:%02d", secOfDay / 3600 % 24, secOfDay / 60 % 60)
}
