import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura de release: sÃƒÆ’Ã‚Â³ se existir android/keystore.properties (fora do git), com storeFile, storePassword,
// keyAlias e keyPassword (como criar: docs/APP-ANDROID.md). Sem o arquivo, o release sai SEM assinatura; para testar
// numa TV box sem a chave do dono: -Ptelas.assinarComDebug=true (sÃƒÆ’Ã‚Â³ teste: um aparelho com o APK de depuraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o precisa
// desinstalar antes de receber o assinado com a chave do dono).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val assinarComDebug = providers.gradleProperty("telas.assinarComDebug").orNull == "true"

// Servidor padrÃƒÆ’Ã‚Â£o da tela de cadastro e da recuperaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o (Ãƒâ€šÃ‚Â§32). O domÃƒÆ’Ã‚Â­nio de produÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o ainda nÃƒÆ’Ã‚Â£o foi decidido:
// SERVIDOR_A_DEFINIR = sem padrÃƒÆ’Ã‚Â£o (quem instala digita o endereÃƒÆ’Ã‚Â§o). Para fixar: -Ptelas.servidorPadrao=https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦
// ou a linha telas.servidorPadrao=https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ no android/gradle.properties.
val servidorPadrao = providers.gradleProperty("telas.servidorPadrao").orNull ?: "SERVIDOR_A_DEFINIR"

android {
    namespace = "br.com.digitalisp.telas"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "br.com.digitalisp.telas"
        minSdk = 24
        targetSdk = 35
        versionCode = 9
        versionName = "0.3.6"
        buildConfigField("String", "SERVIDOR_PADRAO", "\"" + servidorPadrao.replace("\"", "") + "\"")
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
        // As TV box recebem SEMPRE o build de release (sem "depurÃƒÆ’Ã‚Â¡vel"): o Android compila o app de verdade e as setas,
        // o PIN e o cÃƒÆ’Ã‚Â³digo respondem bem mais rÃƒÆ’Ã‚Â¡pido do que no de depuraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o, que roda sem as otimizaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Âµes.
        // R8 desligado de propÃƒÆ’Ã‚Â³sito: sem aparelho de teste aqui para conferir o encolhimento.
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: (if (assinarComDebug) signingConfigs.getByName("debug") else null)
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
        // commit() ÃƒÆ’Ã‚Â© de propÃƒÆ’Ã‚Â³sito (o que foi gravado tem de valer se o aparelho for desligado em seguida);
        // versÃƒÆ’Ã‚Âµes fixas de propÃƒÆ’Ã‚Â³sito; a tela ÃƒÆ’Ã‚Â© de quiosque (nÃƒÆ’Ã‚Â£o redimensiona); o motor guarda sÃƒÆ’Ã‚Â³ o contexto do app;
        // o app tem um idioma sÃƒÆ’Ã‚Â³ (portuguÃƒÆ’Ã‚Âªs), com os textos no cÃƒÆ’Ã‚Â³digo.
        disable += setOf("ApplySharedPref", "GradleDependency", "NonResizeableActivity", "DiscouragedApi", "StaticFieldLeak", "SetTextI18n")
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("com.google.zxing:core:3.5.3")
    // instala o perfil de compilaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o (src/main/baseline-prof.txt) no aparelho: o Android compila antes o que a tela usa
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")

    testImplementation("junit:junit:4.13.2")
    // org.json de verdade nos testes da JVM (o do android.jar ÃƒÆ’Ã‚Â© sÃƒÆ’Ã‚Â³ casca)
    testImplementation("org.json:json:20240303")
}
