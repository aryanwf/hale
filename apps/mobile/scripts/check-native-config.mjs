import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
assert.equal(require("react-dom/package.json").version, require("react/package.json").version, "Clerk needs React DOM to match the mobile React version, not the web workspace version.");
const directory = fileURLToPath(new URL("..", import.meta.url));
const cli = require.resolve("expo/bin/cli");
const config = JSON.parse(execFileSync(process.execPath, [cli, "config", "--type", "introspect", "--json"], { cwd: directory, encoding: "utf8" }));
assert.deepEqual(config.platforms, ["android"], "The mobile app targets Android only.");
assert.equal(config.android.softwareKeyboardLayoutMode, "resize");
const native = config._internal.modResults;
const manifest = native.android.manifest.manifest;
const permissions = manifest["uses-permission"].map((permission) => permission.$["android:name"]);
for (const name of ["CAMERA", "RECORD_AUDIO", "POST_NOTIFICATIONS", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE"]) {
  assert(permissions.includes(`android.permission.${name}`), `Missing Android permission: ${name}`);
}
const application = manifest.application[0];
assert.equal(application.$["android:allowBackup"], "false");
assert.notEqual(application.$["android:usesCleartextTraffic"], "true", "Only the generated debug manifest may allow HTTP to Metro.");
const activity = application.activity.find((entry) => entry.$["android:name"] === ".MainActivity");
assert.equal(activity?.$["android:windowSoftInputMode"], "adjustResize", "Android should resize the dashboard around the keyboard.");
const service = application.service.find((entry) => entry.$["android:name"] === "expo.modules.audio.service.AudioRecordingService");
assert(service, "Android microphone capture needs the native recording service.");
assert.equal(service.$["android:foregroundServiceType"], "microphone");
assert.equal(service.$["android:exported"], "false");
console.log("Android target, keyboard resizing, camera and microphone permissions, private storage, and foreground service verified.");
