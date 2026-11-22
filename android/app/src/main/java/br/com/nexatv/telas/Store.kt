package br.com.nexatv.telas

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import br.com.nexatv.telas.core.Alert
import br.com.nexatv.telas.core.Alerts
import br.com.nexatv.telas.core.ConfigParser
import br.com.nexatv.telas.core.LockoutState
import br.com.nexatv.telas.core.Missing
import br.com.nexatv.telas.core.MissingCase
import br.com.nexatv.telas.core.RecentAlert
import br.com.nexatv.telas.core.TelaConfig
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Cifra o token com uma chave AES-GCM que só existe no Keystore do aparelho. */
internal object SecretBox {
    private const val ALIAS = "nexa_telas_token"
    private const val STORE = "AndroidKeyStore"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(STORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    /** "k1:" + base64(iv + cifrado). Se o Keystore do aparelho falhar, devolve null. */
    fun seal(plain: String): String? = try {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
        "k1:" + Base64.encodeToString(out, Base64.NO_WRAP)
    } catch (_: Exception) {
        null
    }

    fun open(sealed: String): String? = try {
        val raw = Base64.decode(sealed.removePrefix("k1:"), Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
    } catch (_: Exception) {
        null
    }
}

/** Tudo o que o app guarda no aparelho (pasta privada do app). Nunca registrar token nem PIN em log. */
class Store(ctx: Context) {
    private val p: SharedPreferences = ctx.applicationContext.getSharedPreferences("telas", Context.MODE_PRIVATE)

    companion object {
        const val MODE_NONE = ""
        const val MODE_STANDALONE = "standalone"
        const val MODE_MANAGED = "managed"
        const val DEFAULT_SERVER = "https://api.nexa.tv.br"
    }

    var mode: String
        get() = p.getString("mode", MODE_NONE) ?: MODE_NONE
        set(v) { p.edit().putString("mode", v).commit() }

    var server: String
        get() = p.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER
        set(v) { p.edit().putString("server", v).commit() }

    /** Token do aparelho. Guardado cifrado pelo Keystore; em aparelho com Keystore quebrado, fica só na pasta privada. */
    var token: String?
        get() {
            if (tokenLoaded) return tokenCache
            val v = p.getString("token", null)
            tokenCache = when {
                v == null -> null
                v.startsWith("k1:") -> SecretBox.open(v)
                v.startsWith("p0:") -> v.removePrefix("p0:")
                else -> null
            }
            tokenLoaded = true
            return tokenCache
        }
        set(v) {
            if (v.isNullOrEmpty()) p.edit().remove("token").commit()
            else p.edit().putString("token", SecretBox.seal(v) ?: "p0:$v").commit()
            tokenCache = v?.ifEmpty { null }
            tokenLoaded = true
        }

    // o cofre do Android é lento: decifra uma vez e guarda só na memória
    @Volatile private var tokenCache: String? = null
    @Volatile private var tokenLoaded = false

    val tokenInKeystore: Boolean get() = p.getString("token", "")?.startsWith("k1:") == true

    var deviceName: String
        get() = p.getString("deviceName", "") ?: ""
        set(v) { p.edit().putString("deviceName", v).apply() }

    var channel: String
        get() = p.getString("channel", "") ?: ""
        set(v) { p.edit().putString("channel", v).apply() }

    // ---- configuração ----
    var configJson: String?
        get() = p.getString("config", null)
        set(v) { p.edit().putString("config", v).commit() }

    var standaloneUrl: String
        get() = p.getString("saUrl", "") ?: ""
        set(v) { p.edit().putString("saUrl", v).commit() }

    fun setStandalonePin(salt: String, hash: String) {
        p.edit().putString("saSalt", salt).putString("saHash", hash).commit()
    }

    /** A configuração que vale agora: a do servidor guardada (gerenciado) ou a digitada (avulso). */
    fun loadConfig(): TelaConfig? = when (mode) {
        MODE_MANAGED -> configJson?.let { try { ConfigParser.parse(it) } catch (_: Exception) { null } }
        MODE_STANDALONE -> ConfigParser.standalone(standaloneUrl, p.getString("saSalt", "") ?: "", p.getString("saHash", "") ?: "")
        else -> null
    }

    // ---- alertas ----
    var alerts: List<Alert>
        get() = Alerts.parse(p.getString("alerts", null))
        set(v) { p.edit().putString("alerts", Alerts.toJson(v)).commit() }

    var recentAlert: RecentAlert?
        get() = try {
            p.getString("recent", null)?.let { s ->
                val o = JSONObject(s)
                Alerts.parse(org.json.JSONArray().put(o.getJSONObject("a"))).firstOrNull()?.let { RecentAlert(it, o.getLong("at")) }
            }
        } catch (_: Exception) {
            null
        }
        set(v) {
            if (v == null) p.edit().remove("recent").apply()
            else p.edit().putString("recent", JSONObject().put("a", v.alert.toJson()).put("at", v.endedAt).toString()).apply()
        }

    // ---- pessoas desaparecidas (contrato §8): ficam guardadas para valer sem rede, até o `until` de cada caso ----
    var missing: List<MissingCase>
        get() = Missing.parse(p.getString("missing", null))
        set(v) { p.edit().putString("missing", Missing.toJson(v)).commit() }

    // ---- último estado da tela, para valer sem rede (1.2.6) ----
    /** Painel de senha como estava (core/QueueCache): só o que a tela mostra, nunca o tipo de problema. */
    var queueJson: String?
        get() = p.getString("queue", null)
        set(v) { p.edit().putString("queue", v).apply() }

    /** A última hora boa (core/TrustedClock): com ela a tela sabe a hora sem rede enquanto o aparelho não reinicia. */
    var clockAnchor: br.com.nexatv.telas.core.ClockAnchor?
        get() = br.com.nexatv.telas.core.ClockAnchor.parse(p.getString("clockAnchor", null))
        set(v) { p.edit().putString("clockAnchor", v?.toWire()).apply() }

    // ---- bloqueio do PIN ----
    var lockout: LockoutState
        get() = LockoutState(p.getInt("pinFails", 0), p.getLong("pinLockedUntil", 0L))
        set(v) { p.edit().putInt("pinFails", v.fails).putLong("pinLockedUntil", v.lockedUntil).commit() }

    // ---- diagnóstico ----
    var lastHeartbeatAt: Long
        get() = p.getLong("hbAt", 0L)
        set(v) { p.edit().putLong("hbAt", v).apply() }

    var lastError: String
        get() = p.getString("lastError", "") ?: ""
        set(v) { p.edit().putString("lastError", v.take(200)).apply() }

    // ---- ajustes locais ----
    /** Para onde girar quando o layout é "portrait" e a saída do aparelho é deitada: 90 ou 270. */
    /** Legendas escolhidas no aparelho (core/CaptionsPolicy): valem até a próxima mudança do painel. */
    var captionsLocal: String
        get() = p.getString("captionsLocal", "") ?: ""
        set(v) { p.edit().putString("captionsLocal", v).apply() }

    /** O som da chamada escolhido no aparelho ("beep", "voice", "both"; "" = não escolhido). Vale se o painel não definir (§16). */
    var callSoundLocal: String
        get() = p.getString("callSoundLocal", "") ?: ""
        set(v) { p.edit().putString("callSoundLocal", v).apply() }

    /** A voz da chamada escolhida no aparelho: "coral" (padrão), "nova", "ash", "onyx" (vozes que o app traz) ou "android". */
    var callVoice: String
        get() = p.getString("callVoice", "coral") ?: "coral"
        set(v) { p.edit().putString("callVoice", v).apply() }

    /** O assistente de configuração inicial já foi concluído (ou pulado até o fim) neste aparelho. */
    var wizardDone: Boolean
        get() = p.getBoolean("wizardDone", false)
        set(v) { p.edit().putBoolean("wizardDone", v).apply() }

    /** Margem da tela (overscan) em %: 0, 2, 3, 5 ou 7 (core/Overscan). Só no aparelho. */
    var overscanPct: Int
        get() = br.com.nexatv.telas.core.Overscan.clean(p.getInt("overscan", br.com.nexatv.telas.core.Overscan.DEFAULT))
        set(v) { p.edit().putInt("overscan", br.com.nexatv.telas.core.Overscan.clean(v)).apply() }

    var rotation: Int
        get() = p.getInt("rotation", 90)
        set(v) { p.edit().putInt("rotation", v).apply() }

    /** Modo do vídeo (core/VideoMode): "auto", "fixed" ou "fixed720". Desce sozinho se o decodificador falhar; sobe nos ajustes. */
    var videoMode: String
        get() = p.getString("videoMode", "auto") ?: "auto"
        set(v) { p.edit().putString("videoMode", v).apply() }

    /** Experimental (só Device Owner): pôr o aparelho em espera fora do horário. */
    var standbyOffHours: Boolean
        get() = p.getBoolean("standby", false)
        set(v) { p.edit().putBoolean("standby", v).apply() }

    /** Até quando o técnico está fora do app com o PIN (o serviço não puxa o app de volta antes disso). */
    var maintenanceUntil: Long
        get() = p.getLong("maintUntil", 0L)
        set(v) { p.edit().putLong("maintUntil", v).commit() }

    var updateTriedCode: Int
        get() = p.getInt("updCode", 0)
        set(v) { p.edit().putInt("updCode", v).apply() }

    var updateTriedAt: Long
        get() = p.getLong("updAt", 0L)
        set(v) { p.edit().putLong("updAt", v).apply() }

    /** Quedas recentes do app (epoch ms), para não reabrir em laço quando cai na partida. */
    var crashTimes: List<Long>
        get() = (p.getString("crashes", "") ?: "").split(',').mapNotNull { it.toLongOrNull() }
        set(v) { p.edit().putString("crashes", v.takeLast(10).joinToString(",")).commit() }

    /** Sai do modo gerenciado sem perder o PIN em cache (a tela da chave continua protegida). */
    fun wipeToken() {
        token = null
    }

    /** Volta ao estado de fábrica do app. */
    fun wipeAll() {
        p.edit().clear().commit()
        tokenCache = null
        tokenLoaded = true
    }
}
