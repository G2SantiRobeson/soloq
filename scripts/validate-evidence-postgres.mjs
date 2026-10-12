// Exclusive disposable PostgreSQL. No downloads, env files or remote database configuration.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, "artifacts");
const configs = ["local-progress-postgres.json", "local-concurrency-postgres.json"].map((f) =>
  path.join(artifacts, f),
);
if (process.versions.node !== "24.19.0") throw Error("Use Node 24.19.0 for this validation");
await mkdir(artifacts, { recursive: true });
for (const config of configs) {
  try {
    await access(config);
  } catch {
    continue;
  }
  throw Error("Existing local QA configuration must be reviewed before starting");
}
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    [
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
    ].includes(key.toUpperCase()),
  ),
);
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
const run = (args, cwd = root, childEnv = env, command = process.execPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error(`Validation exited with ${code}`)),
    );
  });
let container, workspace;
const written = [];
const clients = [];
try {
  container = docker(
    "run",
    "--detach",
    "--rm",
    "--pull=never",
    "--name",
    `soloq-evidence-f-${randomUUID()}`,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data:rw",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine",
  );
  if (!/^[a-f0-9]{64}$/.test(container)) throw Error("Unexpected container identity");
  const port = Number(/^127\.0\.0\.1:(\d+)$/.exec(docker("port", container, "5432/tcp"))?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Exclusive loopback binding required");
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw Error("Disposable PostgreSQL did not start");
  const options = {
    host: "127.0.0.1",
    port,
    username: "postgres",
    database: "postgres",
    ssl: false,
    max: 1,
    prepare: false,
  };
  const control = postgres(options);
  clients.push(control);
  for (const name of ["soloq_concurrency_test", "soloq_progress_test"]) {
    await control.unsafe(`create database ${name}`);
    const connections = Array.from({ length: 3 }, () => postgres({ ...options, database: name }));
    clients.push(...connections);
    const sessions = await Promise.all(
      connections.map(
        (sql) => sql`
      select pg_backend_pid() pid, current_database() db, current_user username,
      current_setting('server_version') version,
      (select count(*)::int from pg_tables where schemaname='public') tables`,
      ),
    );
    if (
      new Set(sessions.map((r) => r[0].pid)).size !== 3 ||
      sessions.some((r) => r[0].tables !== 0 || r[0].db !== name || r[0].username !== "postgres")
    )
      throw Error("Empty exclusive database / independent session checks failed");
    console.log("Verified disposable database", {
      host: "127.0.0.1",
      port,
      ...sessions[0][0],
      pids: sessions.map((r) => r[0].pid),
    });
  }
  // Run the actual existing migrator from a new directory with NO env files.
  workspace = await mkdtemp(path.join(artifacts, "f-migrations-"));
  await cp(path.join(root, "drizzle"), path.join(workspace, "drizzle"), { recursive: true });
  for (const name of ["soloq_concurrency_test", "soloq_progress_test"])
    await run(
      [
        "--import",
        pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
        path.join(root, "scripts/migrate.ts"),
      ],
      workspace,
      { ...env, DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/${name}` },
    );
  for (const config of configs) {
    await writeFile(config, JSON.stringify({ port }), { flag: "wx" });
    written.push(config);
  }
  const testEnv = {
    ...env,
    ACHIEVEMENT_LOCAL_PG_URL: `postgres://postgres@127.0.0.1:${port}/postgres`,
  };
  const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
  await run(
    [
      vitest,
      "run",
      "tests/achievements-postgres.test.ts",
      "tests/sync-progress-postgres.test.ts",
      "tests/evidence-concurrency-postgres.test.ts",
      "--maxWorkers=2",
      "--hookTimeout=60000",
    ],
    root,
    testEnv,
  );
  if (!process.argv.includes("--focused")) {
    const npm = async (args, childEnv = env) =>
      process.platform === "win32"
        ? run(
            ["/d", "/s", "/c", `npm ${args.join(" ")}`],
            root,
            childEnv,
            env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
          )
        : run(args, root, childEnv, "npm");
    await npm(["run", "lint"]);
    await npm(["run", "typecheck"]);
    await npm(["run", "test", "--", "--maxWorkers=2", "--hookTimeout=60000"], testEnv);
    await run([path.join(root, "scripts/validate-production-demo.mjs")]);
  }
} finally {
  for (const client of clients) await client.end({ timeout: 3 });
  for (const config of written) await unlink(config);
  if (workspace) {
    const resolved = path.resolve(workspace);
    if (
      path.dirname(resolved) !== path.resolve(artifacts) ||
      !path.basename(resolved).startsWith("f-migrations-")
    )
      throw Error("Unsafe temporary workspace path");
    await rm(resolved, { recursive: true });
  }
  if (container && /^[a-f0-9]{64}$/.test(container)) docker("stop", container);
}
