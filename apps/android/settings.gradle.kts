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

// `noyau`     : les liaisons UniFFI et toute la logique qui n'a besoin d'aucune API
//               Android — adresse du serveur, client HTTP, registres, couleurs, hôtes.
//               Elles y sont compilées **une seule fois**, et les deux autres modules
//               les consomment.
// `app`       : l'APK, ses écrans, son service de remplissage, et son test instrumenté.
// `coeur-hote`: le même noyau et les mêmes tests, exécutés sur la JVM du poste. C'est ce
//               qui permet d'éprouver le contrat sans appareil ni émulateur.
include(":noyau")
include(":app")
include(":coeur-hote")
