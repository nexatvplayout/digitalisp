package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoConexao
import br.com.digitalisp.instalador.adb.ResultadoPm
import br.com.digitalisp.instalador.adb.SaidaComandos
import br.com.digitalisp.instalador.rede.TvEncontrada
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Conduz a instalação: conectar (e parear, se preciso) → baixar → enviar → instalar → abrir.
 * Todo passo vira um [Evento] na [MaquinaInstalacao]; a tela só observa [estado].
 *
 * @param lerPacote lê o nome do pacote do APK (no Android, pelo PackageManager); null = usa o padrão do Config.
 * @param portaTlsAtual consulta a porta `_adb-tls-connect` mais recente do host (o mDNS pode achar depois do pareamento).
 */
class Instalador(
    private val adb: AdbGateway,
    private val fonte: () -> FonteApk,
    private val lerPacote: (File) -> String?,
    private val portaTlsAtual: (String) -> Int? = { null },
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val esperaAceiteMs: Long = 2_500,
    private val tempoConexaoMs: Long = 90_000,
    private val esperaPortaTlsMs: Long = 6_000,
    private val observador: (Estado) -> Unit = {},
) {
    private val _estado = MutableStateFlow<Estado>(Estado.Inicio)
    val estado: StateFlow<Estado> = _estado

    @Synchronized
    fun enviar(ev: Evento) {
        val novo = MaquinaInstalacao.proximo(_estado.value, ev)
        if (novo != _estado.value) {
            _estado.value = novo
            observador(novo)
        }
    }

    /** Começa a instalação na TV escolhida. Se ela precisa de pareamento, para em [Estado.PedindoCodigo]. */
    suspend fun instalar(tv: TvEncontrada) {
        if (MaquinaInstalacao.ocupado(_estado.value)) return
        enviar(Evento.Escolher(tv))
        val e = _estado.value
        if (e is Estado.Conectando) conectarEInstalar(e.tv)
    }

    /**
     * O técnico digitou o código. [portaPareamento] e [portaConexao] vêm da tela da TV quando o mDNS não achou
     * (rede que bloqueia multicast).
     */
    suspend fun informarCodigo(codigoDigitado: String, portaPareamento: Int?, portaConexao: Int?) {
        val e = _estado.value as? Estado.PedindoCodigo ?: return
        val codigo = MaquinaInstalacao.normalizarCodigo(codigoDigitado)
        if (codigo == null) {
            enviar(Evento.Erro("O código tem 6 números. Confira na tela da TV."))
            return
        }
        val pPar = portaPareamento ?: e.tv.portaPareamento
        if (pPar == null) {
            enviar(Evento.Erro("Falta a porta de pareamento. Ela aparece na TV junto com o código (IP:porta)."))
            return
        }
        enviar(Evento.CodigoInformado)
        try {
            withContext(io) { adb.parear(e.tv.host, pPar, codigo) }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            enviar(Evento.Erro("Não pareou. O código pode estar errado ou a janela de pareamento fechou na TV. Abra de novo e digite o código novo."))
            return
        }
        var pTls = portaConexao ?: portaTlsAtual(e.tv.host) ?: e.tv.portaTls
        var esperou = 0L
        while (pTls == null && esperou < esperaPortaTlsMs) {
            delay(300); esperou += 300
            pTls = portaTlsAtual(e.tv.host)
        }
        val tv = e.tv.copy(portaTls = pTls ?: e.tv.portaTls, portaPareamento = null)
        enviar(Evento.Pareou(tv))
        if (tv.portaConexao == null) {
            enviar(Evento.Erro("Pareou, mas não achei a porta da conexão. Na TV, em \"Depuração por Wi-Fi\", veja o IP:porta e digite a porta."))
            return
        }
        conectarEInstalar(tv)
    }

    private suspend fun conectarEInstalar(tv: TvEncontrada) {
        val porta = tv.portaConexao ?: 5555
        val resultado = coroutineScope {
            val aviso = launch { delay(esperaAceiteMs); enviar(Evento.DemorouAceite) }
            try {
                withContext(io) { adb.conectar(tv.host, porta, tempoConexaoMs) }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                ResultadoConexao.Falhou("Falha na conexão: ${t.message ?: t.javaClass.simpleName}")
            } finally {
                aviso.cancel()
            }
        }
        when (resultado) {
            ResultadoConexao.Conectado -> {
                enviar(Evento.Conectou)
                try {
                    baixarEnviarInstalarAbrir()
                } finally {
                    withContext(io) { adb.desconectar() }
                }
            }
            ResultadoConexao.PrecisaParear -> enviar(Evento.PrecisaParear)
            ResultadoConexao.NaoAutorizado -> enviar(Evento.NaoAutorizou)
            is ResultadoConexao.Falhou -> enviar(Evento.Erro(resultado.motivo))
        }
    }

    private suspend fun baixarEnviarInstalarAbrir() {
        try {
            // 1. baixar
            val apk = withContext(io) { fonte().obter { feito, total -> enviar(Evento.Progresso(feito, total)) } }
            val tamanho = apk.length()
            enviar(Evento.Baixou(tamanho))

            // 2. enviar para a TV
            withContext(io) {
                apk.inputStream().use { adb.enviar(it, tamanho, Config.DESTINO_NA_TV) { f -> enviar(Evento.Progresso(f, tamanho)) } }
            }
            enviar(Evento.Enviou)

            // 3. instalar (com -g; TV antiga sem -g repete sem)
            val pm = withContext(io) {
                var r = SaidaComandos.lerPmInstall(adb.shell(SaidaComandos.comandoInstalar(Config.DESTINO_NA_TV, true)))
                if (r is ResultadoPm.OpcaoDesconhecida) {
                    r = SaidaComandos.lerPmInstall(adb.shell(SaidaComandos.comandoInstalar(Config.DESTINO_NA_TV, false)))
                }
                runCatching { adb.shell("rm -f \"${Config.DESTINO_NA_TV}\"") }
                r
            }
            when (pm) {
                ResultadoPm.Sucesso -> Unit
                ResultadoPm.OpcaoDesconhecida -> { enviar(Evento.Erro("A TV não aceitou o comando de instalação.")); return }
                is ResultadoPm.Falha -> { enviar(Evento.Erro(pm.explicacao)); return }
            }
            val pacote = runCatching { lerPacote(apk) }.getOrNull() ?: Config.PACOTE_APP_TELA_PADRAO
            enviar(Evento.Instalou(pacote))

            // 4. abrir
            val abriu = withContext(io) {
                SaidaComandos.comandosAbrir(pacote).any { cmd ->
                    runCatching { SaidaComandos.abriuComMonkey(adb.shell(cmd)) }.getOrDefault(false)
                }
            }
            enviar(Evento.Abriu(abriu))
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            enviar(Evento.Erro(t.message ?: "Erro inesperado (${t.javaClass.simpleName})."))
        }
    }

    fun recomecar() = enviar(Evento.Recomecar)
}
