plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Le noyau partagé : tout ce qui n'a besoin d'aucune API Android.
//
// Il porte deux choses. D'abord les liaisons UniFFI générées — compilées **ici et nulle
// part ailleurs**. Elles l'étaient auparavant dans `:app` et dans `:coeur-hote`, chacun
// ajoutant `generated/kotlin` à ses sources : deux compilations d'un même fichier, donc
// deux copies des mêmes classes sur le chemin de classes dès que les deux modules se
// rencontrent. Ensuite la logique du produit qui ne dépend pas d'Android : l'adresse du
// serveur, le client HTTP, les registres, les couleurs d'équipe, le rapprochement d'hôtes.
//
// L'intérêt n'est pas l'élégance : c'est que ces règles deviennent éprouvables sur la JVM
// du poste, en quelques secondes, sans émulateur. Une règle qu'on ne peut éprouver que sur
// appareil est une règle qu'on n'éprouve pas.
val genere = rootProject.file("generated")

sourceSets {
    named("main") { kotlin.srcDir(File(genere, "kotlin")) }
}

kotlin {
    jvmToolchain(21)
    // Android n'accepte pas du bytecode compilé pour la JVM 21 : `:app` consomme ce
    // module, il doit donc viser la même version que lui (voir `compileOptions` de
    // app/build.gradle.kts). Le *toolchain* reste 21 — c'est le JDK qui compile, pas la
    // cible qu'il produit.
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    // `compileOnly`, et c'est ce qui règle un conflit qui n'a rien d'évident.
    //
    // JNA se publie en deux variantes de la **même** coordonnée : un `.jar` qui porte le
    // `libjnidispatch` de macOS et de Linux, et un `@aar` qui porte celui de chaque ABI
    // Android. Chaque consommateur a besoin de la sienne — et si ce module en imposait une
    // en `api`, elle arriverait chez l'autre en plus de la sienne. Gradle ne les
    // départage pas, puisque le groupe, le nom et la version sont identiques : l'APK
    // recevait les deux et D8 refusait la compilation sur des milliers de classes
    // dupliquées (`Duplicate class com.sun.jna.…`).
    //
    // En `compileOnly`, les liaisons générées compilent contre JNA sans l'entraîner
    // derrière elles ; `:coeur-hote` déclare le `.jar`, `:app` déclare l'`@aar`, et chacun
    // n'en voit qu'une.
    compileOnly("net.java.dev.jna:jna:5.17.0")
    // Le JSON traverse partout ici : réponses du serveur, items déchiffrés par le cœur,
    // registres à nom réservé. `org.json` aurait suffi sur Android mais n'existe pas sur
    // la JVM du poste, et c'est précisément là qu'on veut éprouver ces règles.
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
}
