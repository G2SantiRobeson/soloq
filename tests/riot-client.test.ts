import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RiotClient, RiotError, retryAfterMs, SyncDeadline } from "@/server/riot/client";
afterEach(() => vi.unstubAllEnvs());
function setup(responses: Response[]) {
  vi.stubEnv("RIOT_API_KEY", "test-only-not-a-real-key");
  let now = 0;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  const fetcher = vi.fn<typeof fetch>(
    async () => responses.shift() ?? new Response("", { status: 500 }),
  );
  const client = new RiotClient(120000, { fetcher, sleep, now: () => now, interval: 1300 });
  return { client, fetcher, sleep };
}
describe("Riot retry and routing", () => {
  it("honors Retry-After then succeeds without exposing key in URL", async () => {
    const { client, fetcher, sleep } = setup([
      new Response("", { status: 429, headers: { "Retry-After": "3" } }),
      Response.json({ ok: true }),
    ]);
    await expect(client.request("la2", "/test", z.object({ ok: z.boolean() }))).resolves.toEqual({
      ok: true,
    });
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetcher.mock.calls[0][0]).toBe("https://la2.api.riotgames.com/test");
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      "X-Riot-Token": "test-only-not-a-real-key",
    });
  });
  it("bounds retries and does not retry authentication failures", async () => {
    const transient = setup([
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
    ]);
    await expect(transient.client.request("la2", "/test", z.unknown())).rejects.toBeInstanceOf(
      RiotError,
    );
    expect(transient.fetcher).toHaveBeenCalledTimes(3);
    const denied = setup([new Response("", { status: 403 })]);
    await expect(denied.client.request("la2", "/test", z.unknown())).rejects.toMatchObject({
      status: 403,
    });
    expect(denied.fetcher).toHaveBeenCalledTimes(1);
  });
  it("defers long rate limits instead of retrying before Retry-After", async () => {
    const { client, fetcher } = setup([
      new Response("", { status: 429, headers: { "Retry-After": "300" } }),
    ]);
    await expect(client.request("la2", "/test", z.unknown())).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 300000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("validates upstream response schemas and request deadline", async () => {
    const { client } = setup([Response.json({ bad: true })]);
    await expect(
      client.request("la2", "/test", z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ status: 502 });
    const expired = new RiotClient(0);
    await expect(expired.request("la2", "/test", z.unknown())).rejects.toBeInstanceOf(SyncDeadline);
  });
  it("encodes Riot IDs and uses PUUID league endpoint on platform routing", async () => {
    const { client, fetcher } = setup([
      Response.json({ puuid: "p", gameName: "A B", tagLine: "LAS" }),
      Response.json([]),
    ]);
    await client.account("LA2", "A B", "LAS");
    await client.leagues("LA2", "p");
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/A%20B/LAS",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://la2.api.riotgames.com/lol/league/v4/entries/by-puuid/p",
    );
  });
  it("supports HTTP-date retry headers", () =>
    expect(retryAfterMs("Mon, 05 Oct 2026 12:00:05 GMT", Date.parse("2026-10-05T12:00:00Z"))).toBe(
      5000,
    ));
  it("routes SEA accounts through ASIA while retaining SEA for MATCH-V5", async () => {
    const { client, fetcher } = setup([
      Response.json({ puuid: "p", gameName: "SEA Player", tagLine: "OCE" }),
      Response.json([]),
    ]);
    await client.identity("OC1", "p");
    await client.matchIds("OC1", "p", 100, 200, 0);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://asia.api.riotgames.com/riot/account/v1/accounts/by-puuid/p",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://sea.api.riotgames.com/lol/match/v5/matches/by-puuid/p/ids?startTime=100&endTime=200&start=0&count=20",
    );
  });
});
