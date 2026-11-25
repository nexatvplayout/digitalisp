package br.com.digitalisp.instalador.ui

import android.app.Application
import org.conscrypt.Conscrypt
import java.security.Security

/** Põe o Conscrypt (TLS 1.3) como primeiro provedor: o pareamento e a conexão TLS do Android 11+ dependem dele. */
class AppInstalador : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching { Security.insertProviderAt(Conscrypt.newProvider(), 1) }
    }
}
