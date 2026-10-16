// Local launcher preload only; never included in deployment configuration.
const net = require("node:net"); // eslint-disable-line @typescript-eslint/no-require-imports
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options =
    typeof first === "object" && first !== null
      ? first
      : { port: first, host: typeof args[1] === "string" ? args[1] : "localhost" };
  const ipc = typeof first === "string" && !/^\d+$/.test(first);
  if (
    !options.path &&
    !ipc &&
    (Number(options.port) === 5432 ||
      !loopback.has(options.host ?? options.hostname ?? "localhost"))
  )
    throw new Error("LOCAL_DEMO_NETWORK_BLOCKED");
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!loopback.has(url.hostname) || Number(url.port) === 5432)
    throw new Error("LOCAL_DEMO_NETWORK_BLOCKED");
  return originalFetch(input, init);
};
