import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const prebuild = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "prebuild", "--platform", "android", "--no-install"], {
  cwd: appDirectory,
  stdio: "inherit",
});
if (prebuild.error) console.error(prebuild.error.message);
if (prebuild.status !== 0) process.exit(prebuild.status ?? 1);

const gradleArguments = [":app:assembleDebug", "-PreactNativeArchitectures=arm64-v8a,x86_64", "--no-daemon"];
const isWindows = process.platform === "win32";
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
