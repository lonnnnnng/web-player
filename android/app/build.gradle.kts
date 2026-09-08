plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
  id("com.google.devtools.ksp")
id("com.google.dagger.hilt.android")
  jacoco
}

private val localReleaseSigningDir = rootProject.file("local-signing")
private val localReleaseKeystore = localReleaseSigningDir.resolve("local-audio-release.jks")
private val localReleasePasswordFile = localReleaseSigningDir.resolve("release.pass")
private val localReleasePassword = localReleasePasswordFile.takeIf { it.isFile }?.readText()?.trim()

android {
    namespace = "com.example.localaudio"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.github.lonnnnnng.localaudio"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (localReleaseKeystore.isFile && !localReleasePassword.isNullOrEmpty()) {
                // long: 发布签名只从本机受忽略保护的密钥文件读取，密码不进入源码、日志或 GitHub Release。
                storeFile = localReleaseKeystore
                storePassword = localReleasePassword
                keyAlias = "local-audio-release"
                keyPassword = localReleasePassword
            }
        }
    }

    buildTypes {
        release {
            // long: 正式包移除未使用字节码与资源，降低下载体积并减少可被反编译的实现细节。
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = false
      shaders = false
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.jvmArgs("--add-opens=java.base/java.lang=ALL-UNNAMED", "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED", "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.security=ALL-UNNAMED", "--add-opens=java.base/java.text=ALL-UNNAMED",
                "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
                "--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED")
        }
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation("androidx.compose.material:material-icons-extended:1.7.8")
  implementation("androidx.media3:media3-exoplayer:1.10.1")
  implementation("androidx.media3:media3-session:1.10.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.google.dagger:hilt-android:2.60.1")
  ksp("com.google.dagger:hilt-compiler:2.60.1")
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation("org.json:json:20240303")
  testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
  testImplementation("org.robolectric:robolectric:4.16")
  testImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}
