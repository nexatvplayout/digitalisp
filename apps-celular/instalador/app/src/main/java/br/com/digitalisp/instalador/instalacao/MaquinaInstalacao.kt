package br.com.digitalisp.instalador.instalacao

import br.com.digitalisp.instalador.rede.TvEncontrada

/** Em que parte da instalação algo deu errado (para a mensagem e para saber o que repetir). */
enum class Etapa { CONEXAO, PAREAMENTO, DOWNLOAD, ENVIO, INSTALACAO, ABERTURA }

/** Onde a instalação está. Cada estado é uma tela do passo a passo. */
sealed interface Estado {
    data object Inicio : Estado
    data class Conectando(val tv: TvEncontrada) : Estado
    /** Android: a conexão está demorando, quase sempre é a TV mostrando "Permitir depuração?". */
    data class AguardandoAceite(val tv: TvEncontrada) : Estado
    /** Android 11+: o técnico precisa ler o código de 6 dígitos na TV. [aviso] traz o erro da tentativa anterior. */
    data class PedindoCodigo(val tv: TvEncontrada, val aviso: String? = null) : Estado
    data class Pareando(val tv: TvEncontrada) : Estado
    /** Samsung: a TV não aceitou o celular; o IP do celular tem de estar no "Host PC IP" do modo desenvolvedor. */
    data class PedindoHostPc(val tv: TvEncontrada, val aviso: String? = null) : Estado
    /** LG: falta a frase-senha (passphrase) que o app Developer Mode mostra na TV. */
    data class PedindoFrase(val tv: TvEncontrada, val aviso: String? = null) : Estado
    data class Baixando(val tv: TvEncontrada, val feito: Long = 0, val total: Long = -1) : Estado
    data class Enviando(val tv: TvEncontrada, val feito: Long = 0, val total: Long = -1) : Estado
    data class Instalando(val tv: TvEncontrada) : Estado
    data class Abrindo(val tv: TvEncontrada, val pacote: String) : Estado
    /** [observacao]: o que o técnico precisa saber depois (sessão da LG, DUID da Samsung...). */
    data class Concluido(val tv: TvEncontrada, val pacote: String, val abriu: Boolean, val observacao: String? = null) : Estado
    data class Falhou(val tv: TvEncontrada?, val etapa: Etapa, val mensagem: String) : Estado
}

sealed interface Evento {
    data class Escolher(val tv: TvEncontrada) : Evento
    data object DemorouAceite : Evento
    data object Conectou : Evento
    data object PrecisaParear : Evento
    data object NaoAutorizou : Evento
    data class PrecisaHostPc(val aviso: String? = null) : Evento
    data class PrecisaFrase(val aviso: String? = null) : Evento
    /** O técnico confirmou o Host PC (Samsung) ou digitou a frase (LG): tentar conectar de novo. */
    data object TentarConectar : Evento
    data object CodigoInformado : Evento
    data class Pareou(val tv: TvEncontrada) : Evento
    data class Progresso(val feito: Long, val total: Long) : Evento
    data class Baixou(val total: Long) : Evento
    data object Enviou : Evento
    data class Instalou(val pacote: String) : Evento
    data class Abriu(val ok: Boolean, val observacao: String? = null) : Evento
    data class Erro(val mensagem: String) : Evento
    data object Recomecar : Evento
}

/**
 * A máquina de estados da instalação: função pura (estado, evento) → próximo estado. Evento que não cabe no estado
 * atual é ignorado (o estado volta igual), o que protege contra respostas atrasadas de uma tentativa anterior.
 *
 * Android: Conectando → (AguardandoAceite | PedindoCodigo → Pareando → Conectando) → Baixando → Enviando → Instalando
 * → Abrindo → Concluido. Samsung: Conectando (→ PedindoHostPc) → Baixando → ... LG: Conectando (→ PedindoFrase) → ...
 */
object MaquinaInstalacao {

    fun proximo(e: Estado, ev: Evento): Estado {
        if (ev is Evento.Recomecar) return Estado.Inicio
        return when (e) {
            is Estado.Inicio, is Estado.Concluido, is Estado.Falhou ->
                if (ev is Evento.Escolher) escolher(ev.tv) else e

            is Estado.Conectando, is Estado.AguardandoAceite -> {
                val tv = tvDe(e)!!
                when (ev) {
                    Evento.DemorouAceite -> if (e is Estado.Conectando) Estado.AguardandoAceite(tv) else e
                    Evento.Conectou -> Estado.Baixando(tv)
                    Evento.PrecisaParear -> Estado.PedindoCodigo(tv)
                    is Evento.PrecisaHostPc -> Estado.PedindoHostPc(tv, ev.aviso)
                    is Evento.PrecisaFrase -> Estado.PedindoFrase(tv, ev.aviso)
                    Evento.NaoAutorizou -> Estado.Falhou(
                        tv, Etapa.CONEXAO,
                        "A TV não autorizou o celular. Na TV, toque em \"Sempre permitir\" e depois em \"Permitir\" " +
                            "quando aparecer o aviso de depuração, e tente de novo.",
                    )
                    is Evento.Erro -> Estado.Falhou(tv, Etapa.CONEXAO, ev.mensagem)
                    else -> e
                }
            }

            is Estado.PedindoCodigo -> when (ev) {
                Evento.CodigoInformado -> Estado.Pareando(e.tv)
                is Evento.Erro -> e.copy(aviso = ev.mensagem)
                else -> e
            }

            is Estado.Pareando -> when (ev) {
                is Evento.Pareou -> Estado.Conectando(ev.tv)
                // código errado ou janela fechada: volta a pedir o código, com o aviso
                is Evento.Erro -> Estado.PedindoCodigo(e.tv, ev.mensagem)
                else -> e
            }

            is Estado.PedindoHostPc -> when (ev) {
                Evento.TentarConectar -> Estado.Conectando(e.tv)
                is Evento.Erro -> e.copy(aviso = ev.mensagem)
                else -> e
            }

            is Estado.PedindoFrase -> when (ev) {
                Evento.TentarConectar -> Estado.Conectando(e.tv)
                is Evento.Erro -> e.copy(aviso = ev.mensagem)
                else -> e
            }

            is Estado.Baixando -> when (ev) {
                is Evento.Progresso -> e.copy(feito = ev.feito, total = ev.total)
                is Evento.Baixou -> Estado.Enviando(e.tv, 0, ev.total)
                is Evento.Erro -> Estado.Falhou(e.tv, Etapa.DOWNLOAD, ev.mensagem)
                else -> e
            }

            is Estado.Enviando -> when (ev) {
                is Evento.Progresso -> e.copy(feito = ev.feito, total = if (ev.total > 0) ev.total else e.total)
                Evento.Enviou -> Estado.Instalando(e.tv)
                is Evento.Erro -> Estado.Falhou(e.tv, Etapa.ENVIO, ev.mensagem)
                else -> e
            }

            is Estado.Instalando -> when (ev) {
                is Evento.Instalou -> Estado.Abrindo(e.tv, ev.pacote)
                is Evento.Erro -> Estado.Falhou(e.tv, Etapa.INSTALACAO, ev.mensagem)
                else -> e
            }

            is Estado.Abrindo -> when (ev) {
                is Evento.Abriu -> Estado.Concluido(e.tv, e.pacote, ev.ok, ev.observacao)
                // instalou; só não abriu: ainda é sucesso, com o aviso para abrir à mão
                is Evento.Erro -> Estado.Concluido(e.tv, e.pacote, abriu = false)
                else -> e
            }
        }
    }

    private fun escolher(tv: TvEncontrada): Estado = when {
        tv.precisaParear -> Estado.PedindoCodigo(tv)
        else -> Estado.Conectando(tv)
    }

    fun tvDe(e: Estado): TvEncontrada? = when (e) {
        Estado.Inicio -> null
        is Estado.Conectando -> e.tv
        is Estado.AguardandoAceite -> e.tv
        is Estado.PedindoCodigo -> e.tv
        is Estado.Pareando -> e.tv
        is Estado.PedindoHostPc -> e.tv
        is Estado.PedindoFrase -> e.tv
        is Estado.Baixando -> e.tv
        is Estado.Enviando -> e.tv
        is Estado.Instalando -> e.tv
        is Estado.Abrindo -> e.tv
        is Estado.Concluido -> e.tv
        is Estado.Falhou -> e.tv
    }

    /** Há uma instalação em andamento (o app não deve deixar começar outra). */
    fun ocupado(e: Estado): Boolean = when (e) {
        is Estado.Conectando, is Estado.AguardandoAceite, is Estado.Pareando,
        is Estado.Baixando, is Estado.Enviando, is Estado.Instalando, is Estado.Abrindo -> true
        else -> false
    }

    /** Percentual de 0 a 100, ou null se o total não é conhecido. */
    fun percentual(feito: Long, total: Long): Int? =
        if (total <= 0) null else ((feito.coerceIn(0, total) * 100) / total).toInt()

    /** O código do pareamento do Android tem 6 dígitos. Aceita espaços que o técnico digite. */
    fun normalizarCodigo(texto: String): String? {
        val so = texto.filter { !it.isWhitespace() }
        return so.takeIf { it.length == 6 && it.all { c -> c in '0'..'9' } }
    }
}
