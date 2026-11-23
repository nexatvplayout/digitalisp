package br.com.digitalisp.telas.core

/**
 * Junta os dois sinais de "o vídeo está andando" num número só para o [Watchdog]:
 * - quadros que saem do decodificador (o sinal preferido: segue andando nas descontinuidades do HLS e para na imagem
 *   congelada);
 * - a posição do player (reserva: decodificador de TV box barata pode não informar os contadores).
 *
 * O número devolvido muda sempre que QUALQUER um dos dois mudou; só fica parado quando os DOIS estão parados, então o
 * vigia só declara travamento com os dois sinais parados por 10 s.
 *
 * Se os quadros não andam mas a posição anda por [confirmTicks] tiques seguidos, a sessão passa para "por posição"
 * ([byPosition]), o que aparece nos ajustes. (Um tique só não basta: um salto de posição numa volta à ponta do ao
 * vivo mexe na posição sem quadro novo.)
 */
class ProgressSignal(private val confirmTicks: Int = 3) {
    private var lastFrames = Long.MIN_VALUE
    private var lastPosition = Long.MIN_VALUE
    private var primed = false
    private var positionOnly = 0
    private var value = 0L

    /** Os contadores do decodificador não andam neste aparelho: o vigia está valendo pela posição. Não volta atrás. */
    var byPosition = false
        private set

    /** Uma amostra por tique. Devolve o número de progresso para o [Watchdog.tick]. */
    fun sample(frames: Long, position: Long): Long {
        val framesMoved = frames != lastFrames
        val positionMoved = position != lastPosition
        lastFrames = frames
        lastPosition = position
        if (!primed) {
            // primeira amostra depois de (re)carregar: não há com o que comparar
            primed = true
            return ++value
        }
        if (!framesMoved && positionMoved) {
            if (++positionOnly >= confirmTicks) byPosition = true
        } else if (framesMoved) {
            positionOnly = 0
        }
        if (framesMoved || positionMoved) value++
        return value
    }

    /** Vídeo recarregado: esquece as últimas amostras (o modo "por posição" fica). */
    fun reload() {
        primed = false
        positionOnly = 0
    }
}
