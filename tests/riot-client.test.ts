import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  RiotClient,
  RiotError,
  retryAfterMs,
  SyncBudget,
  SyncDeadline,
} from "@/server/riot/client";
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
  it("caps physical requests across a slot and retains pacing in the next slot", async () => {
    const { client, fetcher, sleep } = setup([Response.json([]), Response.json([])]);
    await expect(
      client.withBudget({ deadline: 30000, requests: 1 }, async () => {
        await client.matchIds("LA2", "p", 1, 2, 0);
        await client.matchIds("LA2", "p", 1, 2, 100);
      }),
    ).rejects.toMatchObject({ reason: "request_budget" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.withBudget({ deadline: 30000, requests: 1 }, () =>
      client.matchIds("LA2", "q", 1, 2, 0),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1300);
  });
  it("counts retry dispatches and preserves a 429 when the slot cannot retry", async () => {
    const { client, fetcher, sleep } = setup([
      new Response("", { status: 429, headers: { "Retry-After": "3" } }),
      Response.json([]),
    ]);
    await expect(
      client.withBudget({ deadline: 30000, requests: 1 }, () =>
        client.matchIds("LA2", "p", 1, 2, 0),
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 3000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.withBudget({ deadline: 30000, requests: 1 }, () =>
      client.matchIds("LA2", "q", 1, 2, 0),
    );
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it("finishes a time slot partially without invalidating the global client", async () => {
    const { client, fetcher } = setup([Response.json([])]);
    await expect(
      client.withBudget({ deadline: 11000, requests: 12 }, () =>
        client.matchIds("LA2", "p", 1, 2, 0),
      ),
    ).rejects.toBeInstanceOf(SyncBudget);
    expect(fetcher).not.toHaveBeenCalled();
    await client.matchIds("LA2", "p", 1, 2, 0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch when a pacing sleep overruns the slot", async () => {
    vi.stubEnv("RIOT_API_KEY", "test-only-not-a-real-key");
    let now = 0;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([]));
    const client = new RiotClient(120000, {
      now: () => now,
      fetcher,
      sleep: async () => {
        now = 35000;
      },
    });
    await client.matchIds("LA2", "p", 1, 2, 0);
    await expect(
      client.withBudget({ deadline: 30000, requests: 12 }, () =>
        client.matchIds("LA2", "q", 1, 2, 0),
      ),
    ).rejects.toMatchObject({ reason: "time_budget" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not hide a 429 when Retry-After exceeds the remaining player time", async () => {
    const { client, fetcher } = setup([
      new Response("", { status: 429, headers: { "Retry-After": "25" } }),
    ]);
    await expect(
      client.withBudget({ deadline: 30000, requests: 12 }, () =>
        client.matchIds("LA2", "p", 1, 2, 0),
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 25000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["network", "timeout", "5xx"])(
    "keeps %s failures real when retry capacity ends",
    async (kind) => {
      vi.stubEnv("RIOT_API_KEY", "test-only-not-a-real-key");
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (kind === "5xx") return new Response("", { status: 503 });
        throw new Error(kind === "timeout" ? "AbortError" : "network failure");
      });
      const client = new RiotClient(30000, { fetcher, now: () => 0 });
      await expect(
        client.withBudget({ deadline: 30000, requests: 1 }, () =>
          client.matchIds("LA2", "p", 1, 2, 0),
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("clamps pacing to at least 1300 ms", async () => {
    vi.stubEnv("RIOT_API_KEY", "test-only-not-a-real-key");
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const client = new RiotClient(30000, {
      interval: 1,
      sleep,
      now: () => now,
      fetcher: async () => Response.json([]),
    });
    await client.matchIds("LA2", "p", 1, 2, 0);
    await client.matchIds("LA2", "q", 1, 2, 0);
    expect(sleep).toHaveBeenCalledWith(1300);
  });
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
      "https://sea.api.riotgames.com/lol/match/v5/matches/by-puuid/p/ids?startTime=100&endTime=200&start=0&count=100",
    );
  });
});
