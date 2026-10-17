import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRMATION = "RESET_DEMO_DATA";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function configuredDeployment() {
  const value = process.env.CONVEX_DEPLOYMENT ?? readDeploymentFromEnvFile();
  const deployment = value.replace(/\s+#.*$/, "").trim();
  const match = /^dev:([^\s:]+)$/.exec(deployment);
  if (!match) throw new Error("Refusing to reset: CONVEX_DEPLOYMENT must point to a dev deployment.");
  return match[1];
}

function readDeploymentFromEnvFile() {
  const envFile = readFileSync(resolve(PROJECT_ROOT, ".env.local"), "utf8");
  const match = /^CONVEX_DEPLOYMENT=(.*)$/m.exec(envFile);
  if (!match) throw new Error("Set CONVEX_DEPLOYMENT in the repo-root .env.local file first.");
  return match[1];
}

function hasResetConfirmation() {
  const confirmIndex = process.argv.indexOf("--confirm");
  return process.argv[confirmIndex + 1] === CONFIRMATION;
}

function runReset(deployment: string) {
  const require = createRequire(import.meta.url);
  const convexPackagePath = require.resolve("convex/package.json");
  const convexCli = resolve(dirname(convexPackagePath), "bin/main.js");
  const result = spawnSync("node", [
    convexCli,
    "run",
    "--deployment",
    deployment,
    "reset:resetDemoData",
    JSON.stringify({ confirmation: CONFIRMATION }),
  ], { cwd: PROJECT_ROOT, stdio: "inherit" });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (!hasResetConfirmation()) {
  console.error(`This permanently removes every Convex app document and stored file from dev. Clerk sign-in users remain.\nRun: bun run reset:demo -- --confirm ${CONFIRMATION}`);
  process.exitCode = 1;
} else {
  try {
    const deployment = configuredDeployment();
    console.log(`Resetting Convex dev deployment ${deployment}. App documents and files will be deleted; Clerk users are untouched. Close demo clients first.`);
    runReset(deployment);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start the demo reset.");
    process.exitCode = 1;
  }
}
