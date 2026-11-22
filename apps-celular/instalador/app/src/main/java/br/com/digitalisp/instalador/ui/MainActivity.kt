package br.com.digitalisp.instalador.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.R
import br.com.digitalisp.instalador.adb.ChavesAdb
import br.com.digitalisp.instalador.adb.LibAdbGateway
import br.com.digitalisp.instalador.instalacao.Estado
import br.com.digitalisp.instalador.instalacao.FonteApk
import br.com.digitalisp.instalador.instalacao.FonteUrl
import br.com.digitalisp.instalador.instalacao.Instalador
import br.com.digitalisp.instalador.instalacao.MaquinaInstalacao
import br.com.digitalisp.instalador.instalacao.copiarParaCache
import br.com.digitalisp.instalador.rede.BuscaNaRede
import br.com.digitalisp.instalador.rede.Plataforma
import br.com.digitalisp.instalador.rede.Subrede
import br.com.digitalisp.instalador.rede.TvEncontrada
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException

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
    private var urlApk: String
        get() = prefs.getString("url_apk", Config.URL_APK_PADRAO) ?: Config.URL_APK_PADRAO
        set(v) { prefs.edit().putString("url_apk", v.trim()).apply() }
    private var apkLocal: String?
        get() = prefs.getString("apk_local", null)
        set(v) { prefs.edit().putString("apk_local", v).apply() }

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
        instalador = Instalador(
            adb = LibAdbGateway(ChavesAdb(File(filesDir, "adb"))),
            fonte = { fonteAtual() },
            lerPacote = { f -> packageManager.getPackageArchiveInfo(f.path, 0)?.packageName },
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

    private fun fonteAtual(): FonteApk {
        val local = apkLocal
        if (local != null) {
            return FonteApk { progresso ->
                val uri = Uri.parse(local)
                val total = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                val entrada = contentResolver.openInputStream(uri) ?: throw IOException("Não abri o APK escolhido no celular.")
                entrada.use { copiarParaCache(it, total, cacheDir, progresso) }
            }
        }
        return FonteUrl(urlApk, cacheDir)
    }

    // ---------- desenho das telas ----------

    private fun desenhar() {
        conteudo.removeAllViews()
        when (val e = instalador.estado.value) {
            Estado.Inicio -> telaInicio()
            is Estado.Conectando -> telaEspera("Conectando à TV", "Falando com ${e.tv.host}…", null)
            is Estado.AguardandoAceite -> telaEspera(
                "Olhe a TV",
                "Deve aparecer na TV o aviso \"Permitir depuração?\".\n\nCom o controle remoto, marque \"Sempre permitir " +
                    "deste computador\" e escolha \"Permitir\". A instalação continua sozinha.",
                null,
            )
            is Estado.PedindoCodigo -> telaCodigo(e)
            is Estado.Pareando -> telaEspera("Pareando", "Conferindo o código com a TV…", null)
            is Estado.Baixando -> telaEspera(
                "Baixando o app de tela",
                if (apkLocal != null) "Lendo o APK escolhido no celular." else "Do servidor do DIGITAL ISP.",
                MaquinaInstalacao.percentual(e.feito, e.total) ?: -1,
            )
            is Estado.Enviando -> telaEspera("Enviando para a TV", "Não desligue a TV nem o Wi-Fi.", MaquinaInstalacao.percentual(e.feito, e.total) ?: -1)
            is Estado.Instalando -> telaEspera("Instalando", "A TV está instalando o app. Pode levar um minuto.", null)
            is Estado.Abrindo -> telaEspera("Abrindo o app na TV", "Quase pronto.", null)
            is Estado.Concluido -> telaConcluido(e)
            is Estado.NaoSuportado -> telaNaoSuportado(e.tv)
            is Estado.Falhou -> telaFalha(e)
        }
    }

    private fun telaInicio() {
        conteudo.addView(titulo("Instalar o app de tela"))
        conteudo.addView(paragrafo("O celular precisa estar no mesmo Wi-Fi da TV box. Prepare a TV antes (só na primeira vez):"))
        conteudo.addView(paragrafo(
            "1. Na TV: Configurações → Sobre → clique 7 vezes em \"Compilação\" (libera as Opções do desenvolvedor).\n" +
                "2. Em Opções do desenvolvedor, ligue \"Depuração USB\" e, se existir, \"Depuração ADB pela rede\".\n" +
                "3. Android 11 ou mais novo: ligue \"Depuração por Wi-Fi\" e abra \"Parear dispositivo com código\".",
            Marca.TEXTO_FRACO,
        ))
        if (Config.urlIndefinida(urlApk) && apkLocal == null) {
            conteudo.addView(paragrafo("Atenção: o endereço do app ainda não foi definido. Escolha um APK do celular ou ajuste o endereço abaixo.", Marca.ERRO))
        }
        conteudo.addView(botao(if (buscando) "Procurando…" else "Procurar TVs na rede") { procurar() })
        if (semRede) conteudo.addView(paragrafo("O celular não está num Wi-Fi. Conecte no mesmo Wi-Fi da TV.", Marca.ERRO))
        if (buscando || encontradas.isNotEmpty()) {
            val n = encontradas.count { it.plataforma == Plataforma.ANDROID }
            conteudo.addView(paragrafo(
                if (buscando) "Procurando na rede… ${encontradas.size} aparelho(s) até agora."
                else "Achei ${encontradas.size} aparelho(s), $n TV box Android.",
                Marca.TEXTO_FRACO,
            ))
            if (buscando) conteudo.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true })
        }
        for (tv in encontradas) {
            conteudo.addView(cartao(tv.titulo, tv.detalhe, tv.instalavel) { escopo.launch { busca.parar(); buscando = false; instalador.instalar(tv) } })
        }
        if (!buscando && encontradas.isEmpty()) {
            conteudo.addView(paragrafo("Não achou? A rede pode bloquear a busca (Wi-Fi de visitantes). Digite o IP que aparece na TV.", Marca.TEXTO_FRACO))
        }
        conteudo.addView(botao("Digitar o IP da TV", principal = false) { dialogoIp() })
        conteudo.addView(titulo("App que será instalado").apply { textSize = 17f; setPadding(0, dp(20), 0, 0) })
        conteudo.addView(paragrafo(apkLocal?.let { "APK do celular: ${Uri.parse(it).lastPathSegment}" } ?: "Do endereço: $urlApk", Marca.TEXTO_FRACO))
        conteudo.addView(botao("Escolher um APK do celular", principal = false) { escolherApk() })
        if (apkLocal != null) conteudo.addView(botao("Voltar a baixar do servidor", principal = false) { apkLocal = null; desenhar() })
        conteudo.addView(botao("Endereço do app", principal = false) { dialogoUrl() })
        conteudo.addView(botao("Licenças", principal = false) { dialogoLicencas() })
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

    private fun telaConcluido(e: Estado.Concluido) {
        conteudo.addView(titulo("Pronto!"))
        conteudo.addView(paragrafo(
            if (e.abriu) "O app de tela foi instalado e aberto na TV ${e.tv.host}. Siga o cadastro da tela que aparece na TV."
            else "O app de tela foi instalado na TV ${e.tv.host}, mas não abriu sozinho. Abra pelo menu de apps da TV.",
        ))
        conteudo.addView(paragrafo(
            "Por segurança, depois do cadastro desligue na TV a \"Depuração por Wi-Fi\"/\"Depuração ADB pela rede\".",
            Marca.TEXTO_FRACO,
        ))
        conteudo.addView(botao("Instalar em outra TV") { instalador.recomecar() })
    }

    private fun telaNaoSuportado(tv: TvEncontrada) {
        conteudo.addView(titulo(tv.titulo))
        conteudo.addView(paragrafo(
            when (tv.plataforma) {
                Plataforma.SAMSUNG -> "TVs Samsung ainda não instalam pelo celular. Elas usam o modo desenvolvedor da Samsung e um " +
                    "certificado do DIGITAL ISP. Em monitores profissionais Samsung, a instalação será pelo \"URL Launcher\" do monitor."
                Plataforma.LG -> "TVs LG ainda não instalam pelo celular. O modo desenvolvedor da LG expira e precisa ser renovado; " +
                    "em monitores profissionais LG, a instalação será pelo servidor do próprio monitor."
                Plataforma.ANDROID -> ""
            },
        ))
        conteudo.addView(paragrafo("Se esta TV for Android (Android TV / Google TV), digite o IP dela e tente pela porta 5555.", Marca.TEXTO_FRACO))
        conteudo.addView(botao("Voltar") { instalador.recomecar() })
    }

    private fun telaFalha(e: Estado.Falhou) {
        conteudo.addView(titulo("Não deu certo"))
        conteudo.addView(paragrafo(e.mensagem, Marca.ERRO))
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
        val porta = campo("Porta (5555 se não souber)", InputType.TYPE_CLASS_NUMBER).apply { setText("5555") }
        val parear = android.widget.CheckBox(this).apply { text = "A TV mostra um código de pareamento (Android 11+)" }
        caixa.addView(ip); caixa.addView(porta); caixa.addView(parear)
        AlertDialog.Builder(this)
            .setTitle("Digitar o IP da TV")
            .setView(caixa)
            .setPositiveButton("Instalar") { _, _ ->
                val h = ip.text.toString().trim()
                if (!Subrede.ipValido(h)) { aviso("IP inválido: $h"); return@setPositiveButton }
                val p = porta.text.toString().toIntOrNull()?.takeIf { it in 1..65535 } ?: 5555
                val tv = if (parear.isChecked) TvEncontrada(h, Plataforma.ANDROID, portaPareamento = p)
                else TvEncontrada(h, Plataforma.ANDROID, portaAdb = p)
                busca.parar(); buscando = false
                escopo.launch { instalador.instalar(tv) }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun dialogoUrl() {
        val campo = campo("https://…/telas.apk", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI).apply { setText(urlApk) }
        val caixa = LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(campo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        AlertDialog.Builder(this)
            .setTitle("Endereço do app de tela")
            .setView(caixa)
            .setPositiveButton("Salvar") { _, _ -> urlApk = campo.text.toString(); apkLocal = null; desenhar() }
            .setNeutralButton("Padrão") { _, _ -> urlApk = Config.URL_APK_PADRAO; desenhar() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun escolherApk() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/vnd.android.package-archive"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/vnd.android.package-archive", "application/octet-stream"))
        }
        @Suppress("DEPRECATION")
        startActivityForResult(i, PEDIDO_APK)
    }

    @Deprecated("Activity simples, sem AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PEDIDO_APK || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        apkLocal = uri.toString()
        desenhar()
    }

    private fun dialogoLicencas() {
        AlertDialog.Builder(this)
            .setTitle("Licenças")
            .setMessage(
                "libadb-android (Muntashir Al-Islam) — usada sob a Apache License 2.0 (licença dupla GPL-3.0-or-later OU Apache-2.0).\n\n" +
                    "spake2-java (Muntashir Al-Islam) — GNU LGPL 3.0. Biblioteca separada, sem alteração; código em github.com/MuntashirAkon/spake2-java.\n\n" +
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

    private companion object { const val PEDIDO_APK = 41 }
}
