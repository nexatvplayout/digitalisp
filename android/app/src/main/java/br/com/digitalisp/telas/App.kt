package br.com.digitalisp.telas

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.UserManager
import kotlin.system.exitProcess

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // App que cai é reaberto: registra, agenda a volta e encerra o processo.
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            Engine.onCrash(this, e)
            android.os.Process.killProcess(android.os.Process.myPid())
            exitProcess(10)
        }
        // Antes do primeiro desbloqueio (boot direto) os dados do app ainda estão fechados.
        val um = getSystemService(Context.USER_SERVICE) as UserManager
        if (um.isUserUnlocked) Engine.init(this)
    }
}

/**
 * Serviço em primeiro plano: mantém o processo vivo, fala com o servidor mesmo se a tela sair da frente e, a cada
 * poucos segundos, traz a tela de volta se ela não estiver visível (e ninguém saiu com o PIN).
 */
class KioskService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var away = 0
    private var wifiLock: WifiManager.WifiLock? = null

    private val check = object : Runnable {
        override fun run() {
            if (Engine.isReady) {
                Engine.ensureRunning()
                val maintenance = System.currentTimeMillis() < Engine.store.maintenanceUntil
                if (MainActivity.visible || maintenance) {
                    away = 0
                } else if (++away >= 2) {
                    Launcher.bringToFront(this@KioskService)
                }
            } else {
                val um = getSystemService(Context.USER_SERVICE) as UserManager
                if (um.isUserUnlocked) Engine.init(this@KioskService)
            }
            handler.postDelayed(this, 3000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(NotificationChannel("quiosque", getString(R.string.notif_channel), NotificationManager.IMPORTANCE_MIN))
                Notification.Builder(this, "quiosque")
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this).setPriority(Notification.PRIORITY_MIN)
            }
            val n = builder
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.notif_text))
                .setOngoing(true)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(1, n)
            }
        } catch (_: Exception) {
            // Android 12+ pode recusar o primeiro plano quando o pedido vem de segundo plano; segue como serviço comum.
        }
        Alarms.scheduleWatchdog(this)
        handler.postDelayed(check, 3000)
        // TV box no Wi-Fi: não deixar o rádio entrar em economia (o canal ao vivo engasga e o sinal de vida atrasa).
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "telas:wifi").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacks(check)
        try { wifiLock?.release() } catch (_: Exception) { }
        super.onDestroy()
    }
}
