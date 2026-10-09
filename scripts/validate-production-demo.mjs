import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const isolated = await mkdtemp(path.join(artifacts, "production-demo-"));
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
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] ?? ""}`;
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});
env.DEMO_MODE = "true";
env.NODE_ENV = "production";
env.APP_URL = `http://127.0.0.1:${port}`;
env.LADDER_SCHEDULER_ENABLED = "false";
env.NEXT_TELEMETRY_DISABLED = "1";
env.NODE_OPTIONS = `--require="${path.join(isolated, "scripts/demo-network-guard.cjs").replaceAll("\\", "/")}"`;
const secrets = [
  "DATABASE_URL",
  "RIOT_API_KEY",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "CRON_SECRET",
];
assert(secrets.every((key) => !(key in env)));
let server;
let logs = "";
function launch(command, args) {
  const child = spawn(command, args, {
    cwd: isolated,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs += data.toString();
      process.stdout.write(data);
    });
  return child;
}
async function npmBuild() {
  const child =
    process.platform === "win32"
      ? launch(env.ComSpec ?? env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "npm run build"])
      : launch("npm", ["run", "build"]);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, "Isolated npm run build failed");
  assert(!logs.includes("DEMO_FORBIDDEN_NETWORK"), "Build attempted a forbidden connection");
}
async function check(route, expected = 200, options = {}) {
  const response = await fetch(`${env.APP_URL}${route}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
    headers: {
      cookie: `__Host-soloq_admin=${"a".repeat(64)}; soloq_admin=${"a".repeat(64)}`,
      ...options.headers,
    },
  });
  const body = await response.text();
  assert(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${route}: unexpected HTTP status ${response.status}`,
  );
  if (Array.isArray(expected))
    assert(body.includes("No encontramos esta página."), `${route}: missing not-found view`);
  if (route.startsWith("/api/")) assert.equal(response.headers.get("cache-control"), "no-store");
  else {
    assert(body.includes("rangos y LP ficticios"), `${route}: missing honest demo banner`);
    assert(body.includes("endorsed by Riot Games"), `${route}: missing disclaimer`);
  }
  assert(!logs.includes("DEMO_FORBIDDEN_NETWORK"), "A forbidden connection was attempted");
  console.log(`demo_route_check ${response.status} ${route}`);
  return body;
}
try {
  // Explicit allowlist: no .env*, credentials, .git, CLAUDE.md or .claude/ are copied.
  for (const name of [
    "src",
    "public",
    "champ_icons",
    "rank_icon",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.mjs",
    "vercel.json",
  ])
    await cp(path.join(root, name), path.join(isolated, name), { recursive: true });
  assert(!(await readdir(isolated)).some((name) => name.startsWith(".env")));
  await symlink(
    path.join(root, "node_modules"),
    path.join(isolated, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  // Turbopack must see the existing dependency junction; this changes only the temporary config.
  const configPath = path.join(isolated, "next.config.ts");
  const config = await readFile(configPath, "utf8");
  await writeFile(
    configPath,
    config.replace(
      "export default config;",
      `config.turbopack = { root: ${JSON.stringify(root)} };\nexport default config;`,
    ),
  );
  console.log(
    "demo_environment_check: isolated copy, no .env files, five secrets absent, network guard active",
  );
  console.log(`demo_runtime_check: ${process.version}`);
  await npmBuild();
  server = launch(process.execPath, [
    path.join(isolated, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Demo server startup timeout")), 30_000);
    const ready = (data) => {
      if (data.toString().includes("Ready")) {
        clearTimeout(deadline);
        resolve();
      }
    };
    server.stdout.on("data", ready);
    server.once("error", reject);
    server.once("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Demo server exited: ${code}`));
    });
  });
  const home = await check("/");
  assert(home.includes("demo-1") && home.includes("Demo Nebula"));
  assert(home.includes("RESULTADOS FICTICIOS") && !home.includes("LP oficiales"));
  for (const queue of ["soloq", "flex", "5v5"]) {
    await check(`/?queue=${queue}`);
    const profile = await check(`/player/demo-1?queue=${queue}`);
    assert(
      profile.includes("Perfil ficticio") || profile.includes("Perfil ficticio".toLowerCase()),
    );
    assert(!profile.includes("contadores ranked son los oficiales de Riot"));
    assert(
      !profile.includes("REGISTROS OFICIALES") && !profile.includes("Cobertura disponible en Riot"),
    );
    for (const period of ["season", "30d", "7d"]) {
      const metrics = await check(`/metrics?queue=${queue}&period=${period}`);
      assert(metrics.includes("Salón de honor") && metrics.includes("Salón de la vergüenza"));
    }
  }
  const admin = await check("/admin");
  assert(admin.includes("modo demo") && admin.includes("disabled"));
  await check("/privacy");
  await check("/terms");
  await check("/does-not-exist", 404);
  // Next.js loading boundaries can send 200 before streaming the not-found view.
  await check("/player/missing", [200, 404]);
  await check("/player/123e4567-e89b-42d3-a456-426614174000", [200, 404]);
  for (const dev of ["admin", "history", "ladder", "emblems"])
    await check(`/dev/${dev}`, [200, 404]);
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  await check("/api/admin/players", 503);
  await check("/api/admin/sync/progress", 503);
  for (const route of [
    "login",
    "logout",
    "players",
    "sync",
    `players/${uuid}/sync`,
    `players/${uuid}/backfill`,
    "players/invalid/sync",
  ]) {
    await check(`/api/admin/${route}`, 503, {
      method: "POST",
      headers: { origin: env.APP_URL, "content-type": "application/json" },
      body: "invalid-json",
    });
  }
  for (const method of ["PATCH", "DELETE"])
    await check(`/api/admin/players/${uuid}`, 503, {
      method,
      headers: { origin: env.APP_URL },
      body: "invalid-json",
    });
  await check("/api/admin/sync", 403, {
    method: "POST",
    headers: { origin: "https://invalid.example" },
  });
  const cron = JSON.parse(await check("/api/cron/sync"));
  assert(cron.skipped && cron.reason === "demo");
  const status = JSON.parse(await check("/api/ladder/sync-status"));
  assert(
    status.status === "never" &&
      !status.schedulerConfigured &&
      status.lastSuccessfulSyncAt === null,
  );
  assert(!logs.includes("DEMO_FORBIDDEN_NETWORK"));
  console.log(
    "PRODUCTION_DEMO_PASS: production build and HTTP smoke checks, no PostgreSQL or authenticated Riot connections",
  );
  if (process.argv.includes("--serve")) {
    console.log(`Demo QA URL: ${env.APP_URL}`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
  // Verify the exact disposable target before recursive cleanup; never remove the dependency junction target.
  assert(
    path.dirname(isolated) === artifacts && path.basename(isolated).startsWith("production-demo-"),
  );
  const dependencyLink = path.join(isolated, "node_modules");
  const link = await lstat(dependencyLink).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (link) {
    assert(
      link.isSymbolicLink(),
      "Expected disposable dependency link, never delete actual node_modules",
    );
    if (process.platform === "win32") await rmdir(dependencyLink);
    else await unlink(dependencyLink);
  }
  await rm(isolated, { recursive: true, force: true });
}
