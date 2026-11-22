package br.com.nexatv.telas.core

object Schedule {
    /** "07:00" → 420. Aceita "7:00" e "24:00" (= fim do dia). */
    fun parseHm(raw: String?): Int? {
        val m = Regex("""^(\d{1,2}):(\d{2})$""").find(raw?.trim().orEmpty()) ?: return null
        val h = m.groupValues[1].toInt()
        val min = m.groupValues[2].toInt()
        if (min > 59 || h > 24 || (h == 24 && min != 0)) return null
        return h * 60 + min
    }

    /**
     * A tela deve estar ligada agora? `dow`: 0 = domingo … 6 = sábado, no fuso do aparelho.
     * Sem horário = sempre ligada. Janela que vira a noite (22:00 às 06:00) pertence ao dia em que começa.
     */
    fun isOn(s: ScheduleCfg?, dow: Int, minuteOfDay: Int): Boolean {
        if (s == null) return true
        fun dayOk(d: Int) = s.days.isEmpty() || ((d % 7 + 7) % 7) in s.days
        return when {
            s.onMin == s.offMin -> dayOk(dow)
            s.onMin < s.offMin -> dayOk(dow) && minuteOfDay >= s.onMin && minuteOfDay < s.offMin
            else -> (dayOk(dow) && minuteOfDay >= s.onMin) || (dayOk(dow - 1) && minuteOfDay < s.offMin)
        }
    }
}

/** Quantos minutos faltam para a tela ligar de novo (olha até 8 dias à frente). Null = nunca. */
fun Schedule.minutesUntilOn(s: ScheduleCfg, dow: Int, minuteOfDay: Int): Int? {
    for (i in 1..8 * 1440) {
        val m = minuteOfDay + i
        if (isOn(s, (dow + m / 1440) % 7, m % 1440)) return i
    }
    return null
}

/** Conteúdo guardado no aparelho: o que fica, o que baixa, o que apaga. */
object OfflinePlan {
    data class Plan(
        val keep: List<OfflineItem>,
        val download: List<OfflineItem>,
        val delete: List<String>,
        val skipped: List<OfflineItem>,
    )

    const val PART = ".part"
    private val SHA = Regex("[0-9a-f]{64}")

    fun valid(item: OfflineItem): Boolean = Urls.isHttps(item.url) && SHA.matches(item.sha256) && item.bytes > 0

    /** Nome do arquivo no aparelho: o sha256 mais a extensão do endereço (só letras e números). */
    fun fileName(item: OfflineItem): String {
        val path = item.url.substringBefore('?').substringBefore('#')
        val ext = path.substringAfterLast('/', "").substringAfterLast('.', "").lowercase()
        val safe = if (ext.length in 1..5 && ext.all { it in 'a'..'z' || it in '0'..'9' }) ext else "mp4"
        return item.sha256 + "." + safe
    }

    /**
     * @param existing nome → tamanho dos arquivos na pasta (completos e `.part`)
     * @param freeBytes espaço livre no armazenamento agora
     * @param reserveBytes folga que nunca se ocupa
     */
    fun reconcile(items: List<OfflineItem>, existing: Map<String, Long>, freeBytes: Long, reserveBytes: Long): Plan {
        val listed = LinkedHashMap<String, OfflineItem>()
        for (it in items) if (valid(it)) listed.putIfAbsent(fileName(it), it)

        val keep = ArrayList<OfflineItem>()
        val pending = ArrayList<OfflineItem>()
        val wanted = HashSet<String>()
        for ((name, item) in listed) {
            if (existing[name] == item.bytes) {
                keep.add(item)
                wanted.add(name)
            } else {
                pending.add(item)
                // arquivo "completo" de tamanho errado é lixo; o .part vale se não passou do tamanho
                val part = existing[name + PART]
                if (part != null && part <= item.bytes) wanted.add(name + PART)
            }
        }
        val delete = existing.keys.filter { it !in wanted }.sorted()
        var budget = freeBytes - reserveBytes + delete.sumOf { existing[it] ?: 0L }
        val download = ArrayList<OfflineItem>()
        val skipped = ArrayList<OfflineItem>()
        for (item in pending) {
            val have = existing[fileName(item) + PART]?.takeIf { it <= item.bytes } ?: 0L
            val need = item.bytes - have
            if (need <= budget) {
                download.add(item)
                budget -= need
            } else {
                skipped.add(item)
            }
        }
        return Plan(keep, download, delete, skipped)
    }
}
