import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { body, HttpError, verifyOrigin } from "@/server/http";
import { secureEqual } from "@/server/auth";
import { POST as login } from "@/app/api/admin/login/route";
import { GET as cron } from "@/app/api/cron/sync/route";
import { GET as listPlayers, POST as addPlayer } from "@/app/api/admin/players/route";
import { PATCH, DELETE } from "@/app/api/admin/players/[id]/route";
import { POST as sync } from "@/app/api/admin/sync/route";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
afterEach(() => vi.unstubAllEnvs());
describe("server-side security boundaries", () => {
  it("compares secrets without revealing length through early return", () => {
    expect(secureEqual("secret", "secret")).toBe(true);
    expect(secureEqual("secret", "short")).toBe(false);
  });
  it("rejects cross-origin and absent Origin on mutations", () => {
    vi.stubEnv("APP_URL", "https://soloq.example");
    expect(() =>
      verifyOrigin(
        new Request("https://soloq.example/api", { headers: { origin: "https://evil.example" } }),
      ),
    ).toThrow(HttpError);
    expect(() => verifyOrigin(new Request("https://soloq.example/api"))).toThrow(HttpError);
    expect(() =>
      verifyOrigin(
        new Request("https://soloq.example/api", { headers: { origin: "https://soloq.example" } }),
      ),
    ).not.toThrow();
  });
  it("bounds and validates incoming JSON", async () => {
    const make = (text: string) =>
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
    await expect(body(make('"' + "a".repeat(9000) + '"'), z.string())).rejects.toMatchObject({
      status: 413,
    });
    await expect(body(make("invalid"), z.string())).rejects.toMatchObject({ status: 400 });
  });
  it("rejects every unauthenticated admin API without querying Riot or the database", async () => {
    vi.stubEnv("APP_URL", "http://localhost");
    const get = new Request("http://localhost/api/admin/players");
    expect((await listPlayers(get)).status).toBe(401);
    for (const handler of [addPlayer, PATCH, DELETE, sync]) {
      const response = await handler(
        new Request("http://localhost/api/admin/players/invalid", {
          method: "POST",
          headers: { origin: "http://localhost" },
        }),
      );
      expect(response.status).toBe(401);
    }
  });
  it("rejects forged cron authentication", async () => {
    vi.stubEnv("CRON_SECRET", "x".repeat(32));
    expect(
      (
        await cron(
          new Request("http://localhost/api/cron/sync", {
            headers: { authorization: "Bearer wrong" },
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("does not allow demo login to bypass real admin authentication", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("APP_URL", "http://localhost");
    const response = await login(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ password: "anything" }),
      }),
    );
    expect(response.status).toBe(503);
  });
});
