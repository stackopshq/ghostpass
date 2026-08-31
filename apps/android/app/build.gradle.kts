// AGP 9 embarque le support Kotlin : appliquer `org.jetbrains.kotlin.android` en plus
// est désormais une erreur de configuration, pas une redondance inoffensive.
plugins {
    id("com.android.application")
}

// Ni source d'application, ni ressource : ce module n'existe que pour empaqueter le cœur
// et son test. Les deux répertoires qu'il consomme sont produits par
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
            kotlin.srcDir(File(genere, "kotlin"))
        }
        // Le test de contrat est partagé mot pour mot avec `:coeur-hote`. Un fichier, deux
        // exécutions : sur appareil et sur le poste. S'il en existait deux copies, l'une
        // dériverait.
        getByName("androidTest") {
            kotlin.srcDir(rootProject.file("shared-test/kotlin"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Les liaisons UniFFI passent par JNA. Sur Android il faut la variante `@aar` : elle
    // seule embarque le `libjnidispatch.so` de chaque ABI. Le simple `.jar` compile mais
    // échoue à l'exécution, faute de ce natif.
    implementation("net.java.dev.jna:jna:5.17.0@aar")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("junit:junit:4.13.2")
}
