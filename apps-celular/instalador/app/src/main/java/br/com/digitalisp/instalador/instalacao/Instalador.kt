package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.pacotes.Pacote
import br.com.digitalisp.instalador.rede.Plataforma
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

/** O pacote do app de tela já no celular, conferido. */
data class PacoteLocal(val pacote: Pacote, val arquivo: File)

/**
 * Conduz a instalação em qualquer marca: conectar (com pareamento, Host PC ou frase-senha, conforme a marca) →
 * baixar do servidor DIGITAL ISP → enviar → instalar → abrir. Todo passo vira um [Evento] na [MaquinaInstalacao];
 * a tela só observa [estado].
 *
 * @param baixar busca no servidor a versão atual do app de tela da plataforma e devolve o arquivo conferido.
 * @param portaTlsAtual a porta `_adb-tls-connect` mais recente do host (o mDNS pode achar depois do pareamento).
 */
class Instalador(
    private val conectores: Conectores,
    private val baixar: (Plataforma, (Long, Long) -> Unit) -> PacoteLocal,
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

    /** Começa a instalação na TV escolhida. Pode parar pedindo código (Android 11+), Host PC (Samsung) ou frase (LG). */
    suspend fun instalar(tv: TvEncontrada) {
        if (MaquinaInstalacao.ocupado(_estado.value)) return
        enviar(Evento.Escolher(tv))
        val e = _estado.value
        if (e is Estado.Conectando) conectarEInstalar(e.tv, null)
    }

    /** Samsung: o técnico pôs o IP do celular no Host PC e reiniciou a TV. */
    suspend fun tentarDeNovoHostPc() {
        val e = _estado.value as? Estado.PedindoHostPc ?: return
        enviar(Evento.TentarConectar)
        conectarEInstalar(e.tv, null)
    }

    /** LG: o técnico digitou a frase-senha que o app Developer Mode mostra. */
    suspend fun informarFrase(frase: String) {
        val e = _estado.value as? Estado.PedindoFrase ?: return
        if (frase.isBlank()) {
            enviar(Evento.Erro("Digite a frase-senha (Passphrase) que aparece no app Developer Mode da TV."))
            return
        }
        enviar(Evento.TentarConectar)
        conectarEInstalar(e.tv, frase)
    }

    /**
     * Android 11+: o técnico digitou o código. [portaPareamento] e [portaConexao] vêm da tela da TV quando o mDNS não
     * achou (rede que bloqueia multicast).
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
            withContext(io) { conectores.parearAndroid(e.tv.host, pPar, codigo) }
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
        conectarEInstalar(tv, null)
    }

    private suspend fun conectar(tv: TvEncontrada, frase: String?): Conexao = coroutineScope {
        // só o Android mostra o aviso "Permitir depuração?" na TV
        val aviso = if (tv.plataforma == Plataforma.ANDROID) launch { delay(esperaAceiteMs); enviar(Evento.DemorouAceite) } else null
        try {
            withContext(io) {
                when (tv.plataforma) {
                    Plataforma.ANDROID -> conectores.android(tv, tv.portaConexao ?: 5555, tempoConexaoMs)
                    Plataforma.SAMSUNG -> conectores.samsung(tv)
                    Plataforma.LG -> conectores.lg(tv, frase)
                }
            }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            Conexao.Falhou("Falha na conexão: ${t.message ?: t.javaClass.simpleName}")
        } finally {
            aviso?.cancel()
        }
    }

    private suspend fun conectarEInstalar(tv: TvEncontrada, frase: String?) {
        when (val r = conectar(tv, frase)) {
            is Conexao.Ok -> {
                enviar(Evento.Conectou)
                try {
                    baixarEnviarInstalarAbrir(tv, r.sessao)
                } finally {
                    withContext(io) { runCatching { r.sessao.fechar() } }
                }
            }
            Conexao.PrecisaParear -> enviar(Evento.PrecisaParear)
            Conexao.NaoAutorizado -> enviar(Evento.NaoAutorizou)
            is Conexao.PrecisaHostPc -> enviar(Evento.PrecisaHostPc(r.aviso))
            is Conexao.PrecisaFrase -> enviar(Evento.PrecisaFrase(r.aviso))
            is Conexao.Falhou -> enviar(Evento.Erro(r.motivo))
        }
    }

    private suspend fun baixarEnviarInstalarAbrir(tv: TvEncontrada, sessao: SessaoTv) {
        try {
            // 1. baixar do servidor DIGITAL ISP (conferido pelo SHA-256)
            val local = withContext(io) { baixar(tv.plataforma) { feito, total -> enviar(Evento.Progresso(feito, total)) } }
            val tamanho = local.arquivo.length()
            enviar(Evento.Baixou(tamanho))

            // 2. enviar para a TV
            val destino = sessao.destino(local.pacote)
            withContext(io) { sessao.enviar(local.arquivo, destino) { f -> enviar(Evento.Progresso(f, tamanho)) } }
            enviar(Evento.Enviou)

            // 3. instalar
            val appId = when (val r = withContext(io) { sessao.instalar(destino, local.pacote, local.arquivo) }) {
                is Instalacao.Ok -> r.appId
                is Instalacao.Falha -> { enviar(Evento.Erro(r.mensagem)); return }
            }
            enviar(Evento.Instalou(appId))

            // 4. abrir e o recado final
            val abriu = withContext(io) { runCatching { sessao.abrir(appId) }.getOrDefault(false) }
            val obs = withContext(io) { runCatching { sessao.observacao() }.getOrNull() }
            enviar(Evento.Abriu(abriu, obs))
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            enviar(Evento.Erro(t.message ?: "Erro inesperado (${t.javaClass.simpleName})."))
        }
    }

    fun recomecar() = enviar(Evento.Recomecar)
}
