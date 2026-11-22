package br.com.nexatv.telas.core

import java.security.MessageDigest
import java.security.SecureRandom

object Hex {
    fun of(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) sb.append(Character.forDigit((b.toInt() shr 4) and 0xF, 16)).append(Character.forDigit(b.toInt() and 0xF, 16))
        return sb.toString()
    }

    fun sha256(bytes: ByteArray): String = of(MessageDigest.getInstance("SHA-256").digest(bytes))
}

/** PIN conferido no aparelho: sha256(salt + pin) em hex, com o salt e o PIN concatenados como texto (UTF-8). */
object Pin {
    fun valid(pin: String): Boolean = pin.length in 4..8 && pin.all { it in '0'..'9' }

    fun hash(salt: String, pin: String): String = Hex.sha256((salt + pin).toByteArray(Charsets.UTF_8))

    fun matches(salt: String, pin: String, expectedHash: String): Boolean {
        if (expectedHash.isEmpty()) return false
        return MessageDigest.isEqual(
            hash(salt, pin).toByteArray(Charsets.US_ASCII),
            expectedHash.trim().lowercase().toByteArray(Charsets.US_ASCII),
        )
    }

    fun newSalt(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.let(Hex::of)
}

/** 5 PINs errados = 15 min bloqueado. O estado é gravado a cada mudança, então vale depois de reiniciar. */
data class LockoutState(val fails: Int = 0, val lockedUntil: Long = 0L)

object Lockout {
    const val MAX_FAILS = 5
    const val DURATION_MS = 15 * 60 * 1000L

    /**
     * Relógio que andou para trás (TV box sem bateria de relógio volta a uma data antiga) deixaria o bloqueio
     * valendo por anos: o que passar de 15 min a partir de agora é encurtado para 15 min.
     */
    fun normalize(s: LockoutState, now: Long): LockoutState =
        if (s.lockedUntil - now > DURATION_MS) s.copy(lockedUntil = now + DURATION_MS) else s

    fun isLocked(s: LockoutState, now: Long): Boolean = now < s.lockedUntil

    fun remainingMs(s: LockoutState, now: Long): Long = (s.lockedUntil - now).coerceAtLeast(0L)

    fun onWrong(s: LockoutState, now: Long): LockoutState {
        if (isLocked(s, now)) return s
        val fails = s.fails + 1
        return if (fails >= MAX_FAILS) LockoutState(0, now + DURATION_MS) else LockoutState(fails, 0L)
    }

    fun onRight(): LockoutState = LockoutState()
}

/**
 * Sequência de teclas do controle que abre o pedido do PIN. Guarda as últimas teclas e compara o final com a
 * sequência; uma pausa longa entre teclas zera.
 */
class ExitSequence(seq: List<String>, private val gapMs: Long = 4000L) {
    val seq: List<String> = normalize(seq)
    private val recent = ArrayDeque<String>()
    private var lastAt = 0L

    fun feed(key: String?, now: Long): Boolean {
        if (key == null) {
            recent.clear()
            return false
        }
        if (recent.isNotEmpty() && now - lastAt > gapMs) recent.clear()
        lastAt = now
        recent.addLast(key)
        while (recent.size > seq.size) recent.removeFirst()
        if (recent.size == seq.size && recent.toList() == seq) {
            recent.clear()
            return true
        }
        return false
    }

    fun reset() = recent.clear()

    companion object {
        val KEYS = setOf("UP", "DOWN", "LEFT", "RIGHT", "OK", "BACK", "MENU", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9")
        const val MIN_LEN = 3
        const val MAX_LEN = 12

        /** Tecla de nome desconhecido, sequência curta demais ou ausente: vale a padrão. */
        fun normalize(raw: List<String>?): List<String> {
            val clean = raw.orEmpty().map { it.trim().uppercase() }.map { if (it == "ENTER" || it == "CENTER" || it == "SELECT") "OK" else it }
            if (clean.any { it !in KEYS }) return ConfigParser.DEFAULT_SEQ
            return if (clean.size in MIN_LEN..MAX_LEN) clean else ConfigParser.DEFAULT_SEQ
        }
    }
}
