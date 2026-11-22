package br.com.nexatv.telas

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import br.com.nexatv.telas.core.TelaConfig
import br.com.nexatv.telas.core.UpdateAction
import br.com.nexatv.telas.core.UpdatePolicy
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Atualização do próprio app pelo instalador do Android (PackageInstaller).
 * Com Device Owner instala sozinho, sem perguntar; sem ele, o Android mostra a pergunta na tela.
 *
 * O campo `update` ({ url, sha256, versionCode }) é opcional no /config (contrato, seção 6) e só vem quando a
 * prefeitura define. Sem o campo, este código não faz nada. O arquivo é conferido pelo sha256 antes de instalar, e
 * o Android só aceita um APK assinado com a mesma chave do app instalado.
 */
object Updater {
    private const val MAX_BYTES = 200L * 1024 * 1024
    private val busy = AtomicBoolean(false)

    /** A última frase do fluxo, para os ajustes ("Procurar atualização"). */
    @Volatile var status: String = ""
        private set

    /**
     * Automático (a cada configuração nova) ou pelo botão (manual = true: não espera o intervalo entre tentativas).
     * Devolve o que foi decidido; o download e a instalação seguem numa thread.
     */
    fun maybeUpdate(ctx: Context, store: Store, cfg: TelaConfig, manual: Boolean = false): UpdateAction {
        val up = cfg.update
        val now = System.currentTimeMillis()
        val action = UpdatePolicy.decide(BuildConfig.VERSION_CODE, up, manual, store.updateTriedCode, now - store.updateTriedAt)
        if (manual) status = UpdatePolicy.text(action, BuildConfig.VERSION_NAME, up?.versionCode)
        if (action != UpdateAction.DOWNLOAD || up == null) return action
        if (!busy.compareAndSet(false, true)) {
            if (manual) status = "Já está baixando a versão nova…"
            return action
        }
        store.updateTriedCode = up.versionCode
        store.updateTriedAt = now
        Thread({
            try {
                val apk = File(ctx.cacheDir, "atualizacao.apk")
                download(up.url, apk)
                if (Engine.sha256(apk) != up.sha256) {
                    apk.delete()
                    status = "O arquivo baixado não confere (SHA-256): nada foi instalado."
                    Engine.noteError("Atualização: o arquivo baixado não confere (sha256).")
                } else {
                    status = "Abrindo o instalador do Android (versionCode ${up.versionCode})…"
                    install(ctx, apk)
                }
            } catch (e: Exception) {
                status = "A atualização falhou (${e.javaClass.simpleName}). Confira a internet e tente de novo."
                Engine.noteError("Atualização falhou (${e.javaClass.simpleName}).")
            } finally {
                busy.set(false)
            }
        }, "telas-atualizacao").apply { isDaemon = true }.start()
        return action
    }

    private fun download(url: String, to: File) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            if (conn.responseCode != 200) throw java.io.IOException("HTTP ${conn.responseCode}")
            FileOutputStream(to).use { out ->
                conn.inputStream.use { ins ->
                    val buf = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = ins.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw java.io.IOException("APK grande demais")
                        out.write(buf, 0, n)
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, 64 * 1024) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, UpdateReceiver::class.java), flags)
            session.commit(pi.intentSender)
        }
    }
}

/** Resultado da instalação. Sem Device Owner o Android pede a confirmação na tela. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                // dá dois minutos para alguém responder à pergunta do Android sem o app voltar por cima
                Store(app).maintenanceUntil = System.currentTimeMillis() + 2 * 60_000L
                try {
                    app.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) {
                    Store(app).lastError = "Atualização: o Android não deixou mostrar a pergunta de instalação."
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // o MY_PACKAGE_REPLACED reabre o app
            else -> Store(app).lastError = "Atualização recusada pelo Android (código $status)."
        }
    }
}
