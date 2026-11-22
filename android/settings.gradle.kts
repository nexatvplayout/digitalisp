// NEXA Telas: app nativo (Kotlin) de quiosque para TV box. Dependências só de google() e mavenCentral().
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
    }
}
rootProject.name = "nexa-telas"
include(":app")
