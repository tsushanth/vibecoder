plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vibebuild.export"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vibebuild.export"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            // The release key is NOT in this repository. The build host provides it through APK_KEYSTORE_PATH,
            // APK_KEYSTORE_PASSWORD and (optionally) APK_KEY_ALIAS. Without them the build falls back to the legacy
            // key file that older hosts still carry next to this file, so builds keep working during the switch.
            val ksPath = System.getenv("APK_KEYSTORE_PATH")
            val ksPassword = System.getenv("APK_KEYSTORE_PASSWORD")
            if (!ksPath.isNullOrBlank() && !ksPassword.isNullOrBlank()) {
                storeFile = file(ksPath)
                storePassword = ksPassword
                keyAlias = System.getenv("APK_KEY_ALIAS") ?: "vibebuild-export"
                keyPassword = ksPassword
            } else {
                storeFile = file("debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.webkit:webkit:1.9.0")
}
