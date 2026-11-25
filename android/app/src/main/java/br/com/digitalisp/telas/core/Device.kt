package br.com.digitalisp.telas.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Lógica do aparelho que não depende do Android (para ter teste na JVM): relógio errado, erros de rede e de
 * certificado, modo do vídeo quando o decodificador falha, nome do decodificador e o texto do diagnóstico.
 */

/**
 * TV box barata não tem bateria de relógio: liga em 1970, 2015… e só acerta quando acha um servidor de hora. Com a data
 * errada, o endereço seguro (https) é recusado ("certificado ainda não é válido") e nada funciona. O app não tem como
 * acertar o relógio do aparelho; o que ele faz é dizer isso com todas as letras em vez de "sem resposta".
 */
object ClockCheck {
    /** 1º/11/2026 (UTC): a data desta versão do app. Nenhum aparelho com a hora certa está antes disso. */
    const val FLOOR_MS = 1_793_491_200_000L

    fun wrong(deviceNowMs: Long): Boolean = deviceNowMs < FLOOR_MS

    fun date(ms: Long, zone: TimeZone = TimeZone.getDefault()): String =
        SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).apply { timeZone = zone }.format(Date(ms))

    /** A frase para a tela. */
    fun message(deviceNowMs: Long, zone: TimeZone = TimeZone.getDefault()): String =
        "A data deste aparelho está errada (${date(deviceNowMs, zone)}). Com a data errada o endereço seguro (https) não abre. " +
            "Acerte a data e a hora nas configurações do Android, ou ligue a hora automática pela rede."

    /** "adiantado 3 min", "atrasado 2 h", "igual". `skewMs` = hora do servidor menos a do aparelho. */
    fun skewText(skewMs: Long): String {
        val abs = kotlin.math.abs(skewMs)
        if (abs < 5_000L) return "igual à do servidor"
        val how = if (skewMs > 0) "atrasado" else "adiantado"
        val amount = when {
            abs < 120_000L -> "${abs / 1000} s"
            abs < 2 * 3_600_000L -> "${abs / 60_000} min"
            abs < 48 * 3_600_000L -> "${abs / 3_600_000} h"
            else -> "${abs / 86_400_000} dias"
        }
        return "aparelho $how $amount em relação ao servidor"
    }
}

/** Traduz uma falha de rede (os nomes das classes da cadeia de causas) numa frase para quem está na frente da tela. */
object NetErrors {
    private val CERT_TIME = setOf("CertificateNotYetValidException", "CertificateExpiredException")
    private val CERT = setOf("SSLHandshakeException", "SSLPeerUnverifiedException", "CertPathValidatorException", "CertificateException", "SSLProtocolException")
    private val NO_ROUTE = setOf("UnknownHostException", "NoRouteToHostException")
    private val TIMEOUT = setOf("SocketTimeoutException", "ConnectException")

    fun causes(e: Throwable?): List<String> {
        val out = ArrayList<String>()
        var t = e
        while (t != null && out.size < 8) {
            out.add(t.javaClass.simpleName)
            t = t.cause
        }
        return out
    }

    /** A falha é de certificado? (Aí vale conferir a data do aparelho.) */
    fun certificate(causes: List<String>): Boolean = causes.any { it in CERT || it in CERT_TIME }

    /** O https falhou por causa da DATA do aparelho (certificado "ainda não válido"/"vencido", ou relógio absurdo)? */
    fun dateRelated(causes: List<String>, clockWrong: Boolean): Boolean =
        causes.any { it in CERT_TIME } || (clockWrong && certificate(causes))

    fun describe(causes: List<String>, clockWrong: Boolean): String = when {
        causes.any { it in CERT_TIME } || (clockWrong && certificate(causes)) ->
            "certificado de segurança recusado porque a data do aparelho está errada. Acerte a data e a hora nas configurações do Android."
        certificate(causes) ->
            "certificado de segurança recusado (${causes.first()}). Confira a data e a hora do aparelho e se a rede não exige login num navegador."
        causes.any { it in NO_ROUTE } -> "o aparelho não achou o servidor (sem internet ou sem DNS). Confira a rede."
        causes.any { it in TIMEOUT } -> "o servidor não respondeu a tempo. Confira a rede."
        else -> causes.firstOrNull() ?: "erro desconhecido"
    }
}

/**
 * Como o vídeo é escolhido. Decodificador de TV box barata (Amlogic, Rockchip, Allwinner) às vezes falha quando o HLS
 * adaptativo troca de resolução no meio; aí o app para de trocar.
 */
enum class VideoMode(val wire: String, val label: String) {
    /** Adaptativo: troca de qualidade conforme a rede, até o tamanho da tela. */
    AUTO("auto", "automático (adaptativo, até o tamanho da tela)"),

    /** Uma qualidade só, a melhor que cabe na tela: sem troca de resolução. */
    FIXED("fixed", "fixo na melhor qualidade (sem troca de resolução)"),

    /** Uma qualidade só, até 720p: para aparelho que não aguenta 1080p. */
    FIXED_720("fixed720", "fixo em 720p (aparelho fraco)");

    fun next(): VideoMode = entries[(ordinal + 1) % entries.size]

    companion object {
        fun of(wire: String?): VideoMode = entries.firstOrNull { it.wire == wire } ?: AUTO
    }
}

/** O teto de resolução pedido ao player. */
data class VideoCap(val width: Int, val height: Int)

object VideoPolicy {
    // códigos do Media3 (PlaybackException.ERROR_CODE_DECODER_INIT_FAILED … DECODING_FORMAT_UNSUPPORTED)
    private val DECODER_CODES = 4001..4005

    fun isDecoderError(code: Int): Boolean = code in DECODER_CODES

    /**
     * Teto pelo tamanho da tela (o lado maior conta como largura: o vídeo é sempre deitado). Nunca abaixo de 720p,
     * para uma tela informada errada não derrubar a imagem; tela desconhecida = 1080p.
     */
    fun cap(mode: VideoMode, displayW: Int, displayH: Int): VideoCap {
        if (mode == VideoMode.FIXED_720) return VideoCap(1280, 720)
        val long = maxOf(displayW, displayH)
        val short = minOf(displayW, displayH)
        if (long <= 0 || short <= 0) return VideoCap(1920, 1080)
        return VideoCap(maxOf(long, 1280), maxOf(short, 720))
    }
}

/**
 * Conta os erros de decodificador e desce um degrau ([VideoMode]) quando eles se repetem: [threshold] erros dentro de
 * [windowMs]. Não sobe sozinho (quem sobe é a pessoa, nos ajustes), para o aparelho não ficar indo e voltando.
 */
class DecoderGuard(start: VideoMode, private val threshold: Int = 2, private val windowMs: Long = 10 * 60_000L) {
    var mode: VideoMode = start
        private set
    private val errors = ArrayList<Long>()

    /** Devolve true se o modo mudou (quem chama aplica o modo novo e guarda). */
    fun onDecoderError(now: Long): Boolean {
        errors.removeAll { now - it > windowMs || it > now }
        errors.add(now)
        if (errors.size < threshold || mode == VideoMode.FIXED_720) return false
        mode = if (mode == VideoMode.AUTO) VideoMode.FIXED else VideoMode.FIXED_720
        errors.clear()
        return true
    }

    /** Escolha feita nos ajustes. */
    fun set(m: VideoMode) {
        mode = m
        errors.clear()
    }
}

object CodecNames {
    /** Decodificador por software (do Android ou do FFmpeg), pelo nome. Serve onde o Android não informa (antes do 10). */
    fun isSoftware(name: String?): Boolean {
        val n = name?.lowercase().orEmpty()
        if (n.isEmpty()) return false
        return n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.startsWith("omx.ffmpeg.") ||
            n.startsWith("c2.ffmpeg.") || n.startsWith("omx.sec.") && n.contains(".sw.") || n.endsWith(".sw") || n.endsWith(".sw.dec")
    }

    fun describe(name: String?, hardware: Boolean?): String {
        if (name.isNullOrEmpty()) return "nenhum ainda (vídeo não começou)"
        val hw = hardware ?: !isSoftware(name)
        return name + if (hw) " (hardware)" else " (SOFTWARE: mais lento, pode engasgar em 1080p)"
    }
}

/** O bloco de texto do diagnóstico, para a pessoa fotografar ou copiar. */
object DiagReport {
    /** `null` como rótulo = linha em branco com o título da seção em `value`. */
    fun text(title: String, lines: List<Pair<String?, String?>>): String {
        val sb = StringBuilder()
        sb.append("=== ").append(title).append(" ===\n")
        for ((k, v) in lines) {
            if (k == null) sb.append("\n[").append(v.orEmpty()).append("]\n")
            else sb.append(k).append(": ").append(clean(v)).append('\n')
        }
        return sb.toString().trimEnd()
    }

    /** Uma linha só por valor; nada de token nem de endereço com segredo na consulta. */
    fun clean(v: String?): String {
        val s = v?.replace('\n', ' ')?.replace('\r', ' ')?.trim().orEmpty()
        return if (s.isEmpty()) "—" else s
    }

    /** Endereço sem a parte depois do `?` (pode levar chave de acesso do CDN). */
    fun url(raw: String?): String {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty()) return ""
        val q = s.indexOf('?')
        return if (q < 0) s else s.substring(0, q) + "?…"
    }

    fun bitrate(bps: Int): String = when {
        bps <= 0 -> "não informado"
        bps >= 1_000_000 -> String.format(Locale.US, "%.1f Mbit/s", bps / 1_000_000.0)
        else -> "${bps / 1000} kbit/s"
    }
}
