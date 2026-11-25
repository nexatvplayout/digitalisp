package br.com.digitalisp.instalador.rede

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.net.Socket

/** Testa se uma porta TCP está aberta. Nos testes da JVM entra uma versão falsa. */
fun interface Sonda {
    suspend fun aberta(host: String, porta: Int): Boolean
}

/** Sonda real: abre e fecha um socket TCP com tempo limite curto. */
class SondaTcp(private val tempoMs: Int = 400) : Sonda {
    override suspend fun aberta(host: String, porta: Int): Boolean = withContext(Dispatchers.IO) {
        try {
            Socket().use { it.connect(InetSocketAddress(host, porta), tempoMs); true }
        } catch (_: Exception) {
            false
        }
    }
}

/** Portas que identificam cada tipo de aparelho. A ordem importa: a 5555 é testada primeiro. */
object PortasConhecidas {
    const val ADB = 5555
    val SAMSUNG = listOf(8001, 8002, 26101)
    val LG = listOf(3000, 3001, 9922)
    val TODAS = listOf(ADB) + SAMSUNG + LG
    /** Portas do modo desenvolvedor: Samsung sdb e LG SSH. */
    const val SAMSUNG_DEV = 26101
    const val LG_DEV = 9922

    /** O que o conjunto de portas abertas de um IP diz sobre ele; null = não parece TV. */
    fun classificar(host: String, abertas: Set<Int>): TvEncontrada? = when {
        ADB in abertas -> TvEncontrada(host, Plataforma.ANDROID, portaAdb = ADB)
        abertas.any { it in SAMSUNG } -> TvEncontrada(host, Plataforma.SAMSUNG, portaDev = SAMSUNG_DEV.takeIf { it in abertas })
        abertas.any { it in LG } -> TvEncontrada(host, Plataforma.LG, portaDev = LG_DEV.takeIf { it in abertas })
        else -> null
    }
}

/**
 * Varre os IPs procurando TVs e chama [aoAchar] para cada aparelho assim que ele é identificado.
 * Por IP, para na 5555 aberta (é TV box; não precisa testar o resto).
 */
class Varredura(
    private val sonda: Sonda,
    private val paralelo: Int = 64,
    private val portas: List<Int> = PortasConhecidas.TODAS,
) {
    suspend fun varrer(hosts: List<String>, aoAchar: (TvEncontrada) -> Unit) = coroutineScope {
        val limite = Semaphore(paralelo)
        for (host in hosts) {
            launch {
                limite.withPermit {
                    val abertas = HashSet<Int>()
                    for (porta in portas) {
                        if (sonda.aberta(host, porta)) {
                            abertas.add(porta)
                            if (porta == PortasConhecidas.ADB) break
                        }
                    }
                    PortasConhecidas.classificar(host, abertas)?.let(aoAchar)
                }
            }
        }
    }
}
