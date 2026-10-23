plugins { id("com.android.application"); id("org.jetbrains.kotlin.plugin.compose") }
android {
    namespace = "com.m1racle.note"
    compileSdk = 37
    buildToolsVersion = "36.0.0"
    defaultConfig { applicationId = "com.m1racle.note"; minSdk = 26; targetSdk = 35; versionCode = 15; versionName = "0.0.15" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("main").kotlin.directories.add(rootProject.file("../design-system/platform/android").path)
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.05.00"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.github.kyant0:backdrop:2.0.0")
    testImplementation("junit:junit:4.13.2")
}
val bundleEditor = tasks.register<Exec>("bundleEditor") {
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "mobile/scripts/build.mjs")
    inputs.dir(rootProject.file("editor/src"))
    inputs.dir(rootProject.file("../editor/src"))
    inputs.file(rootProject.file("../editor/preview-build.mjs"))
    inputs.file(rootProject.file("../design-system/platform/web/m1racle-tokens.css"))
    inputs.file(rootProject.file("editor/index.html"))
    inputs.file(rootProject.file("editor/vite.config.ts"))
    inputs.file(rootProject.file("editor/task-controls.mjs"))
    inputs.file(rootProject.file("tsconfig.json"))
    inputs.file(rootProject.file("../package-lock.json"))
    inputs.file(rootProject.file("scripts/build.mjs"))
    inputs.file(rootProject.file("scripts/bundle.mjs"))
    inputs.file(rootProject.file("../THIRD_PARTY_NOTICES.md"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/editor"))
}
tasks.named("preBuild").configure { dependsOn(bundleEditor) }

