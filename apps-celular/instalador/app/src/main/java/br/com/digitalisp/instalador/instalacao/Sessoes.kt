package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoPm
import br.com.digitalisp.instalador.adb.SaidaComandos
import br.com.digitalisp.instalador.lg.ClienteLg
import br.com.digitalisp.instalador.lg.PassoLuna
import br.com.digitalisp.instalador.lg.SaidaLg
import br.com.digitalisp.instalador.pacotes.Pacote
import br.com.digitalisp.instalador.samsung.ResultadoTizen
import br.com.digitalisp.instalador.samsung.SaidaSamsung
import br.com.digitalisp.instalador.samsung.SdbCliente
import java.io.File
import java.io.IOException

/** TV box Android pelo ADB. [lerPacote] lê o nome do pacote do APK (no Android, pelo PackageManager). */
class SessaoAndroid(private val adb: AdbGateway, private val lerPacote: (File) -> String?) : SessaoTv {
    override fun destino(pacote: Pacote) = Config.DESTINO_NA_TV

    override fun enviar(arquivo: File, destino: String, progresso: (Long) -> Unit) {
        arquivo.inputStream().use { adb.enviar(it, arquivo.length(), destino, progresso) }
    }

    override fun instalar(destino: String, pacote: Pacote, arquivo: File): Instalacao {
        // com -g; TV antiga sem -g repete sem
        var r = SaidaComandos.lerPmInstall(adb.shell(SaidaComandos.comandoInstalar(destino, true)))
        if (r is ResultadoPm.OpcaoDesconhecida) r = SaidaComandos.lerPmInstall(adb.shell(SaidaComandos.comandoInstalar(destino, false)))
        runCatching { adb.shell("rm -f \"$destino\"") }
        return when (r) {
            ResultadoPm.Sucesso -> Instalacao.Ok(runCatching { lerPacote(arquivo) }.getOrNull() ?: pacote.appId ?: Config.PACOTE_APP_TELA_PADRAO)
            ResultadoPm.OpcaoDesconhecida -> Instalacao.Falha("A TV não aceitou o comando de instalação.")
            is ResultadoPm.Falha -> Instalacao.Falha(r.explicacao)
        }
    }

    override fun abrir(appId: String): Boolean = SaidaComandos.comandosAbrir(appId).any { cmd ->
        runCatching { SaidaComandos.abriuComMonkey(adb.shell(cmd)) }.getOrDefault(false)
    }

    override fun observacao() = "Por segurança, depois do cadastro desligue na TV a \"Depuração por Wi-Fi\"/\"Depuração ADB pela rede\"."

    override fun fechar() = adb.desconectar()
}

/** TV Samsung (Tizen) pelo sdb, como o `tizen install` do Tizen Studio. */
class SessaoSamsung(private val sdb: SdbCliente) : SessaoTv {
    private val capacidades: Map<String, String> = runCatching { sdb.capacidades() }.getOrDefault(emptyMap())
    val duid: String? = runCatching { SaidaSamsung.lerDuid(sdb.shell(SaidaSamsung.COMANDO_DUID)) }.getOrNull()

    override fun destino(pacote: Pacote): String =
        SaidaSamsung.pastaTemporaria(capacidades) + "/" + pacote.nomeArquivo.replace(Regex("[^A-Za-z0-9_.-]"), "_")

    override fun enviar(arquivo: File, destino: String, progresso: (Long) -> Unit) {
        arquivo.inputStream().use { sdb.enviar(it, arquivo.length(), destino, progresso) }
    }

    override fun instalar(destino: String, pacote: Pacote, arquivo: File): Instalacao {
        val appId = pacote.appId ?: Config.APP_ID_SAMSUNG_PADRAO
        val saida = sdb.shell(SaidaSamsung.comandoInstalar(appId, destino))
        return when (val r = SaidaSamsung.lerInstalacao(saida, duid)) {
            ResultadoTizen.Sucesso -> Instalacao.Ok(appId)
            is ResultadoTizen.Falha -> Instalacao.Falha(r.explicacao)
        }
    }

    override fun abrir(appId: String): Boolean = SaidaSamsung.abriu(sdb.shell(SaidaSamsung.comandoAbrir(appId)))

    override fun observacao(): String =
        "Para o app voltar sozinho quando a TV ligar: Configurações › Geral › Recursos inteligentes › " +
            "\"Executar automaticamente o último aplicativo\" ligado, e deixe o app aberto ao desligar." +
            (duid?.let { "\nDUID desta TV: $it" } ?: "")

    override fun fechar() = sdb.close()
}

/**
 * TV LG (webOS) pelo SSH do modo desenvolvedor, como o `ares-install`. [renovarSessao] renova a sessão do modo
 * desenvolvedor no servidor da LG a partir do token da TV e devolve o tempo que falta (ou null).
 */
class SessaoLg(
    private val lg: ClienteLg,
    private val renovarSessao: (String) -> String? = { null },
    private val tempoInstalacaoMs: Long = 5 * 60_000,
) : SessaoTv {
    override fun destino(pacote: Pacote): String = SaidaLg.caminho(pacote.nomeArquivo)

    override fun enviar(arquivo: File, destino: String, progresso: (Long) -> Unit) {
        lg.executar(SaidaLg.CRIAR_PASTA)
        lg.enviar({ arquivo.inputStream() }, arquivo.length(), destino, progresso)
        // confere o tamanho na TV (o ares-install confere o md5 do fim do arquivo)
        val naTv = lg.executar(SaidaLg.tamanho(destino)).trim().toLongOrNull()
        if (naTv != arquivo.length()) throw IOException("O pacote chegou incompleto na TV ($naTv de ${arquivo.length()} bytes). Tente de novo.")
    }

    override fun instalar(destino: String, pacote: Pacote, arquivo: File): Instalacao {
        var passo: PassoLuna = PassoLuna.Seguindo
        try {
            lg.executar(SaidaLg.instalar(destino), tempoInstalacaoMs) { linha ->
                passo = SaidaLg.lerLinhaInstalacao(linha)
                passo == PassoLuna.Seguindo
            }
        } finally {
            runCatching { lg.executar(SaidaLg.apagar(destino)) }
        }
        return when (val p = passo) {
            PassoLuna.Instalado -> Instalacao.Ok(pacote.appId ?: Config.APP_ID_LG_PADRAO)
            is PassoLuna.Falhou -> Instalacao.Falha(p.motivo)
            PassoLuna.Seguindo -> Instalacao.Falha("A TV não confirmou a instalação.")
        }
    }

    override fun abrir(appId: String): Boolean = SaidaLg.abriu(lg.executar(SaidaLg.abrir(appId)))

    override fun observacao(): String {
        val token = runCatching { SaidaLg.lerToken(lg.executar(SaidaLg.LER_TOKEN)) }.getOrNull()
        val falta = token?.let { runCatching { renovarSessao(it) }.getOrNull() }
        return if (falta != null) {
            "Sessão do modo desenvolvedor da LG renovada: faltam ${SaidaLg.tempoAmigavel(falta)}. " +
                "Quando ela acaba, a TV apaga o app: volte antes (ou toque em \"Extend\" no app Developer Mode)."
        } else {
            "Atenção: a sessão do modo desenvolvedor da LG expira e, quando acaba, a TV apaga o app. " +
                "Renove no app Developer Mode (\"Extend\") antes de vencer."
        }
    }

    override fun fechar() = lg.close()
}
