import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura de release: só se existir android-telas/keystore.properties (fora do git), com
// storeFile, storePassword, keyAlias e keyPassword. Sem o arquivo, o release sai sem assinatura.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "br.com.nexatv.telas"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "br.com.nexatv.telas"
        minSdk = 24
        targetSdk = 35
        versionCode = 25
        versionName = "1.3.1"
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        // 22/11: as TV box recebem o build de release (sem "depurável"): o Android compila o app de verdade e as setas,
        // o PIN e a chave respondem bem mais rápido do que no de depuração, que roda sem as otimizações. Sem o
        // keystore.properties, assina com a mesma chave de depuração das versões já instaladas (senão o Android recusa a
        // atualização por cima). R8 desligado de propósito: sem aparelho de teste aqui para conferir o encolhimento.
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isReturnDefaultValues = true }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
        // commit() é de propósito (o que foi gravado tem de valer se o aparelho for desligado em seguida);
        // versões fixas de propósito; a tela é de quiosque (não redimensiona); o motor guarda só o contexto do app;
        // o app tem um idioma só (português), com os textos no código.
        disable += setOf("ApplySharedPref", "GradleDependency", "NonResizeableActivity", "DiscouragedApi", "StaticFieldLeak", "SetTextI18n")
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("com.google.zxing:core:3.5.3")
    // instala o perfil de compilação (src/main/baseline-prof.txt) no aparelho: o Android compila antes o que a tela usa
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")

    testImplementation("junit:junit:4.13.2")
    // org.json de verdade nos testes da JVM (o do android.jar é só casca)
    testImplementation("org.json:json:20240303")
}
