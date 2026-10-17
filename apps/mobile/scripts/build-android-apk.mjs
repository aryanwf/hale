import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
// Direct Gradle builds do not get NODE_ENV from Expo CLI.
process.env.NODE_ENV ??= "development";
if (isWindows) {
  // Android Studio installs these without necessarily adding them to PATH.
  const studioJava = join(process.env.ProgramFiles ?? "C:\\Program Files", "Android", "Android Studio", "jbr");
  if (!process.env.JAVA_HOME && existsSync(join(studioJava, "bin", "java.exe"))) {
    process.env.JAVA_HOME = studioJava;
  }
  const sdk = process.env.ANDROID_SDK_ROOT ?? (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"));
  if (!process.env.ANDROID_HOME && sdk && existsSync(sdk)) {
    process.env.ANDROID_HOME = sdk;
  }
}
const javaRelease = process.env.JAVA_HOME && join(process.env.JAVA_HOME, "release");
if (javaRelease && existsSync(javaRelease)) {
  const javaVersion = Number(readFileSync(javaRelease, "utf8").match(/JAVA_VERSION="(\d+)/)?.[1]);
  // Prefab's JNA loader needs native access on recent Android Studio JDKs.
  // Without this, AGP treats Java 24+ native-access warnings as build errors.
  if (javaVersion >= 24 && !process.env.JAVA_TOOL_OPTIONS?.includes("--enable-native-access=")) {
    process.env.JAVA_TOOL_OPTIONS = `${process.env.JAVA_TOOL_OPTIONS ?? ""} --enable-native-access=ALL-UNNAMED`.trim();
  }
}
const prebuild = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "prebuild", "--platform", "android", "--no-install"], {
  cwd: appDirectory,
  stdio: "inherit",
});
if (prebuild.error) console.error(prebuild.error.message);
if (prebuild.status !== 0) process.exit(prebuild.status ?? 1);

const gradleArguments = [":app:assembleDebug", "-PreactNativeArchitectures=arm64-v8a,x86_64", "--no-daemon"];
const build = spawnSync(isWindows ? "cmd.exe" : "./gradlew", isWindows ? ["/d", "/s", "/c", "gradlew.bat", ...gradleArguments] : gradleArguments, {
  cwd: join(appDirectory, "android"),
  stdio: "inherit",
});
if (build.error) console.error(build.error.message);
if (build.status !== 0) process.exit(build.status ?? 1);

const outputDirectory = join(appDirectory, "build", "android");
mkdirSync(outputDirectory, { recursive: true });
const apk = join(outputDirectory, "Hale-development.apk");
copyFileSync(join(appDirectory, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"), apk);
console.log(`Development APK: ${apk}`);
console.log("Install on Android, then start Metro with bun run dev:mobile or bun run dev:mobile:usb from the repository root. This debug build needs Metro; it is not a standalone release.");
