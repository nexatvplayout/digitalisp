package br.com.digitalisp.telas.core

/** O que fazer com o `update` do /config (o servidor manda o endereço do APK novo, o SHA-256 e o versionCode). */
enum class UpdateAction { NONE, UP_TO_DATE, WAIT, DOWNLOAD }

object UpdatePolicy {
    /** Depois de uma tentativa automática da mesma versão, espera isto antes de tentar de novo (o botão não espera). */
    const val RETRY_MS = 6 * 60 * 60 * 1000L

    /**
     * installed: o versionCode deste app; offered: o `update` do /config; manual: o botão "Procurar atualização";
     * triedCode/triedAgoMs: a última tentativa automática.
     */
    fun decide(installed: Int, offered: UpdateCfg?, manual: Boolean, triedCode: Int, triedAgoMs: Long): UpdateAction = when {
        offered == null -> UpdateAction.NONE
        offered.versionCode <= installed -> UpdateAction.UP_TO_DATE
        !manual && triedCode == offered.versionCode && triedAgoMs in 0 until RETRY_MS -> UpdateAction.WAIT
        else -> UpdateAction.DOWNLOAD
    }

    /** A frase do botão "Procurar atualização". */
    fun text(action: UpdateAction, installedName: String, offeredCode: Int?): String = when (action) {
        UpdateAction.NONE -> "Nenhuma atualização oferecida pelo servidor (versão instalada: $installedName)."
        UpdateAction.UP_TO_DATE -> "Este aparelho já tem a versão mais nova ($installedName)."
        UpdateAction.WAIT, UpdateAction.DOWNLOAD -> "Baixando a versão nova (versionCode $offeredCode)…"
    }
}

/** Os passos do assistente de configuração inicial (primeiro uso; também nos Ajustes). */
enum class SetupStep(val title: String, val why: String) {
    HOME("Tela inicial do aparelho", "Este app abre no lugar da tela inicial do Android e volta pelo botão Home."),
    BOOT("Abrir ao ligar", "Ao ligar a TV box, o app abre sozinho."),
    INSTALL("Instalar as atualizações do app", "Permite que o app instale a própria versão nova."),
    BATTERY("Sem economia de bateria", "O Android não fecha o app nem atrasa o contato com o servidor."),
    NETWORK("Rede e hora", "Internet funcionando e a data do aparelho certa (sem ela o https não abre)."),
    KEY("Código de cadastro", "O código gerado no painel liga esta tela ao cliente (vale uma vez)."),
}

/** O estado de cada passo, tirado do aparelho (pela tela) e testável sem Android. */
data class SetupState(
    val isHome: Boolean,
    /** Android 10 ou mais novo: só a tela inicial (ou o Device Owner) abre sozinha ao ligar. */
    val sdkQPlus: Boolean,
    val deviceOwner: Boolean,
    val canInstall: Boolean,
    val batteryExempt: Boolean,
    val online: Boolean,
    val clockOk: Boolean,
    val configured: Boolean,
)

object SetupPlan {
    fun ok(step: SetupStep, s: SetupState): Boolean = when (step) {
        SetupStep.HOME -> s.isHome || s.deviceOwner
        // o aviso de boot o app recebe sempre; no Android 10+ ele só consegue abrir a tela sendo a inicial (ou Device Owner)
        SetupStep.BOOT -> !s.sdkQPlus || s.isHome || s.deviceOwner
        SetupStep.INSTALL -> s.canInstall || s.deviceOwner
        SetupStep.BATTERY -> s.batteryExempt
        SetupStep.NETWORK -> s.online && s.clockOk
        SetupStep.KEY -> s.configured
    }

    /** O próximo passo a fazer: o primeiro que não está OK e não foi pulado; null = tudo feito ou pulado. */
    fun next(s: SetupState, skipped: Set<SetupStep>): SetupStep? =
        SetupStep.values().firstOrNull { !ok(it, s) && it !in skipped }

    /** "OK", "pulado" ou "falta". */
    fun label(step: SetupStep, s: SetupState, skipped: Set<SetupStep>): String = when {
        ok(step, s) -> "OK"
        step in skipped -> "pulado"
        else -> "falta"
    }
}
