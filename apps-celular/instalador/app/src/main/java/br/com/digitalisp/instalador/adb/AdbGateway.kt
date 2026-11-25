package br.com.digitalisp.instalador.adb

import java.io.InputStream

/** Resultado de uma tentativa de conexão ADB. */
sealed interface ResultadoConexao {
    data object Conectado : ResultadoConexao
    /** A TV usa a depuração por Wi-Fi (TLS) e ainda não conhece este celular: precisa parear com código. */
    data object PrecisaParear : ResultadoConexao
    /** A TV não confirmou a chave a tempo (ninguém tocou em "Permitir" no aviso da TV) ou recusou. */
    data object NaoAutorizado : ResultadoConexao
    data class Falhou(val motivo: String) : ResultadoConexao
}

/**
 * O que o instalador precisa do ADB. A biblioteca real fica atrás desta interface ([LibAdbGateway]); nos testes entra
 * uma versão falsa. Todas as funções bloqueiam: chame fora da thread principal.
 */
interface AdbGateway {
    fun conectar(host: String, porta: Int, tempoMs: Long): ResultadoConexao

    /** Pareia com o código de 6 dígitos mostrado na TV. Lança exceção se o código estiver errado ou a janela fechou. */
    fun parear(host: String, porta: Int, codigo: String)

    /** Roda um comando no shell da TV e devolve a saída inteira. */
    fun shell(comando: String): String

    /** Grava um arquivo na TV pelo serviço sync:, informando o progresso em bytes. */
    fun enviar(origem: InputStream, tamanho: Long, destino: String, progresso: (Long) -> Unit)

    fun desconectar()
}
