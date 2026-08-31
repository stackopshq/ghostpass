plugins {
    id("org.jetbrains.kotlin.jvm")
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
    named("main") { kotlin.srcDir(File(genere, "kotlin")) }
    named("test") { kotlin.srcDir(rootProject.file("shared-test/kotlin")) }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
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
