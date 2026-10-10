import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPlayerDiagnostics } from "@/components/admin-player-diagnostics";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import {
  syncPlayer as syncRecentPlayer,
  syncBackfillPlayer,
  syncAllPlayers,
} from "@/server/sync/service";
import { withSyncLease, SyncBusy } from "@/server/sync/lease";
import * as leaseService from "@/server/sync/lease";
import { RiotClient, RiotError, SyncBudget } from "@/server/riot/client";
import {
  allowLogin,
  authenticated,
  createSession,
  destroySession,
  sessionCookie,
} from "@/server/auth";
import { seasonStart, CURRENT_SEASON } from "@/lib/season";
import { getSeasonOverview } from "@/server/season-queries";
import { SyncDeadline } from "@/server/riot/client";
import { getLeaderboard, getProfile } from "@/server/queries";
import type { RiotMatch } from "@/server/riot/schemas";
import { POST as createPlayer } from "@/app/api/admin/players/route";
import { getWeeklyLp, getWeeklyLpSummary } from "@/server/weekly-lp";
import { getSyncStatus } from "@/server/sync/status";
import { GET as syncStatusRoute } from "@/app/api/ladder/sync-status/route";
import { RECENT_OVERLAP_MS } from "@/server/sync/recent";
import { toPlayerSyncState } from "@/server/sync/player-state";
import { getAdminPlayers, getAdminSyncContext } from "@/server/admin-queries";
import { GET as listAdminPlayers } from "@/app/api/admin/players/route";
import { POST as individualSync } from "@/app/api/admin/players/[id]/sync/route";
import { POST as manualBackfill } from "@/app/api/admin/players/[id]/backfill/route";
import { PATCH as togglePlayer, DELETE as deletePlayer } from "@/app/api/admin/players/[id]/route";
import { attemptActivity, LEGACY_PARTIAL_SYNC_MESSAGE } from "@/lib/admin-sync";
import { SYNC_LEASE_MS } from "@/lib/sync-status";
import {
  checkpoint,
  leaseContext,
  LeaseLost,
  readSyncProgress,
  syncWrite,
} from "@/server/sync/progress";
import { GET as progressRoute } from "@/app/api/admin/sync/progress/route";
import { runIdentity } from "@/server/sync/lease";
const pg = new PGlite();
const database = drizzle(pg, { schema });
const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("@/db", () => ({ db: () => database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (cookieJar.has(key) ? { value: cookieJar.get(key) } : undefined),
    set: (key: string, value: string) => cookieJar.set(key, value),
  }),
}));
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});

describe("recent-first synchronization", () => {
  function freshMatch(id: string, puuid = "stable-puuid") {
    const result = match(id);
    result.info.gameStartTimestamp = Date.now() - 3600_000;
    result.info.participants[0].puuid = puuid;
    return result;
  }
  beforeEach(() => {
    vi.spyOn(RiotClient.prototype, "identity").mockImplementation(async (_p, puuid) => ({
      puuid,
      gameName: "Example",
      tagLine: "LAS",
    }));
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "match").mockImplementation(async (_p, id) => freshMatch(id));
  });
  afterEach(() => vi.restoreAllMocks());
  async function row(id: string) {
    return (await database.select().from(schema.players).where(eq(schema.players.id, id)))[0];
  }
  async function release() {
    await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
  }

  it("rotates all 18 eligible players over bounded runs and names untouched players", async () => {
    const base = Date.now();
    let clock = base;
    const roster = [];
    for (let i = 0; i < 18; i++) {
      const p = await addPlayer(`fair-${i}`);
      await database
        .update(schema.players)
        .set({
          createdAt: new Date(base + i),
          scanStart: new Date(base),
          backfillSeason: CURRENT_SEASON.id,
          backfillStatus: "completed",
        })
        .where(eq(schema.players.id, p.id));
      roster.push(p);
    }
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const visits: string[] = [];
    vi.mocked(RiotClient.prototype.identity).mockImplementation(async (_p, puuid) => {
      visits.push(puuid);
      clock += 25000;
      return { puuid, gameName: "Example", tagLine: "LAS" };
    });
    const first = await syncAllPlayers();
    expect(first.outcome).toBe("partial");
    expect(first.recent).toMatchObject({
      eligible: 18,
      visited: 7,
      complete: 7,
      budgetPending: 11,
      errors: 0,
    });
    expect(first.results).toHaveLength(18);
    expect(
      first.results.slice(7).every((r) => r.attempted === false && r.reason === "execution_budget"),
    ).toBe(true);
    expect((await row(roster[7].id)).lastSyncAttempt).toBeNull();
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBeNull();
    for (let i = 0; i < 2; i++) {
      await release();
      await syncAllPlayers();
    }
    expect(new Set(visits.slice(0, 18))).toEqual(new Set(roster.map((p) => p.puuid)));
  });

  it("bounds excluded modes and 404 requests and continues with the next player", async () => {
    const a = await addPlayer("excluded-backlog");
    const b = await addPlayer("healthy");
    await database
      .update(schema.players)
      .set({ createdAt: new Date(1000) })
      .where(eq(schema.players.id, a.id));
    await database
      .update(schema.players)
      .set({ createdAt: new Date(2000) })
      .where(eq(schema.players.id, b.id));
    vi.stubEnv("RIOT_API_KEY", "test-only-not-a-real-key");
    // Use real client dispatch/accounting for recent requests; all responses are local fixtures.
    vi.mocked(RiotClient.prototype.matchIds).mockRestore();
    vi.mocked(RiotClient.prototype.match).mockRestore();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/ids?"))
        return Response.json(
          url.includes(a.puuid) ? Array.from({ length: 40 }, (_, i) => `excluded_${i}`) : [],
        );
      if (url.endsWith("_0")) {
        const excluded = freshMatch("excluded_0", a.puuid);
        excluded.info.queueId = 450;
        return Response.json(excluded);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    // Advance only virtual pacing, no real sleeps or Riot traffic.
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Inject virtual pacing into the same serial client used by both production passes.
    vi.spyOn(leaseService, "withSyncLease").mockImplementation(async (work) =>
      work(
        new RiotClient(clock + 230000, {
          fetcher,
          now: () => clock,
          sleep: async (ms) => {
            clock += ms;
          },
        }),
      ),
    );
    try {
      const run = await syncAllPlayers();
      expect(run.results[0]).toMatchObject({
        playerId: a.id,
        status: "partial",
        reason: "request_budget",
      });
      expect(run.results[1]).toMatchObject({ playerId: b.id, status: "complete" });
      const updated = await row(a.id);
      expect(updated.rankCheckedAt).not.toBeNull();
      expect(updated.lastSyncedAt).toBeNull();
      expect(updated.recentError).toBeNull();
      // Recent and historical slots are independent; each cap includes IDs and excluded details.
      expect(run.recent.errors).toBe(0);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).includes("/matches/excluded_")),
      ).toHaveLength(16);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reserves history progress even when the recent pass leaves players untouched", async () => {
    const base = Date.now();
    let clock = base;
    for (let i = 0; i < 8; i++) await addPlayer(`reserve-${i}`);
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(RiotClient.prototype.identity).mockImplementation(async (_p, puuid) => {
      clock += 25000;
      return { puuid, gameName: "Example", tagLine: "LAS" };
    });
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, start) => {
      if (start < base / 1000 - 2 * 86400) clock += 15000;
      return [];
    });
    const run = await syncAllPlayers();
    expect(run.recent).toMatchObject({ visited: 7, pending: 1, errors: 0 });
    expect(run.backfill).toMatchObject({ visited: 3, complete: 3, pending: 5 });
    expect(
      run.backfill.results
        .filter((r) => r.attempted === false)
        .every((r) => r.reason === "execution_budget"),
    ).toBe(true);
    expect(clock - base).toBeLessThanOrEqual(230000);
  });

  it("keeps a historical cursor and its prior error after a scoped interruption, then resumes", async () => {
    const p = await addPlayer();
    const ids = ["checkpoint_saved", "checkpoint_pending"];
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(ids);
    vi.mocked(RiotClient.prototype.match)
      .mockResolvedValueOnce(freshMatch(ids[0]))
      .mockRejectedValueOnce(new SyncBudget("time_budget"));
    const oldError = {
      occurredAt: new Date().toISOString(),
      code: 503,
      step: "history" as const,
      message: "Riot no está disponible temporalmente.",
    };
    await database
      .update(schema.players)
      .set({ backfillError: oldError })
      .where(eq(schema.players.id, p.id));
    await expect(syncBackfillPlayer(p.id, new RiotClient())).rejects.toBeInstanceOf(SyncBudget);
    const interrupted = await row(p.id);
    expect(interrupted).toMatchObject({
      scanPending: [ids[1]],
      scanOffset: 2,
      scanExhausted: true,
      backfillProcessed: 1,
      backfillError: oldError,
    });
    expect(interrupted.lastSyncAttempt).toMatchObject({
      outcome: "partial",
      pendingReason: "time_budget",
    });
    const frozen = interrupted.scanEnd;
    vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => freshMatch(id));
    await syncBackfillPlayer(p.id, new RiotClient());
    const complete = await row(p.id);
    expect(complete).toMatchObject({
      backfillProcessed: 2,
      backfillDiscovered: 2,
      backfillStatus: "completed",
      backfillError: null,
      scanPending: [],
      scanEnd: null,
    });
    expect(complete.scanStart.getTime()).toBe(frozen!.getTime() - RECENT_OVERLAP_MS);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(vi.mocked(RiotClient.prototype.matchIds)).toHaveBeenCalledTimes(1);
  });

  it("excludes paused players from both passes and from direct history retries", async () => {
    const p = await addPlayer("paused");
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, p.id));
    const run = await syncAllPlayers();
    expect(run.recent.eligible).toBe(0);
    expect(run.backfill.eligible).toBe(0);
    expect(await syncBackfillPlayer(p.id, new RiotClient())).toMatchObject({ status: "skipped" });
    expect((await row(p.id)).lastSyncAttempt).toBeNull();
    expect(vi.mocked(RiotClient.prototype.identity)).not.toHaveBeenCalled();
    expect(vi.mocked(RiotClient.prototype.matchIds)).not.toHaveBeenCalled();
  });

  it("imports a newly played match without touching a frozen historical cursor", async () => {
    const p = await addPlayer();
    const frozen = new Date(Date.now() - 3 * 86400_000);
    await database
      .update(schema.players)
      .set({
        backfillSeason: CURRENT_SEASON.id,
        backfillStatus: "running",
        scanEnd: frozen,
        scanOffset: 100,
        scanPending: ["old_pending"],
        scanExhausted: false,
      })
      .where(eq(schema.players.id, p.id));
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(["new_match"]);
    const result = await syncRecentPlayer(p.id, new RiotClient());
    expect(result.status).toBe("complete");
    const updated = await row(p.id);
    expect(updated).toMatchObject({
      scanEnd: frozen,
      scanOffset: 100,
      scanPending: ["old_pending"],
      scanExhausted: false,
      backfillStatus: "running",
    });
    expect(updated.lastSyncedAt?.getTime()).toBe(
      vi.mocked(RiotClient.prototype.matchIds).mock.calls[0][3] * 1000,
    );
    expect((await getProfile(p.id, "soloq"))?.recent[0].matchId).toBe("new_match");
  });

  it("offers recent windows to both players before any history request, serially", async () => {
    const a = await addPlayer();
    const b = await addPlayer("other-player");
    const events: string[] = [];
    let active = 0;
    let maximum = 0;
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, puuid, start) => {
      active++;
      maximum = Math.max(maximum, active);
      events.push(`${start < Date.now() / 1000 - 2 * 86400 ? "history" : "recent"}:${puuid}`);
      await Promise.resolve();
      active--;
      return [];
    });
    const run = await syncAllPlayers();
    expect(events.slice(0, 2)).toEqual([`recent:${a.puuid}`, `recent:${b.puuid}`]);
    expect(events.slice(2).every((e) => e.startsWith("history:"))).toBe(true);
    expect(maximum).toBe(1);
    expect(run.recent).toMatchObject({ eligible: 2, complete: 2, pending: 0 });
    expect(run.backfill.complete).toBe(2);
  });

  it("does not impose a player-count cap when the global deadline still permits work", async () => {
    await database.insert(schema.players).values(
      Array.from({ length: 51 }, (_, i) => ({
        gameName: `Roster ${i}`,
        tagLine: "LAS",
        puuid: `roster-${i}`,
        platform: "LA2" as const,
        scanStart: seasonStart("LA2"),
        backfillSeason: CURRENT_SEASON.id,
        backfillStatus: "completed" as const,
      })),
    );
    const run = await syncAllPlayers();
    expect(run.recent).toMatchObject({ eligible: 51, complete: 51, pending: 0 });
    expect(run.outcome).toBe("success");
  });

  it("recovers a recent deadline with untouched players first in the next run", async () => {
    const a = await addPlayer("first");
    const b = await addPlayer("second");
    const c = await addPlayer("third");
    for (const [i, p] of [a, b, c].entries())
      await database
        .update(schema.players)
        .set({ createdAt: new Date(1000 + i * 1000) })
        .where(eq(schema.players.id, p.id));
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, puuid) => {
      if (puuid === b.puuid) throw new SyncDeadline();
      return [];
    });
    const run = await syncAllPlayers();
    expect(run.outcome).toBe("partial");
    expect(run.recent).toMatchObject({ complete: 1, pending: 2 });
    expect(
      run.backfill.results.every((r) => r.attempted === false && r.reason === "execution_budget"),
    ).toBe(true);
    expect((await row(a.id)).lastAttemptAt).not.toBeNull();
    expect((await row(b.id)).lastAttemptAt).toBeNull();
    expect((await row(c.id)).lastAttemptAt).toBeNull();
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBeNull();
    await release();
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue([]).mockClear();
    await syncAllPlayers();
    expect(
      vi
        .mocked(RiotClient.prototype.matchIds)
        .mock.calls.slice(0, 3)
        .map((c) => c[1]),
    ).toEqual([c.puuid, a.puuid, b.puuid]);
  });

  it("does not demote a player when the deadline precedes its first request", async () => {
    const p = await addPlayer();
    vi.mocked(RiotClient.prototype.identity).mockRejectedValue(new SyncDeadline());
    await expect(syncRecentPlayer(p.id, new RiotClient())).rejects.toBeInstanceOf(SyncDeadline);
    expect((await row(p.id)).lastAttemptAt).toBeNull();
    expect((await row(p.id)).lastSyncedAt).toBeNull();
  });

  it("keeps recent global success when history encounters a deadline", async () => {
    const p = await addPlayer();
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, start) => {
      if (start < Date.now() / 1000 - 2 * 86400) throw new SyncDeadline();
      return [];
    });
    const run = await syncAllPlayers();
    expect(run.outcome).toBe("success");
    expect(run.recent.pending).toBe(0);
    expect(run.backfill.results).toEqual([{ playerId: p.id, status: "partial" }]);
    expect((await getSyncStatus()).status).toBe("success");
    expect((await getSyncStatus()).lastSuccessfulSyncAt).not.toBeNull();
    expect((await row(p.id)).backfillStatus).toBe("running");
    expect((await row(p.id)).lastSyncedAt).not.toBeNull();
  });

  it("reports success separately from a bounded, unfinished historical batch", async () => {
    const p = await addPlayer();
    const ids = Array.from({ length: 30 }, (_, i) => `historical_${i}`);
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, start) =>
      start < Date.now() / 1000 - 2 * 86400 ? ids : [],
    );
    const run = await syncAllPlayers();
    expect(run.recent).toMatchObject({ complete: 1, pending: 0 });
    expect(run.outcome).toBe("success");
    expect(run.backfill).toMatchObject({ complete: 0, pending: 1 });
    expect((await row(p.id)).scanPending).toHaveLength(5);
    expect((await row(p.id)).backfillProcessed).toBe(25);
    const attempt = (await row(p.id)).lastAttemptAt;
    const coverage = (await row(p.id)).lastSyncedAt;
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue([]);
    await syncBackfillPlayer(p.id, new RiotClient());
    expect((await row(p.id)).lastAttemptAt).toEqual(attempt);
    expect((await row(p.id)).lastSyncedAt).toEqual(coverage);
    expect((await row(p.id)).backfillStatus).toBe("completed");
  });

  it("keeps the bootstrap lower bound stable between incomplete retries", async () => {
    const p = await addPlayer();
    const played = Date.now() - 3600_000;
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(["bootstrap_a", "bootstrap_b"]);
    vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => {
      const result = freshMatch(id);
      result.info.gameStartTimestamp = played;
      return result;
    });
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 1 })).status).toBe("partial");
    const start = vi.mocked(RiotClient.prototype.matchIds).mock.lastCall?.[2];
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600_000);
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 1 })).status).toBe("complete");
    expect(vi.mocked(RiotClient.prototype.matchIds).mock.lastCall?.[2]).toBe(start);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
  });

  it("reports recent errors separately and does not disguise them with backfill", async () => {
    await addPlayer();
    vi.mocked(RiotClient.prototype.matchIds).mockRejectedValue(new RiotError(503));
    const run = await syncAllPlayers();
    expect(run.outcome).toBe("failed");
    expect(run.recent).toMatchObject({ complete: 0, pending: 1, errors: 1 });
    expect(run.backfill.results).toEqual([
      { playerId: expect.any(String), status: "partial", attempted: false, reason: "recent_error" },
    ]);
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBeNull();
  });

  it("repairs the legacy gap between an old completed scan and a later completion timestamp", async () => {
    const p = await addPlayer();
    await database
      .update(schema.players)
      .set({
        backfillSeason: CURRENT_SEASON.id,
        backfillStatus: "completed",
        scanStart: new Date(Date.now() - 10 * 86400_000),
        lastSyncedAt: new Date(Date.now() - 2 * 3600_000),
      })
      .where(eq(schema.players.id, p.id));
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, start) =>
      start < Date.now() / 1000 - 2 * 86400 ? ["legacy_gap"] : [],
    );
    vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => {
      const result = freshMatch(id);
      result.info.gameStartTimestamp = Date.now() - 5 * 86400_000;
      return result;
    });
    const run = await syncAllPlayers();
    expect(run.recent).toMatchObject({ complete: 1, pending: 0 });
    expect(run.backfill).toMatchObject({ eligible: 1, complete: 1 });
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect((await row(p.id)).scanStart.getTime()).toBeGreaterThan(Date.now() - 2 * 86400_000);
    await release();
    const next = await syncAllPlayers();
    expect(next.backfill.eligible).toBe(0);
    expect(vi.mocked(RiotClient.prototype.match)).toHaveBeenCalledTimes(1);
  });

  it("resumes an already frozen incremental cursor even for a completed backfill", async () => {
    const p = await addPlayer();
    const frozen = new Date(Date.now() - 2 * 3600_000);
    await database
      .update(schema.players)
      .set({
        backfillSeason: CURRENT_SEASON.id,
        backfillStatus: "completed",
        scanStart: new Date(Date.now() - 86400_000),
        scanEnd: frozen,
        scanPending: ["frozen_incremental"],
        scanOffset: 1,
        scanExhausted: true,
      })
      .where(eq(schema.players.id, p.id));
    vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => {
      const result = freshMatch(id);
      result.info.gameStartTimestamp = Date.now() - 3 * 3600_000;
      return result;
    });
    const run = await syncAllPlayers();
    expect(run.outcome).toBe("success");
    expect(run.backfill.complete).toBe(1);
    expect((await row(p.id)).scanPending).toEqual([]);
    expect((await row(p.id)).scanEnd).toBeNull();
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
  });

  it.each([new SyncDeadline(), new RiotError(503)])(
    "preserves coverage and saved participants after an incomplete detail request (%s)",
    async (error) => {
      const p = await addPlayer();
      const coverage = new Date(Date.now() - 2 * 3600_000);
      await database.update(schema.players).set({ lastSyncedAt: coverage });
      vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(["saved", "pending"]);
      vi.mocked(RiotClient.prototype.match)
        .mockResolvedValueOnce(freshMatch("saved"))
        .mockRejectedValueOnce(error);
      await expect(syncRecentPlayer(p.id, new RiotClient())).rejects.toThrow();
      expect((await row(p.id)).lastSyncedAt).toEqual(coverage);
      expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
      vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => freshMatch(id));
      expect((await syncRecentPlayer(p.id, new RiotClient())).status).toBe("complete");
      expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    },
  );

  it("replays multiple pages and bounded batches without skipping or duplicating matches", async () => {
    const p = await addPlayer();
    const ids = Array.from({ length: 105 }, (_, i) => `recent_${i}`);
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, _s, _e, offset) =>
      ids.slice(offset, offset + 100),
    );
    for (const expected of [40, 80]) {
      expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 40 })).status).toBe(
        "partial",
      );
      expect((await row(p.id)).lastSyncedAt).toBeNull();
      expect(await database.select().from(schema.playerMatches)).toHaveLength(expected);
    }
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 40 })).status).toBe(
      "complete",
    );
    expect((await row(p.id)).lastSyncedAt).not.toBeNull();
    expect(await database.select().from(schema.matches)).toHaveLength(105);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(105);
    expect(vi.mocked(RiotClient.prototype.match)).toHaveBeenCalledTimes(105);
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 40 })).imported).toBe(0);
    expect(vi.mocked(RiotClient.prototype.match)).toHaveBeenCalledTimes(105);
  });

  it("checks another page after exactly 100 IDs before declaring coverage", async () => {
    const p = await addPlayer();
    const ids = Array.from({ length: 100 }, (_, i) => `boundary_${i}`);
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, _s, _e, offset) =>
      ids.slice(offset, offset + 100),
    );
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 100 })).status).toBe(
      "complete",
    );
    expect(vi.mocked(RiotClient.prototype.matchIds).mock.calls.map((c) => c[4])).toEqual([0, 100]);
  });

  it("does not advance coverage if the next page fails after the entire first page was saved", async () => {
    const p = await addPlayer();
    const ids = Array.from({ length: 100 }, (_, i) => `page_${i}`);
    vi.mocked(RiotClient.prototype.matchIds)
      .mockResolvedValueOnce(ids)
      .mockRejectedValueOnce(new SyncDeadline());
    await expect(syncRecentPlayer(p.id, new RiotClient(), { budget: 100 })).rejects.toThrow();
    expect((await row(p.id)).lastSyncedAt).toBeNull();
    expect(await database.select().from(schema.playerMatches)).toHaveLength(100);
  });

  it("imports late-indexed matches through overlap while preserving the historical state", async () => {
    const p = await addPlayer();
    await syncRecentPlayer(p.id, new RiotClient());
    const coverage = (await row(p.id)).lastSyncedAt!;
    const late = freshMatch("late");
    late.info.gameStartTimestamp = coverage.getTime() - 3600_000;
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(["late"]);
    vi.mocked(RiotClient.prototype.match).mockResolvedValue(late);
    await syncRecentPlayer(p.id, new RiotClient());
    expect(vi.mocked(RiotClient.prototype.matchIds).mock.lastCall?.[2]).toBe(
      Math.floor((coverage.getTime() - RECENT_OVERLAP_MS) / 1000),
    );
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect((await row(p.id)).scanEnd).toBeNull();
  });

  it("does not let excluded modes consume the new-participant allowance", async () => {
    const p = await addPlayer();
    const ids = ["aram", "gone", "ranked"];
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue(ids);
    vi.mocked(RiotClient.prototype.match).mockImplementation(async (_p, id) => {
      if (id === "gone") throw new RiotError(404);
      const result = freshMatch(id);
      if (id === "aram") result.info.queueId = 450;
      return result;
    });
    expect((await syncRecentPlayer(p.id, new RiotClient(), { budget: 1 })).status).toBe("complete");
    expect(await database.select().from(schema.matches)).toHaveLength(1);
  });

  it.each([401, 403, 429])(
    "aborts recent sync on %i and preserves shared cooldown",
    async (status) => {
      const p = await addPlayer();
      await addPlayer("untouched");
      vi.mocked(RiotClient.prototype.matchIds).mockRejectedValue(new RiotError(status, 300000));
      await expect(syncAllPlayers()).rejects.toMatchObject({ status });
      expect(vi.mocked(RiotClient.prototype.matchIds)).toHaveBeenCalledTimes(1);
      expect((await row(p.id)).lastSyncedAt).toBeNull();
      expect((await getSyncStatus()).status).toBe("failed");
      if (status === 429)
        await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
    },
  );

  it("preserves a history 429 cooldown without invalidating completed recent windows", async () => {
    await addPlayer();
    await addPlayer("history-backoff-pending");
    vi.mocked(RiotClient.prototype.matchIds).mockImplementation(async (_p, _id, start) => {
      if (start < Date.now() / 1000 - 2 * 86400) throw new RiotError(429, 300000);
      return [];
    });
    const run = await syncAllPlayers();
    expect(run.outcome).toBe("success");
    expect(run.backfill.errors).toBe(1);
    expect(run.backfill.results[1]).toMatchObject({
      status: "partial",
      attempted: false,
      reason: "riot_backoff",
    });
    expect(run.backfill.visited).toBe(1);
    expect((await getSyncStatus()).status).toBe("success");
    await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
  });
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE players, matches, ranked_snapshots, player_matches, sync_locks, admin_sessions, login_attempts CASCADE",
  );
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret".repeat(4));
  cookieJar.clear();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});
async function addPlayer(puuid = "stable-puuid") {
  return (
    await database
      .insert(schema.players)
      .values({
        gameName: "Example",
        tagLine: "LAS",
        puuid,
        platform: "LA2",
        scanStart: new Date("2026-09-01T00:00:00Z"),
      })
      .returning()
  )[0];
}
describe("administrative phase diagnostics and individual synchronization", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "http://localhost");
    await createSession();
    vi.spyOn(RiotClient.prototype, "identity").mockImplementation(async (_p, puuid) => ({
      puuid,
      gameName: "Example",
      tagLine: "LAS",
    }));
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "match").mockImplementation(async (_p, id) => {
      const m = match(id);
      m.info.gameStartTimestamp = Date.now() - 3600_000;
      return m;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const request = (id: string, suffix = "sync", origin = "http://localhost") =>
    new Request(`http://localhost/api/admin/players/${id}/${suffix}`, {
      method: "POST",
      headers: { origin },
    });
  const row = async (id: string) =>
    (await database.select().from(schema.players).where(eq(schema.players.id, id)))[0];
  const update = async (id: string, values: Partial<typeof schema.players.$inferInsert>) =>
    database.update(schema.players).set(values).where(eq(schema.players.id, id));
  const error = (step: "recent" | "history" | "league") => ({
    occurredAt: "2026-09-01T00:00:00.000Z",
    code: 503,
    step,
    message: "old error with private SQL",
  });

  it("exposes the existing typed state without PUUID or internal legacy messages and without caching", async () => {
    const p = await addPlayer();
    await update(p.id, { syncError: "postgres://private-password@host", updatedAt: new Date() });
    const response = await listAdminPlayers(new Request("http://localhost/api/admin/players"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [admin] = await response.json();
    expect(admin.syncState.rank).toEqual({ checkedAt: null, error: null });
    expect(admin.syncState.recent.coveredThrough).toBeNull();
    expect(admin.syncState.lastAttempt).toBeNull();
    expect(admin.legacyError).toMatch(/sin clasificar/);
    expect(JSON.stringify(admin)).not.toMatch(/private-password|stable-puuid|puuid/);
    expect(admin.lastSyncedAt).toBeNull();
  });

  it("keeps rank, recent and history evidence independent across the administrative query", async () => {
    const p = await addPlayer();
    const checked = new Date("2026-10-08T00:00:00Z");
    const covered = new Date("2026-10-01T00:00:00Z");
    await update(p.id, {
      rankCheckedAt: checked,
      lastSyncedAt: covered,
      recentError: error("recent"),
      backfillSeason: CURRENT_SEASON.id,
      backfillStatus: "completed",
      backfillUnavailable: 2,
    });
    let [admin] = await getAdminPlayers();
    expect(admin.syncState.rank.checkedAt).toBe(checked.toISOString());
    expect(admin.syncState.recent).toMatchObject({
      coveredThrough: covered.toISOString(),
      error: { step: "recent" },
    });
    expect(admin.syncState.history).toMatchObject({
      status: "completed",
      unavailable: 2,
      error: null,
    });
    await update(p.id, {
      recentError: null,
      backfillError: error("history"),
      backfillStatus: "failed",
    });
    [admin] = await getAdminPlayers();
    expect(admin.syncState.history).toMatchObject({ status: "failed", error: { step: "history" } });
    expect(admin.syncState.rank.error).toBeNull();
    expect(admin.syncState.recent.error).toBeNull();
    expect(JSON.stringify(admin)).not.toContain("private SQL");
  });

  it("does not duplicate a phase mirror as an unclassified legacy error", async () => {
    const p = await addPlayer();
    await update(p.id, { rankError: error("league"), syncError: error("league").message });
    const [admin] = await getAdminPlayers();
    expect(admin.legacyError).toBeNull();
    expect(admin.syncState.rank.error?.code).toBe(503);
  });

  it("classifies a persisted resumable partial as information without changing stored progress", async () => {
    const p = await addPlayer();
    const now = new Date();
    await update(p.id, {
      syncError: LEGACY_PARTIAL_SYNC_MESSAGE,
      rankCheckedAt: now,
      lastSyncedAt: now,
      backfillSeason: CURRENT_SEASON.id,
      backfillStatus: "running",
      backfillProcessed: 75,
      backfillDiscovered: 205,
      scanOffset: 100,
      lastSyncAttempt: {
        phase: "history",
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        outcome: "partial",
        pendingReason: "batch_limit",
      },
    });
    const before = await row(p.id);
    const [admin] = await getAdminPlayers();
    expect(admin.legacyError).toBeNull();
    expect(admin.syncError).toBeNull();
    expect(admin.legacyNotice).toBe(LEGACY_PARTIAL_SYNC_MESSAGE);
    expect(admin.syncState.history).toMatchObject({
      status: "running",
      processed: 75,
      error: null,
    });
    const html = renderToStaticMarkup(
      createElement(AdminPlayerDiagnostics, {
        player: admin,
        context: { serverNow: now.toISOString(), leaseUntil: null },
      }),
    );
    expect(html).toContain(
      'class="admin-player-state partial">Lote parcial guardado; puede continuar',
    );
    expect(html).toContain("Aviso previo de progreso parcial");
    expect(html).not.toContain("Errores pendientes de revisión");
    expect(html).not.toContain("Error previo sin clasificar");
    expect(await row(p.id)).toEqual(before);
  });

  it.each(["rankError", "recentError", "backfillError"] as const)(
    "retains %s with an informational legacy message and prioritizes it over unknown legacy errors",
    async (column) => {
      const p = await addPlayer();
      const phaseError = error(
        column === "rankError" ? "league" : column === "recentError" ? "recent" : "history",
      );
      await update(p.id, { [column]: phaseError, syncError: LEGACY_PARTIAL_SYNC_MESSAGE });
      let [admin] = await getAdminPlayers();
      expect(admin.legacyError).toBeNull();
      expect(admin.legacyNotice).toBe(LEGACY_PARTIAL_SYNC_MESSAGE);
      expect(admin.syncError).toBe("Riot no está disponible temporalmente.");
      const html = renderToStaticMarkup(
        createElement(AdminPlayerDiagnostics, {
          player: admin,
          context: { serverNow: new Date().toISOString(), leaseUntil: null },
        }),
      );
      expect(html).toContain('class="admin-player-state error">Errores pendientes de revisión');
      expect(html).toContain("Aviso previo de progreso parcial");
      expect(html).not.toContain("Error previo sin clasificar");
      await update(p.id, { syncError: "unknown error with private SQL" });
      [admin] = await getAdminPlayers();
      expect(admin.legacyError).toMatch(/sin clasificar/);
      expect(admin.legacyNotice).toBeNull();
      expect(admin.syncError).toBe("Riot no está disponible temporalmente.");
      expect(JSON.stringify(admin)).not.toContain("private SQL");
    },
  );

  it("does not suppress a structured deadline even when it uses the known partial wording", async () => {
    const p = await addPlayer();
    await update(p.id, {
      syncError: LEGACY_PARTIAL_SYNC_MESSAGE,
      recentError: {
        code: "deadline",
        step: "recent",
        occurredAt: new Date().toISOString(),
        message: LEGACY_PARTIAL_SYNC_MESSAGE,
      },
    });
    const [admin] = await getAdminPlayers();
    expect(admin.legacyError).toBeNull();
    expect(admin.syncState.recent.error?.code).toBe("deadline");
    expect(admin.syncError).toBe("Se agotó el tiempo; el progreso guardado permite continuar.");
    const html = renderToStaticMarkup(
      createElement(AdminPlayerDiagnostics, {
        player: admin,
        context: { serverNow: new Date().toISOString(), leaseUntil: null },
      }),
    );
    expect(html).toContain('class="admin-player-state error">Errores pendientes de revisión');
  });

  it("does not assume an old running attempt is still active, including during a different lease", async () => {
    const p = await addPlayer();
    await update(p.id, {
      lastSyncAttempt: {
        phase: "recent",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: null,
        outcome: "running",
      },
    });
    await database
      .insert(schema.syncLocks)
      .values({ name: "riot", owner: p.id, expiresAt: new Date(Date.now() + 60_000) });
    const [admin] = await getAdminPlayers();
    expect(attemptActivity(admin.syncState, await getAdminSyncContext())).toMatch(
      /Posiblemente interrumpido/,
    );
  });

  it("updates a completed-history player without changing history, another player, or global status", async () => {
    const p = await addPlayer();
    const other = await addPlayer("untouched");
    const previous = new Date("2026-09-03T00:00:00Z");
    await update(p.id, {
      backfillSeason: CURRENT_SEASON.id,
      backfillStatus: "completed",
      scanOffset: 100,
      scanPending: ["historical-id"],
      scanEnd: previous,
      backfillError: error("history"),
      backfillDiscovered: 101,
      backfillProcessed: 100,
    });
    await database.insert(schema.syncLocks).values({
      name: "riot",
      owner: p.id,
      expiresAt: new Date(0),
      lastSuccessfulSyncAt: previous,
      lastStartedAt: previous,
      lastFinishedAt: previous,
      lastOutcome: "partial",
    });
    const beforeOther = await row(other.id);
    const response = await individualSync(request(p.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.status).toBe("complete");
    expect(body.result.syncState.lastAttempt).toMatchObject({
      phase: "recent",
      outcome: "success",
    });
    expect(body.result.syncState.history.error).not.toBeNull();
    expect(await row(p.id)).toMatchObject({
      backfillStatus: "completed",
      scanOffset: 100,
      scanPending: ["historical-id"],
      scanEnd: previous,
      backfillDiscovered: 101,
      backfillProcessed: 100,
      backfillError: error("history"),
    });
    expect(await row(other.id)).toEqual(beforeOther);
    const [lease] = await database.select().from(schema.syncLocks);
    expect(lease).toMatchObject({
      lastSuccessfulSyncAt: previous,
      lastStartedAt: previous,
      lastFinishedAt: previous,
      lastOutcome: "partial",
    });
    expect(vi.mocked(RiotClient.prototype.matchIds)).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid", 400],
    ["123e4567-e89b-42d3-a456-426614174000", 404],
  ])("rejects invalid or missing player %s before acquiring a lease", async (id, status) => {
    expect((await individualSync(request(id))).status).toBe(status);
    expect(await database.select().from(schema.syncLocks)).toHaveLength(0);
    expect(RiotClient.prototype.identity).not.toHaveBeenCalled();
  });

  it("rejects disabled players and invalid Origin without Riot calls", async () => {
    const p = await addPlayer();
    await update(p.id, { enabled: false });
    expect((await individualSync(request(p.id))).status).toBe(409);
    expect((await individualSync(request(p.id, "sync", "https://evil.example"))).status).toBe(403);
    expect((await individualSync(request(p.id, "sync", ""))).status).toBe(403);
    expect(RiotClient.prototype.identity).not.toHaveBeenCalled();
  });

  it("rejects an occupied lease and retains its global state", async () => {
    const p = await addPlayer();
    await database.insert(schema.syncLocks).values({
      name: "riot",
      owner: p.id,
      expiresAt: new Date(Date.now() + 60_000),
      lastOutcome: "running",
    });
    expect((await individualSync(request(p.id))).status).toBe(409);
    expect(RiotClient.prototype.identity).not.toHaveBeenCalled();
    expect((await row(p.id)).lastSyncAttempt).toBeNull();
  });

  it("preserves Riot Retry-After and rejects an immediate retry", async () => {
    const p = await addPlayer();
    vi.mocked(RiotClient.prototype.leagues).mockRejectedValue(new RiotError(429, 60_000));
    const response = await individualSync(request(p.id));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    const body = await response.json();
    expect(body.result.status).toBe("error");
    expect(body.error).toMatch(/No se alcanzó/);
    expect(body.result.syncState.lastAttempt.phase).toBe("rank");
    expect(RiotClient.prototype.matchIds).not.toHaveBeenCalled();
    const [lease] = await database.select().from(schema.syncLocks);
    expect(lease.expiresAt.getTime()).toBeGreaterThan(Date.now() + 58_000);
    expect(lease.lastSuccessfulSyncAt).toBeNull();
    expect((await individualSync(request(p.id))).status).toBe(409);
  });

  it.each([401, 403, 404, 503])(
    "returns a sanitized recoverable Riot %s failure without claiming recent work",
    async (code) => {
      const p = await addPlayer();
      const failure = new RiotError(code);
      failure.message = "private SQL and credentials";
      vi.mocked(RiotClient.prototype.identity).mockRejectedValue(failure);
      const response = await individualSync(request(p.id));
      expect(response.status).toBe(code === 404 ? 404 : 503);
      const body = await response.json();
      expect(body.result.status).toBe("error");
      expect(body.error).toMatch(/No se alcanzó/);
      expect(JSON.stringify(body)).not.toMatch(/private SQL|credentials|stable-puuid/);
      expect(RiotClient.prototype.matchIds).not.toHaveBeenCalled();
    },
  );

  it("retains a verified rank and historical error when recent work fails", async () => {
    const p = await addPlayer();
    await update(p.id, {
      backfillSeason: CURRENT_SEASON.id,
      backfillStatus: "completed",
      backfillError: error("history"),
    });
    vi.mocked(RiotClient.prototype.matchIds).mockRejectedValue(new RiotError(503));
    const response = await individualSync(request(p.id));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/rango se verificó/);
    expect(body.result.syncState.rank.checkedAt).not.toBeNull();
    expect(body.result.syncState.recent.coveredThrough).toBeNull();
    expect(body.result.syncState.history.error).not.toBeNull();
    expect((await row(p.id)).backfillStatus).toBe("completed");
  });

  it.each(["identity", "matchIds"] as const)(
    "returns a deadline in %s as partial with the actual phase",
    async (method) => {
      const p = await addPlayer();
      vi.mocked(RiotClient.prototype[method]).mockRejectedValue(new SyncDeadline());
      const response = await individualSync(request(p.id));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.result.status).toBe("partial");
      expect(body.result.syncState.lastAttempt).toMatchObject({
        phase: method === "identity" ? "rank" : "recent",
        outcome: "partial",
      });
      expect(body.message).toMatch(/parcial/);
      expect(body.result.syncState.recent.coveredThrough).toBeNull();
    },
  );

  it("keeps batch exhaustion partial with checkpointed participants and an untouched history cursor", async () => {
    const p = await addPlayer();
    await update(p.id, { scanOffset: 10, scanPending: ["history-pending"] });
    vi.mocked(RiotClient.prototype.matchIds).mockResolvedValue([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
    const response = await individualSync(request(p.id));
    const body = await response.json();
    expect(body.result).toMatchObject({ status: "partial", imported: 5 });
    expect(body.result.syncState.recent.coveredThrough).toBeNull();
    expect(await database.select().from(schema.playerMatches)).toHaveLength(5);
    expect(await row(p.id)).toMatchObject({ scanOffset: 10, scanPending: ["history-pending"] });
  });

  it("reports a skipped player if it becomes disabled before the leased sync reads it", async () => {
    const p = await addPlayer();
    vi.spyOn(leaseService, "withSyncLease").mockImplementation(async (work) => {
      await update(p.id, { enabled: false });
      return work(new RiotClient());
    });
    const response = await individualSync(request(p.id));
    expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("skipped");
    expect(RiotClient.prototype.identity).not.toHaveBeenCalled();
    expect((await row(p.id)).lastSyncAttempt).toBeNull();
  });

  it("sanitizes an unexpected service failure and retains its recorded phase", async () => {
    const p = await addPlayer();
    vi.mocked(RiotClient.prototype.identity).mockRejectedValue(
      new Error("postgres://password@host internal trace"),
    );
    const response = await individualSync(request(p.id));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.result.status).toBe("error");
    expect(body.result.syncState.rank.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toMatch(/password@host|internal trace/);
  });

  it("requires authentication for both diagnostic queries", async () => {
    cookieJar.clear();
    await expect(getAdminPlayers()).rejects.toMatchObject({ status: 401 });
    await expect(getAdminSyncContext()).rejects.toMatchObject({ status: 401 });
  });

  it("retains the existing enable, backfill and delete actions", async () => {
    const p = await addPlayer();
    const mutation = (method: string, body: unknown) =>
      new Request(`http://localhost/api/admin/players/${p.id}`, {
        method,
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await togglePlayer(mutation("PATCH", { enabled: false }))).status).toBe(200);
    expect((await row(p.id)).enabled).toBe(false);
    await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    expect((await togglePlayer(mutation("PATCH", { enabled: true }))).status).toBe(200);
    await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    expect((await manualBackfill(request(p.id, "backfill"))).status).toBe(200);
    expect((await row(p.id)).backfillStatus).toBe("completed");
    await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    expect((await deletePlayer(mutation("DELETE", { confirm: true }))).status).toBe(200);
    expect(await row(p.id)).toBeUndefined();
  });
});

function match(id: string): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: Date.parse("2026-09-10T00:00:00Z"),
      gameDuration: 1800,
      participants: [
        {
          puuid: "stable-puuid",
          championName: "Ahri",
          championId: 103,
          teamPosition: "MIDDLE",
          teamId: 100,
          kills: 7,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 20,
          totalDamageDealtToChampions: 25000,
          win: true,
        },
        {
          puuid: "teammate",
          championName: "Jinx",
          championId: 222,
          teamPosition: "BOTTOM",
          teamId: 100,
          kills: 10,
          deaths: 4,
          assists: 6,
          totalMinionsKilled: 220,
          neutralMinionsKilled: 5,
          totalDamageDealtToChampions: 29000,
          win: true,
        },
      ],
    },
  };
}
function client() {
  const client = new RiotClient();
  vi.spyOn(client, "identity").mockResolvedValue({
    puuid: "stable-puuid",
    gameName: "Renamed",
    tagLine: "LAS",
  });
  vi.spyOn(client, "summoner").mockResolvedValue({ profileIconId: 23 });
  vi.spyOn(client, "leagues").mockResolvedValue([
    {
      queueType: "RANKED_SOLO_5x5",
      tier: "DIAMOND",
      rank: "II",
      leaguePoints: 73,
      wins: 10,
      losses: 5,
    },
  ]);
  vi.spyOn(client, "matchIds").mockResolvedValue(["LA2_1"]);
  vi.spyOn(client, "match").mockImplementation(async (_platform, id) => match(id));
  return client;
}
// Existing historical scenarios exercise the rank refresh and the historical phase explicitly.
// Recent-window behavior is covered independently below, with current match timestamps.
async function syncPlayer(
  id: string,
  riot: RiotClient,
  options: { rankOnly?: boolean; budget?: number } = {},
) {
  const rank = await syncRecentPlayer(id, riot, { rankOnly: true });
  if (options.rankOnly || rank.status === "skipped") return rank;
  return syncBackfillPlayer(id, riot, options.budget);
}
describe("independent player synchronization state", () => {
  afterEach(() => vi.restoreAllMocks());
  async function row(id: string) {
    return (await database.select().from(schema.players).where(eq(schema.players.id, id)))[0];
  }

  it("keeps the verified rank when recent imports fail, without advancing coverage or history", async () => {
    const player = await addPlayer();
    const coverage = new Date("2026-09-30T00:00:00Z");
    await database
      .update(schema.players)
      .set({ lastSyncedAt: coverage, scanPending: ["historical_pending"], scanOffset: 100 })
      .where(eq(schema.players.id, player.id));
    const riot = client();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(503));
    await expect(syncRecentPlayer(player.id, riot)).rejects.toMatchObject({ status: 503 });
    const saved = await row(player.id);
    expect(saved.rankCheckedAt).not.toBeNull();
    expect(saved).toMatchObject({
      rankError: null,
      recentError: { code: 503, step: "recent" },
      backfillError: null,
      lastSyncedAt: coverage,
      scanPending: ["historical_pending"],
      scanOffset: 100,
      backfillStatus: "not_started",
      lastAttemptAt: null,
      lastSyncAttempt: { phase: "recent", outcome: "failed" },
    });
    expect(saved.lastSyncAttempt?.finishedAt).not.toBeNull();
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    expect(toPlayerSyncState(saved).rank.checkedAt).toBe(saved.rankCheckedAt!.toISOString());
    expect(toPlayerSyncState(saved).recent.coveredThrough).toBe(coverage.toISOString());
  });

  it("records a new rank check without inserting unchanged snapshots", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncRecentPlayer(player.id, riot, { rankOnly: true });
    const snapshots = await database.select().from(schema.rankedSnapshots);
    const oldCheck = new Date("2026-09-01T00:00:00Z");
    await database
      .update(schema.players)
      .set({ rankCheckedAt: oldCheck })
      .where(eq(schema.players.id, player.id));
    await syncRecentPlayer(player.id, riot, { rankOnly: true });
    const saved = await row(player.id);
    expect(saved.rankCheckedAt!.getTime()).toBeGreaterThan(oldCheck.getTime());
    expect(saved.lastSyncAttempt).toMatchObject({ phase: "rank", outcome: "success" });
    expect(saved.lastSyncedAt).toBeNull();
    expect(saved.recentError).toBeNull();
    expect(await database.select().from(schema.rankedSnapshots)).toEqual(snapshots);
  });

  it("preserves a historical error after successful rank and recent coverage", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(503));
    await expect(syncBackfillPlayer(player.id, riot)).rejects.toThrow();
    const failed = await row(player.id);
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncRecentPlayer(player.id, riot);
    const saved = await row(player.id);
    expect(saved.backfillError).toEqual(failed.backfillError);
    expect(saved.backfillStatus).toBe("failed");
    expect(saved.backfillUpdatedAt).toEqual(failed.backfillUpdatedAt);
    expect(saved.scanEnd).toEqual(failed.scanEnd);
    expect(saved.syncError).toBe(failed.backfillError?.message);
    expect(saved.lastSyncAttempt).toMatchObject({ phase: "recent", outcome: "success" });
    expect(saved.recentError).toBeNull();
    expect(saved.lastSyncedAt).not.toBeNull();
  });

  it("does not let historical success erase a recent error", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(503));
    await expect(syncRecentPlayer(player.id, riot)).rejects.toThrow();
    const failed = await row(player.id);
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncBackfillPlayer(player.id, riot);
    const saved = await row(player.id);
    expect(saved.recentError).toEqual(failed.recentError);
    expect(saved.rankCheckedAt).toEqual(failed.rankCheckedAt);
    expect(saved.lastSyncedAt).toBeNull();
    expect(saved.backfillError).toBeNull();
    expect(saved.backfillStatus).toBe("completed");
    expect(saved.syncError).toBe(failed.recentError?.message);
    expect(saved.lastSyncAttempt).toMatchObject({ phase: "history", outcome: "success" });
  });

  it("clears only the resolved phase and retires classified legacy errors after all recover", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(404));
    await expect(syncBackfillPlayer(player.id, riot)).rejects.toThrow();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(503));
    await expect(syncRecentPlayer(player.id, riot)).rejects.toThrow();
    vi.mocked(riot.leagues).mockRejectedValue(new RiotError(403));
    await expect(syncRecentPlayer(player.id, riot)).rejects.toThrow();
    const failed = await row(player.id);
    expect(failed.rankError).toMatchObject({ code: 403, step: "league" });
    vi.mocked(riot.leagues).mockResolvedValue([]);
    await syncRecentPlayer(player.id, riot, { rankOnly: true });
    const rankRecovered = await row(player.id);
    expect(rankRecovered.rankError).toBeNull();
    expect(rankRecovered.recentError).toEqual(failed.recentError);
    expect(rankRecovered.backfillError).toEqual(failed.backfillError);
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncRecentPlayer(player.id, riot);
    const recentRecovered = await row(player.id);
    expect(recentRecovered.recentError).toBeNull();
    expect(recentRecovered.backfillError).toEqual(failed.backfillError);
    expect(recentRecovered.syncError).toBe(failed.backfillError?.message);
    await syncBackfillPlayer(player.id, riot);
    const recovered = await row(player.id);
    expect(recovered).toMatchObject({
      rankError: null,
      recentError: null,
      backfillError: null,
      syncError: null,
    });
  });

  it("keeps old attempts and rank checks unknown, without classifying legacy errors", async () => {
    const player = await addPlayer();
    await database
      .update(schema.players)
      .set({
        syncError: "Unclassified old error",
        updatedAt: new Date(),
        lastSyncedAt: new Date("2026-09-01T00:00:00Z"),
      })
      .where(eq(schema.players.id, player.id));
    const unknown = toPlayerSyncState(await row(player.id));
    expect(unknown.rank).toEqual({ checkedAt: null, error: null });
    expect(unknown.lastAttempt).toBeNull();
    expect(unknown.recent.coveredThrough).toBe("2026-09-01T00:00:00.000Z");
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncRecentPlayer(player.id, riot);
    await syncBackfillPlayer(player.id, riot);
    expect((await row(player.id)).syncError).toBe("Unclassified old error");
  });

  it("preserves recent partial progress and the historical cursor across retries", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["new_a", "new_b"]);
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => ({
      ...match(id),
      info: { ...match(id).info, gameStartTimestamp: Date.now() - 3600_000 },
    }));
    expect(await syncRecentPlayer(player.id, riot, { budget: 1 })).toMatchObject({
      status: "partial",
      imported: 1,
    });
    const partial = await row(player.id);
    expect(partial.lastSyncedAt).toBeNull();
    expect(partial.lastSyncAttempt).toMatchObject({ phase: "recent", outcome: "partial" });
    expect(partial.scanStart).toEqual(player.scanStart);
    expect(partial.scanEnd).toBeNull();
    expect(partial.backfillStatus).toBe("not_started");
    expect(await syncRecentPlayer(player.id, riot, { budget: 1 })).toMatchObject({
      status: "complete",
      imported: 1,
    });
    const saved = await row(player.id);
    expect(saved.lastSyncedAt).not.toBeNull();
    expect(saved.lastSyncAttempt).toMatchObject({ phase: "recent", outcome: "success" });
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(riot.match).toHaveBeenCalledTimes(2);
  });

  it("preserves historical partial cursors, distinguishes deadlines and recovers without duplicates", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["old_a", "old_b", "old_c"]);
    expect(await syncBackfillPlayer(player.id, riot, 1)).toMatchObject({
      status: "partial",
      imported: 1,
    });
    const partial = await row(player.id);
    expect(partial).toMatchObject({
      scanPending: ["old_b", "old_c"],
      scanOffset: 3,
      backfillProcessed: 1,
      backfillDiscovered: 3,
      backfillError: null,
      lastSyncAttempt: { phase: "history", outcome: "partial" },
    });
    vi.mocked(riot.match).mockRejectedValue(new SyncDeadline());
    await expect(syncBackfillPlayer(player.id, riot)).rejects.toBeInstanceOf(SyncDeadline);
    const paused = await row(player.id);
    expect(paused.scanPending).toEqual(partial.scanPending);
    expect(paused.scanEnd).toEqual(partial.scanEnd);
    expect(paused.backfillProcessed).toBe(1);
    expect(paused).toMatchObject({
      backfillStatus: "running",
      backfillError: { code: "deadline" },
      lastSyncAttempt: { phase: "history", outcome: "partial" },
    });
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => match(id));
    await syncBackfillPlayer(player.id, riot);
    const saved = await row(player.id);
    expect(saved).toMatchObject({
      backfillStatus: "completed",
      backfillProcessed: 3,
      scanPending: [],
      backfillError: null,
      syncError: null,
      lastSyncedAt: null,
    });
    expect(await database.select().from(schema.playerMatches)).toHaveLength(3);
    expect(riot.matchIds).toHaveBeenCalledTimes(1);
  });

  it("does not clear an unresolved error on a merely partial retry", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockRejectedValue(new RiotError(503));
    await expect(syncBackfillPlayer(player.id, riot)).rejects.toThrow();
    const failed = await row(player.id);
    vi.mocked(riot.matchIds).mockResolvedValue(["pending_a", "pending_b"]);
    await syncBackfillPlayer(player.id, riot, 1);
    const partial = await row(player.id);
    expect(partial.backfillError).toEqual(failed.backfillError);
    expect(partial.syncError).toBe(failed.syncError);
    expect(partial.lastSyncAttempt).toMatchObject({ phase: "history", outcome: "partial" });
    expect(partial.backfillProcessed).toBe(1);
  });

  it("records a preparation failure without pretending LEAGUE-V4 was checked", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.identity).mockRejectedValue(new RiotError(404));
    await expect(syncRecentPlayer(player.id, riot)).rejects.toThrow();
    expect(await row(player.id)).toMatchObject({
      rankCheckedAt: null,
      rankError: { code: 404, step: "identity" },
      lastSyncAttempt: { phase: "rank", outcome: "failed" },
      lastAttemptAt: null,
      lastSyncedAt: null,
    });
    expect(riot.leagues).not.toHaveBeenCalled();
  });

  it("rolls back the check timestamp with snapshots if rank persistence fails", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncRecentPlayer(player.id, riot, { rankOnly: true });
    const checkedAt = new Date("2026-09-01T00:00:00Z");
    await database
      .update(schema.players)
      .set({ rankCheckedAt: checkedAt })
      .where(eq(schema.players.id, player.id));
    const snapshots = await database.select().from(schema.rankedSnapshots);
    await pg.exec(
      "alter table ranked_snapshots add constraint test_lp_limit check (league_points <= 100)",
    );
    try {
      vi.mocked(riot.leagues).mockResolvedValue([
        {
          queueType: "RANKED_SOLO_5x5",
          tier: "DIAMOND",
          rank: "II",
          leaguePoints: 200,
          wins: 11,
          losses: 5,
        },
      ]);
      await expect(syncRecentPlayer(player.id, riot, { rankOnly: true })).rejects.toThrow();
      expect(await row(player.id)).toMatchObject({
        rankCheckedAt: checkedAt,
        rankError: { code: "internal", step: "snapshots" },
        lastSyncAttempt: { phase: "rank", outcome: "failed" },
      });
      expect(await database.select().from(schema.rankedSnapshots)).toEqual(snapshots);
    } finally {
      await pg.exec("alter table ranked_snapshots drop constraint test_lp_limit");
    }
  });
});
describe("PostgreSQL migrations and data integrity", () => {
  it("keeps remakes visible in history while excluding them from public combat aggregates", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_normal", "LA2_remake", "LA2_short"]);
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      const result = match(id);
      if (id !== "LA2_normal") result.info.gameDuration = 86;
      if (id === "LA2_remake") {
        result.info.participants[0].win = false;
        result.info.participants[1].gameEndedInEarlySurrender = true;
      }
      return result;
    });
    await syncPlayer(player.id, riot);
    const [playerView] = await getLeaderboard("soloq");
    expect(playerView.stats).toMatchObject({
      games: 2,
      wins: 2,
      losses: 0,
      kills: 14,
      duration: 1886,
    });
    expect(playerView.rank).toMatchObject({ wins: 10, losses: 5 });
    expect(playerView.recent.find((m) => m.matchId === "LA2_remake")?.isRemake).toBe(true);
    expect(playerView.recent.find((m) => m.matchId === "LA2_short")?.isRemake).toBe(false);
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.recent).toHaveLength(3);
    expect(profile?.recent.find((m) => m.matchId === "LA2_remake")?.isRemake).toBe(true);
    expect(profile?.champions[0].games).toBe(2);
    expect((await getLeaderboard("5v5"))[0].stats.losses).toBe(0);
  });
  it("bounds momentum to 30 queue-specific observations and preserves the newest rank", async () => {
    const player = await addPlayer();
    await database.insert(schema.rankedSnapshots).values([
      ...Array.from({ length: 35 }, (_, i) => ({
        playerId: player.id,
        queue: "RANKED_SOLO_5x5" as const,
        tier: "MASTER",
        division: "I",
        leaguePoints: 20 * i,
        wins: i,
        losses: 0,
        timestamp: new Date(Date.UTC(2026, 9, 1, i)),
      })),
      {
        playerId: player.id,
        queue: "RANKED_FLEX_SR" as const,
        tier: "GOLD",
        division: "II",
        leaguePoints: 42,
        wins: 9,
        losses: 7,
        timestamp: new Date(Date.UTC(2026, 9, 3)),
      },
    ]);
    const [soloq] = await getLeaderboard("soloq");
    expect(soloq.rank?.leaguePoints).toBe(680);
    expect(soloq.momentum).toMatchObject({ net: 580, intervals: 29, perWin: 20, games: 29 });
    const [flex] = await getLeaderboard("flex");
    expect(flex.rank?.leaguePoints).toBe(42);
    expect(flex.momentum?.net).toBeNull();
    expect((await getLeaderboard("5v5"))[0].momentum).toBeNull();
  });
  it("enables RLS and denies ordinary database roles access without policies", async () => {
    const result = await pg.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname='public'",
    );
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.rowsecurity)).toBe(true);
    await addPlayer();
    await pg.exec(
      "CREATE ROLE test_reader; GRANT USAGE ON SCHEMA public TO test_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO test_reader; SET ROLE test_reader",
    );
    try {
      expect((await pg.query("select * from players")).rows).toEqual([]);
    } finally {
      await pg.exec("RESET ROLE; DROP OWNED BY test_reader; DROP ROLE test_reader");
    }
  });
  it("reads correct public aggregates without exposing PUUID and hides paused players", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(Array.from({ length: 8 }, (_, i) => `LA2_${i}`));
    await syncPlayer(player.id, riot);
    const [publicPlayer] = await getLeaderboard("soloq");
    expect(publicPlayer.stats.games).toBe(8);
    expect(publicPlayer.stats.cs).toBe(1600);
    expect(publicPlayer.rank?.leaguePoints).toBe(73);
    expect(publicPlayer.recent).toHaveLength(5);
    expect(publicPlayer.recent[0]).toMatchObject({
      champion: "Ahri",
      championId: 103,
      matchId: "LA2_7",
      win: true,
    });
    expect(publicPlayer.momentum?.net).toBeNull();
    expect(publicPlayer).not.toHaveProperty("puuid");
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.champions[0].games).toBe(8);
    expect(profile?.recent).toHaveLength(8);
    expect(profile?.history).toHaveLength(1);
    expect((await getLeaderboard("flex"))[0].stats.games).toBe(0);
    expect((await getLeaderboard("5v5"))[0].rank).toBeNull();
    expect((await getLeaderboard("5v5"))[0].momentum).toBeNull();
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    expect(await getLeaderboard("soloq")).toEqual([]);
    expect(await getProfile(player.id, "soloq")).toBeNull();
  });
  it("stores only a session hash and supports logout, expiry and secret rotation", async () => {
    await createSession();
    const token = cookieJar.get(sessionCookie);
    expect(token).toHaveLength(64);
    const [session] = await database.select().from(schema.adminSessions);
    expect(session.tokenHash).not.toBe(token);
    expect(await authenticated()).toBe(true);
    vi.stubEnv("ADMIN_SESSION_SECRET", "rotated-secret".repeat(4));
    expect(await authenticated()).toBe(false);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret".repeat(4));
    await database.update(schema.adminSessions).set({ expiresAt: new Date(0) });
    expect(await authenticated()).toBe(false);
    await createSession();
    expect(await authenticated()).toBe(true);
    await destroySession();
    expect(await authenticated()).toBe(false);
    expect(await database.select().from(schema.adminSessions)).toHaveLength(0);
  });
  it("rejects duplicate PUUIDs", async () => {
    await addPlayer();
    await expect(addPlayer()).rejects.toThrow();
  });
  it("sync is idempotent and persists identity, rank changes, matches and KP", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.matches)).toHaveLength(1);
    const participants = await database.select().from(schema.playerMatches);
    expect(participants).toHaveLength(1);
    expect(participants[0].cs).toBe(200);
    expect(participants[0].killParticipation).toBeCloseTo(15 / 17);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    expect(riot.match).toHaveBeenCalledTimes(1);
    vi.mocked(riot.leagues).mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 90,
        wins: 11,
        losses: 5,
      },
    ]);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(3);
    const [updated] = await database.select().from(schema.players);
    expect(updated.gameName).toBe("Renamed");
    expect(updated.lastSyncedAt).toBeNull(); // Historical completion is not recent coverage.
    expect(updated.scanEnd).toBeNull();
  });
  it("resumes failed pages without advancing the cursor or losing completed matches", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_1", "LA2_2"]);
    vi.mocked(riot.match)
      .mockResolvedValueOnce(match("LA2_1"))
      .mockRejectedValueOnce(new RiotError(503));
    await expect(syncPlayer(player.id, riot)).rejects.toThrow();
    const [partial] = await database.select().from(schema.players);
    expect(partial.scanStart).toEqual(seasonStart(player.platform));
    expect(partial.scanOffset).toBe(2);
    expect(partial.scanPending).toEqual(["LA2_2"]);
    expect(partial.backfillStatus).toBe("failed");
    expect(partial.backfillProcessed).toBe(1);
    expect(partial.scanEnd).not.toBeNull();
    expect(partial.lastSyncedAt).toBeNull();
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(vi.mocked(riot.match).mock.calls.filter((c) => c[1] === "LA2_1")).toHaveLength(1);
  });
  it("does not import excluded modes or sync disabled players", async () => {
    const player = await addPlayer();
    const riot = client();
    const aram = match("LA2_1");
    aram.info.queueId = 450;
    vi.mocked(riot.match).mockResolvedValue(aram);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.matches)).toHaveLength(0);
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    vi.mocked(riot.identity).mockClear();
    expect((await syncPlayer(player.id, riot)).status).toBe("skipped");
    expect(riot.identity).not.toHaveBeenCalled();
  });
  it("cascade deletes personal rows while retaining shared matches", async () => {
    const player = await addPlayer();
    await syncPlayer(player.id, client());
    const other = await addPlayer("other");
    const [stats] = await database.select().from(schema.playerMatches);
    await database.insert(schema.playerMatches).values({ ...stats, playerId: other.id });
    await database.delete(schema.players).where(eq(schema.players.id, player.id));
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    await database.execute(
      sql`delete from matches m where not exists (select 1 from player_matches pm where pm.match_id=m.id)`,
    );
    expect(await database.select().from(schema.matches)).toHaveLength(1);
    await database.delete(schema.players).where(eq(schema.players.id, other.id));
    await database.execute(
      sql`delete from matches m where not exists (select 1 from player_matches pm where pm.match_id=m.id)`,
    );
    expect(await database.select().from(schema.matches)).toHaveLength(0);
  });
  it("uses an atomic shared lease and preserves Retry-After across invocations", async () => {
    await expect(
      withSyncLease(async () => {
        await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
        throw new RiotError(429, 300000);
      }),
    ).rejects.toBeInstanceOf(RiotError);
    const [lock] = await database.select().from(schema.syncLocks);
    expect(lock.expiresAt.getTime()).toBeGreaterThan(Date.now() + 295000);
    await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
  });
  it("recovers an expired interrupted lease and prevents its old owner from releasing the new one", async () => {
    const oldOwner = "00000000-0000-4000-8000-000000000001";
    await database
      .insert(schema.syncLocks)
      .values({ name: "riot", owner: oldOwner, expiresAt: new Date(0), lastOutcome: "running" });
    await withSyncLease(async () => {
      const [acquired] = await database.select().from(schema.syncLocks);
      expect(acquired.owner).not.toBe(oldOwner);
      expect(acquired.expiresAt.getTime()).toBeGreaterThan(Date.now() + 320000);
      await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
      // Simulate replacement following expiry; the prior worker's finally must not release it.
      await database
        .update(schema.syncLocks)
        .set({ owner: oldOwner, expiresAt: new Date(Date.now() + 60000) });
    });
    const [remaining] = await database.select().from(schema.syncLocks);
    expect(remaining.owner).toBe(oldOwner);
    expect(remaining.expiresAt.getTime()).toBeGreaterThan(Date.now() + 58000);
  });
  it("shares the login rate limit atomically across concurrent attempts", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => allowLogin()));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    await database
      .update(schema.loginAttempts)
      .set({ resetsAt: new Date(0) })
      .where(and(eq(schema.loginAttempts.key, "admin")));
    expect(await allowLogin()).toBe(true);
  });
});

describe("resumable season history", () => {
  it("starts a bounded history batch when the administrator adds an account", async () => {
    vi.stubEnv("APP_URL", "http://localhost");
    await createSession();
    const riot = client();
    const ids = Array.from({ length: 7 }, (_, i) => `LA2_new_${i}`);
    const account = { puuid: "stable-puuid", gameName: "Example", tagLine: "LAS" };
    const mocks = [
      vi.spyOn(RiotClient.prototype, "account").mockResolvedValue(account),
      vi.spyOn(RiotClient.prototype, "identity").mockResolvedValue(account),
      vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 }),
      vi
        .spyOn(RiotClient.prototype, "leagues")
        .mockResolvedValue(await riot.leagues("LA2", account.puuid)),
      vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue(ids),
      vi.spyOn(RiotClient.prototype, "match").mockImplementation(async (_p, id) => {
        const result = match(id);
        result.info.gameStartTimestamp = Date.now() - 3600_000;
        return result;
      }),
    ];
    try {
      const response = await createPlayer(
        new Request("http://localhost/api/admin/players", {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify({ gameName: "Example", tagLine: "LAS", platform: "LA2" }),
        }),
      );
      expect(response.status).toBe(201);
      expect((await database.select().from(schema.players))[0]).toMatchObject({
        backfillStatus: "running",
        backfillProcessed: 5,
        backfillDiscovered: 7,
        scanPending: ids.slice(5),
      });
      expect(await database.select().from(schema.playerMatches)).toHaveLength(5);
      expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    } finally {
      mocks.forEach((mock) => mock.mockRestore());
    }
  });
  it.each([0, 1, 99, 100, 101, 205])(
    "paginates %i IDs across bounded batches, then switches to incremental",
    async (count) => {
      const player = await addPlayer();
      const riot = client();
      const ids = Array.from({ length: count }, (_, i) => `LA2_page_${i}`);
      vi.mocked(riot.matchIds).mockImplementation(async (_platform, _puuid, _start, _end, offset) =>
        ids.slice(offset, offset + 100),
      );
      let result = await syncPlayer(player.id, riot, { budget: 17 });
      let batches = 1;
      while (result.status === "partial" && batches < 30) {
        result = await syncPlayer(player.id, riot, { budget: 17 });
        batches++;
      }
      expect(result.status).toBe("complete");
      expect(vi.mocked(riot.matchIds).mock.calls.map((c) => c[4])).toEqual(
        Array.from({ length: Math.floor(count / 100) + 1 }, (_, i) => i * 100),
      );
      expect(new Set(vi.mocked(riot.matchIds).mock.calls.map((c) => c[3])).size).toBe(1);
      expect(vi.mocked(riot.matchIds).mock.calls[0][2]).toBe(
        seasonStart(player.platform).getTime() / 1000,
      );
      const [state] = await database.select().from(schema.players);
      expect(state).toMatchObject({
        backfillStatus: "completed",
        backfillSeason: CURRENT_SEASON.id,
        backfillProcessed: count,
        backfillDiscovered: count,
        scanPending: [],
        scanOffset: 0,
      });
      expect(state.lastBackfillAt).not.toBeNull();
      expect(state.scanStart.getTime()).toBeGreaterThan(Date.now() - 2 * 86400_000);
      expect(await database.select().from(schema.playerMatches)).toHaveLength(count);
      expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
      vi.mocked(riot.matchIds).mockResolvedValue([]);
      await syncPlayer(player.id, riot);
      expect(vi.mocked(riot.matchIds).mock.lastCall?.[2]).toBe(
        Math.floor(state.scanStart.getTime() / 1000),
      );
      expect(await database.select().from(schema.playerMatches)).toHaveLength(count);
    },
  );
  it("saves cursor through expired keys, duplicate IDs and unavailable details", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_a", "LA2_a", "LA2_b", "LA2_gone"]);
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      if (id === "LA2_b") throw new RiotError(403);
      if (id === "LA2_gone") throw new RiotError(404);
      return match(id);
    });
    await expect(syncPlayer(player.id, riot)).rejects.toMatchObject({ status: 403 });
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "failed",
      backfillProcessed: 1,
      scanPending: ["LA2_b", "LA2_gone"],
    });
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      if (id === "LA2_gone") throw new RiotError(404);
      return match(id);
    });
    await syncPlayer(player.id, riot);
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "completed",
      backfillProcessed: 3,
      backfillDiscovered: 3,
      backfillUnavailable: 1,
    });
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(riot.matchIds).toHaveBeenCalledTimes(1);
  });
  it("safely yields on a deadline and rank-only creation never requests match history", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot, { rankOnly: true });
    expect(riot.matchIds).not.toHaveBeenCalled();
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_a", "LA2_b"]);
    vi.mocked(riot.match)
      .mockResolvedValueOnce(match("LA2_a"))
      .mockRejectedValueOnce(new SyncDeadline());
    await expect(syncPlayer(player.id, riot)).rejects.toBeInstanceOf(SyncDeadline);
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "running",
      backfillProcessed: 1,
      scanPending: ["LA2_b"],
    });
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
  });
  it("restarts the season cursor after a configuration change without destroying existing data", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot);
    await database
      .update(schema.players)
      .set({ backfillSeason: "2025", scanOffset: 987, scanPending: ["OLD"] })
      .where(eq(schema.players.id, player.id));
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncPlayer(player.id, riot);
    expect(vi.mocked(riot.matchIds).mock.lastCall?.[4]).toBe(0);
    expect(vi.mocked(riot.matchIds).mock.lastCall?.[2]).toBe(seasonStart("LA2").getTime() / 1000);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
  });
  it("aggregates the complete season, filters 30d/7d without deleting, and keeps LP history short", async () => {
    const player = await addPlayer();
    const riot = client();
    const now = Date.now();
    const rows = [
      { id: "LA2_old", age: 90 },
      { id: "LA2_month", age: 10 },
      { id: "LA2_week", age: 2 },
      { id: "LA2_remake", age: 1 },
    ];
    vi.mocked(riot.matchIds).mockResolvedValue(rows.map((r) => r.id));
    vi.mocked(riot.match).mockImplementation(async (_p, id) => {
      const m = match(id);
      m.info.gameStartTimestamp = now - rows.find((r) => r.id === id)!.age * 86400_000;
      m.info.participants[0].win = id !== "LA2_month";
      if (id === "LA2_remake") m.info.participants[0].gameEndedInEarlySurrender = true;
      return m;
    });
    await syncPlayer(player.id, riot);
    expect((await getLeaderboard("soloq", "season"))[0].stats).toMatchObject({
      games: 3,
      wins: 2,
      losses: 1,
    });
    expect((await getLeaderboard("soloq", "30d"))[0].stats.games).toBe(2);
    expect((await getLeaderboard("soloq", "7d"))[0].stats.games).toBe(1);
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.performance).toHaveLength(3);
    expect(profile?.performance.at(-1)).toMatchObject({ sample: 3, winrate: 200 / 3 });
    expect(Date.parse(profile!.performance[0].timestamp)).toBeLessThan(now - 30 * 86400_000);
    expect(Date.parse(profile!.trackingSince!)).toBeGreaterThan(now - 60_000);
    const season = await getSeasonOverview("soloq", "season");
    expect(season.uniqueGames).toBe(3);
    expect(season.champions[0]).toMatchObject({ games: 3, wins: 2 });
    expect(season.recentForm).toEqual([{ playerId: player.id, games: 3, wins: 2 }]);
    expect(season.activity.reduce((n, p) => n + p.games, 0)).toBe(3);
    expect((await getSeasonOverview("soloq", "7d")).uniqueGames).toBe(1);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(4);
  });
  it("bounds recent form at twenty non-remakes and excludes disabled players and other queues", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(
      Array.from({ length: 24 }, (_, i) => `LA2_form_${i}`),
    );
    vi.mocked(riot.match).mockImplementation(async (_p, id) => {
      const m = match(id),
        index = Number(id.split("_").at(-1));
      m.info.gameStartTimestamp = Date.now() - (24 - index) * 3600_000;
      m.info.participants[0].win = index < 10;
      if (index === 22) m.info.participants[0].gameEndedInEarlySurrender = true;
      if (index === 23) m.info.queueId = 440;
      return m;
    });
    await syncPlayer(player.id, riot);
    expect((await getSeasonOverview("soloq", "season")).recentForm).toEqual([
      { playerId: player.id, games: 20, wins: 8 },
    ]);
    expect((await getSeasonOverview("flex", "season")).recentForm[0].games).toBe(1);
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    const hidden = await getSeasonOverview("soloq", "season");
    expect(hidden.recentForm).toEqual([]);
    expect(hidden.champions).toEqual([]);
    expect(hidden.uniqueGames).toBe(0);
  });
});

describe("weekly ladder baselines and global sync metadata", () => {
  it("the global service records complete recent runs but not an incomplete recent window", async () => {
    await addPlayer();
    const spies = [
      vi
        .spyOn(RiotClient.prototype, "identity")
        .mockResolvedValue({ puuid: "stable-puuid", gameName: "Example", tagLine: "LAS" }),
      vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 }),
      vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]),
      vi.spyOn(RiotClient.prototype, "match").mockImplementation(async (_platform, id) => {
        const result = match(id);
        result.info.gameStartTimestamp = Date.now() - 3600_000;
        return result;
      }),
    ];
    const ids = vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    try {
      expect((await syncAllPlayers()).results[0].status).toBe("complete");
      const last = (await getSyncStatus()).lastSuccessfulSyncAt;
      expect(last).not.toBeNull();
      await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
      ids.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `LA2_weekly_${i}`));
      expect((await syncAllPlayers()).results[0].status).toBe("partial");
      expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(last);
      expect((await getSyncStatus()).status).toBe("partial");
    } finally {
      ids.mockRestore();
      for (const spy of spies) spy.mockRestore();
    }
  });
  it("isolates the displayed five beyond 30 snapshots without changing profile momentum", async () => {
    const player = await addPlayer();
    const start = Date.now() - 12 * 3600_000;
    const base = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "GOLD",
      division: "I",
      leaguePoints: 58,
      wins: 18,
      losses: 23,
    };
    await database
      .insert(schema.rankedSnapshots)
      .values([
        { ...base, timestamp: new Date(start) },
        ...Array.from({ length: 40 }, (_, i) => ({
          ...base,
          timestamp: new Date(start + 2 * 3600_000 + (i + 1) * 10000),
        })),
        {
          ...base,
          leaguePoints: 26,
          wins: 19,
          losses: 27,
          timestamp: new Date(start + 7 * 3600_000),
        },
      ]);
    for (let i = 0; i < 5; i++) {
      const id = `LA2_verified_${i}`;
      await database
        .insert(schema.matches)
        .values({
          id,
          queueId: 420,
          mapId: 11,
          timestamp: new Date(start + (i + 2) * 3600_000),
          duration: 1800,
          isRemake: false,
        });
      await database
        .insert(schema.playerMatches)
        .values({
          playerId: player.id,
          matchId: id,
          champion: "Ahri",
          championId: 103,
          position: "MIDDLE",
          win: i === 4,
          kills: 1,
          deaths: 1,
          assists: 1,
          cs: 100,
          damage: 1000,
          killParticipation: 0.5,
        });
    }
    const [row] = await getLeaderboard("soloq");
    expect(row.lastFiveLp?.net).toBe(-32);
    expect(row.recent.map((m) => m.matchId)).toEqual(
      [4, 3, 2, 1, 0].map((i) => `LA2_verified_${i}`),
    );
    expect(row.momentum?.intervals).toBe(29);
    await database
      .insert(schema.matches)
      .values({
        id: "LA2_extra_remake",
        queueId: 420,
        mapId: 11,
        timestamp: new Date(start + 3600_000),
        duration: 120,
        isRemake: true,
      });
    await database
      .insert(schema.playerMatches)
      .values({
        playerId: player.id,
        matchId: "LA2_extra_remake",
        champion: "Ahri",
        championId: 103,
        position: "MIDDLE",
        win: false,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        damage: 0,
        killParticipation: 0,
      });
    expect((await getLeaderboard("soloq"))[0].lastFiveLp?.net).toBeNull();
  });
  it("returns a partial weekly reference and official V/D for exactly the same interval", async () => {
    const player = await addPlayer();
    const base = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "GOLD",
      division: "I",
      leaguePoints: 58,
      wins: 18,
      losses: 23,
    };
    await database.insert(schema.rankedSnapshots).values([
      { ...base, timestamp: new Date("2026-10-06T10:00:00Z") },
      {
        ...base,
        leaguePoints: 26,
        wins: 19,
        losses: 27,
        timestamp: new Date("2026-10-06T16:00:00Z"),
      },
    ]);
    expect(
      (await getWeeklyLpSummary([player.id], "soloq", new Date("2026-10-10T18:00:00Z"))).get(
        player.id,
      ),
    ).toMatchObject({
      net: -32,
      wins: 1,
      losses: 4,
      partial: true,
      from: "2026-10-06T10:00:00.000Z",
      to: "2026-10-06T16:00:00.000Z",
    });
  });
  it("reads the Monday baseline beyond 30 observations and isolates both queues", async () => {
    const player = await addPlayer();
    const fresh = await addPlayer("new-midweek");
    const now = new Date("2026-10-06T18:00:00Z");
    const base = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "PLATINUM",
      division: "I",
      leaguePoints: 80,
      wins: 20,
      losses: 10,
    };
    await database.insert(schema.rankedSnapshots).values([
      { ...base, timestamp: new Date("2026-10-04T23:00:00Z") },
      ...Array.from({ length: 40 }, (_, n) => ({
        ...base,
        timestamp: new Date(Date.parse("2026-10-05T04:00:00Z") + n * 60000),
        leaguePoints: 81,
      })),
      { ...base, tier: "EMERALD", division: "IV", leaguePoints: 5, timestamp: now },
      { ...base, tier: "INVALID", timestamp: new Date(now.getTime() - 1) },
      { ...base, playerId: fresh.id, timestamp: new Date("2026-10-05T05:00:00Z") },
      {
        ...base,
        queue: "RANKED_FLEX_SR",
        tier: "MASTER",
        leaguePoints: 350,
        timestamp: new Date("2026-10-05T03:00:00Z"),
      },
      {
        ...base,
        queue: "RANKED_FLEX_SR",
        tier: "GRANDMASTER",
        leaguePoints: 370,
        timestamp: now,
      },
    ]);
    const solo = await getWeeklyLp([player.id, fresh.id], "soloq", now);
    expect(solo.get(player.id)).toBeNull(); // Invalid intervening rank must not be bridged.
    expect(solo.get(fresh.id)).toBeNull();
    expect((await getWeeklyLp([player.id], "flex", now)).get(player.id)).toBe(20);
    expect(await getWeeklyLp([player.id], "5v5", now)).toEqual(new Map());
  });
  it("returns zero for an unchanged baseline but never bridges seasons", async () => {
    const player = await addPlayer();
    const values = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "GOLD",
      division: "II",
      leaguePoints: 50,
      wins: 20,
      losses: 10,
    };
    await database
      .insert(schema.rankedSnapshots)
      .values({ ...values, timestamp: new Date("2026-10-04T23:00:00Z") });
    expect(
      (await getWeeklyLp([player.id], "soloq", new Date("2026-10-06T18:00:00Z"))).get(player.id),
    ).toBeNull(); // A single observation cannot define a weekly interval.
    await database.delete(schema.rankedSnapshots);
    await database.insert(schema.rankedSnapshots).values([
      { ...values, timestamp: new Date("2025-12-01T00:00:00Z") },
      { ...values, timestamp: new Date("2026-10-06T00:00:00Z") },
    ]);
    expect(
      (await getWeeklyLp([player.id], "soloq", new Date("2026-10-06T18:00:00Z"))).get(player.id),
    ).toBeNull();
  });
  it("records only successful complete global runs; partial, errors and individual jobs preserve success", async () => {
    const release = () => database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    const policy = { successful: (complete: boolean) => complete };
    expect((await getSyncStatus()).status).toBe("never");
    await withSyncLease(
      async () => {
        expect((await getSyncStatus()).status).toBe("running");
        return true;
      },
      230000,
      policy,
    );
    const success = await getSyncStatus();
    expect(success.lastSuccessfulSyncAt).not.toBeNull();
    expect(success.status).toBe("success");
    expect(
      Date.parse(success.nextExpectedSyncAt!) - Date.parse(success.lastSuccessfulSyncAt!),
    ).toBe(600000);
    await release();
    await withSyncLease(async () => false, 230000, policy);
    expect((await getSyncStatus()).status).toBe("partial");
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    await release();
    await expect(
      withSyncLease(
        async () => {
          throw new Error("failed run");
        },
        230000,
        policy,
      ),
    ).rejects.toThrow("failed run");
    expect((await getSyncStatus()).status).toBe("failed");
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    await release();
    await withSyncLease(async () => true);
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    expect((await getSyncStatus()).status).toBe("failed");
  });
  it("the public read-only endpoint reveals no lease owner or credentials and never calls Riot", async () => {
    const riot = vi.spyOn(RiotClient.prototype, "leagues");
    const response = await syncStatusRoute(new Request("http://localhost/api/ladder/sync-status"));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(
      [
        "lastSuccessfulSyncAt",
        "nextExpectedSyncAt",
        "updatedAt",
        "status",
        "schedulerConfigured",
        "serverNow",
      ].sort(),
    );
    expect(riot).not.toHaveBeenCalled();
    riot.mockRestore();
    expect(await database.select().from(schema.syncLocks)).toEqual([]);
  });
  it("treats an abandoned running lease as failure without fabricating a success", async () => {
    const now = new Date("2026-10-06T18:00:00Z");
    await database.insert(schema.syncLocks).values({
      name: "riot",
      owner: "00000000-0000-4000-8000-000000000001",
      expiresAt: new Date(0),
      lastStartedAt: new Date(now.getTime() - SYNC_LEASE_MS - 1),
      lastOutcome: "running",
    });
    expect((await getSyncStatus(now)).status).toBe("failed");
    expect((await getSyncStatus(now)).lastSuccessfulSyncAt).toBeNull();
  });
});

describe("durable execution progress and fencing (local PostgreSQL)", () => {
  const correlation = "00000000-0000-4000-8000-000000000099";
  beforeEach(() => {
    vi.stubEnv("APP_URL", "http://localhost");
    vi.spyOn(RiotClient.prototype, "identity").mockImplementation(async (_p, puuid) => ({
      puuid,
      gameName: "Example",
      tagLine: "LAS",
    }));
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "match").mockRejectedValue(new RiotError(404));
  });
  afterEach(() => vi.restoreAllMocks());
  const release = () => database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
  const read = () => readSyncProgress();

  it("starts atomically, returns a safe identity and retains complete global/recent coverage", async () => {
    const p = await addPlayer();
    const paused = await addPlayer("paused-progress");
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, paused.id));
    const result = await syncAllPlayers({ action: "global", requestId: correlation });
    const dto = await read();
    expect(dto.run).toMatchObject({
      runId: result.runId,
      requestId: correlation,
      state: "completed",
      recentOutcome: "success",
      recent: { eligible: 1, visited: 1, complete: 1 },
      history: { complete: 1 },
    });
    const [saved] = await database.select().from(schema.players).where(eq(schema.players.id, p.id));
    expect(dto.run?.players[0]).toMatchObject({
      rank: { checkedAt: saved.rankCheckedAt!.toISOString() },
      recent: { coveredThrough: saved.lastSyncedAt!.toISOString() },
      history: { history: { scanExhausted: true } },
    });
    expect(JSON.stringify(dto)).not.toMatch(/leaseOwner|puuid|stable-puuid/);
    expect((await getSyncStatus()).lastSuccessfulSyncAt).not.toBeNull();
  });
  it("rejects a concurrent acquisition without changing run data or executing work", async () => {
    let finish!: () => void;
    let ready!: () => void;
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = withSyncLease(
      async () => {
        ready();
        await wait;
      },
      230000,
      undefined,
      { action: "global" },
    );
    await acquired;
    const before = await read();
    const work = vi.fn();
    await expect(
      withSyncLease(work, 230000, undefined, { action: "global" }),
    ).rejects.toBeInstanceOf(SyncBusy);
    expect(await read()).toMatchObject({ run: before.run });
    expect(work).not.toHaveBeenCalled();
    finish();
    await first;
    expect((await read()).run?.state).toBe("completed");
  });
  it("fences a replaced owner, retains interrupted previous and never overwrites the newer result", async () => {
    const p = await addPlayer();
    let newerId: string | undefined;
    let oldId: string | undefined;
    await expect(
      withSyncLease(
        async (old) => {
          oldId = runIdentity(old).runId;
          await checkpoint(old, { type: "phase", phase: "rank", playerId: p.id });
          await release();
          expect((await read()).run?.state).toBe("possibly_interrupted");
          await withSyncLease(
            async (next) => {
              newerId = runIdentity(next).runId;
            },
            230000,
            undefined,
            { action: "player_recent", playerId: p.id },
          );
          await syncWrite(old, async (tx) => {
            await tx
              .update(schema.players)
              .set({ rankCheckedAt: new Date() })
              .where(eq(schema.players.id, p.id));
          });
        },
        230000,
        undefined,
        { action: "global" },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await read()).run).toMatchObject({ runId: newerId, state: "completed" });
    expect((await readSyncProgress({ runId: oldId })).run).toMatchObject({
      state: "interrupted",
      finishedAt: null,
    });
    expect((await database.select().from(schema.players))[0].rankCheckedAt).toBeNull();
  });
  it("rolls back business and progress when expiry occurs inside a write transaction", async () => {
    const p = await addPlayer();
    await expect(
      withSyncLease(
        async (client) => {
          await syncWrite(
            client,
            async (tx) => {
              await tx
                .update(schema.players)
                .set({ scanPending: ["must-rollback"], backfillProcessed: 99 })
                .where(eq(schema.players.id, p.id));
              await tx.update(schema.syncLocks).set({ expiresAt: new Date(0) });
            },
            { type: "import", pass: "history", playerId: p.id, imported: 1 },
          );
        },
        230000,
        undefined,
        { action: "player_history", playerId: p.id },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    const [row] = await database.select().from(schema.players);
    expect(row.scanPending).toEqual([]);
    expect(row.backfillProcessed).toBe(0);
    expect((await read()).run?.players).toEqual([]);
  });
  it("rejects a stale revision even if the lease owner is unchanged", async () => {
    const p = await addPlayer();
    await expect(
      withSyncLease(
        async (client) => {
          const context = leaseContext(client)!;
          const e = structuredClone(context.envelope!);
          e.latest.revision++;
          await database.update(schema.syncLocks).set({ runProgress: e });
          await checkpoint(client, {
            type: "rank",
            playerId: p.id,
            checkedAt: new Date().toISOString(),
          });
        },
        230000,
        undefined,
        { action: "global" },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await read()).run?.players).toEqual([]);
  });
  it("coalesces intermediate writes and flushes only committed counts at a result checkpoint", async () => {
    const p = await addPlayer();
    await withSyncLease(
      async (client) => {
        await checkpoint(client, { type: "select", pass: "history", ids: [p.id] });
        const revision = (await read()).run!.revision;
        for (let i = 0; i < 10; i++)
          await syncWrite(
            client,
            async (tx) => {
              await tx
                .update(schema.players)
                .set({ backfillProcessed: i + 1 })
                .where(eq(schema.players.id, p.id));
            },
            { type: "import", pass: "history", playerId: p.id, imported: 1 },
          );
        expect((await read()).run).toMatchObject({ revision, history: { imported: 0 } });
        await expect(
          syncWrite(
            client,
            async () => {
              throw new Error("transaction failed");
            },
            { type: "import", pass: "history", playerId: p.id, imported: 50 },
          ),
        ).rejects.toThrow("transaction failed");
        await checkpoint(client, {
          type: "result",
          pass: "history",
          result: { playerId: p.id, status: "partial", reason: "batch_limit" },
        });
        expect((await read()).run?.history?.imported).toBe(10);
      },
      230000,
      undefined,
      { action: "player_history", playerId: p.id },
    );
    expect((await read()).run?.state).toBe("partial");
  });
  it("preserves rank after recent failure and records a successful unchanged rank verification", async () => {
    const p = await addPlayer();
    await withSyncLease((c) => syncRecentPlayer(p.id, c), 230000, undefined, {
      action: "player_recent",
      playerId: p.id,
    });
    const count = (await database.select().from(schema.rankedSnapshots)).length;
    await release();
    vi.mocked(RiotClient.prototype.matchIds).mockRejectedValue(new RiotError(503));
    await expect(
      withSyncLease((c) => syncRecentPlayer(p.id, c), 230000, undefined, {
        action: "player_recent",
        playerId: p.id,
      }),
    ).rejects.toBeInstanceOf(RiotError);
    const dto = await read();
    expect(dto.run).toMatchObject({ state: "failed" });
    expect(dto.run?.players[0]).toMatchObject({
      rank: { outcome: "verified" },
      recent: { status: "error", error: { code: 503, step: "recent" }, coveredThrough: null },
    });
    expect((await database.select().from(schema.rankedSnapshots)).length).toBe(count);
  });
  it("continues an existing historical cursor and counts unavailable IDs without invented participations", async () => {
    const p = await addPlayer();
    const frozen = new Date(Date.now() - 120000);
    await database.update(schema.players).set({
      backfillSeason: CURRENT_SEASON.id,
      backfillStatus: "running",
      scanEnd: frozen,
      scanPending: ["unavailable-a", "unavailable-b"],
      scanOffset: 2,
      scanExhausted: true,
      backfillDiscovered: 2,
    });
    const first = await withSyncLease((c) => syncBackfillPlayer(p.id, c, 1), 230000, undefined, {
      action: "player_history",
      playerId: p.id,
    });
    expect(first.status).toBe("partial");
    expect((await database.select().from(schema.players))[0].scanPending).toEqual([
      "unavailable-b",
    ]);
    expect((await read()).run?.players[0].history?.history).toMatchObject({
      discovered: 2,
      processed: 1,
      unavailable: 1,
      cursorPending: 1,
      scanThrough: frozen.toISOString(),
    });
    await release();
    await withSyncLease((c) => syncBackfillPlayer(p.id, c, 1), 230000, undefined, {
      action: "player_history",
      playerId: p.id,
    });
    expect((await read()).run?.players[0].history?.history).toMatchObject({
      mode: "season_backfill",
      discovered: 2,
      processed: 2,
      unavailable: 2,
      scanExhausted: true,
    });
    expect((await read()).run?.history?.imported).toBe(0);
    expect(RiotClient.prototype.matchIds).not.toHaveBeenCalled();
    expect(await database.select().from(schema.playerMatches)).toEqual([]);
  });
  it("retains Retry-After cooldown and terminal state without marking queued players complete", async () => {
    const p = await addPlayer();
    vi.mocked(RiotClient.prototype.leagues).mockRejectedValue(new RiotError(429, 60000));
    await expect(
      syncAllPlayers({ action: "global", requestId: correlation }),
    ).rejects.toBeInstanceOf(RiotError);
    const dto = await read();
    expect(dto.run).toMatchObject({
      state: "failed",
      players: [{ playerId: p.id, recent: { error: { code: 429 } } }],
    });
    expect(dto.control).toMatchObject({ state: "cooldown", reason: "riot_retry_after" });
    expect(Date.parse(dto.control.until!) - Date.parse(dto.serverNow)).toBeGreaterThan(59000);
    const saved = (await database.select().from(schema.syncLocks))[0].runProgress;
    await expect(
      withSyncLease(async () => true, 230000, undefined, { action: "global" }),
    ).rejects.toBeInstanceOf(SyncBusy);
    expect((await database.select().from(schema.syncLocks))[0].runProgress).toEqual(saved);
  });
  it("correlates individual POST with durable GET, enforces auth and keeps GET read-only/no-store", async () => {
    const p = await addPlayer();
    const url = `http://localhost/api/admin/sync/progress?requestId=${correlation}`;
    expect((await progressRoute(new Request(url))).status).toBe(401);
    await createSession();
    const response = await individualSync(
      new Request(`http://localhost/api/admin/players/${p.id}/sync`, {
        method: "POST",
        headers: { origin: "http://localhost", "X-SoloQ-Sync-Request-Id": correlation },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.runId).toBeTruthy();
    const before = await database.select().from(schema.syncLocks);
    const get = await progressRoute(new Request(url));
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(await get.json()).toMatchObject({
      run: { runId: body.runId, requestId: correlation, state: "completed" },
    });
    expect(await database.select().from(schema.syncLocks)).toEqual(before);
    for (const query of [
      "?runId=invalid",
      `?requestId=${correlation}&runId=${body.runId}`,
      "?unknown=x",
    ])
      expect(
        (await progressRoute(new Request(`http://localhost/api/admin/sync/progress${query}`)))
          .status,
      ).toBe(400);
    await release();
    const work = vi.fn();
    await expect(
      withSyncLease(work, 230000, undefined, { action: "global", requestId: correlation }),
    ).rejects.toBeInstanceOf(SyncBusy);
    expect(work).not.toHaveBeenCalled();
  });
  it("evicts only the third-oldest execution and does not infer previous work from player timestamps", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await withSyncLease(
        async (c) => {
          ids.push(runIdentity(c).runId!);
        },
        230000,
        undefined,
        { action: "global" },
      );
      await release();
    }
    expect((await readSyncProgress({ runId: ids[0] })).run).toBeNull();
    expect((await readSyncProgress({ runId: ids[1] })).run?.runId).toBe(ids[1]);
    expect((await read()).run?.runId).toBe(ids[2]);
  });
});
