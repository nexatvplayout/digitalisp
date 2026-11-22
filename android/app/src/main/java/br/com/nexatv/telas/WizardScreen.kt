package br.com.nexatv.telas

import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import br.com.nexatv.telas.core.SetupPlan
import br.com.nexatv.telas.core.SetupState
import br.com.nexatv.telas.core.SetupStep

/**
 * Assistente de configuração inicial (1.2.4): no primeiro uso, antes da chave; também nos Ajustes. Cada passo mostra se
 * ficou OK, tem o botão que abre a tela certa do Android e pode ser pulado. O Android não deixa um app virar a tela
 * inicial sozinho (só com o Device Owner): quem instala confirma na pergunta do sistema.
 */
class WizardScreen(act: MainActivity, private val firstRun: Boolean = false) : Screen(act) {
    private val built = panel(680f)
    override val view: View get() = built.first
    override val autoClose: Boolean get() = Engine.configured
    private val skipped = HashSet<SetupStep>()
    private val rows = HashMap<SetupStep, TextView>()
    private val summary = Ui.label(act, "", 17f, 0xFFFFD166.toInt())
    private var first: View? = null

    init {
        val col = built.second
        col.addView(Ui.label(act, "Configuração inicial", 26f, bold = true))
        col.addView(Ui.label(act, "Faça cada passo (o Android pergunta na tela) ou pule. Dá para voltar aqui pelos Ajustes.", 15f, Ui.MUTED), Ui.lp(top = gap(6f)))
        for (step in SetupStep.values()) {
            val status = Ui.label(act, "", 18f, bold = true)
            rows[step] = status
            col.addView(status, Ui.lp(top = gap(14f)))
            col.addView(Ui.label(act, step.why, 14f, Ui.MUTED), Ui.lp(top = gap(2f)))
            val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }
            val doIt = Ui.button(act, actionText(step)) { run(step) }
            if (first == null) first = doIt
            row.addView(doIt, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f))
            if (step != SetupStep.KEY) {
                row.addView(
                    Ui.button(act, "Pular") {
                        skipped.add(step)
                        refresh()
                    },
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = gap(8f) },
                )
            }
            col.addView(row, Ui.lp(top = gap(6f)))
        }
        col.addView(summary, Ui.lp(top = gap(16f)))
        col.addView(Ui.button(act, if (firstRun) "Continuar para a chave de ativação" else "Fechar") { finish() }, Ui.lp(top = gap(8f)))
        refresh()
    }

    private fun actionText(step: SetupStep) = when (step) {
        SetupStep.HOME -> "Tornar o NEXA Telas a tela inicial"
        SetupStep.BOOT -> "Conferir (depende da tela inicial)"
        SetupStep.INSTALL -> "Permitir instalar as atualizações"
        SetupStep.BATTERY -> "Tirar da economia de bateria"
        SetupStep.NETWORK -> "Rede (Wi-Fi) / data e hora"
        SetupStep.KEY -> "Digitar a chave de ativação"
    }

    private fun run(step: SetupStep) {
        when (step) {
            SetupStep.HOME, SetupStep.BOOT -> act.openHomeChooser()
            SetupStep.INSTALL -> act.openInstallPermission()
            SetupStep.BATTERY -> act.openBatteryExemption()
            SetupStep.NETWORK -> if (Engine.deviceClockWrong()) act.openDateSettings() else act.openNetworkSettings()
            SetupStep.KEY -> finish()
        }
    }

    private fun state() = SetupState(
        isHome = Kiosk.isHome(act),
        sdkQPlus = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q,
        deviceOwner = Kiosk.isOwner(act),
        canInstall = Kiosk.canInstall(act),
        batteryExempt = Kiosk.batteryExempt(act),
        online = Engine.net() != "none",
        clockOk = !Engine.deviceClockWrong(),
        configured = Engine.configured,
    )

    private fun refresh() {
        val s = state()
        for ((step, tv) in rows) {
            val label = SetupPlan.label(step, s, skipped)
            tv.text = "${step.ordinal + 1}. ${step.title}: $label"
            tv.setTextColor(
                when (label) {
                    "OK" -> 0xFF7EE787.toInt()
                    "pulado" -> Ui.MUTED
                    else -> 0xFFFFD166.toInt()
                },
            )
        }
        summary.text = when (val next = SetupPlan.next(s, skipped)) {
            null -> "Tudo pronto."
            SetupStep.KEY -> "Falta só a chave de ativação."
            else -> "Próximo: ${next.title}."
        }
    }

    override fun onTick() = refresh()

    override fun onShown() {
        first?.requestFocus()
        refresh()
    }

    override fun onBack() = finish()

    private fun finish() {
        Engine.store.wizardDone = true
        if (Engine.configured) act.closeScreen() else act.showScreen(SetupScreen(act, SetupScreen.CHOOSE))
    }
}
