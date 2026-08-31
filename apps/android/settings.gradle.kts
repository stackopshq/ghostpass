// Projet Gradle minimal : il n'existe que pour faire traverser le cœur Rust jusqu'à
// Kotlin et le prouver. Pas d'écran, pas d'activité — l'application viendra après, sur un
// pont déjà éprouvé.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ghostpass-android"

// `app`       : l'APK et son test instrumenté — ce qui s'exécute sur un appareil.
// `coeur-hote`: les mêmes liaisons et le même test, compilés pour la JVM du poste.
//               C'est ce qui permet d'éprouver la traversée sans appareil ni émulateur.
include(":app")
include(":coeur-hote")
