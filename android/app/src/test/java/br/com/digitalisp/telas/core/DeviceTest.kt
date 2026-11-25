package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.TimeZone

/** Lógica do aparelho para o teste na TV box com Android 11: relógio, certificado, decodificador, diagnóstico. */
class DeviceTest {
    private val utc = TimeZone.getTimeZone("UTC")

    // ---- relógio ----
    @Test fun relogioAbsurdo() {
        assertTrue(ClockCheck.wrong(0L)) // 1970
        assertTrue(ClockCheck.wrong(1_420_070_400_000L)) // 2015
        assertTrue(ClockCheck.wrong(1_704_067_199_000L)) // 31/12/2023
        assertTrue(ClockCheck.wrong(ClockCheck.FLOOR_MS - 1))
        assertFalse(ClockCheck.wrong(ClockCheck.FLOOR_MS))
        assertFalse(ClockCheck.wrong(1_794_300_000_000L)) // novembro de 2026
    }

    @Test fun pisoDoRelogioEhNovembroDe2026() {
        assertEquals("01/11/2026 00:00", ClockCheck.date(ClockCheck.FLOOR_MS, utc))
    }

    @Test fun mensagemDoRelogioMostraADataDoAparelho() {
        val m = ClockCheck.message(1_420_070_400_000L, utc)
        assertTrue(m, m.contains("01/01/2015 00:00"))
        assertTrue(m, m.contains("data") && m.contains("https"))
    }

    @Test fun diferencaParaOServidor() {
        assertEquals("igual à do servidor", ClockCheck.skewText(0L))
        assertEquals("igual à do servidor", ClockCheck.skewText(-4_000L))
        assertEquals("aparelho atrasado 30 s em relação ao servidor", ClockCheck.skewText(30_000L))
        assertEquals("aparelho adiantado 3 min em relação ao servidor", ClockCheck.skewText(-180_000L))
        assertEquals("aparelho atrasado 5 h em relação ao servidor", ClockCheck.skewText(5 * 3_600_000L))
        assertEquals("aparelho atrasado 4322 dias em relação ao servidor", ClockCheck.skewText(4322L * 86_400_000L))
    }

    // ---- rede e certificado ----
    private class SSLHandshakeException(cause: Throwable?) : IOException("x", cause)
    private class CertificateException(cause: Throwable?) : Exception("x", cause)
    private class CertificateNotYetValidException : Exception("x")
    private class CertPathValidatorException : Exception("x")
    private class UnknownHostException : IOException("x")
    private class SocketTimeoutException : IOException("x")

    @Test fun cadeiaDeCausas() {
        val e = SSLHandshakeException(CertificateException(CertificateNotYetValidException()))
        assertEquals(listOf("SSLHandshakeException", "CertificateException", "CertificateNotYetValidException"), NetErrors.causes(e))
        assertTrue(NetErrors.causes(null).isEmpty())
    }

    @Test fun certificadoAindaNaoValidoFalaDaData() {
        val c = NetErrors.causes(SSLHandshakeException(CertificateException(CertificateNotYetValidException())))
        assertTrue(NetErrors.certificate(c))
        // mesmo com o relógio "parecendo" certo, esse erro é de data
        assertTrue(NetErrors.describe(c, clockWrong = false).contains("data do aparelho está errada"))
    }

    @Test fun certificadoRecusadoComRelogioErradoFalaDaData() {
        // o Android costuma dar só SSLHandshakeException > CertificateException > CertPathValidatorException
        val c = NetErrors.causes(SSLHandshakeException(CertificateException(CertPathValidatorException())))
        assertTrue(NetErrors.describe(c, clockWrong = true).contains("data do aparelho está errada"))
        val semRelogio = NetErrors.describe(c, clockWrong = false)
        assertFalse(semRelogio.contains("está errada"))
        assertTrue(semRelogio.contains("certificado") && semRelogio.contains("data e a hora"))
    }

    @Test fun outrasFalhasDeRede() {
        assertTrue(NetErrors.describe(NetErrors.causes(UnknownHostException()), true).contains("não achou o servidor"))
        assertTrue(NetErrors.describe(NetErrors.causes(SocketTimeoutException()), false).contains("não respondeu a tempo"))
        assertEquals("IOException", NetErrors.describe(NetErrors.causes(IOException("x")), false))
        assertFalse(NetErrors.certificate(NetErrors.causes(UnknownHostException())))
    }

    // ---- vídeo ----
    @Test fun tetoPeloTamanhoDaTela() {
        assertEquals(VideoCap(1920, 1080), VideoPolicy.cap(VideoMode.AUTO, 1920, 1080))
        assertEquals(VideoCap(1920, 1080), VideoPolicy.cap(VideoMode.FIXED, 1080, 1920)) // saída em pé
        assertEquals(VideoCap(3840, 2160), VideoPolicy.cap(VideoMode.AUTO, 3840, 2160))
        assertEquals(VideoCap(1280, 720), VideoPolicy.cap(VideoMode.AUTO, 1280, 720))
        // tela informada pequena demais ou desconhecida não derruba a imagem
        assertEquals(VideoCap(1280, 720), VideoPolicy.cap(VideoMode.AUTO, 960, 540))
        assertEquals(VideoCap(1920, 1080), VideoPolicy.cap(VideoMode.AUTO, 0, 0))
        // modo 720p não olha a tela
        assertEquals(VideoCap(1280, 720), VideoPolicy.cap(VideoMode.FIXED_720, 3840, 2160))
    }

    @Test fun errosDeDecodificador() {
        for (code in 4001..4005) assertTrue(VideoPolicy.isDecoderError(code))
        assertFalse(VideoPolicy.isDecoderError(1002)) // atrás da janela do ao vivo
        assertFalse(VideoPolicy.isDecoderError(2001)) // rede
        assertFalse(VideoPolicy.isDecoderError(3002)) // lista malformada
    }

    @Test fun modoDoVideoIdaEVolta() {
        for (m in VideoMode.entries) assertEquals(m, VideoMode.of(m.wire))
        assertEquals(VideoMode.AUTO, VideoMode.of(null))
        assertEquals(VideoMode.AUTO, VideoMode.of("outro"))
        assertEquals(VideoMode.FIXED, VideoMode.AUTO.next())
        assertEquals(VideoMode.FIXED_720, VideoMode.FIXED.next())
        assertEquals(VideoMode.AUTO, VideoMode.FIXED_720.next())
    }

    @Test fun doisErrosDeDecodificadorEmDezMinutosDescemUmDegrau() {
        val g = DecoderGuard(VideoMode.AUTO)
        assertFalse(g.onDecoderError(1_000L))
        assertEquals(VideoMode.AUTO, g.mode)
        assertTrue(g.onDecoderError(60_000L))
        assertEquals(VideoMode.FIXED, g.mode)
        // a contagem recomeça no degrau novo
        assertFalse(g.onDecoderError(70_000L))
        assertTrue(g.onDecoderError(80_000L))
        assertEquals(VideoMode.FIXED_720, g.mode)
        // dali não desce mais
        assertFalse(g.onDecoderError(90_000L))
        assertFalse(g.onDecoderError(91_000L))
        assertEquals(VideoMode.FIXED_720, g.mode)
    }

    @Test fun errosEspalhadosNaoMudamOModo() {
        val g = DecoderGuard(VideoMode.AUTO)
        assertFalse(g.onDecoderError(0L))
        assertFalse(g.onDecoderError(11 * 60_000L)) // o primeiro já saiu da janela de 10 min
        assertFalse(g.onDecoderError(22 * 60_000L))
        assertEquals(VideoMode.AUTO, g.mode)
        // relógio que voltou no tempo não conta erro "do futuro"
        assertFalse(g.onDecoderError(1_000L))
        assertEquals(VideoMode.AUTO, g.mode)
    }

    @Test fun escolhaNosAjustesZeraAContagem() {
        val g = DecoderGuard(VideoMode.FIXED_720)
        g.set(VideoMode.AUTO)
        assertEquals(VideoMode.AUTO, g.mode)
        assertFalse(g.onDecoderError(1L))
        g.set(VideoMode.AUTO)
        assertFalse(g.onDecoderError(2L))
        assertEquals(VideoMode.AUTO, g.mode)
    }

    // ---- decodificador ----
    @Test fun decodificadorPorSoftwarePeloNome() {
        for (n in listOf("OMX.google.h264.decoder", "c2.android.avc.decoder", "OMX.ffmpeg.h264.decoder", "OMX.SEC.avc.sw.dec")) {
            assertTrue(n, CodecNames.isSoftware(n))
        }
        for (n in listOf("OMX.amlogic.avc.decoder.awesome", "OMX.rk.video_decoder.avc", "OMX.allwinner.video.decoder.avc", "c2.amlogic.avc.decoder", "OMX.MTK.VIDEO.DECODER.AVC")) {
            assertFalse(n, CodecNames.isSoftware(n))
        }
        assertFalse(CodecNames.isSoftware(null))
        assertFalse(CodecNames.isSoftware(""))
    }

    @Test fun descricaoDoDecodificador() {
        assertEquals("OMX.amlogic.avc.decoder.awesome (hardware)", CodecNames.describe("OMX.amlogic.avc.decoder.awesome", null))
        assertTrue(CodecNames.describe("c2.android.avc.decoder", null).contains("SOFTWARE"))
        // o que o Android informa vale mais que o nome
        assertTrue(CodecNames.describe("c2.fabricante.avc", false).contains("SOFTWARE"))
        assertTrue(CodecNames.describe(null, null).startsWith("nenhum ainda"))
    }

    // ---- texto do diagnóstico ----
    @Test fun blocoDeTexto() {
        val t = DiagReport.text(
            "Telas 1.2.0",
            listOf("Modelo" to "B13", null to "Vídeo", "Decodificador" to null, "Erro" to "linha 1\nlinha 2", "Vazio" to "  "),
        )
        assertEquals(
            "=== Telas 1.2.0 ===\nModelo: B13\n\n[Vídeo]\nDecodificador: —\nErro: linha 1 linha 2\nVazio: —",
            t,
        )
    }

    @Test fun enderecoSemAConsulta() {
        assertEquals("https://video.exemplo.com.br/hls/canal/master.m3u8", DiagReport.url("https://video.exemplo.com.br/hls/canal/master.m3u8"))
        assertEquals("https://cdn.x/a.m3u8?…", DiagReport.url("https://cdn.x/a.m3u8?token=segredo"))
        assertEquals("", DiagReport.url(null))
    }

    @Test fun taxaDoVideo() {
        assertEquals("não informado", DiagReport.bitrate(0))
        assertEquals("não informado", DiagReport.bitrate(-1))
        assertEquals("800 kbit/s", DiagReport.bitrate(800_000))
        assertEquals("4.5 Mbit/s", DiagReport.bitrate(4_500_000))
    }
}
