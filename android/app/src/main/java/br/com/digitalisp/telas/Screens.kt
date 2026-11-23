package br.com.digitalisp.telas

import android.graphics.Color
import android.os.Build
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import br.com.digitalisp.telas.core.ClockCheck
import br.com.digitalisp.telas.core.Overscan
import br.com.digitalisp.telas.core.CaptionsPolicy
import br.com.digitalisp.telas.core.CallSound
import br.com.digitalisp.telas.core.CallSoundMode
import br.com.digitalisp.telas.core.PinDisplay
import br.com.digitalisp.telas.core.ClockView
import br.com.digitalisp.telas.core.ActivationKey
import br.com.digitalisp.telas.core.StartupClock
import br.com.digitalisp.telas.core.NetErrors
import br.com.digitalisp.telas.core.Lockout
import br.com.digitalisp.telas.core.Pin
import br.com.digitalisp.telas.core.Urls
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Uma tela por cima do vídeo (primeira configuração, PIN, ajustes). */
abstract class Screen(protected val act: MainActivity) {
    abstract val view: View

    /** Fecha sozinha depois de um tempo sem tecla? */
    open val autoClose: Boolean = true
    open fun onKey(e: KeyEvent): Boolean = false
    open fun onBack() = act.closeScreen()
    open fun onTick() {}
    open fun onShown() {}

    /** Largura útil da coluna do painel (para os teclados da tela caberem). */
    protected var contentWidthPx = 0
        private set

    /** Painel rolável, com uma coluna no meio, dentro da área segura do overscan (a mesma margem da tela do canal). */
    protected fun panel(widthDp: Float = 620f): Pair<FrameLayout, LinearLayout> {
        val p = Ui.dp(act, 24f)
        val col = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(p, p, p, p)
        }
        val dm = act.resources.displayMetrics
        val ins = Overscan.insets(dm.widthPixels, dm.heightPixels, try { Engine.store.overscanPct } catch (_: Exception) { Overscan.DEFAULT })
        // nunca mais largo que a tela menos as margens (TV box com a interface em 720p e densidade alta tem poucos "dp")
        val w = minOf(Ui.dp(act, widthDp), dm.widthPixels - ins.left - ins.right - Ui.dp(act, 16f))
        contentWidthPx = w - 2 * p
        val scroll = ScrollView(act).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(col, FrameLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL))
        }
        val host = FrameLayout(act).apply {
            setBackgroundColor(Ui.BG)
            setPadding(ins.left, ins.top, ins.right, ins.bottom)
            isClickable = true
            addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        return host to col
    }

    protected fun gap(dp: Float = 12f) = Ui.dp(act, dp)

    /**
     * O topo white-label (docs/CONTRATO-APP-MARCA.md): a logo da revenda sobre a cor de fundo dela; com a logo ainda não
     * baixada, o nome da revenda; sem marca (antes do cadastro), [neutral] (ou nada). Nunca o nome do app.
     */
    protected fun fillBrand(slot: FrameLayout, neutral: String?) {
        slot.removeAllViews()
        val b = Engine.brand
        val logo = act.brandLogo()
        val v: View? = when {
            logo != null -> android.widget.ImageView(act).apply {
                setImageBitmap(logo)
                adjustViewBounds = true
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                setBackgroundColor(b?.background ?: Color.BLACK)
                val p = gap(10f)
                setPadding(p, p, p, p)
                maxWidth = if (contentWidthPx > 0) contentWidthPx else Ui.dp(act, 560f)
                maxHeight = Ui.dp(act, 110f)
                isFocusable = false
            }
            b != null && b.name.isNotEmpty() -> Ui.label(act, b.name, 30f, b.accent, bold = true)
            neutral != null -> Ui.label(act, neutral, 30f, bold = true)
            else -> null
        }
        if (v != null) slot.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.START))
        slot.visibility = if (v == null) View.GONE else View.VISIBLE
    }

    /** Botão que pede um segundo toque para confirmar. */
    protected fun confirmButton(text: String, confirm: String, action: () -> Unit): Button {
        var armedAt = 0L
        return Ui.button(act, text) { b ->
            val now = System.currentTimeMillis()
            if (now - armedAt < 6000) {
                action()
            } else {
                armedAt = now
                b.text = confirm
                b.postDelayed({ b.text = text }, 6000)
            }
        }
    }
}

/** Tela que mostra a marca da revenda no topo: a logo pode ficar pronta com a tela aberta. */
interface BrandedScreen {
    fun onBrandChanged()
}

/** Primeira configuração: escolha do modo, cadastro com o código (gerenciado) ou endereço e PIN (avulso). */
class SetupScreen(act: MainActivity, private var step: Int, private val message: String = "") : Screen(act), BrandedScreen {
    companion object {
        const val CHOOSE = 0
        const val MANAGED = 1
        const val STANDALONE = 2
        const val NEUTRAL_TITLE = "DIGITAL ISP"
    }

    private val built = panel()
    override val view: View get() = built.first
    private val col: LinearLayout get() = built.second
    private var busy = false
    private var first: View? = null

    /** Enquanto o app não está configurado, esta tela não fecha. */
    override val autoClose: Boolean get() = Engine.configured

    private var clockLoading: View? = null
    private var clockMsg: android.widget.TextView? = null
    private var clockBtn: View? = null
    private var recoverNote: View? = null
    private val brandSlot = FrameLayout(act)

    init {
        build()
    }

    override fun onBrandChanged() = fillBrand(brandSlot, NEUTRAL_TITLE)

    override fun onShown() {
        first?.requestFocus()
    }

    override fun onTick() = refreshClock()

    /** Relógio errado: "Carregando…" na partida; passado o prazo, a frase curta, o detalhe e o botão da data. */
    fun refreshClock() {
        val v = Engine.clockView()
        clockLoading?.visibility = if (v == ClockView.LOADING) View.VISIBLE else View.GONE
        val msg = v == ClockView.MESSAGE
        clockMsg?.visibility = if (msg) View.VISIBLE else View.GONE
        clockBtn?.visibility = if (msg) View.VISIBLE else View.GONE
        recoverNote?.visibility = if (Engine.recovering) View.VISIBLE else View.GONE
        if (msg) clockMsg?.text = StartupClock.MESSAGE_TEXT + " " + ClockCheck.message(System.currentTimeMillis())
    }

    override fun onBack() {
        if (busy) return
        if (Engine.configured) act.showSettings()
        else if (step != CHOOSE) act.requirePin { go(CHOOSE) }
    }

    private fun go(s: Int) {
        step = s
        build()
        act.showScreen(this)
    }

    private fun build() {
        col.removeAllViews()
        first = null
        (brandSlot.parent as? ViewGroup)?.removeView(brandSlot)
        col.addView(brandSlot)
        fillBrand(brandSlot, NEUTRAL_TITLE)
        if (message.isNotEmpty()) col.addView(Ui.label(act, message, 18f, 0xFFFFD166.toInt()), Ui.lp(top = gap(8f)))
        // TV box sem bateria de relógio: com a data errada a ativação falha (o https é recusado). Na partida o relógio
        // acerta sozinho pela rede em segundos: até lá, "Carregando…" (StartupClock); depois, a frase e o botão.
        clockLoading = Ui.label(act, StartupClock.LOADING_TEXT, 17f, Ui.MUTED).also { col.addView(it, Ui.lp(top = gap(8f))) }
        clockMsg = Ui.label(act, "", 17f, 0xFFFF8A80.toInt()).also { col.addView(it, Ui.lp(top = gap(8f))) }
        clockBtn = Ui.button(act, "Abrir data e hora do Android") { act.requirePin { act.openDateSettings() } }.also { col.addView(it, Ui.lp(top = gap(6f))) }
        // app reinstalado (§32): a tela do aparelho volta sozinha, sem a chave, se ainda estiver ativa no painel
        recoverNote = Ui.label(act, "Procurando a ativação anterior deste aparelho…", 17f, Ui.MUTED).also { col.addView(it, Ui.lp(top = gap(8f))) }
        refreshClock()
        when (step) {
            CHOOSE -> buildChoose()
            MANAGED -> buildManaged()
            else -> buildStandalone()
        }
        col.addView(
            Ui.label(act, "Versão ${BuildConfig.VERSION_NAME} · Nível de quiosque ${Kiosk.level(act)} · Rede: ${netName()}", 14f, Ui.MUTED),
            Ui.lp(top = gap(20f)),
        )
    }

    private fun netName() = when (Engine.net()) {
        "wifi" -> "Wi-Fi"
        "ethernet" -> "cabo"
        else -> "sem rede"
    }

    private fun androidSettingsButton() = Ui.button(act, "Configurações do Android (rede Wi-Fi)") {
        act.requirePin { act.openAndroidSettings() }
    }

    private fun buildChoose() {
        col.addView(Ui.label(act, "Como esta tela vai funcionar?", 20f), Ui.lp(top = gap()))
        val managed = Ui.button(act, "Com o código de cadastro do painel (gerenciado)") { go(MANAGED) }
        col.addView(managed, Ui.lp(top = gap(16f)))
        col.addView(Ui.label(act, "A tela recebe a programação, os avisos e as campanhas pelo painel.", 15f, Ui.MUTED), Ui.lp(top = gap(4f)))
        col.addView(Ui.button(act, "Só um endereço de vídeo, digitado aqui (avulso)") { go(STANDALONE) }, Ui.lp(top = gap(16f)))
        col.addView(Ui.label(act, "Sem servidor: você digita o endereço HLS e cria um PIN neste aparelho.", 15f, Ui.MUTED), Ui.lp(top = gap(4f)))
        col.addView(androidSettingsButton(), Ui.lp(top = gap(24f)))
        first = managed
    }

    private fun buildManaged() {
        val store = Engine.store
        val serverLabel = Ui.label(act, "Endereço do servidor", 16f, Ui.MUTED)
        col.addView(serverLabel, Ui.lp(top = gap(16f)))
        val server = Ui.field(act, Store.defaultServer ?: "https://…", store.server)
        col.addView(server, Ui.lp(top = gap(4f)))
        // com o servidor padrão do build (e nenhum outro gravado), o campo fica escondido num "avançado"
        val def = Store.defaultServer
        if (def != null && (store.server.isEmpty() || Urls.origin(store.server) == def)) {
            serverLabel.visibility = View.GONE
            server.visibility = View.GONE
            col.addView(
                Ui.button(act, "Avançado: usar outro servidor") { b ->
                    serverLabel.visibility = View.VISIBLE
                    server.visibility = View.VISIBLE
                    b.visibility = View.GONE
                    server.requestFocus()
                },
                Ui.lp(top = gap(4f)),
            )
        }
        col.addView(Ui.label(act, "Código de cadastro (gerado no painel, vale uma vez e por 24 h)", 16f, Ui.MUTED), Ui.lp(top = gap()))
        val key = Ui.field(act, "XXXX-XXXX")
        key.typeface = android.graphics.Typeface.MONOSPACE
        key.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        col.addView(key, Ui.lp(top = gap(4f)))
        val keyWarn = Ui.label(act, "", 15f, 0xFFFF8A80.toInt()).apply { visibility = View.GONE }
        col.addView(keyWarn, Ui.lp(top = gap(4f)))
        // sempre maiúsculas e XXXX-XXXX (o hífen entra sozinho); o teclado USB e o colar valem e são normalizados;
        // 0, 1, I e O (que a chave não tem) não são trocados em silêncio: aviso para conferir
        var chars = ""
        var editing = false
        fun show(next: String, warn: String?) {
            chars = next
            editing = true
            val f = ActivationKey.format(next)
            key.setText(f)
            key.setSelection(f.length)
            editing = false
            keyWarn.text = warn.orEmpty()
            keyWarn.visibility = if (warn == null) View.GONE else View.VISIBLE
        }
        key.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing || s == null) return
                val c = ActivationKey.onEdited(chars, s)
                if (s.toString() != ActivationKey.format(c.chars) || c.confusing) show(c.chars, ActivationKey.warning(c.confusing)) else chars = c.chars
            }
        })
        // digitar só com o controle remoto: setas + OK nas teclas abaixo (o teclado do Android abre com OK no campo)
        col.addView(Ui.label(act, "Digite com as setas e o OK do controle nas teclas abaixo.", 14f, Ui.MUTED), Ui.lp(top = gap(8f)))
        // 19/11: o aviso pequeno passava despercebido e o teclado sem 0, 1, I e O parecia com defeito
        col.addView(Ui.label(act, "${ActivationKey.HINT}: não existem na chave, por isso não estão no teclado.", 17f), Ui.lp(top = gap(4f)))
        val pad = KeyPad(
            act,
            contentWidthPx,
            { ch -> show(ActivationKey.append(chars, ch), null) },
            { show(ActivationKey.erase(chars), null) },
        )
        col.addView(pad, Ui.lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, gap(4f)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        val status = Ui.label(act, "", 16f, 0xFFFFD166.toInt())
        val go = Ui.button(act, "Ativar") { b -> activate(server, key, status, b) }
        col.addView(go, Ui.lp(top = gap(12f)))
        col.addView(status, Ui.lp(top = gap(8f)))
        col.addView(androidSettingsButton(), Ui.lp(top = gap(16f)))
        col.addView(Ui.button(act, "Voltar") { onBack() }, Ui.lp(top = gap(8f)))
        first = pad.getChildAt(0)
    }

    private fun activate(server: EditText, key: EditText, status: TextView, button: Button) {
        if (busy) return
        val k = Engine.normalizeKey(key.text.toString())
        if (k == null) {
            status.text = "A chave tem 8 letras e números (por exemplo ABCD-EFGH)."
            return
        }
        val origin = Urls.origin(server.text.toString().ifBlank { Store.defaultServer.orEmpty() })
        if (origin == null || !Urls.apiAllowed(origin, BuildConfig.DEBUG)) {
            status.text = "O endereço do servidor precisa começar com https://"
            return
        }
        busy = true
        button.isEnabled = false
        status.text = "Ativando…"
        Thread {
            val error: String? = try {
                Engine.activate(origin, k)
                null
            } catch (e: ApiException) {
                when (e.code) {
                    400 -> "Chave em formato inválido."
                    404 -> "Chave inexistente, já usada ou vencida. Gere outra no painel."
                    429 -> "Muitas tentativas. Espere um pouco e tente de novo."
                    else -> "O servidor respondeu com erro ${e.code}."
                }
            } catch (e: Exception) {
                // diz o motivo: sem rede, servidor fora ou certificado recusado (data do aparelho errada)
                "Sem resposta do servidor: " + NetErrors.describe(NetErrors.causes(e), ClockCheck.wrong(System.currentTimeMillis()))
            }
            act.runOnUiThread {
                busy = false
                button.isEnabled = true
                if (error != null) status.text = error
                else {
                    status.text = "Ativado. Buscando a configuração…"
                    act.onActivated()
                }
            }
        }.start()
    }

    private fun buildStandalone() {
        val store = Engine.store
        val hasPin = Engine.standalone && Engine.lockCfg()?.hasPin == true
        col.addView(Ui.label(act, "Endereço do vídeo (HLS, termina em .m3u8)", 16f, Ui.MUTED), Ui.lp(top = gap(16f)))
        val url = Ui.field(act, "https://…/canal.m3u8", store.standaloneUrl)
        col.addView(url, Ui.lp(top = gap(4f)))
        col.addView(
            Ui.label(act, if (hasPin) "Novo PIN (deixe vazio para manter o atual)" else "PIN para sair e para abrir os ajustes (4 a 8 números)", 16f, Ui.MUTED),
            Ui.lp(top = gap()),
        )
        val pin = Ui.field(act, "PIN", number = true, secret = true)
        col.addView(pin, Ui.lp(top = gap(4f)))
        val pin2 = Ui.field(act, "Repita o PIN", number = true, secret = true)
        col.addView(pin2, Ui.lp(top = gap(8f)))
        val status = Ui.label(act, "", 16f, 0xFFFFD166.toInt())
        col.addView(
            Ui.button(act, "Salvar e tocar") {
                val u = Urls.clean(url.text.toString())
                val p = pin.text.toString()
                when {
                    u == null -> status.text = "Endereço inválido. Use http:// ou https://"
                    p.isEmpty() && !hasPin -> status.text = "Crie um PIN de 4 a 8 números."
                    p.isNotEmpty() && !Pin.valid(p) -> status.text = "O PIN precisa ter de 4 a 8 números."
                    p != pin2.text.toString() -> status.text = "Os dois PINs não são iguais."
                    else -> {
                        Engine.saveStandalone(u, p)
                        act.closeScreen()
                    }
                }
            },
            Ui.lp(top = gap(16f)),
        )
        col.addView(status, Ui.lp(top = gap(8f)))
        col.addView(
            Ui.label(act, "Para sair depois: no controle, ↑ ↑ ↓ ↓ OK e o PIN. Endereço http:// (sem cadeado) só é aceito neste modo.", 15f, Ui.MUTED),
            Ui.lp(top = gap(8f)),
        )
        col.addView(androidSettingsButton(), Ui.lp(top = gap(16f)))
        col.addView(Ui.button(act, "Voltar") { onBack() }, Ui.lp(top = gap(8f)))
        first = url
    }
}

/** Pedido do PIN. 5 erros = 15 minutos bloqueado (vale depois de reiniciar). */
class PinScreen(act: MainActivity, private val back: () -> Unit, private val onOk: () -> Unit) : Screen(act) {
    private val built = panel(380f)
    override val view: View get() = built.first
    private val dots = Ui.label(act, "", 34f, bold = true).apply { gravity = Gravity.CENTER }
    private val msg = Ui.label(act, "", 16f, 0xFFFFD166.toInt()).apply { gravity = Gravity.CENTER }
    // o PIN tem de 4 a 8 números (o servidor sorteia 6): as bolinhas aparecem conforme se digita, e quem confere é o OK
    private val pad = PinPad(act, contentWidthPx, { p -> dots.text = PinDisplay.dots(p.length) }, { p -> submit(p) })

    init {
        val col = built.second
        col.gravity = Gravity.CENTER_HORIZONTAL
        col.addView(Ui.label(act, "Digite o PIN", 24f, bold = true).apply { gravity = Gravity.CENTER })
        col.addView(Ui.label(act, PinDisplay.HINT, 15f, Ui.MUTED).apply { gravity = Gravity.CENTER }, Ui.lp(top = gap(4f)))
        col.addView(dots, Ui.lp(top = gap()))
        col.addView(msg, Ui.lp(top = gap(4f)))
        col.addView(pad, Ui.lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, gap()).apply { gravity = Gravity.CENTER_HORIZONTAL })
        col.addView(Ui.button(act, "Cancelar") { back() }, Ui.lp(top = gap()))
        pad.clear()
        onTick()
    }

    override fun onShown() = pad.focusFirst()

    override fun onBack() = back()

    private fun state() = Lockout.normalize(Engine.store.lockout, System.currentTimeMillis())

    override fun onTick() {
        val s = state()
        val now = System.currentTimeMillis()
        val locked = Lockout.isLocked(s, now)
        pad.enabledInput = !locked
        if (locked) {
            val left = Lockout.remainingMs(s, now)
            msg.text = "Muitos PINs errados. Tente de novo em ${left / 60000 + 1} min."
        } else if (msg.text.startsWith("Muitos")) {
            msg.text = ""
        }
    }

    private fun submit(pin: String) {
        // curto demais não conta como erro (não é um PIN possível)
        if (PinDisplay.tooShort(pin)) {
            msg.text = "O PIN tem de 4 a 8 números."
            return
        }
        val now = System.currentTimeMillis()
        var s = state()
        if (Lockout.isLocked(s, now)) return
        val lock = Engine.lockCfg()
        if (lock != null && Pin.matches(lock.pinSalt, pin, lock.pinHash)) {
            Engine.store.lockout = Lockout.onRight()
            back()
            onOk()
            return
        }
        s = Lockout.onWrong(s, now)
        Engine.store.lockout = s
        pad.clear()
        msg.text = if (Lockout.isLocked(s, now)) "" else "PIN errado. Restam ${Lockout.MAX_FAILS - s.fails} tentativa(s)."
        onTick()
    }

    override fun onKey(e: KeyEvent): Boolean {
        val c = e.keyCode
        val digit = when (c) {
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> '0' + (c - KeyEvent.KEYCODE_0)
            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> '0' + (c - KeyEvent.KEYCODE_NUMPAD_0)
            else -> null
        }
        if (digit != null) {
            if (e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0) pad.digit(digit)
            return true
        }
        if (c == KeyEvent.KEYCODE_DEL) {
            if (e.action == KeyEvent.ACTION_DOWN) pad.backspace()
            return true
        }
        return false
    }
}

/** Ajustes e diagnóstico (sempre atrás do PIN). */
class SettingsScreen(act: MainActivity) : Screen(act) {
    private val built = panel(680f)
    override val view: View get() = built.first
    private val info = Ui.label(act, "", 16f, Color.WHITE)
    private val note = Ui.label(act, "", 16f, 0xFFFFD166.toInt())
    private val close = Ui.button(act, "Voltar ao canal") { act.closeScreen() }
    private val fmt = SimpleDateFormat("dd/MM HH:mm:ss", Locale("pt", "BR"))

    // O que só muda com uma ação fora desta tela (consultas ao Android, que custam): lido ao abrir e a cada 10 s, e não a
    // cada segundo, para as setas responderem na hora numa TV box fraca (22/11).
    private var kioskLevelText = ""
    private var homeText = ""
    private var kioskIssuesText = ""
    private var ticks = 0

    private fun readKiosk() {
        val owner = Kiosk.isOwner(act)
        kioskLevelText = if (owner) "2 (administrador do aparelho: travas do Android ativas)"
        else "1 (só o APK)" + if (Kiosk.canBringToFront(act)) "; volta sozinho para a frente" else "; neste Android o app só volta pelo botão Home ou ao religar"
        homeText = when {
            Kiosk.isHome(act) -> "é este app (abre sozinho ao ligar)"
            owner -> "fixada pelo administrador"
            else -> "NÃO é este app: sem isso ele não abre sozinho ao ligar. Use o botão abaixo ou aperte Home e escolha DIGITAL ISP > Sempre"
        }
        kioskIssuesText = act.kioskIssues()
    }

    init {
        val col = built.second
        val store = Engine.store
        readKiosk()
        col.addView(Ui.label(act, "Ajustes e diagnóstico", 26f, bold = true))
        col.addView(close, Ui.lp(top = gap()))
        col.addView(info, Ui.lp(top = gap()))
        col.addView(note, Ui.lp(top = gap(6f)))

        col.addView(Ui.button(act, "Diagnóstico completo (texto para fotografar)") { act.showScreen(DiagScreen(act)) }, Ui.lp(top = gap()))
        col.addView(Ui.button(act, "Testar o canal") { testStream() }, Ui.lp(top = gap(8f)))
        col.addView(
            Ui.button(act, "Procurar atualização (instalada: ${BuildConfig.VERSION_NAME})") {
                note.text = "Procurando atualização…"
                Thread {
                    val msg = Engine.checkUpdateNow()
                    act.runOnUiThread { note.text = msg }
                }.start()
            },
            Ui.lp(top = gap(8f)),
        )
        if (!Kiosk.canInstall(act)) {
            col.addView(Ui.button(act, "Permitir que o app instale as próprias atualizações") { act.openInstallPermission() }, Ui.lp(top = gap(8f)))
        }
        col.addView(Ui.button(act, "Assistente de configuração inicial") { act.showScreen(WizardScreen(act)) }, Ui.lp(top = gap(8f)))
        col.addView(
            Ui.button(act, "Recarregar a configuração e o vídeo") {
                if (Engine.managed) Engine.requestConfig()
                act.reloadPlayer()
                note.text = "Recarregando…"
            },
            Ui.lp(top = gap(8f)),
        )
        if (Engine.managed) {
            col.addView(
                confirmButton("Reativar com outra chave", "Aperte de novo para apagar a ativação atual") {
                    store.wipeToken()
                    act.showScreen(SetupScreen(act, SetupScreen.MANAGED, "Digite a nova chave de acesso."))
                    act.applyConfig()
                },
                Ui.lp(top = gap(8f)),
            )
        } else {
            col.addView(Ui.button(act, "Trocar o endereço ou o PIN") { act.showScreen(SetupScreen(act, SetupScreen.STANDALONE)) }, Ui.lp(top = gap(8f)))
        }
        col.addView(
            confirmButton("Trocar de modo (apaga tudo deste app)", "Aperte de novo para apagar tudo") {
                Engine.resetAll()
                act.applyConfig()
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(Ui.button(act, "Sair para as configurações do Android (10 min)") { act.openAndroidSettings() }, Ui.lp(top = gap(8f)))
        // O que a pessoa precisa conceder numa TV box sem Device Owner (cada botão some depois de concedido).
        if (!Kiosk.isOwner(act) && !Kiosk.isHome(act)) {
            col.addView(Ui.button(act, "Tornar este app a tela inicial (abre sozinho ao ligar)") { act.openHomeChooser() }, Ui.lp(top = gap(8f)))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Kiosk.isOwner(act) && !Kiosk.canBringToFront(act)) {
            col.addView(Ui.button(act, "Permitir que o app volte sozinho para a frente (sobrepor a outros apps)") { act.openOverlayPermission() }, Ui.lp(top = gap(8f)))
        }
        if (!Kiosk.batteryExempt(act)) {
            col.addView(Ui.button(act, "Tirar o app da economia de bateria") { act.openBatteryExemption() }, Ui.lp(top = gap(8f)))
        }
        col.addView(Ui.button(act, "Data e hora do Android") { act.openDateSettings() }, Ui.lp(top = gap(8f)))
        col.addView(
            Ui.button(act, videoText()) { b ->
                act.cycleVideoMode()
                b.text = videoText()
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, captionsText()) { b ->
                val c = act.captionsState()
                act.setLocalCaptions(!c.on, c.lang)
                b.text = captionsText()
                note.text = "Vale neste aparelho até a próxima mudança das legendas no painel."
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, captionsLangText()) { b ->
                val c = act.captionsState()
                act.setLocalCaptions(true, CaptionsPolicy.nextLang(c.lang, act.captionLanguages()))
                b.text = captionsLangText()
                note.text = "Hoje o ar traz a legenda em português (a do canal). Vale até a próxima mudança no painel."
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, callVoiceText()) { b ->
                act.cycleCallVoice()
                b.text = callVoiceText()
                note.text = "Tocando um exemplo com a voz escolhida. Coral, Nova, Ash e Onyx vêm no app (vozes geradas por inteligência artificial) e funcionam em qualquer aparelho; a voz do Android depende da caixa."
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, callSoundText()) { b ->
                act.cycleCallSound()
                b.text = callSoundText()
                note.text = if (act.callSound().source == CallSound.FROM_PANEL) "O painel definiu o som desta tela: vale o do painel. A escolha daqui vale quando o painel não definir."
                else "Vale neste aparelho enquanto o painel não definir o som da chamada."
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, rotationText()) { b ->
                store.rotation = if (store.rotation == 90) 270 else 90
                b.text = rotationText()
                act.applyConfig()
            },
            Ui.lp(top = gap(8f)),
        )
        col.addView(
            Ui.button(act, overscanText()) { b ->
                store.overscanPct = Overscan.next(store.overscanPct)
                b.text = overscanText()
                act.applyOverscan()
            },
            Ui.lp(top = gap(8f)),
        )
        if (Kiosk.isOwner(act)) {
            col.addView(
                Ui.button(act, standbyText()) { b ->
                    store.standbyOffHours = !store.standbyOffHours
                    b.text = standbyText()
                },
                Ui.lp(top = gap(8f)),
            )
            col.addView(
                confirmButton("Deixar de ser o administrador do aparelho", "Aperte de novo: as travas do nível 2 serão removidas") {
                    note.text = if (Kiosk.release(act)) "Pronto: o app voltou ao nível 1." else "O aparelho recusou."
                    readKiosk()
                    refresh()
                },
                Ui.lp(top = gap(8f)),
            )
        }
        col.addView(Ui.label(act, ownerHelp(), 14f, Ui.MUTED), Ui.lp(top = gap(16f)))
        refresh()
    }

    override fun onShown() {
        close.requestFocus()
    }

    override fun onTick() {
        if (++ticks % 10 == 0) readKiosk()
        refresh()
    }

    private fun videoText() = "Vídeo: ${act.videoMode.label} (trocar)"
    private fun overscanText() = "Margem da tela (overscan): ${Engine.store.overscanPct}% (trocar: 0, 2, 3, 5, 7)"
    private fun captionsText() = "Legendas: " + (if (act.captionsState().on) "ligadas" else "desligadas") + " (trocar)"
    private fun captionsLangText() = "Idioma da legenda: " + CaptionsPolicy.name(act.captionsState().lang) + " (trocar)"
    private fun callSoundText(): String {
        val local = CallSoundMode.of(Engine.store.callSoundLocal) ?: CallSoundMode.BOTH
        val now = act.callSound()
        return "Som da chamada no aparelho: ${local.label} (trocar)" + if (now.source == CallSound.FROM_PANEL) " · o painel definiu: ${now.mode.label}" else ""
    }
    private fun callVoiceText() = "Voz da chamada: ${VoiceClips.label(Engine.store.callVoice)} (trocar e ouvir)"
    private fun rotationText() = "TV em pé: girar ${Engine.store.rotation}° (trocar o lado)"
    private fun standbyText() = "Espera fora do horário (experimental): " + if (Engine.store.standbyOffHours) "ligada" else "desligada"

    private fun ownerHelp() =
        "Nível 2 (Device Owner), uma vez só, pelo computador, com a depuração USB ou de rede ligada e sem conta Google no aparelho:\n" +
            "adb shell dpm set-device-owner br.com.digitalisp.telas/.AdminReceiver\n" +
            "Depois reabra o app. Para desfazer use o botão acima (ou, em build de teste, adb shell dpm remove-active-admin br.com.digitalisp.telas/.AdminReceiver).\n" +
            "Nenhum app bloqueia o botão físico de ligar; ao religar, o app volta sozinho."

    private fun testStream() {
        note.text = "Testando…"
        val c = Engine.config
        Thread {
            val main = Engine.probe(c?.stream?.hls)
            val backup = c?.stream?.backup?.let { Engine.probe(it) }
            act.runOnUiThread {
                note.text = "Principal: " + (if (main) "respondeu" else "NÃO respondeu") +
                    (if (backup != null) " · Reserva: " + (if (backup) "respondeu" else "NÃO respondeu") else " · Sem reserva") +
                    " · Player: " + act.playerSummary()
            }
        }.start()
    }

    private fun refresh() {
        val store = Engine.store
        val c = Engine.config
        val sb = StringBuilder()
        fun line(k: String, v: String?) {
            sb.append(k).append(": ").append(if (v.isNullOrEmpty()) "—" else v).append('\n')
        }
        line("Modo", if (Engine.managed) "gerenciado pelo painel" else "avulso")
        if (Engine.managed) {
            line("Aparelho", c?.device?.name?.ifEmpty { store.deviceName } ?: store.deviceName)
            line("Local", c?.device?.office)
            line("Região", c?.device?.region)
            line("Servidor", store.server)
            line("Último sinal de vida", if (store.lastHeartbeatAt > 0) fmt.format(Date(store.lastHeartbeatAt)) else "nenhum ainda")
            line("Token", if (store.token == null) "sem ativação" else if (store.tokenInKeystore) "guardado no cofre do Android (Keystore)" else "guardado na pasta privada (Keystore indisponível)")
            line("Layout", c?.layoutRaw)
            line("Conteúdo guardado", Engine.offlineNote.ifEmpty { "${Engine.offlineFiles().size} vídeo(s)" })
        } else {
            line("Endereço", store.standaloneUrl)
        }
        line("Versão do app", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" + if (BuildConfig.DEBUG) " depuração" else "")
        line("Aparelho (modelo)", "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        line("Nível de quiosque", kioskLevelText)
        line("Tela inicial (Home)", homeText)
        kioskIssuesText.takeIf { it.isNotEmpty() }?.let { line("Travas recusadas pelo aparelho", it) }
        line("Rede", when (Engine.net()) { "wifi" -> "Wi-Fi"; "ethernet" -> "cabo"; else -> "sem rede" })
        line("Player", act.playerSummary())
        line("Vigia", act.watchdogMode())
        if (c?.queue?.enabled == true) {
            line("Chamada de senha (tempo real)", QueueLink.status)
            line("Som da chamada", act.callSoundSummary())
        }
        if (c?.internal != null) line("Tela interna", act.internalSummary())
        line(
            "Relógio",
            when {
                Engine.deviceClockWrong() -> "DATA ERRADA no aparelho (" + ClockCheck.date(System.currentTimeMillis()) + "): o endereço seguro (https) não abre. Acerte em \"Data e hora do Android\""
                Engine.clockOk() -> fmt.format(Date(Engine.now())) + (Engine.serverSkewMs?.let { " · " + ClockCheck.skewText(it) } ?: "")
                else -> "sem hora certa (horário e alertas com prazo ficam em espera)"
            },
        )
        line("Último erro", store.lastError)
        // só troca o texto quando muda (trocar o texto refaz a medida do painel inteiro)
        val t = sb.toString().trimEnd()
        if (t != info.text.toString()) info.text = t
    }
}

/**
 * Diagnóstico para o teste de campo: tudo num bloco de texto só, para fotografar com o celular (ou copiar). Fica
 * atrás do PIN, como os ajustes; as setas para baixo e para cima rolam o texto.
 */
class DiagScreen(act: MainActivity) : Screen(act) {
    private val built = panel(900f)
    override val view: View get() = built.first
    private val back = Ui.button(act, "Voltar aos ajustes") { act.showSettings() }
    private val note = Ui.label(act, "", 15f, 0xFFFFD166.toInt())
    private val text = Ui.label(act, "", 15f).apply {
        typeface = Typeface.MONOSPACE
        setLineSpacing(0f, 1.15f)
        setTextIsSelectable(false)
    }
    private var frozen = false

    init {
        val col = built.second
        col.addView(Ui.label(act, "Diagnóstico", 24f, bold = true))
        col.addView(back, Ui.lp(top = gap(8f)))
        col.addView(
            Ui.button(act, "Congelar o texto (para fotografar)") { b ->
                frozen = !frozen
                b.text = if (frozen) "Texto congelado (apertar de novo para atualizar)" else "Congelar o texto (para fotografar)"
            },
            Ui.lp(top = gap(6f)),
        )
        col.addView(
            Ui.button(act, "Copiar o texto") {
                note.text = try {
                    val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("DIGITAL ISP", act.diagnosticsText()))
                    "Texto copiado (dá para colar em outro app com um teclado ou mouse ligado na TV box)."
                } catch (_: Exception) {
                    "Este aparelho não deixou copiar; fotografe a tela."
                }
            },
            Ui.lp(top = gap(6f)),
        )
        col.addView(note, Ui.lp(top = gap(4f)))
        col.addView(text, Ui.lp(top = gap(8f)))
        refresh()
    }

    override fun onShown() {
        back.requestFocus()
    }

    override fun onBack() = act.showSettings()

    override fun onTick() {
        if (!frozen) refresh()
    }

    private fun refresh() {
        val t = act.diagnosticsText()
        if (t != text.text.toString()) text.text = t
    }
}
