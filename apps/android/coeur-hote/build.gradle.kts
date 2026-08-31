plugins {
    id("org.jetbrains.kotlin.jvm")
    // Le test de contrat déclare ses propres formes de charge utile : sans ce greffon,
    // `@Serializable` n'engendre rien et les erreurs pointent la ligne d'appel, jamais
    // le greffon manquant.
    id("org.jetbrains.kotlin.plugin.serialization")
}

val genere = rootProject.file("generated")

// Les mêmes liaisons Kotlin que l'APK, compilées pour la JVM du poste. Ce module ne part
// dans aucun paquet : il rend le test de contrat exécutable sans appareil ni émulateur.
//
// Ce qu'il prouve : que le cœur Rust et les liaisons générées s'accordent, et que les
// vecteurs traversent la frontière FFI intacts. Ce qu'il ne prouve pas : l'empaquetage
// des `.so` dans l'APK, ni le chargeur de bibliothèques d'Android. Pour cela il faut
// `:app:connectedAndroidTest`, et donc un appareil.
sourceSets {
    named("test") {
        kotlin.srcDir(rootProject.file("shared-test/kotlin"))
        // Les vecteurs de contrat de la suite, copie vendorée du dépôt `suite`
        // (ADR-0002). Ils sont *lus* par `ContratTest`, pas recopiés dans son source :
        // un client qui garderait ses valeurs en dur à côté resterait vert avec un
        // fichier corrompu, ce qui est exactement la duplication que l'ADR combat.
        resources.srcDir(rootProject.file("../../assets/vecteurs"))
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    // Les liaisons et la logique viennent de `:noyau`, qui les compile pour tout le monde.
    implementation(project(":noyau"))
    // Ici le `.jar` et non l'`@aar` : c'est lui qui porte le `libjnidispatch` de macOS et
    // de Linux. L'inverse de ce que demande Android, pour la même raison.
    implementation("net.java.dev.jna:jna:5.17.0")
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    useJUnit()
    // JNA cherche `libghost_crypto_ffi.dylib` ici. Le répertoire est produit par la
    // dernière étape de tools/android/build-jni.sh.
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
    testLogging {
        events("passed", "failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// La porte en ligne de commande sur les primitives de partage du cœur, pour le témoin
// croisé avec WebCrypto. Voir PartageCroise.kt et tools/android/temoin-du-partage-croise.sh.
//
//   ./gradlew :coeur-hote:partageCroise --args="sceller 'un secret'"
tasks.register<JavaExec>("partageCroise") {
    group = "verification"
    description = "Scelle ou ouvre une enveloppe de partage par le cœur Rust."
    mainClass.set("ch.stackops.ghostpass.PartageCroise")
    classpath = sourceSets["main"].runtimeClasspath
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
}

// Le client de partage, pour le témoin de destination contre un serveur à relais.
// Voir PartageDeBoutEnBout.kt et tools/android/temoin-de-la-destination.sh.
tasks.register<JavaExec>("partageClient") {
    group = "verification"
    description = "Exécute le client de partage d'Android contre un serveur donné."
    mainClass.set("ch.stackops.ghostpass.PartageDeBoutEnBout")
    classpath = sourceSets["main"].runtimeClasspath
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
}

// La rotation de clé d'organisation, provoquée pendant qu'une session est ouverte.
// Voir RotationDeCle.kt et tools/android/temoin-de-la-rotation.sh.
tasks.register<JavaExec>("rotationClient") {
    group = "verification"
    description = "Provoque une rotation d'Org Key et éprouve le refus d'écrire."
    mainClass.set("ch.stackops.ghostpass.RotationDeCle")
    classpath = sourceSets["main"].runtimeClasspath
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
}

// Le client du SSO mobile, pour le témoin de bout en bout contre un vrai serveur.
// Voir SsoDeBoutEnBout.kt et tools/android/temoin-du-sso-mobile.sh.
tasks.register<JavaExec>("ssoClient") {
    group = "verification"
    description = "Exécute le client SSO d'Android contre un serveur donné."
    mainClass.set("ch.stackops.ghostpass.SsoDeBoutEnBout")
    classpath = sourceSets["main"].runtimeClasspath
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
}

// Sème un serveur local pour éprouver l'application à la main. Voir SemerLeServeur.kt.
//
//   ./gradlew :coeur-hote:semerLeServeur -Pserveur=http://127.0.0.1:3111
tasks.register<JavaExec>("semerLeServeur") {
    group = "verification"
    description = "Crée un compte et quelques éléments sur un serveur GhostPass local."
    mainClass.set("ch.stackops.ghostpass.SemerLeServeur")
    classpath = sourceSets["main"].runtimeClasspath
    systemProperty("jna.library.path", File(genere, "jvmLibs").absolutePath)
    for (nom in listOf("serveur", "email", "motdepasse")) {
        if (project.hasProperty(nom)) systemProperty(nom, project.property(nom)!!)
    }
}
