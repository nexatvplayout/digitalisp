package br.com.digitalisp.telas.core

import org.json.JSONObject

/** O que uma resposta de erro do servidor significa para o aparelho (contrato, seção 6). */
enum class ApiFailure {
    /** 401: token revogado. Apaga o token e volta à tela da chave. */
    REVOKED,

    /** 403 com code "unavailable": o modo foi desligado para o cliente (ou ele está suspenso). Guarda o token, segue com a última configuração e tenta de novo depois. */
    UNAVAILABLE,

    /** Qualquer outro erro: registra e tenta de novo no próximo sinal de vida. */
    OTHER,
}

object ApiErrors {
    /** Espera entre tentativas enquanto o serviço está indisponível para o cliente. */
    const val UNAVAILABLE_RETRY_SEC = 300

    fun classify(status: Int, code: String?): ApiFailure = when {
        status == 401 -> ApiFailure.REVOKED
        status == 403 && code?.trim()?.lowercase() == "unavailable" -> ApiFailure.UNAVAILABLE
        else -> ApiFailure.OTHER
    }

    /** Lê { "error": "…", "code": "…" } do corpo do erro; corpo que não é JSON dá (null, null). */
    fun parse(body: String?): Pair<String?, String?> = try {
        val o = JSONObject(body.orEmpty())
        ConfigParser.str(o, "error")?.take(160) to ConfigParser.str(o, "code")?.take(40)
    } catch (_: Exception) {
        null to null
    }
}

/** Captura da tela: o servidor só aceita JPEG de verdade (começa com FF D8 FF, termina com FF D9) de até 400 KB. */
object Jpeg {
    const val MAX_BYTES = 400 * 1024

    fun valid(b: ByteArray?, maxBytes: Int = MAX_BYTES): Boolean {
        if (b == null || b.size < 4 || b.size > maxBytes) return false
        fun u(i: Int) = b[i].toInt() and 0xFF
        return u(0) == 0xFF && u(1) == 0xD8 && u(2) == 0xFF && u(b.size - 2) == 0xFF && u(b.size - 1) == 0xD9
    }
}
