import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura de release: só se existir apps-celular/instalador/keystore.properties (fora do git) com storeFile,
// storePassword, keyAlias e keyPassword. Sem o arquivo, o release sai SEM assinatura (app-release-unsigned.apk).
// Como o dono cria a chave: ver LEIAME.md.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "br.com.digitalisp.instalador"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "br.com.digitalisp.instalador"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
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
        release {
            // R8 desligado: mantém as bibliotecas inteiras e separáveis no APK (LGPL do spake2-java, ver PESQUISA.md).
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isReturnDefaultValues = true }

    packaging {
        resources.excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/DEPENDENCIES")
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
        // um idioma só (português), textos no código; versões fixas de propósito.
        disable += setOf("SetTextI18n", "GradleDependency", "HardcodedText")
    }
}

dependencies {
    // ADB (TCP 5555 e pareamento do Android 11+). Licença escolhida: Apache-2.0 (dupla com GPL-3.0). Ver PESQUISA.md.
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    // TLS 1.3 com exportKeyingMaterial, usado no pareamento e na conexão TLS.
    implementation("org.conscrypt:conscrypt-android:2.5.3")
    // Gera o certificado autoassinado da chave ADB do celular.
    implementation("org.bouncycastle:bcprov-jdk15to18:1.81")
    implementation("org.bouncycastle:bcpkix-jdk15to18:1.81")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
