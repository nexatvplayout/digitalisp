package br.com.digitalisp.instalador.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import br.com.digitalisp.instalador.BuildConfig
import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.R
import br.com.digitalisp.instalador.adb.ChavesAdb
import br.com.digitalisp.instalador.adb.LibAdbGateway
import br.com.digitalisp.instalador.instalacao.ConectoresReais
import br.com.digitalisp.instalador.instalacao.CredenciaisLg
import br.com.digitalisp.instalador.instalacao.Estado
import br.com.digitalisp.instalador.instalacao.Instalador
import br.com.digitalisp.instalador.instalacao.MaquinaInstalacao
import br.com.digitalisp.instalador.instalacao.PacoteLocal
import br.com.digitalisp.instalador.pacotes.Baixador
import br.com.digitalisp.instalador.rede.BuscaNaRede
import br.com.digitalisp.instalador.rede.Plataforma
import br.com.digitalisp.instalador.rede.PortasConhecidas
import br.com.digitalisp.instalador.rede.Subrede
import br.com.digitalisp.instalador.rede.TvEncontrada
import br.com.digitalisp.instalador.rede.redeLocal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.File

/** Uma tela só, que muda conforme o [Estado] da instalação: o passo a passo do técnico. */
class MainActivity : Activity() {

    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var conteudo: LinearLayout
    private lateinit var busca: BuscaNaRede
    private lateinit var instalador: Instalador
    private var encontradas: List<TvEncontrada> = emptyList()
    private var buscando = false
    private var semRede = false

    private val prefs by lazy { getSharedPreferences("ajustes", MODE_PRIVATE) }
    private var servidor: String
        get() = prefs.getString("servidor", Config.SERVIDOR_PADRAO)?.takeIf { Config.servidorValido(it) } ?: Config.SERVIDOR_PADRAO
        set(v) { prefs.edit().putString("servidor", v.trim().trimEnd('/')).apply() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Marca.MARINHO

        val raiz = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Marca.FUNDO) }
        raiz.addView(LinearLayout(this).apply {
            setBackgroundColor(Marca.MARINHO)
            setPadding(dp(20), dp(16), dp(20), dp(16))
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply {
                setImageResource(R.drawable.logo_branco)
                adjustViewBounds = true
                contentDescription = "DIGITAL ISP"
                layoutParams = LinearLayout.LayoutParams(dp(170), ViewGroup.LayoutParams.WRAP_CONTENT)
            })
            addView(TextView(context).apply {
                text = "Instalador"
                textSize = 16f
                setTextColor(Marca.CIANO)
                setPadding(dp(12), 0, 0, 0)
            })
        })
        conteudo = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(32)) }
        raiz.addView(ScrollView(this).apply { addView(conteudo) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(raiz)

        busca = BuscaNaRede(this, escopo) { lista -> runOnUiThread { encontradas = lista; desenhar() } }
        val lerPacote: (File) -> String? = { f -> packageManager.getPackageArchiveInfo(f.path, 0)?.packageName }
        val conectores = ConectoresReais(
            adb = LibAdbGateway(ChavesAdb(File(filesDir, "adb"))),
            lerPacote = lerPacote,
            credenciaisLg = CredenciaisLg(File(filesDir, "lg")),
        )
        instalador = Instalador(
            conectores = conectores,
            baixar = { plataforma, progresso ->
                val b = Baixador(servidor, File(cacheDir, "pacotes"))
                val p = b.versaoAtual(plataforma)
                PacoteLocal(p, b.baixar(p, progresso))
            },
            portaTlsAtual = { host -> busca.catalogo.obter(host)?.portaTls },
        )
        escopo.launch { instalador.estado.collectLatest { desenhar() } }
    }

    override fun onDestroy() {
        busca.parar()
        escopo.cancel()
        super.onDestroy()
    }

    @Deprecated("Activity simples, sem AndroidX")
    override fun onBackPressed() {
        val e = instalador.estado.value
        if (e is Estado.Inicio) super.onBackPressed()
        else if (!MaquinaInstalacao.ocupado(e)) instalador.recomecar()
    }

    private fun ipDoCelular(): String? = redeLocal(this)?.ip

    // ---------- desenho das telas ----------

    private fun desenhar() {
        conteudo.removeAllViews()
        when (val e = instalador.estado.value) {
            Estado.Inicio -> telaInicio()
            is Estado.Conectando -> telaEspera("Conectando à ${e.tv.titulo}", "Falando com ${e.tv.host}…", null)
            is Estado.AguardandoAceite -> telaEspera(
                "Olhe a TV",
                "Deve aparecer na TV o aviso \"Permitir depuração?\".\n\nCom o controle remoto, marque \"Sempre permitir " +
                    "deste computador\" e escolha \"Permitir\". A instalação continua sozinha.",
                null,
            )
            is Estado.PedindoCodigo -> telaCodigo(e)
            is Estado.Pareando -> telaEspera("Pareando", "Conferindo o código com a TV…", null)
            is Estado.PedindoHostPc -> telaHostPc(e)
            is Estado.PedindoFrase -> telaFrase(e)
            is Estado.Baixando -> telaEspera(
                "Baixando o app de tela",
                "Do servidor DIGITAL ISP, a versão para ${e.tv.titulo}.",
                MaquinaInstalacao.percentual(e.feito, e.total) ?: -1,
            )
            is Estado.Enviando -> telaEspera("Enviando para a TV", "Não desligue a TV nem o Wi-Fi.", MaquinaInstalacao.percentual(e.feito, e.total) ?: -1)
            is Estado.Instalando -> telaEspera("Instalando", "A TV está instalando o app. Pode levar um minuto.", null)
            is Estado.Abrindo -> telaEspera("Abrindo o app na TV", "Quase pronto.", null)
            is Estado.Concluido -> telaConcluido(e)
            is Estado.Falhou -> telaFalha(e)
        }
    }

    private fun telaInicio() {
        conteudo.addView(titulo("Instalar o app de tela"))
        conteudo.addView(paragrafo("TV box Android, TV Samsung ou TV LG. O celular precisa estar no mesmo Wi-Fi da TV."))
        conteudo.addView(botao(if (buscando) "Procurando…" else "Procurar TVs na rede") { procurar() })
        if (semRede) conteudo.addView(paragrafo("O celular não está num Wi-Fi. Conecte no mesmo Wi-Fi da TV.", Marca.ERRO))
        if (buscando || encontradas.isNotEmpty()) {
            conteudo.addView(paragrafo(
                if (buscando) "Procurando na rede… ${encontradas.size} aparelho(s) até agora."
                else "Achei ${encontradas.size} aparelho(s).",
                Marca.TEXTO_FRACO,
            ))
            if (buscando) conteudo.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true })
        }
        for (tv in encontradas) {
            conteudo.addView(cartao(tv.titulo, tv.detalhe, tv.plataforma == Plataforma.ANDROID || tv.portaDev != null) {
                escopo.launch { busca.parar(); buscando = false; instalador.instalar(tv) }
            })
        }
        if (!buscando && encontradas.isEmpty()) {
            conteudo.addView(paragrafo("Não achou? A rede pode bloquear a busca (Wi-Fi de visitantes). Digite o IP que aparece na TV.", Marca.TEXTO_FRACO))
        }
        conteudo.addView(botao("Digitar o IP da TV", principal = false) { dialogoIp() })

        conteudo.addView(titulo("Antes de instalar").apply { textSize = 17f; setPadding(0, dp(20), 0, 0) })
        conteudo.addView(botao("Preparar TV box Android", principal = false) { ajuda(Plataforma.ANDROID) })
        conteudo.addView(botao("Preparar TV Samsung", principal = false) { ajuda(Plataforma.SAMSUNG) })
        conteudo.addView(botao("Preparar TV LG", principal = false) { ajuda(Plataforma.LG) })
        conteudo.addView(paragrafo("Versão ${BuildConfig.VERSION_NAME} · app de tela de $servidor", Marca.TEXTO_FRACO).apply { textSize = 13f; setPadding(0, dp(16), 0, 0) })
        conteudo.addView(botao("Servidor", principal = false) { dialogoServidor() })
        conteudo.addView(botao("Licenças", principal = false) { dialogoLicencas() })
    }

    private fun textoAjuda(p: Plataforma): String = when (p) {
        Plataforma.ANDROID ->
            "1. Na TV: Configurações → Sobre → clique 7 vezes em \"Compilação\" (libera as Opções do desenvolvedor).\n" +
                "2. Em Opções do desenvolvedor, ligue \"Depuração USB\" e, se existir, \"Depuração ADB pela rede\".\n" +
                "3. Android 11 ou mais novo: ligue \"Depuração por Wi-Fi\" e abra \"Parear dispositivo com código\".\n" +
                "4. Na primeira conexão, a TV pergunta \"Permitir depuração?\": marque \"Sempre permitir\" e \"Permitir\"."
        Plataforma.SAMSUNG ->
            "1. Na TV, abra \"Apps\".\n" +
                "2. Com o controle, digite 1 2 3 4 5 (com o teclado numérico ou o da tela).\n" +
                "3. Ligue \"Developer mode\" e, em \"Host PC IP\", digite o IP deste celular: ${ipDoCelular() ?: "(conecte o celular no Wi-Fi)"}.\n" +
                "4. Confirme e desligue a TV pela tomada por 30 segundos; ligue de novo.\n" +
                "5. Aqui, procure a TV e toque nela.\n\n" +
                "O app de tela da Samsung é assinado com o certificado do DIGITAL ISP, que precisa incluir cada TV (o DUID). " +
                "Se a instalação disser que a TV recusou a assinatura, mande o DUID mostrado ao responsável."
        Plataforma.LG ->
            "1. Na TV, abra a LG Content Store e instale o app \"Developer Mode\".\n" +
                "2. Abra o app e entre com a conta de desenvolvedor LG do DIGITAL ISP.\n" +
                "3. Ligue \"Dev Mode Status\" (a TV reinicia) e abra o app de novo.\n" +
                "4. Ligue \"Key Server\". Anote a \"Passphrase\" que aparece.\n" +
                "5. Aqui, procure a TV, toque nela e digite a Passphrase.\n\n" +
                "Atenção: a sessão do modo desenvolvedor da LG vence. O instalador renova a sessão a cada visita; " +
                "se ela vencer, a TV apaga o app."
    }

    private fun ajuda(p: Plataforma) {
        AlertDialog.Builder(this)
            .setTitle(when (p) { Plataforma.ANDROID -> "TV box Android"; Plataforma.SAMSUNG -> "TV Samsung"; Plataforma.LG -> "TV LG" })
            .setMessage(textoAjuda(p))
            .setPositiveButton("Entendi", null)
            .show()
    }

    private fun telaEspera(t: String, texto: String, percentual: Int?) {
        conteudo.addView(titulo(t))
        conteudo.addView(paragrafo(texto))
        conteudo.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            if (percentual == null || percentual < 0) isIndeterminate = true else { max = 100; progress = percentual }
            setPadding(0, dp(12), 0, dp(4))
        })
        if (percentual != null && percentual >= 0) conteudo.addView(paragrafo("$percentual%", Marca.TEXTO_FRACO))
    }

    private fun telaCodigo(e: Estado.PedindoCodigo) {
        conteudo.addView(titulo("Código de pareamento"))
        conteudo.addView(paragrafo(
            "Na TV: Opções do desenvolvedor → Depuração por Wi-Fi → \"Parear dispositivo com código\". " +
                "Digite aqui o código de 6 números que aparece. Deixe essa janela aberta na TV até terminar.",
        ))
        e.aviso?.let { conteudo.addView(paragrafo(it, Marca.ERRO)) }
        val codigo = campo("Código (6 números)", InputType.TYPE_CLASS_NUMBER)
        val portaPar = campo("Porta do pareamento (o número depois de \":\" no IP mostrado junto com o código)", InputType.TYPE_CLASS_NUMBER)
            .apply { e.tv.portaPareamento?.let { setText(it.toString()) } }
        val portaCon = campo("Porta da conexão (opcional: IP:porta na tela \"Depuração por Wi-Fi\")", InputType.TYPE_CLASS_NUMBER)
            .apply { e.tv.portaTls?.let { setText(it.toString()) } }
        conteudo.addView(codigo); conteudo.addView(portaPar); conteudo.addView(portaCon)
        conteudo.addView(botao("Parear e instalar") {
            val pPar = portaPar.text.toString().toIntOrNull()
            val pCon = portaCon.text.toString().toIntOrNull()
            escopo.launch { instalador.informarCodigo(codigo.text.toString(), pPar, pCon) }
        })
        conteudo.addView(botao("Voltar", principal = false) { instalador.recomecar() })
    }

    private fun telaHostPc(e: Estado.PedindoHostPc) {
        val ip = ipDoCelular()
        conteudo.addView(titulo("Liberar este celular na Samsung"))
        e.aviso?.let { conteudo.addView(paragrafo(it, Marca.ERRO)) }
        conteudo.addView(paragrafo("Na TV ${e.tv.host}:"))
        conteudo.addView(paragrafo(
            "1. Abra \"Apps\" e digite 1 2 3 4 5 no controle.\n" +
                "2. Ligue \"Developer mode\".\n" +
                "3. Em \"Host PC IP\", digite o IP deste celular (abaixo) e confirme.\n" +
                "4. Desligue a TV pela tomada por 30 segundos e ligue de novo.",
        ))
        conteudo.addView(TextView(this).apply {
            text = ip ?: "sem Wi-Fi"
            textSize = 30f
            setTextColor(Marca.AZUL)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(12))
            setTextIsSelectable(true)
        })
        conteudo.addView(paragrafo("Se o celular trocar de IP (outro dia, outro Wi-Fi), é preciso trocar na TV também.", Marca.TEXTO_FRACO))
        conteudo.addView(botao("Já fiz: conectar") { escopo.launch { instalador.tentarDeNovoHostPc() } })
        conteudo.addView(botao("Voltar", principal = false) { instalador.recomecar() })
    }

    private fun telaFrase(e: Estado.PedindoFrase) {
        conteudo.addView(titulo("Frase-senha da LG"))
        e.aviso?.let { conteudo.addView(paragrafo(it, Marca.ERRO)) }
        conteudo.addView(paragrafo(
            "Na TV ${e.tv.host}, abra o app \"Developer Mode\": \"Dev Mode Status\" e \"Key Server\" ligados. " +
                "Digite aqui a \"Passphrase\" que aparece na tela (letras e números).",
        ))
        val frase = campo("Passphrase (ex.: A1B2C3)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        conteudo.addView(frase)
        conteudo.addView(botao("Conectar e instalar") { escopo.launch { instalador.informarFrase(frase.text.toString()) } })
        conteudo.addView(botao("Voltar", principal = false) { instalador.recomecar() })
    }

    private fun telaConcluido(e: Estado.Concluido) {
        conteudo.addView(titulo("Pronto!"))
        conteudo.addView(paragrafo(
            if (e.abriu) "O app de tela foi instalado e aberto na ${e.tv.titulo} ${e.tv.host}. Siga o cadastro da tela que aparece na TV."
            else "O app de tela foi instalado na ${e.tv.titulo} ${e.tv.host}, mas não abriu sozinho. Abra pela lista de apps da TV (\"DIGITAL ISP\").",
        ))
        e.observacao?.let { conteudo.addView(paragrafo(it, Marca.TEXTO_FRACO)) }
        conteudo.addView(botao("Instalar em outra TV") { instalador.recomecar() })
    }

    private fun telaFalha(e: Estado.Falhou) {
        conteudo.addView(titulo("Não deu certo"))
        conteudo.addView(paragrafo(e.mensagem, Marca.ERRO))
        Regex("DUID desta TV: ([A-Z0-9]+)").find(e.mensagem)?.groupValues?.get(1)?.let { duid ->
            conteudo.addView(botao("Copiar o DUID", principal = false) {
                getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("DUID", duid))
                Toast.makeText(this, "DUID copiado", Toast.LENGTH_SHORT).show()
            })
        }
        e.tv?.let { tv -> conteudo.addView(botao("Tentar de novo") { escopo.launch { instalador.instalar(tv) } }) }
        conteudo.addView(botao("Voltar ao começo", principal = false) { instalador.recomecar() })
    }

    // ---------- ações ----------

    private fun procurar() {
        if (buscando) return
        encontradas = emptyList()
        buscando = true
        semRede = false
        val ok = busca.iniciar { runOnUiThread { buscando = false; desenhar() } }
        if (!ok) { buscando = false; semRede = true }
        desenhar()
    }

    private fun campo(dica: String, tipo: Int) = EditText(this).apply {
        hint = dica
        inputType = tipo
        textSize = 16f
        setSingleLine()
    }

    private fun dialogoIp() {
        val caixa = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        val ip = campo("IP da TV (ex.: 192.168.0.25)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val grupo = RadioGroup(this)
        val rAndroid = RadioButton(this).apply { text = "TV box Android"; id = android.view.View.generateViewId() }
        val rSamsung = RadioButton(this).apply { text = "TV Samsung"; id = android.view.View.generateViewId() }
        val rLg = RadioButton(this).apply { text = "TV LG"; id = android.view.View.generateViewId() }
        grupo.addView(rAndroid); grupo.addView(rSamsung); grupo.addView(rLg)
        grupo.check(rAndroid.id)
        val porta = campo("Porta do Android (5555 se não souber)", InputType.TYPE_CLASS_NUMBER).apply { setText("5555") }
        val parear = android.widget.CheckBox(this).apply { text = "Android 11+: a TV mostra um código de pareamento" }
        caixa.addView(ip); caixa.addView(grupo); caixa.addView(porta); caixa.addView(parear)
        AlertDialog.Builder(this)
            .setTitle("Digitar o IP da TV")
            .setView(caixa)
            .setPositiveButton("Instalar") { _, _ ->
                val h = ip.text.toString().trim()
                if (!Subrede.ipValido(h)) { aviso("IP inválido: $h"); return@setPositiveButton }
                val p = porta.text.toString().toIntOrNull()?.takeIf { it in 1..65535 } ?: 5555
                val tv = when (grupo.checkedRadioButtonId) {
                    rSamsung.id -> TvEncontrada(h, Plataforma.SAMSUNG, portaDev = PortasConhecidas.SAMSUNG_DEV)
                    rLg.id -> TvEncontrada(h, Plataforma.LG, portaDev = PortasConhecidas.LG_DEV)
                    else -> if (parear.isChecked) TvEncontrada(h, Plataforma.ANDROID, portaPareamento = p)
                    else TvEncontrada(h, Plataforma.ANDROID, portaAdb = p)
                }
                busca.parar(); buscando = false
                escopo.launch { instalador.instalar(tv) }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun dialogoServidor() {
        val campo = campo("https://www.digitalisp.com.br", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI).apply { setText(servidor) }
        val caixa = LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(campo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        AlertDialog.Builder(this)
            .setTitle("Servidor DIGITAL ISP")
            .setMessage("De onde o instalador baixa o app de tela. Normalmente não precisa mudar.")
            .setView(caixa)
            .setPositiveButton("Salvar") { _, _ ->
                val v = campo.text.toString().trim()
                if (Config.servidorValido(v)) servidor = v else aviso("O endereço precisa começar com https://")
                desenhar()
            }
            .setNeutralButton("Padrão") { _, _ -> servidor = Config.SERVIDOR_PADRAO; desenhar() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun dialogoLicencas() {
        AlertDialog.Builder(this)
            .setTitle("Licenças")
            .setMessage(
                "libadb-android (Muntashir Al-Islam) — usada sob a Apache License 2.0 (licença dupla GPL-3.0-or-later OU Apache-2.0).\n\n" +
                    "spake2-java (Muntashir Al-Islam) — GNU LGPL 3.0. Biblioteca separada, sem alteração; código em github.com/MuntashirAkon/spake2-java.\n\n" +
                    "JSch (Atsuhiko Yamanaka, JCraft; mantido por Matthias Wiedemann) — licença BSD.\n\n" +
                    "Conscrypt (Google) — Apache License 2.0.\n\n" +
                    "Bouncy Castle — licença MIT (Bouncy Castle).\n\n" +
                    "Kotlin e kotlinx.coroutines (JetBrains) — Apache License 2.0.",
            )
            .setPositiveButton("Fechar", null)
            .show()
    }

    private fun aviso(texto: String) {
        AlertDialog.Builder(this).setMessage(texto).setPositiveButton("OK", null).show()
    }
}
