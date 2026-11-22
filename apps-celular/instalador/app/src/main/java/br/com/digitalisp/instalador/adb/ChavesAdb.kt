package br.com.digitalisp.instalador.adb

import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date

/**
 * A chave RSA com que o celular se apresenta às TVs. É criada uma vez e guardada na pasta privada do app: assim a TV
 * que já aceitou ("Sempre permitir") ou já pareou este celular entra direto nas próximas vezes.
 * A chave nunca sai do celular e não vai para o repositório.
 */
class ChavesAdb(private val pasta: File) {
    private val arquivoChave = File(pasta, "adb_chave.pk8")
    private val arquivoCert = File(pasta, "adb_cert.der")

    @Volatile private var cache: Pair<PrivateKey, Certificate>? = null

    @Synchronized
    fun obter(): Pair<PrivateKey, Certificate> {
        cache?.let { return it }
        val par = carregar() ?: gerar()
        cache = par
        return par
    }

    private fun carregar(): Pair<PrivateKey, Certificate>? = runCatching {
        if (!arquivoChave.isFile || !arquivoCert.isFile) return null
        val chave = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(arquivoChave.readBytes()))
        val cert = arquivoCert.inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
        chave to cert
    }.getOrNull()

    private fun gerar(): Pair<PrivateKey, Certificate> {
        val gerador = KeyPairGenerator.getInstance("RSA")
        gerador.initialize(2048)
        val par = gerador.generateKeyPair()
        val nome = X500Name("CN=DIGITAL ISP Instalador")
        val agora = System.currentTimeMillis()
        val construtor = JcaX509v3CertificateBuilder(
            nome,
            BigInteger.valueOf(agora),
            Date(agora - 24L * 3600 * 1000),
            Date(agora + 30L * 365 * 24 * 3600 * 1000),
            nome,
            par.public,
        )
        val assinador = JcaContentSignerBuilder("SHA256withRSA").build(par.private)
        val cert = JcaX509CertificateConverter().getCertificate(construtor.build(assinador))
        pasta.mkdirs()
        gravarAtomico(arquivoChave, par.private.encoded)
        gravarAtomico(arquivoCert, cert.encoded)
        return par.private to cert
    }

    private fun gravarAtomico(destino: File, bytes: ByteArray) {
        val tmp = File(destino.parentFile, destino.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(destino)) {
            destino.delete()
            if (!tmp.renameTo(destino)) throw IllegalStateException("não gravou ${destino.name}")
        }
    }
}
