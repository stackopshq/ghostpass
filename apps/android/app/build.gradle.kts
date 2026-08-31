// AGP 9 embarque le support Kotlin : appliquer `org.jetbrains.kotlin.android` en plus
// est désormais une erreur de configuration, pas une redondance inoffensive.
plugins {
    id("com.android.application")
    // AGP 9 embarque Kotlin, mais pas ses greffons : Compose et la sérialisation se
    // déclarent explicitement.
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// L'APK : les écrans, le service de remplissage, et le test instrumenté. Les liaisons du
// cœur ne sont plus compilées ici — elles viennent de `:noyau`, qui les compile une fois
// pour tout le monde. Seuls les `.so` restent à empaqueter, et ils sont produits par
// tools/android/build-jni.sh, jamais écrits à la main.
val genere = rootProject.file("generated")

android {
    namespace = "ch.stackops.ghostpass"
    compileSdk = 36

    defaultConfig {
        applicationId = "ch.stackops.ghostpass"
        // `minSdk` doit rester d'accord avec l'API que build-jni.sh donne au compilateur
        // du NDK (`API=24`). Le relever ici sans le relever là-bas lierait le cœur contre
        // une libc plus ancienne que celle qu'on déclare accepter.
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Les témoins qu'un script pilote sont exclus de l'exécution ordinaire : lancés
        // d'affilée, ils seraient rouges pour une raison qui n'est pas le produit. Voir
        // `TemoinPilote` et `tools/android/temoin-de-l-invalidation.sh`.
        testInstrumentationRunnerArguments["notAnnotation"] = "ch.stackops.ghostpass.TemoinPilote"

        // Les trois ABI que build-jni.sh produit, et pas une de plus. JNA, elle, embarque
        // aussi `x86`, `armeabi` et `mips` : sans ce filtre, un appareil dont l'ABI
        // primaire est l'une de celles-là installerait l'application, chargerait JNA, puis
        // ne trouverait pas le cœur — un plantage à l'exécution au lieu d'un refus
        // d'installation.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDir(File(genere, "jniLibs"))
        }
        // Le test de contrat est partagé mot pour mot avec `:coeur-hote`. Un fichier, deux
        // exécutions : sur appareil et sur le poste. S'il en existait deux copies, l'une
        // dériverait.
        getByName("androidTest") {
            kotlin.srcDir(rootProject.file("shared-test/kotlin"))
            // Les mêmes vecteurs que sur le poste, empaquetés dans l'APK de test : le
            // test instrumenté doit lire le fichier, pas une transcription.
            resources.srcDir(rootProject.file("../../assets/vecteurs"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // Le noyau : les liaisons UniFFI et toute la logique éprouvée sur le poste.
    implementation(project(":noyau"))

    // Les liaisons UniFFI passent par JNA. Sur Android il faut la variante `@aar` : elle
    // seule embarque le `libjnidispatch.so` de chaque ABI. Le simple `.jar` compile mais
    // échoue à l'exécution, faute de ce natif. `:noyau` en dépend en `.jar` pour la JVM du
    // poste ; ici on impose l'`@aar`, et c'est la même bibliothèque.
    implementation("net.java.dev.jna:jna:5.17.0@aar")

    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Le mot de passe maître et le jeton ne vont pas dans un fichier de préférences en
    // clair. `EncryptedSharedPreferences` s'appuie sur le KeyStore matériel.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // La biométrie : `BiometricPrompt`, et une clé invalidée à l'enrôlement d'une nouvelle
    // empreinte — l'équivalent de `.biometryCurrentSet` d'iOS (§11).
    implementation("androidx.biometric:biometric:1.1.0")

    // Les onglets personnalisés, pour le SSO. **Jamais une WebView** : elle donnerait à
    // l'application l'accès au mot de passe saisi chez le fournisseur d'identité, ce qui
    // annule l'intérêt du SSO (§8). Voir OngletSecurise.
    implementation("androidx.browser:browser:1.8.0")

    androidTestImplementation("androidx.test:runner:1.6.2")
    // UiAutomator pilote l'application **du dehors**, comme le ferait un utilisateur, et
    // traverse les frontières d'applications — ce qu'exige le parcours de bout en bout :
    // la suggestion de remplissage est une fenêtre du système, pas de GhostPass.
    //
    // Il remplace `adb shell input text`, qui s'est révélé inutilisable pour ce parcours :
    // sur un champ Compose et un émulateur ARM, il perd ou double des caractères sans
    // le dire. Un parcours dont la saisie est aléatoire ne mesure pas le produit.
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("junit:junit:4.13.2")
}
