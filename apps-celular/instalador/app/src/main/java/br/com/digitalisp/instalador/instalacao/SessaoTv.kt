package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.pacotes.Pacote
import br.com.digitalisp.instalador.rede.TvEncontrada
import java.io.File

/** Resultado da instalação na TV: o id do app instalado, ou a explicação do erro. */
sealed interface Instalacao {
    data class Ok(val appId: String) : Instalacao
    data class Falha(val mensagem: String) : Instalacao
}

/**
 * Uma TV já conectada, de qualquer marca. Bloqueia: chame fora da thread principal.
 * Android: ADB. Samsung: sdb (modo desenvolvedor). LG: SSH (modo desenvolvedor).
 */
interface SessaoTv {
    /** Caminho completo, na TV, em que o pacote será gravado. */
    fun destino(pacote: Pacote): String
    fun enviar(arquivo: File, destino: String, progresso: (Long) -> Unit)
    fun instalar(destino: String, pacote: Pacote, arquivo: File): Instalacao
    fun abrir(appId: String): Boolean
    /** O que mostrar ao técnico no fim (tempo da sessão da LG, DUID da Samsung...). Nunca lança. */
    fun observacao(): String? = null
    fun fechar()
}

/** Como terminou a tentativa de conectar, para qualquer marca. */
sealed interface Conexao {
    data class Ok(val sessao: SessaoTv) : Conexao
    data object PrecisaParear : Conexao
    data object NaoAutorizado : Conexao
    data class PrecisaHostPc(val aviso: String? = null) : Conexao
    data class PrecisaFrase(val aviso: String? = null) : Conexao
    data class Falhou(val motivo: String) : Conexao
}

/** As formas de entrar em cada marca. A real fica em ui/ConectoresReais.kt; os testes usam uma falsa. */
interface Conectores {
    fun android(tv: TvEncontrada, porta: Int, tempoMs: Long): Conexao
    fun parearAndroid(host: String, porta: Int, codigo: String)
    fun samsung(tv: TvEncontrada): Conexao
    /** [frase] null: usa a chave e a frase guardadas da última vez nesta TV, se houver. */
    fun lg(tv: TvEncontrada, frase: String?): Conexao
}
