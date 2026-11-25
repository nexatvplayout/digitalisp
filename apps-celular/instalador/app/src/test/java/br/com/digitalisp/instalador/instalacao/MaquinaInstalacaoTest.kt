package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.rede.Plataforma
import br.com.digitalisp.instalador.rede.TvEncontrada
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MaquinaInstalacaoTest {
    private val box = TvEncontrada("192.168.0.50", Plataforma.ANDROID, portaAdb = 5555)
    private val box11 = TvEncontrada("192.168.0.51", Plataforma.ANDROID, portaPareamento = 40001)
    private val samsung = TvEncontrada("192.168.0.60", Plataforma.SAMSUNG)

    private fun rodar(vararg evs: Evento, inicio: Estado = Estado.Inicio): Estado =
        evs.fold(inicio) { e, ev -> MaquinaInstalacao.proximo(e, ev) }

    @Test fun caminhoFelizTcp5555() {
        var e: Estado = Estado.Inicio
        e = MaquinaInstalacao.proximo(e, Evento.Escolher(box)); assertEquals(Estado.Conectando(box), e)
        e = MaquinaInstalacao.proximo(e, Evento.DemorouAceite); assertEquals(Estado.AguardandoAceite(box), e)
        e = MaquinaInstalacao.proximo(e, Evento.Conectou); assertEquals(Estado.Baixando(box), e)
        e = MaquinaInstalacao.proximo(e, Evento.Progresso(50, 100)); assertEquals(Estado.Baixando(box, 50, 100), e)
        e = MaquinaInstalacao.proximo(e, Evento.Baixou(100)); assertEquals(Estado.Enviando(box, 0, 100), e)
        e = MaquinaInstalacao.proximo(e, Evento.Progresso(100, 100)); assertEquals(Estado.Enviando(box, 100, 100), e)
        e = MaquinaInstalacao.proximo(e, Evento.Enviou); assertEquals(Estado.Instalando(box), e)
        e = MaquinaInstalacao.proximo(e, Evento.Instalou("br.com.digitalisp.telas")); assertEquals(Estado.Abrindo(box, "br.com.digitalisp.telas"), e)
        e = MaquinaInstalacao.proximo(e, Evento.Abriu(true)); assertEquals(Estado.Concluido(box, "br.com.digitalisp.telas", true), e)
    }

    @Test fun android11ComecaPedindoCodigoEDepoisConecta() {
        var e = rodar(Evento.Escolher(box11))
        assertEquals(Estado.PedindoCodigo(box11), e)
        e = rodar(Evento.CodigoInformado, inicio = e)
        assertEquals(Estado.Pareando(box11), e)
        val pareada = box11.copy(portaTls = 37123, portaPareamento = null)
        e = rodar(Evento.Pareou(pareada), inicio = e)
        assertEquals(Estado.Conectando(pareada), e)
    }

    @Test fun codigoErradoVoltaAPedirComAviso() {
        val e = rodar(Evento.Escolher(box11), Evento.CodigoInformado, Evento.Erro("código errado"))
        assertEquals(Estado.PedindoCodigo(box11, "código errado"), e)
    }

    @Test fun conexaoQuePedePareamento() {
        val e = rodar(Evento.Escolher(box), Evento.PrecisaParear)
        assertEquals(Estado.PedindoCodigo(box), e)
    }

    @Test fun tvQueNaoAutorizaFalhaNaConexao() {
        val e = rodar(Evento.Escolher(box), Evento.DemorouAceite, Evento.NaoAutorizou)
        assertTrue(e is Estado.Falhou)
        e as Estado.Falhou
        assertEquals(Etapa.CONEXAO, e.etapa)
        assertTrue(e.mensagem.contains("Permitir"))
    }

    @Test fun erroEmCadaEtapaDizQualEtapa() {
        assertEquals(Etapa.CONEXAO, (rodar(Evento.Escolher(box), Evento.Erro("x")) as Estado.Falhou).etapa)
        assertEquals(Etapa.DOWNLOAD, (rodar(Evento.Escolher(box), Evento.Conectou, Evento.Erro("x")) as Estado.Falhou).etapa)
        assertEquals(Etapa.ENVIO, (rodar(Evento.Escolher(box), Evento.Conectou, Evento.Baixou(1), Evento.Erro("x")) as Estado.Falhou).etapa)
        assertEquals(Etapa.INSTALACAO, (rodar(Evento.Escolher(box), Evento.Conectou, Evento.Baixou(1), Evento.Enviou, Evento.Erro("x")) as Estado.Falhou).etapa)
    }

    @Test fun naoAbrirAindaContaComoInstalado() {
        val e = rodar(Evento.Escolher(box), Evento.Conectou, Evento.Baixou(1), Evento.Enviou, Evento.Instalou("a.b"), Evento.Erro("x"))
        assertEquals(Estado.Concluido(box, "a.b", false), e)
    }

    @Test fun samsungSemHostPcPedeOIpDoCelularEDepoisTentaDeNovo() {
        var e = rodar(Evento.Escolher(samsung))
        assertEquals(Estado.Conectando(samsung), e)
        e = rodar(Evento.PrecisaHostPc("não aceitou"), inicio = e)
        assertEquals(Estado.PedindoHostPc(samsung, "não aceitou"), e)
        assertEquals(Estado.Conectando(samsung), rodar(Evento.TentarConectar, inicio = e))
    }

    @Test fun lgPedeAFraseEDepoisConecta() {
        val lg = TvEncontrada("192.168.0.70", Plataforma.LG, portaDev = 9922)
        var e = rodar(Evento.Escolher(lg), Evento.PrecisaFrase(null))
        assertEquals(Estado.PedindoFrase(lg, null), e)
        e = rodar(Evento.Erro("frase errada"), inicio = e)
        assertEquals(Estado.PedindoFrase(lg, "frase errada"), e)
        e = rodar(Evento.TentarConectar, Evento.Conectou, Evento.Baixou(1), Evento.Enviou, Evento.Instalou("br.com.digitalisp.telas"),
            Evento.Abriu(true, "sessão renovada"), inicio = e)
        assertEquals(Estado.Concluido(lg, "br.com.digitalisp.telas", true, "sessão renovada"), e)
    }

    @Test fun eventoForaDeHoraEIgnorado() {
        // resposta atrasada de uma tentativa anterior não pode pular etapas
        assertEquals(Estado.Inicio, rodar(Evento.Conectou))
        assertEquals(Estado.Inicio, rodar(Evento.Instalou("a.b")))
        val baixando = rodar(Evento.Escolher(box), Evento.Conectou)
        assertEquals(baixando, rodar(Evento.Enviou, inicio = baixando))
        assertEquals(baixando, rodar(Evento.Escolher(box11), inicio = baixando))
        // DemorouAceite que chega depois de conectar não volta para "olhe a TV"
        assertEquals(baixando, rodar(Evento.DemorouAceite, inicio = baixando))
    }

    @Test fun depoisDeTerminarOuFalharPodeComecarDeNovo() {
        val falhou = rodar(Evento.Escolher(box), Evento.Erro("x"))
        assertEquals(Estado.Conectando(box), rodar(Evento.Escolher(box), inicio = falhou))
        val pronto = rodar(Evento.Escolher(box), Evento.Conectou, Evento.Baixou(1), Evento.Enviou, Evento.Instalou("a.b"), Evento.Abriu(true))
        assertEquals(Estado.Conectando(box11.copy(portaAdb = 5555)), rodar(Evento.Escolher(box11.copy(portaAdb = 5555)), inicio = pronto))
    }

    @Test fun recomecarSempreVoltaAoInicio() {
        assertEquals(Estado.Inicio, rodar(Evento.Escolher(box), Evento.Conectou, Evento.Recomecar))
    }

    @Test fun ocupadoSoDuranteOTrabalho() {
        assertFalse(MaquinaInstalacao.ocupado(Estado.Inicio))
        assertFalse(MaquinaInstalacao.ocupado(Estado.PedindoCodigo(box11)))
        assertTrue(MaquinaInstalacao.ocupado(Estado.Conectando(box)))
        assertTrue(MaquinaInstalacao.ocupado(Estado.Enviando(box)))
        assertFalse(MaquinaInstalacao.ocupado(Estado.Falhou(box, Etapa.ENVIO, "x")))
    }

    @Test fun percentual() {
        assertNull(MaquinaInstalacao.percentual(10, -1))
        assertEquals(0, MaquinaInstalacao.percentual(0, 100))
        assertEquals(50, MaquinaInstalacao.percentual(5_000_000_000, 10_000_000_000))
        assertEquals(100, MaquinaInstalacao.percentual(200, 100))
    }

    @Test fun codigoDePareamento() {
        assertEquals("123456", MaquinaInstalacao.normalizarCodigo(" 123 456 "))
        assertNull(MaquinaInstalacao.normalizarCodigo("12345"))
        assertNull(MaquinaInstalacao.normalizarCodigo("1234567"))
        assertNull(MaquinaInstalacao.normalizarCodigo("12a456"))
    }
}
