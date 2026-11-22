package br.com.digitalisp.telas.core

import org.json.JSONObject

/** A imagem que o cliente sobe para a tela não ficar preta sem conexão (`offline.image` do /config, 14/11). */
data class FallbackImage(val url: String, val sha256: String, val bytes: Long) {
    /** Nome do arquivo no aparelho (pasta própria, fora da dos vídeos guardados). */
    val fileName: String get() = "$sha256.jpg"

    fun asItem(): OfflineItem = OfflineItem(url, sha256, bytes)
}

/** O que mostrar na área do vídeo. */
enum class VideoArea { VIDEO, IMAGE, BLACK }

object FallbackImages {
    const val MAX_BYTES = 2L * 1024 * 1024

    /** Tempo sem vídeo antes de pôr a imagem (as recargas rápidas do vigia não piscam a imagem). */
    const val GRACE_MS = 4_000L

    private val SHA = Regex("[0-9a-f]{64}")

    /** `offline.image`: só https, sha256 de 64 hex e de 1 byte a 2 MB. Ausente, null ou inválido = sem imagem. */
    fun parse(o: JSONObject?): FallbackImage? {
        if (o == null) return null
        val url = Urls.clean(ConfigParser.str(o, "url"))?.takeIf { Urls.isHttps(it) } ?: return null
        val sha = ConfigParser.str(o, "sha256")?.lowercase()?.takeIf { SHA.matches(it) } ?: return null
        val bytes = o.optLong("bytes", 0L)
        if (bytes !in 1..MAX_BYTES) return null
        return FallbackImage(url, sha, bytes)
    }

    data class Plan(val download: FallbackImage?, val delete: List<String>, val show: String?)

    /**
     * Mantém a última imagem boa: a nova só substitui a antiga depois de baixada e conferida.
     * @param existing nome → tamanho dos arquivos na pasta da imagem (completos e `.part`)
     * - sem imagem na configuração: apaga tudo;
     * - a pedida já está no aparelho: mostra ela e apaga o resto;
     * - falta a pedida: baixa; enquanto isso mostra a anterior (se houver) e só apaga os `.part` de outras.
     */
    fun plan(image: FallbackImage?, existing: Map<String, Long>): Plan {
        if (image == null) return Plan(null, existing.keys.sorted(), null)
        val want = image.fileName
        if (existing[want] == image.bytes) return Plan(null, existing.keys.filter { it != want }.sorted(), want)
        val part = want + OfflinePlan.PART
        val complete = existing.filterKeys { !it.endsWith(OfflinePlan.PART) && it != want && it.endsWith(".jpg") }
        val delete = existing.keys.filter { it != part && it !in complete.keys }.sorted()
        return Plan(image, delete, complete.keys.sorted().firstOrNull())
    }

    /**
     * Vídeo guardado > imagem > preto. O vigia (core/Watchdog) já troca para o vídeo guardado quando principal e reserva
     * não tocam; a imagem cobre só o tempo em que NADA toca (sem vídeo guardado, ou enquanto ele carrega).
     * @param notPlayingMs há quanto tempo nada toca (0 = tocando)
     */
    fun area(playing: Boolean, notPlayingMs: Long, hasImage: Boolean): VideoArea = when {
        playing || notPlayingMs < GRACE_MS -> VideoArea.VIDEO
        hasImage -> VideoArea.IMAGE
        else -> VideoArea.BLACK
    }
}
