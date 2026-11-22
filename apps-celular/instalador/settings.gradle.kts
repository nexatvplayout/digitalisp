// DIGITAL ISP — Instalador pelo celular (app do técnico da revenda; não é o app white-label da TV).
pluginManagement {
    repositories {
        google()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Só a libadb-android e o spake2-java vêm do JitPack; nada mais é aceito de lá.
        maven("https://jitpack.io") {
            content { includeGroupByRegex("""com\.github\.MuntashirAkon.*""") }
        }
    }
}
rootProject.name = "digitalisp-instalador"
include(":app")
