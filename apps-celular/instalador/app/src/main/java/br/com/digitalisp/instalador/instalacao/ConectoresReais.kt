package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.Config
import br.com.digitalisp.instalador.adb.AdbGateway
import br.com.digitalisp.instalador.adb.ResultadoConexao
import br.com.digitalisp.instalador.lg.ClienteLg
import br.com.digitalisp.instalador.lg.ResultadoLg
import br.com.digitalisp.instalador.lg.SaidaLg
import br.com.digitalisp.instalador.rede.TvEncontrada
import br.com.digitalisp.instalador.samsung.ResultadoSdb
import br.com.digitalisp.instalador.samsung.SdbCliente
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Chave e frase-senha da LG guardadas por TV (pasta privada do app), para a próxima visita não pedir a frase de novo.
 * Ficam só no celular do técnico.
 */
class CredenciaisLg(private val pasta: File) {
    private fun nome(host: String) = host.replace(Regex("[^0-9A-Za-z.]"), "_")
    fun ler(host: String): Pair<ByteArray, String>? = runCatching {
        val k = File(pasta, nome(host) + ".pem"); val f = File(pasta, nome(host) + ".frase")
        if (k.isFile && f.isFile) k.readBytes() to f.readText() else null
    }.getOrNull()
    fun gravar(host: String, chave: ByteArray, frase: String) {
        pasta.mkdirs()
        File(pasta, nome(host) + ".pem").writeBytes(chave)
        File(pasta, nome(host) + ".frase").writeText(frase)
    }
    fun apagar(host: String) {
        File(pasta, nome(host) + ".pem").delete(); File(pasta, nome(host) + ".frase").delete()
    }
}

/** Os conectores de verdade: ADB (libadb), sdb (Samsung) e SSH (LG). Nada de Android aqui (testável na JVM). */
class ConectoresReais(
    private val adb: AdbGateway,
    private val lerPacote: (File) -> String?,
    private val credenciaisLg: CredenciaisLg,
    private val baixarChaveLg: (String) -> ByteArray? = { ClienteLg.baixarChave(it) },
    private val renovarLg: (String) -> String? = ::renovarSessaoLg,
    private val portaSamsung: Int = 26101,
    private val portaLg: Int = SaidaLg.PORTA_SSH,
) : Conectores {

    override fun android(tv: TvEncontrada, porta: Int, tempoMs: Long): Conexao = when (val r = adb.conectar(tv.host, porta, tempoMs)) {
        ResultadoConexao.Conectado -> Conexao.Ok(SessaoAndroid(adb, lerPacote))
        ResultadoConexao.PrecisaParear -> Conexao.PrecisaParear
        ResultadoConexao.NaoAutorizado -> Conexao.NaoAutorizado
        is ResultadoConexao.Falhou -> Conexao.Falhou(r.motivo)
    }

    override fun parearAndroid(host: String, porta: Int, codigo: String) = adb.parear(host, porta, codigo)

    override fun samsung(tv: TvEncontrada): Conexao = when (val r = SdbCliente.conectar(tv.host, portaSamsung)) {
        is ResultadoSdb.Conectado -> Conexao.Ok(SessaoSamsung(r.cliente))
        ResultadoSdb.HostPcErrado -> Conexao.PrecisaHostPc("A TV não aceitou este celular: o \"Host PC IP\" do modo desenvolvedor não é o IP dele.")
        ResultadoSdb.ModoDevDesligado -> Conexao.PrecisaHostPc("O modo desenvolvedor da TV está desligado (ou a TV ainda não foi reiniciada).")
        is ResultadoSdb.Falhou -> Conexao.Falhou(r.motivo)
    }

    override fun lg(tv: TvEncontrada, frase: String?): Conexao {
        val fraseUsada = frase?.let { SaidaLg.normalizarFrase(it) ?: return Conexao.PrecisaFrase("A frase-senha tem só letras e números.") }
        val guardada = credenciaisLg.ler(tv.host)
        // 1. a chave: a guardada (se a frase for a mesma ou não foi digitada) ou a do Key Server
        val (chave, fraseFinal) = when {
            fraseUsada == null && guardada != null -> guardada
            fraseUsada == null -> return Conexao.PrecisaFrase(null)
            else -> {
                val k = baixarChaveLg(tv.host)
                    ?: guardada?.first
                    ?: return Conexao.PrecisaFrase("Não consegui baixar a chave da TV. No app Developer Mode, ligue o \"Key Server\" e tente de novo.")
                k to fraseUsada
            }
        }
        return when (val r = ClienteLg.conectar(tv.host, chave, fraseFinal, portaLg)) {
            is ResultadoLg.Conectado -> {
                credenciaisLg.gravar(tv.host, chave, fraseFinal)
                Conexao.Ok(SessaoLg(r.cliente, renovarLg))
            }
            ResultadoLg.FraseErrada -> {
                if (fraseUsada == null) credenciaisLg.apagar(tv.host)
                Conexao.PrecisaFrase(if (fraseUsada == null) null else "A frase-senha não confere. Confira no app Developer Mode da TV.")
            }
            ResultadoLg.KeyServerDesligado -> Conexao.PrecisaFrase("Ligue o \"Key Server\" no app Developer Mode da TV.")
            ResultadoLg.ModoDevDesligado ->
                Conexao.Falhou("O modo desenvolvedor da TV LG está desligado. No app Developer Mode, ligue \"Dev Mode Status\" (a TV reinicia) e tente de novo.")
            is ResultadoLg.Falhou -> {
                // chave antiga guardada que a TV não aceita mais: pede a frase para baixar a nova
                if (fraseUsada == null && guardada != null) { credenciaisLg.apagar(tv.host); Conexao.PrecisaFrase(r.motivo) }
                else Conexao.Falhou(r.motivo)
            }
        }
    }
}

/** Renova a sessão do modo desenvolvedor da LG e devolve o tempo que falta ("HHH:MM:SS"), ou null. */
fun renovarSessaoLg(token: String): String? {
    fun get(url: String): String? = runCatching {
        val c = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 10_000; readTimeout = 10_000 }
        try { if (c.responseCode == 200) c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) } else null } finally { c.disconnect() }
    }.getOrNull()
    val t = URLEncoder.encode(token, "UTF-8")
    get(Config.LG_RENOVAR + t)
    return get(Config.LG_CONSULTAR + t)?.let { SaidaLg.lerTempoRestante(it) }
}
