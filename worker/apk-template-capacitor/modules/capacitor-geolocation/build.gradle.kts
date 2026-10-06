plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.capacitorjs.plugins.geolocation"
    compileSdk = 35
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        // Capacitor 7 declares Java 21; the sources compile fine at 17 (verified by the build), which is the box's JDK.
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false }
}

dependencies {
    implementation("io.ionic.libs:iongeolocation-android:1.0.0")
    implementation(project(":capacitor-android"))
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.6.4")
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
