package br.com.digitalisp.telas.core

import org.json.JSONObject

/**
 * As legendas TRADUZIDAS do canal do NEXA Broadcast (o studiofy): o vídeo leva só a legenda original (CEA-608 CC1); as
 * traduções são arquivos WebVTT listados no guia público do canal (GET https://<site>/api/c/<canal>/epg?count=3), com os
 * mesmos tempos da original. O app escolhe o arquivo do idioma pedido e desenha por cima do vídeo, sincronizado pelo
 * horário da imagem que está na tela: posição no arquivo = (agora_no_ar − startsAt) / 1000 + mediaOffset.
 * Sem o guia (outro canal, YouTube) nada disto vale: fica a legenda que o próprio canal entrega.
 */
data class GuideCaption(val lang: String, val url: String)

data class GuideItem(
    val kind: String,
    val startsAt: Long,
    val endsAt: Long,
    val mediaOffsetSec: Double,
    val captions: List<GuideCaption>,
) {
    /** O arquivo do idioma pedido (pt casa com pt-BR; zh-CN com zh-cn), ou null. */
    fun captionFor(lang: String?): GuideCaption? {
        if (lang == null) return null
        val want = lang.lowercase()
        return captions.firstOrNull { it.lang.lowercase() == want } ?: captions.firstOrNull { it.lang.substringBefore('-').lowercase() == want.substringBefore('-') }
    }
}

data class Guide(val serverTime: Long, val airLagMs: Long, val items: List<GuideItem>, val blocked: Boolean) {
    /** O item no ar no horário `airNow` (ms de época). */
    fun itemAt(airNow: Long): GuideItem? = items.firstOrNull { airNow >= it.startsAt && airNow < it.endsAt }

    /** Os idiomas das legendas do item no ar (a original primeiro), para o botão dos ajustes. */
    fun languagesAt(airNow: Long): List<String> = itemAt(airNow)?.captions?.map { it.lang }.orEmpty()
}

data class Cue(val startSec: Double, val endSec: Double, val text: String)

object GuideCaptions {
    /** Releitura do guia (o NEXA pede ~30 s, ou na troca de item). */
    const val REFRESH_MS = 30_000L

    private val HLS = Regex("^https?://hls\\.([^/]+)/hls/([A-Za-z0-9_-]{1,60})/", RegexOption.IGNORE_CASE)

    /** O endereço do guia do canal a partir do HLS dele (https://hls.<site>/hls/<canal>/… → https://<site>/api/c/<canal>/epg). */
    fun guideUrl(hls: String?): String? {
        val m = HLS.find(hls ?: return null) ?: return null
        return "https://${m.groupValues[1]}/api/c/${m.groupValues[2]}/epg?count=3"
    }

    /** A raiz do site do guia, para as URLs relativas das legendas. */
    fun siteOf(guideUrl: String): String = guideUrl.substringBefore("/api/")

    fun parseGuide(json: String, site: String): Guide? = try {
        val o = JSONObject(json)
        val arr = o.optJSONArray("items")
        val items = ArrayList<GuideItem>()
        if (arr != null) for (i in 0 until arr.length()) {
            val it = arr.optJSONObject(i) ?: continue
            val caps = ArrayList<GuideCaption>()
            val ca = it.optJSONArray("captions")
            if (ca != null) for (k in 0 until ca.length()) {
                val c = ca.optJSONObject(k) ?: continue
                val lang = c.optString("lang", "").trim()
                val url = c.optString("url", "").trim()
                if (lang.isNotEmpty() && url.isNotEmpty()) caps.add(GuideCaption(lang, absolute(site, url)))
            }
            items.add(GuideItem(
                kind = it.optString("kind", ""),
                startsAt = it.optDouble("startsAt", 0.0).toLong(),
                endsAt = it.optDouble("endsAt", 0.0).toLong(),
                mediaOffsetSec = it.optDouble("mediaOffset", 0.0).let { v -> if (v.isNaN()) 0.0 else v },
                captions = if (it.optString("kind") == "live") emptyList() else caps,
            ))
        }
        // alerta de emergência no ar: a legenda some (como no site do NEXA)
        val eas = o.optJSONObject("eas")
        val blocked = (eas?.optJSONArray("cards")?.length() ?: 0) > 0
        Guide(o.optLong("serverTime", 0L), o.optLong("airLagMs", 0L), items, blocked)
    } catch (_: Exception) {
        null
    }

    private fun absolute(site: String, url: String): String = when {
        url.startsWith("http://") || url.startsWith("https://") -> url
        url.startsWith("/") -> site.trimEnd('/') + url
        else -> site.trimEnd('/') + "/" + url
    }

    private val TIME = Regex("(?:(\\d+):)?(\\d{1,2}):(\\d{2})[.,](\\d{1,3})")

    private fun seconds(s: String): Double? {
        val m = TIME.find(s.trim()) ?: return null
        val h = m.groupValues[1].ifEmpty { "0" }.toDouble()
        val frac = m.groupValues[4].padEnd(3, '0').take(3).toDouble() / 1000.0
        return h * 3600 + m.groupValues[2].toDouble() * 60 + m.groupValues[3].toDouble() + frac
    }

    /** Lê um WebVTT: os trechos com início, fim e texto (sem as marcas <i>, <b>, <c.x>…). */
    fun parseVtt(text: String): List<Cue> {
        val out = ArrayList<Cue>()
        val blocks = text.replace("\r\n", "\n").replace('\r', '\n').split(Regex("\n\\s*\n"))
        for (b in blocks) {
            val lines = b.split('\n').map { it.trimEnd() }.filter { it.isNotEmpty() }
            val i = lines.indexOfFirst { it.contains("-->") }
            if (i < 0) continue
            val parts = lines[i].split("-->")
            val start = seconds(parts[0]) ?: continue
            val end = seconds(parts.getOrNull(1)?.trim()?.substringBefore(' ') ?: "") ?: continue
            val body = lines.drop(i + 1).joinToString("\n") { it.replace(Regex("<[^>]+>"), "") }.trim()
            if (body.isNotEmpty() && end > start) out.add(Cue(start, end, body))
        }
        return out.sortedBy { it.startSec }
    }

    /** O texto da legenda na posição `posSec` do arquivo (vazio = nada na tela). */
    fun textAt(cues: List<Cue>, posSec: Double): String {
        // busca binária pelo último trecho que já começou
        var lo = 0; var hi = cues.size - 1; var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (cues[mid].startSec <= posSec) { found = mid; lo = mid + 1 } else hi = mid - 1
        }
        if (found < 0) return ""
        // trechos que se sobrepõem: junta os que ainda valem
        val now = ArrayList<String>()
        var k = found
        while (k >= 0 && now.size < 3) {
            val c = cues[k]
            if (posSec < c.endSec) now.add(0, c.text)
            if (found - k > 6) break
            k--
        }
        return now.joinToString("\n")
    }

    /** A posição no arquivo do item no ar: (agora_no_ar − startsAt)/1000 + mediaOffset. */
    fun position(item: GuideItem, airNow: Long): Double = (airNow - item.startsAt) / 1000.0 + item.mediaOffsetSec
}
