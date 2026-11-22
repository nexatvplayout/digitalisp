package br.com.digitalisp.instalador.adb

/** Resultado do `pm install`, já com a explicação em português para o técnico. */
sealed interface ResultadoPm {
    data object Sucesso : ResultadoPm
    /** A TV é antiga e não conhece a opção -g: repetir sem ela. */
    data object OpcaoDesconhecida : ResultadoPm
    data class Falha(val codigo: String, val explicacao: String) : ResultadoPm
}

/** Lê a saída dos comandos do shell da TV. Sem Android (testável). */
object SaidaComandos {
    private val EXPLICACOES = mapOf(
        "INSTALL_FAILED_UPDATE_INCOMPATIBLE" to
            "Já existe na TV um app com o mesmo nome, assinado com outra chave. Desinstale o app antigo da TV e tente de novo.",
        "INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES" to
            "Já existe na TV um app com o mesmo nome, assinado com outra chave. Desinstale o app antigo da TV e tente de novo.",
        "INSTALL_FAILED_VERSION_DOWNGRADE" to
            "A TV já tem uma versão mais nova do app. Não é preciso instalar de novo.",
        "INSTALL_FAILED_INSUFFICIENT_STORAGE" to
            "A TV está sem espaço. Apague apps ou arquivos que não usa e tente de novo.",
        "INSTALL_FAILED_OLDER_SDK" to
            "O Android desta TV é antigo demais para o app de tela.",
        "INSTALL_FAILED_NO_MATCHING_ABIS" to
            "O app não tem versão para o processador desta TV.",
        "INSTALL_PARSE_FAILED_NO_CERTIFICATES" to
            "O arquivo do app não está assinado. Use o APK de release assinado.",
        "INSTALL_FAILED_INVALID_APK" to
            "O arquivo do app chegou estragado. Baixe de novo.",
        "INSTALL_PARSE_FAILED_NOT_APK" to
            "O arquivo baixado não é um app Android. Confira o endereço do APK.",
        "INSTALL_FAILED_USER_RESTRICTED" to
            "A TV bloqueou a instalação. Nas opções do desenvolvedor, ligue \"Instalar via USB\" e aceite o aviso na TV.",
        "INSTALL_FAILED_VERIFICATION_FAILURE" to
            "A TV bloqueou o app (verificação de apps). Desligue a verificação de apps instalados por USB e tente de novo.",
        "INSTALL_FAILED_ABORTED" to
            "A instalação foi cancelada na TV. Tente de novo e aceite o aviso na tela da TV, se aparecer.",
    )

    fun lerPmInstall(saida: String): ResultadoPm {
        val texto = saida.trim()
        if (texto.lines().any { it.trim() == "Success" }) return ResultadoPm.Sucesso
        if (texto.contains("Unknown option", ignoreCase = true) || texto.contains("Unknown option: -g")) {
            return ResultadoPm.OpcaoDesconhecida
        }
        val codigo = Regex("(INSTALL_[A-Z_]+)").find(texto)?.groupValues?.get(1)
        if (codigo != null) {
            return ResultadoPm.Falha(codigo, EXPLICACOES[codigo] ?: "A TV recusou a instalação ($codigo).")
        }
        val resumo = texto.lines().lastOrNull { it.isNotBlank() }?.take(200) ?: "sem resposta"
        return ResultadoPm.Falha("DESCONHECIDO", "A TV não confirmou a instalação: $resumo")
    }

    /** O `monkey` diz "No activities found to run" quando não há ícone na categoria pedida. */
    fun abriuComMonkey(saida: String): Boolean =
        !saida.contains("No activities found", ignoreCase = true) &&
            !saida.contains("monkey aborted", ignoreCase = true) &&
            !saida.contains("not found", ignoreCase = true)

    /** Comandos para abrir o app, na ordem: ícone de TV (Leanback) e depois ícone comum. */
    fun comandosAbrir(pacote: String): List<String> {
        require(pacote.matches(Regex("^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$"))) { "pacote inválido: $pacote" }
        return listOf(
            "monkey -p $pacote -c android.intent.category.LEANBACK_LAUNCHER 1",
            "monkey -p $pacote -c android.intent.category.LAUNCHER 1",
        )
    }

    fun comandoInstalar(caminho: String, comPermissoes: Boolean): String =
        if (comPermissoes) "pm install -r -g \"$caminho\"" else "pm install -r \"$caminho\""
}
