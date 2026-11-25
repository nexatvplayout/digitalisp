package br.com.digitalisp.telas.core

import java.io.File

/**
 * Os arquivos da TV Corporativa no aparelho (imagens, logomarca, fotos), conferidos pelo sha256, para a tela seguir sem
 * internet. Pasta própria (`files/signage`), separada dos vídeos guardados e da imagem de fora do ar. Sem Android aqui.
 *
 * Regras (§4.1): até [Signage.MAX_FILES] arquivos e [Signage.MAX_CACHE_BYTES] no total; o que a configuração pede nunca
 * sai; o que saiu da configuração fica (pode voltar amanhã) até passar do teto, e aí sai o usado há mais tempo.
 */
object SignageCache {
    /** Um arquivo na pasta: tamanho e quando foi usado pela última vez (data de modificação). */
    data class Existing(val bytes: Long, val usedAt: Long)

    data class Plan(val download: List<SignageFile>, val delete: List<String>, val skipped: List<SignageFile>)

    fun plan(
        wanted: List<SignageFile>,
        existing: Map<String, Existing>,
        maxFiles: Int = Signage.MAX_FILES,
        maxBytes: Long = Signage.MAX_CACHE_BYTES,
    ): Plan {
        val want = LinkedHashMap<String, SignageFile>()
        for (f in wanted) want.putIfAbsent(f.fileName, f)
        val delete = ArrayList<String>()
        // .part que ninguém pede mais e arquivos de nome estranho saem; arquivo completo de tamanho errado também
        for ((name, e) in existing) {
            if (name.endsWith(OfflinePlan.PART)) {
                val base = name.removeSuffix(OfflinePlan.PART)
                val w = want[base]
                if (w == null || e.bytes > w.bytes) delete.add(name)
            } else {
                val w = want[name]
                if (!name.endsWith(".img")) delete.add(name)
                else if (w != null && e.bytes != w.bytes) delete.add(name)
            }
        }
        val gone = delete.toHashSet()
        val have = existing.filterKeys { it !in gone && !it.endsWith(OfflinePlan.PART) }
        // o pedido cabe? (na ordem da configuração: o que vem antes tem preferência)
        val download = ArrayList<SignageFile>()
        val skipped = ArrayList<SignageFile>()
        var files = 0
        var bytes = 0L
        for ((name, f) in want) {
            if (files + 1 > maxFiles || bytes + f.bytes > maxBytes) {
                skipped.add(f)
                continue
            }
            files++
            bytes += f.bytes
            if (have[name]?.bytes != f.bytes) download.add(f)
        }
        // os de fora da configuração: ficam enquanto couberem, os mais recentes primeiro
        val extra = have.filterKeys { it !in want }.entries.sortedByDescending { it.value.usedAt }
        for ((name, e) in extra) {
            if (files + 1 > maxFiles || bytes + e.bytes > maxBytes) {
                delete.add(name)
                continue
            }
            files++
            bytes += e.bytes
        }
        // um pedido pulado por falta de espaço também não fica com o arquivo (se houver) de tamanho certo ocupando
        for (f in skipped) if (have.containsKey(f.fileName)) delete.add(f.fileName)
        return Plan(download, delete.distinct().sorted(), skipped)
    }

    /** O arquivo pronto (baixado e do tamanho certo) ou null (a tela pula o item). */
    fun ready(dir: File, f: SignageFile): File? = File(dir, f.fileName).takeIf { it.isFile && it.length() == f.bytes }

    /** Lista a pasta no formato do [plan]. */
    fun scan(dir: File): Map<String, Existing> =
        (dir.listFiles() ?: emptyArray()).filter { it.isFile }.associate { it.name to Existing(it.length(), it.lastModified()) }

    /**
     * Uma passada: apaga o que o plano manda, baixa o que falta (conferindo o sha256 pelo [OfflineFetch]) e marca como
     * usados os pedidos. Devolve quantos arquivos novos ficaram prontos. [skip] diz se um arquivo deve esperar (falhou há
     * pouco); [onResult] recebe o resultado de cada download.
     */
    fun sync(
        dir: File,
        wanted: List<SignageFile>,
        transport: OfflineTransport,
        now: Long,
        skip: (SignageFile) -> Boolean = { false },
        onResult: (SignageFile, OfflineFetch.Result) -> Unit = { _, _ -> },
        cancelled: () -> Boolean = { false },
    ): Int {
        dir.mkdirs()
        val p = plan(wanted, scan(dir))
        for (name in p.delete) File(dir, name).delete()
        var got = 0
        for (f in p.download) {
            if (cancelled()) break
            if (skip(f)) continue
            val r = OfflineFetch.fetchAs(f.fileName, f.asItem(), dir, transport, cancelled)
            onResult(f, r)
            if (r == OfflineFetch.Result.OK) got++
        }
        // "usado agora": o que a configuração pede é o último a sair quando o cache enche
        for (f in wanted) ready(dir, f)?.setLastModified(now)
        return got
    }
}
