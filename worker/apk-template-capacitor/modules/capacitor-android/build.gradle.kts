plugins {
    id("com.android.library")
}

android {
    namespace = "com.getcapacitor.android"
    compileSdk = 35
    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }
    compileOptions {
        // Capacitor 7 declares Java 21; the sources compile fine at 17 (verified by the build), which is the box's JDK.
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = false }
}

dependencies {
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.9.25"))
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.activity:activity:1.9.2")
    implementation("androidx.fragment:fragment:1.8.4")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.apache.cordova:framework:10.1.1")
}
