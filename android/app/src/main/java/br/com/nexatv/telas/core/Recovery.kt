package br.com.nexatv.telas.core

/*
 * A licença que sobrevive à reinstalação do app (docs/TELAS.md §32). Desinstalar apaga a pasta do app (o token some), mas
 * o ANDROID_ID não muda: do Android 8 em diante ele é por chave de assinatura do app + usuário + aparelho, igual depois de
 * reinstalar o mesmo app (mesma assinatura) e só muda no reset de fábrica. O app manda ao servidor um resumo dele (hwid) na
 * ativação e, reinstalado e sem token, pergunta ao servidor (POST /api/telas/recover) se há uma tela ativa ligada a este
 * aparelho: havendo, volta a ela sem chave.
 */

/** O hwid: SHA-256 (hexa minúsculo) do ANDROID_ID + nome do pacote. O ANDROID_ID cru nunca sai do aparelho. */
object HardwareId {
    /** O ANDROID_ID errado de fábrica de uma leva de aparelhos do Android 2.2 (o mesmo em todos): não identifica nada. */
    private const val BROKEN = "9774d56d682e549c"

    fun of(androidId: String?, pkg: String): String? {
        val id = androidId?.trim()?.lowercase().orEmpty()
        if (id.length < 8 || id == BROKEN || id.all { it == '0' } || pkg.isBlank()) return null
        return Hex.sha256("$id|$pkg".toByteArray(Charsets.UTF_8))
    }
}

/** O que fazer depois de uma pergunta ao /recover. */
enum class RecoverStep {
    /** 200: a tela voltou (token novo). */
    DONE,

    /** 404/400: nenhuma tela ativa ligada a este aparelho. Para de perguntar; fica a tela da chave. */
    NONE,

    /** Sem resposta (sem rede, relógio errado na partida): pergunta de novo logo. */
    RETRY_SOON,

    /** Freio (429) ou erro do servidor: pergunta de novo mais tarde. */
    RETRY_LATER,
}

object Recovery {
    fun shouldTry(mode: String, hasToken: Boolean, gaveUp: Boolean): Boolean = mode != "standalone" && !hasToken && !gaveUp

    /** status HTTP da resposta; null = sem resposta. */
    fun step(status: Int?): RecoverStep = when {
        status == null -> RecoverStep.RETRY_SOON
        status == 200 -> RecoverStep.DONE
        status == 404 || status == 400 -> RecoverStep.NONE
        else -> RecoverStep.RETRY_LATER
    }

    /** Vários servidores: um DONE vence; NONE só se todos disseram NONE; senão, o que pede mais pressa. */
    fun combine(steps: List<RecoverStep>): RecoverStep = when {
        steps.isEmpty() -> RecoverStep.NONE
        RecoverStep.DONE in steps -> RecoverStep.DONE
        steps.all { it == RecoverStep.NONE } -> RecoverStep.NONE
        RecoverStep.RETRY_SOON in steps -> RecoverStep.RETRY_SOON
        else -> RecoverStep.RETRY_LATER
    }

    /** Espera até a próxima pergunta: 5 s nas primeiras 12 sem rede (o 1º minuto da partida), depois 30 s; 60 s no freio. */
    fun delayMs(step: RecoverStep, attempt: Int): Long = when (step) {
        RecoverStep.RETRY_SOON -> if (attempt <= 12) 5_000L else 30_000L
        else -> 60_000L
    }

    /** Onde perguntar: o servidor guardado (se outro) e o padrão do app, sem repetir. */
    fun servers(saved: String?, default: String): List<String> =
        listOfNotNull(Urls.origin(saved), Urls.origin(default)).distinct()
}
