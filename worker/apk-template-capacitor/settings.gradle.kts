pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "VibeBuildCapacitorExport"
include(":app")
// Capacitor 7.6.9 Android library and the four plugins, vendored from the npm packages (see README.md in this folder).
include(":capacitor-android", ":capacitor-camera", ":capacitor-geolocation", ":capacitor-haptics", ":capacitor-share")
project(":capacitor-android").projectDir = file("modules/capacitor-android")
project(":capacitor-camera").projectDir = file("modules/capacitor-camera")
project(":capacitor-geolocation").projectDir = file("modules/capacitor-geolocation")
project(":capacitor-haptics").projectDir = file("modules/capacitor-haptics")
project(":capacitor-share").projectDir = file("modules/capacitor-share")
