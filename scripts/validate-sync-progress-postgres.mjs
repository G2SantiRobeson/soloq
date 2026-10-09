// Optional local QA: existing Docker image only, no env files, Neon or Riot.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = path.join(root, "artifacts/local-progress-postgres.json");
await mkdir(path.dirname(config), { recursive: true });
let occupied = false;
try {
  await access(config);
  occupied = true;
} catch {
  /* absent */
}
if (occupied) throw new Error("An existing local QA configuration must be reviewed first.");
const name = `soloq-progress-${randomUUID()}`;
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
let container;
let wroteConfig = false;
try {
  container = docker(
    "run",
    "--detach",
    "--rm",
    "--pull=never",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data:rw",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env",
    "POSTGRES_DB=soloq_progress_test",
    "postgres:17-alpine",
  );
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error("Unrecognized temporary container ID");
  const address = docker("port", container, "5432/tcp");
  const port = /^127\.0\.0\.1:(\d+)$/.exec(address)?.[1];
  if (!port) throw new Error("PostgreSQL must bind exclusively to loopback");
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      docker("exec", container, "pg_isready", "-U", "postgres", "-d", "soloq_progress_test");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("Local PostgreSQL did not become ready");
  await writeFile(config, JSON.stringify({ port: Number(port) }), { flag: "wx" });
  wroteConfig = true;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "tests/sync-progress-postgres.test.ts",
      ],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`Local PostgreSQL checks exited with ${code}`);
} finally {
  if (wroteConfig) await unlink(config).catch(() => undefined);
  if (container && /^[a-f0-9]{64}$/.test(container)) docker("stop", container);
}
