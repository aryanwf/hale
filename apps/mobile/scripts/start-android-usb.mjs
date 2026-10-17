import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const windowsAdb = process.env.HALE_WINDOWS_ADB;
if (windowsAdb) {
  const serverPort = "5038";
  const server = spawnSync(windowsAdb, ["-P", serverPort, "start-server"], { stdio: "inherit" });
  if (server.error || server.status !== 0) {
    console.error("Could not start the Windows ADB bridge. Check HALE_WINDOWS_ADB points to Windows platform-tools/adb.exe.");
    process.exit(1);
  }
  process.env.ADB_SERVER_SOCKET = `tcp:127.0.0.1:${serverPort}`;
}
const sdkDirectory = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adbExecutable = process.platform === "win32" ? "adb.exe" : "adb";
const sdkAdb = sdkDirectory && join(sdkDirectory, "platform-tools", adbExecutable);
const adb = sdkAdb && existsSync(sdkAdb) ? sdkAdb : adbExecutable;

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

async function findMetroPort() {
  const preferredPort = process.env.RCT_METRO_PORT ? Number(process.env.RCT_METRO_PORT) : 8081;
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    throw new Error(`Invalid RCT_METRO_PORT: ${process.env.RCT_METRO_PORT}`);
  }

  const lastPort = Math.min(preferredPort + 100, 65535);
  for (let port = preferredPort; port <= lastPort; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available Metro port found between ${preferredPort} and ${lastPort}.`);
}

const metroPort = await findMetroPort();
console.log(`Forwarding Android USB to Metro on port ${metroPort}.`);
const reverse = spawnSync(adb, ["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`], { stdio: "inherit" });

if (reverse.error || reverse.status !== 0) {
  console.error("Connect one Android device with USB debugging enabled and approve its authorization prompt. Install Android SDK Platform-Tools and set ANDROID_HOME. For multiple devices, set ANDROID_SERIAL to the device shown by adb devices.");
  process.exit(1);
}

// ADB reverse connects to IPv4 loopback; Windows may resolve localhost to ::1.
const metro = spawnSync(process.execPath, ["--dns-result-order=ipv4first", require.resolve("expo/bin/cli"), "start", "--dev-client", "--localhost", "--port", String(metroPort), "--android"], {
  cwd: appDirectory,
  stdio: "inherit",
});
if (metro.error) console.error(metro.error.message);
process.exit(metro.status ?? 1);
