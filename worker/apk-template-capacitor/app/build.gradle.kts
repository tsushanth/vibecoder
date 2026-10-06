plugins {
    id("com.android.application")
}

android {
    namespace = "com.vibebuild.export"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vibebuild.export"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        aaptOptions {
            // Same pattern Capacitor's own template uses: keep dot-files out of the packaged assets.
            ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
    }

    signingConfigs {
        create("release") {
            // The release key is NOT in this repository. The build host provides it through APK_KEYSTORE_PATH,
            // APK_KEYSTORE_PASSWORD and (optionally) APK_KEY_ALIAS, exactly like the legacy template. There is no
            // key file fallback here: assembling a release without them fails (see the check below) instead of
            // producing an APK signed with a throwaway key.
            val ksPath = System.getenv("APK_KEYSTORE_PATH")
            val ksPassword = System.getenv("APK_KEYSTORE_PASSWORD")
            if (!ksPath.isNullOrBlank() && !ksPassword.isNullOrBlank()) {
                storeFile = file(ksPath)
                storePassword = ksPassword
                keyAlias = System.getenv("APK_KEY_ALIAS") ?: "vibebuild-export"
                keyPassword = ksPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            isDebuggable = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

gradle.taskGraph.whenReady {
    val releasing = allTasks.any { it.name.contains("Release") && it.project == project }
    if (releasing && (System.getenv("APK_KEYSTORE_PATH").isNullOrBlank() || System.getenv("APK_KEYSTORE_PASSWORD").isNullOrBlank())) {
        throw GradleException("APK_KEYSTORE_PATH and APK_KEYSTORE_PASSWORD must be set to build a release APK")
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-camera"))
    implementation(project(":capacitor-geolocation"))
    implementation(project(":capacitor-haptics"))
    implementation(project(":capacitor-share"))
}
