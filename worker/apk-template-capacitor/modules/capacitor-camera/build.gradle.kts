plugins {
    id("com.android.library")
}

android {
    namespace = "com.capacitorjs.plugins.camera"
    compileSdk = 35
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        // Capacitor 7 declares Java 21; the sources compile fine at 17 (verified by the build), which is the box's JDK.
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = false }
}

dependencies {
    implementation(project(":capacitor-android"))
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
