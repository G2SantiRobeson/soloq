// Preloaded only by the isolated demo validation process, never by deployments.
const net = require("node:net"); // eslint-disable-line @typescript-eslint/no-require-imports -- Node CommonJS preload
const allowed = new Set(["localhost", "127.0.0.1", "::1", "ddragon.leagueoflegends.com"]);
function reject() {
  console.error("DEMO_FORBIDDEN_NETWORK");
  throw new Error("Demo validation blocked an unexpected network operation.");
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options =
    typeof first === "object" && first !== null
      ? first
      : {
          port: first,
          host: typeof args[1] === "string" ? args[1] : "localhost",
        };
  // Build workers use local IPC pipes, which are not network database connections.
  const ipcPath = typeof first === "string" && !/^\d+$/.test(first);
  if (!options.path && !ipcPath) {
    const host = options.host ?? options.hostname ?? "localhost";
    if (Number(options.port) === 5432 || !allowed.has(host)) reject();
  }
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!allowed.has(url.hostname)) reject();
  return fetch(input, init);
};
