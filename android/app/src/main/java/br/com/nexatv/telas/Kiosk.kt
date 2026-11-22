package br.com.nexatv.telas

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.pm.PackageManager
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings

/** Administrador do aparelho. Vira Device Owner com: adb shell dpm set-device-owner br.com.nexatv.telas/.AdminReceiver */
class AdminReceiver : DeviceAdminReceiver()

/**
 * Travas do quiosque.
 * Nível 1 (só o APK): tela inicial + tela cheia + volta sozinho ao ligar + serviço que traz o app de volta.
 * Nível 2 (Device Owner): tudo do nível 1 mais as travas de verdade do Android (lock task, restrições).
 */
object Kiosk {
    private val RESTRICTIONS = listOf(
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
    )

    private fun admin(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)
    private fun dpm(ctx: Context) = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isOwner(ctx: Context): Boolean = try {
        dpm(ctx).isDeviceOwnerApp(ctx.packageName)
    } catch (_: Exception) {
        false
    }

    fun level(ctx: Context): Int = if (isOwner(ctx)) 2 else 1

    /** O serviço consegue abrir o app por cima de outro? (No Android 10+ só com Device Owner ou "sobrepor a outros apps".) */
    fun canBringToFront(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || isOwner(ctx) || Settings.canDrawOverlays(ctx)

    const val ACTION_REQUEST_ROLE = "android.app.role.action.REQUEST_ROLE"

    /**
     * O app é a tela inicial (Home) do aparelho? É isso que faz ele abrir sozinho ao ligar no Android 10+ sem Device
     * Owner: o sistema abre a tela inicial no boot, e nenhuma permissão substitui essa escolha.
     */
    fun isHome(ctx: Context): Boolean {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val rm = ctx.getSystemService(RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) return rm.isRoleHeld(RoleManager.ROLE_HOME)
            }
        } catch (_: Exception) {
        }
        return homePackage(ctx) == ctx.packageName
    }

    /** O pacote da tela inicial em uso ("android" = ainda sem escolha: o Android pergunta ao apertar Home). */
    fun homePackage(ctx: Context): String? = try {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        ctx.packageManager.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
    } catch (_: Exception) {
        null
    }

    /** Android 10+: a pergunta do sistema "usar o NEXA Telas como tela inicial?". Null se o aparelho não tem. */
    fun homeRoleIntent(ctx: Context): Intent? = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) null
        else ctx.getSystemService(RoleManager::class.java)
            ?.takeIf { it.isRoleAvailable(RoleManager.ROLE_HOME) && !it.isRoleHeld(RoleManager.ROLE_HOME) }
            ?.createRequestRoleIntent(RoleManager.ROLE_HOME)
    } catch (_: Exception) {
        null
    }

    fun batteryIgnored(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)
    } catch (_: Exception) {
        false
    }

    /** O aparelho tem bateria? TV box não tem (EXTRA_PRESENT falso): ligada na tomada, o Doze nunca entra. Sem a informação: sim. */
    fun hasBattery(ctx: Context): Boolean = try {
        ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?.getBooleanExtra(android.os.BatteryManager.EXTRA_PRESENT, true) ?: true
    } catch (_: Exception) {
        true
    }

    /** O Android do aparelho tem alguma tela para tirar o app da economia de bateria? (muitas TV box não têm) */
    fun batteryScreenExists(ctx: Context): Boolean = batteryIntents(ctx).any { it.resolveActivity(ctx.packageManager) != null }

    fun batteryIntents(ctx: Context): List<Intent> = listOf(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:${ctx.packageName}")),
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
    )

    /**
     * O passo "Sem economia de bateria" está resolvido: o app está isento, ou o aparelho não tem bateria (a economia não age
     * na tomada), ou não existe a tela para isentar (19/11: no BTV B13 o botão não fazia nada).
     */
    fun batteryExempt(ctx: Context): Boolean = batteryIgnored(ctx) || !hasBattery(ctx) || !batteryScreenExists(ctx)

    fun batteryStatus(ctx: Context): String = when {
        batteryIgnored(ctx) -> "app isento"
        !hasBattery(ctx) -> "não se aplica (aparelho sem bateria, sempre na tomada)"
        !batteryScreenExists(ctx) -> "não se aplica (o Android deste aparelho não tem essa tela)"
        else -> "app NÃO isento"
    }

    /** O Android deixa este app instalar a própria atualização sem perguntar pelas "fontes desconhecidas"? */
    fun canInstall(ctx: Context): Boolean = try {
        isOwner(ctx) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()
    } catch (_: Exception) {
        false
    }

    fun notificationsOn(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    } catch (_: Exception) {
        false
    }

    /** Aplica as travas do nível 2. Devolve a lista do que o aparelho recusou (vazia = tudo certo). */
    fun apply(ctx: Context): List<String> {
        if (!isOwner(ctx)) return emptyList()
        val d = dpm(ctx)
        val a = admin(ctx)
        val failed = ArrayList<String>()
        fun step(name: String, block: () -> Unit) {
            try { block() } catch (e: Exception) { failed.add(name) }
        }
        step("lock task") { d.setLockTaskPackages(a, arrayOf(ctx.packageName)) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            step("recursos do lock task") { d.setLockTaskFeatures(a, DevicePolicyManager.LOCK_TASK_FEATURE_NONE) }
        }
        step("barra de status") { d.setStatusBarDisabled(a, true) }
        step("tela de bloqueio") { d.setKeyguardDisabled(a, true) }
        step("tela inicial fixa") {
            val f = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            d.addPersistentPreferredActivity(a, f, ComponentName(ctx, MainActivity::class.java))
        }
        for (r in RESTRICTIONS) step(r) { d.addUserRestriction(a, r) }
        step("tela sempre ligada") { d.setGlobalSetting(a, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7") }
        return failed
    }

    fun enterLockTask(activity: Activity) {
        if (!isOwner(activity)) return
        try {
            val d = dpm(activity)
            // a saída com o PIN tira o app da lista; aqui ele volta
            if (!d.isLockTaskPermitted(activity.packageName)) d.setLockTaskPackages(admin(activity), arrayOf(activity.packageName))
            activity.startLockTask()
        } catch (_: Exception) {
        }
    }

    /** Saída autorizada pelo PIN. Tirar o app da lista do lock task encerra a trava mesmo se o stopLockTask for recusado. */
    fun leaveLockTask(activity: Activity) {
        try { activity.stopLockTask() } catch (_: Exception) { }
        if (isOwner(activity)) try { dpm(activity).setLockTaskPackages(admin(activity), arrayOf()) } catch (_: Exception) { }
    }

    /** Reinicia o aparelho (só Device Owner). Devolve null se o pedido foi aceito, ou o motivo da recusa. */
    fun reboot(ctx: Context): String? {
        if (!isOwner(ctx)) return "O app não é o administrador do aparelho (Device Owner); reiniciar de longe não é possível."
        return try {
            dpm(ctx).reboot(admin(ctx))
            null
        } catch (e: Exception) {
            "O aparelho recusou reiniciar: ${e.javaClass.simpleName}"
        }
    }

    /** Espera (tela apagada). Em TV box com HDMI-CEC ligado nas configurações, o Android avisa a TV. Só Device Owner. */
    fun standby(ctx: Context): Boolean {
        if (!isOwner(ctx)) return false
        return try {
            dpm(ctx).lockNow()
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Desfaz o nível 2: solta as restrições e deixa de ser Device Owner (para testes e para devolver o aparelho). */
    fun release(ctx: Context): Boolean {
        if (!isOwner(ctx)) return false
        val d = dpm(ctx)
        val a = admin(ctx)
        for (r in RESTRICTIONS) try { d.clearUserRestriction(a, r) } catch (_: Exception) { }
        try { d.clearPackagePersistentPreferredActivities(a, ctx.packageName) } catch (_: Exception) { }
        try { d.setStatusBarDisabled(a, false) } catch (_: Exception) { }
        try { d.setKeyguardDisabled(a, false) } catch (_: Exception) { }
        try { d.setLockTaskPackages(a, arrayOf()) } catch (_: Exception) { }
        return try {
            @Suppress("DEPRECATION")
            d.clearDeviceOwnerApp(ctx.packageName)
            true
        } catch (_: Exception) {
            false
        }
    }
}

/** Abrir o app e o serviço a partir de segundo plano, do jeito que o Android deixar. */
object Launcher {
    fun bringToFront(ctx: Context) {
        try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            // Android 10+ sem Device Owner nem "sobrepor a outros apps": o sistema recusa; o Home ainda volta ao app.
        }
    }

    fun startService(ctx: Context) {
        try {
            val i = Intent(ctx, KioskService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        } catch (_: Exception) {
            // Android 12+ pode recusar serviço em primeiro plano vindo de segundo plano; a tela, ao abrir, liga o serviço.
        }
    }
}

object Alarms {
    const val ACTION_WATCHDOG = "br.com.nexatv.telas.WATCHDOG"
    const val ACTION_RESTART = "br.com.nexatv.telas.RESTART"
    const val ACTION_WAKE = "br.com.nexatv.telas.WAKE"
    private const val WATCHDOG_MS = 5 * 60 * 1000L

    private fun pending(ctx: Context, action: String, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, AlarmReceiver::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun am(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /** Alarme periódico: se o app não estiver na tela, reabre. */
    fun scheduleWatchdog(ctx: Context) {
        try {
            am(ctx).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + WATCHDOG_MS, pending(ctx, ACTION_WATCHDOG, 1))
        } catch (_: Exception) {
        }
    }

    /** Reabrir o app daqui a pouco (depois de uma queda ou de "reiniciar o app"). */
    fun scheduleRestart(ctx: Context, delayMs: Long) {
        try {
            am(ctx).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, pending(ctx, ACTION_RESTART, 2))
        } catch (_: Exception) {
        }
    }

    /** Acordar o aparelho na hora de ligar (só usado com a espera fora do horário). */
    fun scheduleWake(ctx: Context, delayMs: Long) {
        try {
            am(ctx).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, pending(ctx, ACTION_WAKE, 3))
        } catch (_: Exception) {
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Alarms.ACTION_WAKE) {
            try {
                val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
                @Suppress("DEPRECATION")
                pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                    "nexatelas:acordar",
                ).acquire(10_000L)
            } catch (_: Exception) {
            }
        }
        Alarms.scheduleWatchdog(app)
        Launcher.startService(app)
        val maintenance = System.currentTimeMillis() < Store(app).maintenanceUntil
        if (!MainActivity.visible && (!maintenance || intent.action == Alarms.ACTION_RESTART)) Launcher.bringToFront(app)
    }
}

/** Liga junto com o aparelho e volta depois de o app ser atualizado. */
class BootReceiver : BroadcastReceiver() {
    private companion object {
        val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action !in ACTIONS) return
        // Antes do primeiro desbloqueio os dados do app ainda estão fechados; o BOOT_COMPLETED vem logo depois.
        val um = app.getSystemService(Context.USER_SERVICE) as UserManager
        if (!um.isUserUnlocked) return
        Alarms.scheduleWatchdog(app)
        Launcher.startService(app)
        Launcher.bringToFront(app)
    }
}
