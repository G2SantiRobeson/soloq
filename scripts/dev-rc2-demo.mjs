// Process-only Demo launcher. It never reads .env files or starts database scripts.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (readdirSync(root).some((name) => name.startsWith(".env") && name !== ".env.example"))
  throw new Error("Demo launcher requires a worktree without environment files.");
const keep = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]);
for (const key of Object.keys(process.env))
  if (!keep.has(key.toUpperCase())) delete process.env[key];
Object.assign(process.env, {
  DEMO_MODE: "true",
  NODE_ENV: "development",
  LADDER_SCHEDULER_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  APP_URL: "http://127.0.0.1:3003",
});
const guard = path.join(root, "scripts/achievements-demo-network-guard.cjs");
process.env.NODE_OPTIONS = '--require="' + guard.replaceAll("\\", "/") + '"';
createRequire(import.meta.url)(guard);
process.chdir(root);
const cli = path.join(root, "node_modules/next/dist/bin/next");
process.argv = [process.execPath, cli, "dev", "--hostname", "127.0.0.1", "--port", "3003"];
await import(pathToFileURL(cli).href);
