package br.com.digitalisp.instalador.rede

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.net.Inet4Address
import java.util.ArrayDeque

/** IPv4 e prefixo do celular na rede atual (Wi-Fi ou cabo). */
data class RedeLocal(val ip: String, val prefixo: Int)

fun redeLocal(context: Context): RedeLocal? {
    val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
    val rede = cm.activeNetwork ?: return null
    val caps = cm.getNetworkCapabilities(rede)
    if (caps != null && !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
        !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    ) return null
    val link = cm.getLinkProperties(rede) ?: return null
    val v4 = link.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress } ?: return null
    return RedeLocal(v4.address.hostAddress ?: return null, v4.prefixLength)
}

/**
 * Procura TVs de duas formas ao mesmo tempo: mDNS (serviços do ADB) e varredura de portas da sub-rede.
 * Cada novidade vai para [aoMudar] com a lista inteira, já sem repetição.
 */
class BuscaNaRede(
    private val context: Context,
    private val escopo: CoroutineScope,
    private val aoMudar: (List<TvEncontrada>) -> Unit,
) {
    val catalogo = Catalogo()
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val ouvintes = ArrayList<NsdManager.DiscoveryListener>()
    private val filaResolver = ArrayDeque<NsdServiceInfo>()
    private var resolvendo = false
    private var multicast: WifiManager.MulticastLock? = null
    private var varredura: Job? = null

    /** Começa a busca. Devolve false se o celular não está numa rede local (sem Wi-Fi). */
    fun iniciar(aoTerminarVarredura: () -> Unit): Boolean {
        parar()
        catalogo.limpar()
        val rede = redeLocal(context) ?: return false
        iniciarMdns()
        varredura = escopo.launch {
            Varredura(SondaTcp()).varrer(Subrede.hosts(rede.ip, rede.prefixo)) { adicionar(it) }
            aoTerminarVarredura()
        }
        return true
    }

    fun adicionar(tv: TvEncontrada) {
        if (catalogo.adicionar(tv)) aoMudar(catalogo.lista())
    }

    fun parar() {
        varredura?.cancel()
        varredura = null
        for (o in ouvintes) runCatching { nsd?.stopServiceDiscovery(o) }
        ouvintes.clear()
        synchronized(filaResolver) { filaResolver.clear(); resolvendo = false }
        multicast?.let { if (it.isHeld) it.release() }
        multicast = null
    }

    private fun iniciarMdns() {
        val nsd = nsd ?: return
        runCatching {
            val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
            multicast = wifi?.createMulticastLock("digitalisp-busca")?.apply { setReferenceCounted(false); acquire() }
        }
        for (tipo in ServicosAdb.TODOS) {
            val ouvinte = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {}
                override fun onDiscoveryStopped(serviceType: String) {}
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.w(TAG, "mDNS não iniciou $serviceType: $errorCode")
                }
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
                override fun onServiceFound(info: NsdServiceInfo) = enfileirar(info)
                override fun onServiceLost(info: NsdServiceInfo) {}
            }
            runCatching { nsd.discoverServices(tipo, NsdManager.PROTOCOL_DNS_SD, ouvinte); ouvintes.add(ouvinte) }
        }
    }

    // Antes do Android 14 o NsdManager só resolve um serviço por vez: fila.
    private fun enfileirar(info: NsdServiceInfo) {
        synchronized(filaResolver) {
            filaResolver.add(info)
            if (resolvendo) return
            resolvendo = true
        }
        proximo()
    }

    @Suppress("DEPRECATION")
    private fun proximo() {
        val info = synchronized(filaResolver) {
            val i = filaResolver.poll()
            if (i == null) resolvendo = false
            i
        } ?: return
        val nsd = nsd ?: return
        runCatching {
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = proximo()
                override fun onServiceResolved(s: NsdServiceInfo) {
                    val host = (s.host as? Inet4Address)?.hostAddress
                    if (host != null) {
                        ServicosAdb.paraTv(s.serviceType ?: info.serviceType, s.serviceName ?: "", host, s.port)
                            ?.let { adicionar(it) }
                    }
                    proximo()
                }
            })
        }.onFailure { proximo() }
    }

    private companion object { const val TAG = "BuscaNaRede" }
}
