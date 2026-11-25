package br.com.digitalisp.instalador.lg

import org.json.JSONObject

/** Andamento da instalação no luna-send (cada linha é um JSON). */
sealed interface PassoLuna {
    data object Seguindo : PassoLuna
    data object Instalado : PassoLuna
    data class Falhou(val motivo: String) : PassoLuna
}

/**
 * Os comandos e as respostas do modo desenvolvedor da LG (webOS), como o `ares-install`/`ares-launch` do webOS TV CLI
 * (github.com/webos-tools/cli, Apache-2.0: lib/install.js, lib/base/luna.js e files/conf/command-service.json).
 * Sem Android a não ser o org.json (testável na JVM com o org.json de verdade).
 */
object SaidaLg {
    const val PORTA_SSH = 9922
    const val PORTA_CHAVE = 9991
    const val USUARIO = "prisoner"
    const val PASTA = "/media/developer/temp"
    const val LUNA = "/usr/bin/luna-send-pub"

    fun validarAppId(appId: String) {
        require(appId.matches(Regex("^[a-z0-9]+(\\.[a-z0-9-]+)+$"))) { "id de app LG inválido: $appId" }
    }

    fun validarNomeArquivo(nome: String) {
        require(nome.matches(Regex("^[A-Za-z0-9_.-]+\\.ipk$"))) { "nome de pacote inválido: $nome" }
    }

    fun caminho(nomeArquivo: String): String { validarNomeArquivo(nomeArquivo); return "$PASTA/$nomeArquivo" }

    const val CRIAR_PASTA = "/usr/bin/test -d $PASTA || /bin/mkdir -p $PASTA"

    fun tamanho(caminho: String) = "/usr/bin/wc -c < \"$caminho\""

    fun apagar(caminho: String) = "/bin/rm -f \"$caminho\""

    /** Igual ao ares-install: o id "com.ares.defaultName" e o caminho do .ipk na TV. */
    fun instalar(caminho: String): String {
        require(caminho.startsWith("$PASTA/")) { "caminho fora da pasta do modo desenvolvedor" }
        validarNomeArquivo(caminho.removePrefix("$PASTA/"))
        return "$LUNA -i luna://com.webos.appInstallService/dev/install " +
            "'{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$caminho\",\"subscribe\":true}'"
    }

    fun abrir(appId: String): String {
        validarAppId(appId)
        return "$LUNA -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$appId\"}'"
    }

    /** O token da sessão do modo desenvolvedor (o app Developer Mode grava em /var/luna/preferences/devmode_enabled). */
    const val LER_TOKEN = "/bin/cat /var/luna/preferences/devmode_enabled"

    /**
     * Uma linha do luna-send da instalação. O ares-install olha `details.state`: "FAILED" é erro (motivo em
     * `details.reason`), "installed"/"SUCCESS" é fim; o resto é andamento.
     */
    fun lerLinhaInstalacao(linha: String): PassoLuna {
        val j = runCatching { JSONObject(linha.trim()) }.getOrNull() ?: return PassoLuna.Seguindo
        if (j.has("returnValue") && !j.optBoolean("returnValue", true)) {
            return PassoLuna.Falhou(j.optString("errorText", j.optString("errorMessage", "a TV recusou a instalação")))
        }
        val d = j.optJSONObject("details") ?: return PassoLuna.Seguindo
        val estado = d.optString("state", "")
        return when {
            estado.contains("FAILED", ignoreCase = true) -> PassoLuna.Falhou(explicar(d.optString("reason", estado)))
            Regex("installed|^SUCCESS", RegexOption.IGNORE_CASE).containsMatchIn(estado) -> PassoLuna.Instalado
            else -> PassoLuna.Seguindo
        }
    }

    fun explicar(motivo: String): String = when {
        motivo.contains("space", ignoreCase = true) || motivo.contains("storage", ignoreCase = true) ->
            "A TV está sem espaço. Apague apps que não usa e tente de novo."
        motivo.contains("verif", ignoreCase = true) || motivo.contains("signature", ignoreCase = true) ->
            "A TV não aceitou o pacote ($motivo)."
        else -> "A TV recusou a instalação ($motivo)."
    }

    /** O launch devolve `{"returnValue":true,...}`. */
    fun abriu(saida: String): Boolean = Regex("\"returnValue\"\\s*:\\s*true").containsMatchIn(saida)

    /** A frase-senha que a TV mostra no app Developer Mode: letras e números, normalmente 6. */
    fun normalizarFrase(texto: String): String? {
        val t = texto.trim().filter { !it.isWhitespace() }.uppercase()
        return t.takeIf { it.length in 4..32 && it.all { c -> c.isLetterOrDigit() } }
    }

    /** O token do devmode_enabled: só letras, números e alguns símbolos (vai numa URL). */
    fun lerToken(saida: String): String? = saida.trim().takeIf { it.matches(Regex("^[A-Za-z0-9+/=_-]{8,512}$")) }

    /** Resposta do CheckDevModeSession.dev: {"result":"success","errorMsg":"HHH:MM:SS"} — o tempo que falta. */
    fun lerTempoRestante(json: String): String? {
        val j = runCatching { JSONObject(json) }.getOrNull() ?: return null
        if (j.optString("result") != "success") return null
        return j.optString("errorMsg").takeIf { it.matches(Regex("^\\d{1,4}:\\d{2}(:\\d{2})?$")) }
    }

    /** "1234:56:00" → "51 dias e 10 horas" (aprox.), para o técnico. */
    fun tempoAmigavel(hms: String): String {
        val p = hms.split(':').mapNotNull { it.toIntOrNull() }
        val horas = p.getOrElse(0) { 0 }
        val dias = horas / 24
        return if (dias > 0) "$dias dia(s) e ${horas % 24} hora(s)" else "$horas hora(s) e ${p.getOrElse(1) { 0 }} minuto(s)"
    }
}
