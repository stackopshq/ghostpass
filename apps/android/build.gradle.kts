plugins {
    id("com.android.application") version "9.1.0" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
    // Le compilateur Compose est un greffon du compilateur Kotlin depuis 2.0 : sa version
    // est celle de Kotlin, et il n'y a plus de table de correspondance à tenir.
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.0" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.0" apply false
}
