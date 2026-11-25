package br.com.digitalisp.instalador.samsung

/** Resultado do `0 vd_appinstall`, com a explicação em português. */
sealed interface ResultadoTizen {
    data object Sucesso : ResultadoTizen
    data class Falha(val codigo: String?, val explicacao: String, val certificado: Boolean) : ResultadoTizen
}

/**
 * O que a TV Samsung responde, lido sem Android (testável). Os formatos vêm do tráfego real de uma Samsung
 * UN58TU7020 (Tizen 5.5) e do Tizen Studio 2025 (classes InstallCLICommand e SecureCmdVer1_0 do tizen-new-cli).
 */
object SaidaSamsung {
    const val PORTA = 26101
    /** Pasta em que a TV aceita receber pacotes (a única liberada para o sdb no modo desenvolvedor). */
    const val PASTA_PADRAO = "/home/owner/share/tmp/sdk_tools"

    /** "capability:" devolve linhas chave:valor (com um 0x02 antes da primeira). */
    fun lerCapacidades(texto: String): Map<String, String> =
        texto.trimStart('\u0002').lines().mapNotNull { l ->
            val i = l.indexOf(':')
            if (i <= 0) null else l.substring(0, i).trim() to l.substring(i + 1).trim()
        }.toMap()

    /** Pasta temporária para o pacote: `sdk_toolpath` + "/tmp", como o Tizen Studio faz. */
    fun pastaTemporaria(capacidades: Map<String, String>): String {
        val base = capacidades["sdk_toolpath"]?.takeIf { it.startsWith("/") && !it.contains("..") } ?: PASTA_PADRAO
        return base.trimEnd('/') + "/tmp"
    }

    /** O CNXN da TV traz "device::MODELO::0". */
    fun modeloDoCnxn(texto: String): String? = texto.trimEnd('\u0000').split("::").getOrNull(1)?.takeIf { it.isNotBlank() }

    fun validarAppId(appId: String) {
        require(appId.matches(Regex("^[A-Za-z0-9]{10}\\.[A-Za-z0-9_]+$"))) { "id de app Samsung inválido: $appId" }
    }

    fun validarCaminho(caminho: String) {
        require(caminho.matches(Regex("^/[A-Za-z0-9_./-]+$")) && !caminho.contains("..")) { "caminho inválido: $caminho" }
    }

    fun comandoInstalar(appId: String, caminho: String): String {
        validarAppId(appId); validarCaminho(caminho)
        return "0 vd_appinstall $appId $caminho"
    }

    fun comandoAbrir(appId: String): String { validarAppId(appId); return "0 execute $appId" }

    const val COMANDO_DUID = "0 getduid"
    const val COMANDO_APPS = "0 applist"

    /**
     * Saída do vd_appinstall. Sucesso: "app_id[X] install completed". Falha: "app_id[X] install failed[118, -12]" ou
     * "download failed[16]", às vezes com o motivo. O que fala em assinatura ou certificado quase sempre é o certificado
     * de distribuidor sem o DUID desta TV.
     */
    fun lerInstalacao(saida: String, duid: String?): ResultadoTizen {
        val t = saida.trim()
        if (Regex("install completed", RegexOption.IGNORE_CASE).containsMatchIn(t)) return ResultadoTizen.Sucesso
        val codigo = Regex("failed\\[([^\\]]+)]", RegexOption.IGNORE_CASE).find(t)?.groupValues?.get(1)?.trim()
        val primeiro = codigo?.substringBefore(',')?.trim()
        val cert = Regex("signature|certificate|certif|author|distributor|privilege", RegexOption.IGNORE_CASE).containsMatchIn(t) ||
            primeiro in setOf("118", "117", "-12")
        val tv = duid?.let { " (DUID desta TV: $it)" } ?: ""
        val explicacao = when {
            cert ->
                "A TV recusou a assinatura do app$tv. O certificado Samsung do DIGITAL ISP precisa incluir esta TV: " +
                    "mande o DUID ao responsável, que gera o pacote de novo com o DUID no certificado."
            t.contains("download failed", ignoreCase = true) && primeiro == "16" ->
                "A TV não encontrou o pacote enviado. Tente de novo."
            t.contains("download failed", ignoreCase = true) ->
                "A TV não conseguiu ler o pacote (erro ${codigo ?: "?"}). Tente de novo; se repetir, desligue e ligue a TV pela tomada."
            primeiro == "-11" || t.contains("space", ignoreCase = true) ->
                "A TV está sem espaço. Apague apps que não usa e tente de novo."
            codigo != null -> "A TV recusou a instalação (erro $codigo)$tv."
            t.isEmpty() -> "A TV não respondeu ao pedido de instalação."
            else -> "A TV não confirmou a instalação: ${t.lines().last { it.isNotBlank() }.take(200)}"
        }
        return ResultadoTizen.Falha(codigo, explicacao, cert)
    }

    /** `0 getduid` devolve o DUID (13 letras/números) e uma quebra de linha. */
    fun lerDuid(saida: String): String? = saida.trim().takeIf { it.matches(Regex("^[A-Z0-9]{8,32}$")) }

    /** `0 applist`: linhas "\t'Nome'\t 'AppId'". */
    fun appInstalado(saida: String, appId: String): Boolean = saida.contains("'$appId'")

    /** O `0 execute` devolve "... launch app[...] successed" ou um erro; sem "fail" consideramos aberto. */
    fun abriu(saida: String): Boolean = !Regex("fail|error|not found|invalid", RegexOption.IGNORE_CASE).containsMatchIn(saida)
}
