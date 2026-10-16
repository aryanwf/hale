import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("..", import.meta.url));
const cli = require.resolve("expo/bin/cli");
const config = JSON.parse(execFileSync(process.execPath, [cli, "config", "--type", "introspect", "--json"], { cwd: directory, encoding: "utf8" }));
const native = config._internal.modResults;
const plist = native.ios.infoPlist;
assert(plist.UIBackgroundModes.includes("audio"), "iOS audio background mode is required.");
assert(plist.NSMicrophoneUsageDescription.includes("everyone"), "Explain microphone use and participant consent.");
assert.equal(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false, "Do not enable arbitrary insecure HTTP.");
const manifest = native.android.manifest.manifest;
const permissions = manifest["uses-permission"].map((permission) => permission.$["android:name"]);
for (const name of ["RECORD_AUDIO", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE"]) {
  assert(permissions.includes(`android.permission.${name}`), `Missing Android permission: ${name}`);
}
const application = manifest.application[0];
assert.equal(application.$["android:allowBackup"], "false");
const service = application.service.find((entry) => entry.$["android:name"] === "expo.modules.audio.service.AudioRecordingService");
assert(service, "Android microphone capture needs the native recording service.");
assert.equal(service.$["android:foregroundServiceType"], "microphone");
assert.equal(service.$["android:exported"], "false");
console.log("Native microphone permissions, background modes, service, and transport settings verified.");
