import java.util.Properties

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

/**
 * La signature de diffusion, lue dans `android/key.properties` — **hors du dépôt**, à côté
 * de la clé elle-même. Voir `key.properties.example`.
 *
 * Sans ce fichier, la variante `release` sort **non signée**, donc ininstallable. C'est le
 * comportement voulu : un paquet signé par la clé de débogage s'installe, se lance, et ne
 * se distingue d'un vrai que par son empreinte. Mieux vaut un artefact qui refuse de
 * s'installer qu'un artefact qui se distribue par erreur.
 *
 * Même motif que `apps/mobile/android/app/build.gradle.kts` de GhostCal : la clé d'envoi y
 * vit chez Clara, et la signature est ce qui lie toutes les mises à jour d'une application
 * à la précédente. Google refuse un dépôt dont l'empreinte de certificat ne correspond pas
 * à celle de la version déjà en ligne.
 */
val proprietesDeLaCle = Properties().apply {
    val fichier = rootProject.file("key.properties")
    if (fichier.exists()) fichier.inputStream().use { load(it) }
}

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
        // **Les mêmes numéros que l'envoi iOS.** `MARKETING_VERSION` y vaut 1.0 et
        // `CURRENT_PROJECT_VERSION` 1 : les deux plateformes sortent la même application au
        // même numéro, ce qui est le seul moyen qu'un rapport de bogue désigne quelque
        // chose. Le `0.1` d'avant datait d'un portage qui n'avait rien à publier.
        //
        // `versionCode` doit monter à **chaque** dépôt sur la Play Console : elle refuse
        // deux fois le même, et c'est lui qui ordonne les mises à jour — pas `versionName`,
        // qui n'est qu'un texte affiché.
        versionCode = 1
        versionName = "1.0"
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

    signingConfigs {
        if (proprietesDeLaCle.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(proprietesDeLaCle.getProperty("storeFile"))
                storePassword = proprietesDeLaCle.getProperty("storePassword")
                keyAlias = proprietesDeLaCle.getProperty("keyAlias")
                keyPassword = proprietesDeLaCle.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // `findByName` et non `getByName` : sans `key.properties`, la configuration
            // n'existe pas et `null` laisse la variante non signée. `getByName` ferait
            // échouer la **configuration** du projet, donc tout — y compris un
            // `assembleDebug` qui n'a aucun besoin de la clé de production.
            signingConfig = signingConfigs.findByName("release")
        }
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
    // `LocalLifecycleOwner`. Celui d'`androidx.compose.ui.platform` existe encore mais
    // est déprécié, et le compilateur nomme lui-même son remplaçant : il a déménagé ici.
    // La dépendance est explicite plutôt que transitive — ce qu'on obtient par ricochet
    // disparaît à la prochaine montée de version de ce qui le tirait.
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Le mot de passe maître et le jeton ne vont pas dans un fichier de préférences en
    // clair. `EncryptedSharedPreferences` s'appuie sur le KeyStore matériel.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // La biométrie : `BiometricPrompt`, et une clé invalidée à l'enrôlement d'une nouvelle
    // empreinte — l'équivalent de `.biometryCurrentSet` d'iOS (§11).
    implementation("androidx.biometric:biometric:1.1.0")

    // ─── Et le `fragment` qu'elle entraîne, remonté de force ───
    //
    // **Sans cette ligne, toute ouverture d'un sélecteur de fichiers fait planter
    // l'application.** `biometric:1.1.0` tire `fragment:1.2.5`, dont la `FragmentActivity`
    // vérifie que tout code de requête tient sur seize bits :
    //
    //     java.lang.IllegalArgumentException: Can only use lower 16 bits for requestCode
    //         at androidx.fragment.app.FragmentActivity.checkForValidRequestCode
    //         at androidx.activity.ComponentActivity$activityResultRegistry$1.onLaunch
    //
    // Or `ActivityResultRegistry` — ce qui est derrière `rememberLauncherForActivityResult`
    // — tire ses codes sur tout l'espace des entiers. Les deux sont incompatibles, et
    // `fragment:1.3.0` a levé la contrainte.
    //
    // Le défaut était **latent** : l'application n'ouvrait aucune activité pour résultat
    // avant l'écran d'import. Il n'a donc rien cassé jusqu'ici, et il aurait frappé le
    // premier écran à en ouvrir une — c'est-à-dire celui-ci, en production comme ici.
    // `ActivitePrincipale` est une `FragmentActivity` parce que `BiometricPrompt` n'accepte
    // rien d'autre : on ne peut pas éviter la classe, seulement la mettre à jour.
    implementation("androidx.fragment:fragment:1.8.5")

    // ─── AppCompat, pour la langue et pour rien d'autre ───
    //
    // Une application entièrement en Compose n'a aucun besoin d'AppCompat, et l'ajouter
    // pour le décor serait du poids. Ici il porte une fonction précise :
    // `AppCompatDelegate.setApplicationLocales` est **le** chemin qui pose la langue de
    // l'application sur tous les niveaux d'API, et le seul qui s'accorde avec le réglage
    // de langue par application qu'Android 13 a ajouté aux paramètres du système.
    //
    // L'alternative — envelopper le contexte dans `attachBaseContext` avec une
    // `Configuration` localisée — ne demande aucune dépendance et fonctionne, mais elle
    // ignore le réglage du système : l'écran « Paramètres › Applications › GhostPass ›
    // Langue » continuerait d'annoncer autre chose que ce que l'application affiche. Deux
    // réponses à la même question, dont une fausse.
    //
    // Conséquence assumée : les activités héritent d'`AppCompatActivity` et le thème de
    // fenêtre descend d'`Theme.AppCompat`. `AppCompatActivity` **est** une
    // `FragmentActivity`, donc `BiometricPrompt` continue de l'accepter.
    implementation("androidx.appcompat:appcompat:1.7.0")

    // ─── La caméra et le décodeur de QR code, pour le second facteur ───
    //
    // Recopier une clé base32 à la main est le moment où l'on se trompe : trente-deux
    // caractères sans séparateur, dans une police où le 0 et le O se ressemblent. Le QR code
    // porte la même clé, **plus** l'émetteur, le nombre de chiffres et la période — que la
    // saisie manuelle laisse forcément aux valeurs par défaut.
    //
    // **ZXing et non ML Kit**, et ce n'est pas une question de poids. `barcode-scanning` de
    // ML Kit est la voie que Google documente, mais sa variante légère télécharge son modèle
    // par les services Play, et la variante groupée les réclame quand même à l'exécution.
    //
    // Or **cette liste de dépendances ne contient aucun service Play**, et c'est une
    // propriété du produit plutôt qu'un hasard : une fiche de magasin qui promet « aucun
    // traceur » ne peut pas faire passer par Google le QR code d'un second facteur. Que
    // `tools/android/verifier-l-autonomie.sh` scanne l'APK livré ne couvre pas ce cas — il
    // y cherche la facturation de Google, pas ses services — donc rien d'automatique ne
    // rattraperait l'erreur : la raison est ici, et nulle part ailleurs.
    //
    // `zxing:core` est du Java pur, hors ligne, sans service ni réseau : il reçoit un tableau
    // de luminance et rend une chaîne. CameraX ne fournit que les images.
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.zxing:core:3.5.3")

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
