import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { DELETE } from "@/app/api/admin/players/[id]/route";
import { createSession } from "@/server/auth";
import { toAdminPlayer } from "@/server/admin-queries";
import { RiotClient, RiotError } from "@/server/riot/client";
import type { RiotMatch } from "@/server/riot/schemas";
import { normalizeParticipant } from "@/server/riot/normalize";
import { withSyncLease } from "@/server/sync/lease";
import {
  bindLease,
  checkpoint,
  LeaseLost,
  readSyncProgress,
  syncWrite,
} from "@/server/sync/progress";
import * as deletion from "@/server/sync/player-deletion";
import { syncAllPlayers, syncPlayer } from "@/server/sync/service";
import { insertMatchParticipation } from "@/server/sync/source-revision";
import { captureRemakeInTx } from "@/server/sync/ranked-evidence";
import { capturePageInTx, openMatchScansInTx } from "@/server/sync/match-evidence";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import {
  applyProgressEvent,
  finishRun,
  newRun,
  progressEnvelopeSchema,
  type ProgressEnvelope,
} from "@/lib/sync-progress";

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
beforeEach(async () => {
  await pg.exec("TRUNCATE players,matches,sync_locks,admin_sessions CASCADE");
  cookieJar.clear();
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("APP_URL", "http://localhost");
  vi.stubEnv("ADMIN_SESSION_SECRET", "synthetic-deletion-test-secret".repeat(3));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No operational transport in D13 tests");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => pg.close());
const row = async () => (await database.select().from(schema.syncLocks))[0];
const expire = () => database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
const request = (id: string) =>
  new Request(`http://localhost/api/admin/players/${id}`, {
    method: "DELETE",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
async function player(suffix: string) {
  return (
    await database
      .insert(schema.players)
      .values({
        puuid: `synthetic-private-${suffix}`,
        gameName: `Fixture${suffix}`,
        tagLine: "TEST",
        platform: "LA2",
        scanStart: seasonStart("LA2"),
        backfillSeason: CURRENT_SEASON.id,
      })
      .returning()
  )[0];
}
function run(a: string, b: string, owner: string, individual = false) {
  const now = new Date().toISOString();
  const value = newRun(
    {
      action: individual ? "player_history" : "global",
      ...(individual ? { playerId: a } : {}),
      requestId: randomUUID(),
    },
    owner,
    randomUUID(),
    now,
    CURRENT_SEASON.id,
  );
  for (const id of [a, b]) {
    applyProgressEvent(value, { type: "phase", phase: "history", playerId: id }, now);
    applyProgressEvent(value, { type: "rank", playerId: id, checkedAt: now }, now);
    applyProgressEvent(
      value,
      {
        type: "import",
        pass: "history",
        playerId: id,
        imported: 7,
        confirmedMatchId: id === a ? "LA2_101" : "LA2_102",
        history: {
          season: CURRENT_SEASON.id,
          mode: "season_backfill",
          discovered: 112,
          processed: 112,
          unavailable: 0,
          cursorPending: 0,
          scanExhausted: true,
          scanThrough: now,
        },
      },
      now,
    );
    applyProgressEvent(
      value,
      {
        type: "result",
        pass: "history",
        result: { playerId: id, status: "complete", imported: 7 },
      },
      now,
    );
  }
  finishRun(value, now, false, "aborted");
  return value;
}
async function progress(a: string, b: string, individual = false) {
  const owner = randomUUID();
  const envelope: ProgressEnvelope = {
    version: 1,
    latest: run(a, b, owner, individual),
    previous: run(a, b, owner, true),
  };
  // Exercise the real field even when a legacy final run retained a current ID.
  envelope.latest.currentPlayerId = a;
  envelope.previous!.currentPlayerId = a;
  await database.insert(schema.syncLocks).values({
    name: "riot",
    owner,
    expiresAt: new Date(0),
    runProgress: envelope,
    lastOutcome: "partial",
    lastFinishedAt: new Date(),
    lastSuccessfulSyncAt: new Date(),
  });
  return envelope;
}
function detail(
  a: typeof schema.players.$inferSelect,
  b: typeof schema.players.$inferSelect,
): RiotMatch {
  return {
    metadata: { matchId: "LA2_900" },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: seasonStart("LA2").getTime() + 86400000,
      gameDuration: 1800,
      participants: [a, b].map((p) => ({
        puuid: p.puuid,
        championName: "Ahri",
        championId: 103,
        teamPosition: "MIDDLE",
        teamId: 100,
        kills: 1,
        deaths: 1,
        assists: 1,
        totalMinionsKilled: 100,
        neutralMinionsKilled: 0,
        totalDamageDealtToChampions: 1000,
        win: true,
        gameEndedInEarlySurrender: true,
      })),
    },
  };
}
async function personalData(
  a: typeof schema.players.$inferSelect,
  b: typeof schema.players.$inferSelect,
) {
  const m = detail(a, b);
  await withSyncLease(async (c) => {
    vi.spyOn(c, "identity").mockImplementation(async (_platform, puuid) => ({
      puuid,
      gameName: "Fixture",
      tagLine: "TEST",
    }));
    vi.spyOn(c, "summoner").mockResolvedValue({ profileIconId: 1 });
    vi.spyOn(c, "leagues").mockResolvedValue([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "GOLD",
        rank: "I",
        leaguePoints: 49,
        wins: 20,
        losses: 10,
      },
      {
        queueType: "RANKED_FLEX_SR",
        tier: "SILVER",
        rank: "I",
        leaguePoints: 28,
        wins: 10,
        losses: 10,
      },
    ]);
    vi.spyOn(c, "matchIds").mockResolvedValue([m.metadata.matchId]);
    vi.spyOn(c, "match").mockResolvedValue(m);
    for (const p of [a, b]) {
      await syncPlayer(p.id, c, { rankOnly: true });
      await syncWrite(c, async (tx) => {
        await insertMatchParticipation(
          tx,
          {
            id: m.metadata.matchId,
            queueId: 420,
            mapId: 11,
            timestamp: new Date(m.info.gameStartTimestamp),
            duration: 1800,
            isRemake: null,
          },
          { playerId: p.id, matchId: m.metadata.matchId, ...normalizeParticipant(m, p.puuid)! },
        );
        if (p.id === a.id)
          await insertMatchParticipation(
            tx,
            {
              id: "LA2_901",
              queueId: 440,
              mapId: 11,
              timestamp: new Date(m.info.gameStartTimestamp),
              duration: 1800,
              isRemake: false,
            },
            { playerId: p.id, matchId: "LA2_901", ...normalizeParticipant(m, p.puuid)! },
          );
      });
      const from = seasonStart("LA2"),
        to = new Date();
      const scan = await syncWrite(c, (tx) =>
        openMatchScansInTx(tx, c, p, "season_backfill", from, to),
      );
      const observed = await c.observeMatchIds(
        { playerId: p.id, platform: p.platform, puuid: p.puuid },
        {
          start: 0,
          count: 100,
          startTime: Math.floor(from.getTime() / 1000),
          endTime: Math.floor(to.getTime() / 1000),
        },
      );
      await syncWrite(c, (tx) => capturePageInTx(tx, c, scan, p, observed.capture));
    }
    const observed = await c.observeRemakeDetail("LA2", m.metadata.matchId);
    await syncWrite(c, (tx) =>
      captureRemakeInTx(tx, c, "LA2", m.metadata.matchId, observed.capture),
    );
  });
  await expire();
}

describe("D13 local deletion: PGlite transactions and modeled fencing, not multi-session PostgreSQL concurrency", () => {
  it("deletes both queues' identity, ranked, MATCH and remake evidence while preserving the shared owner", async () => {
    const a = await player("a"),
      b = await player("b");
    await personalData(a, b);
    const beforeHeaders = await database.select().from(schema.achievementEvidenceHeaders);
    for (const queue of ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"])
      for (const id of [a.id, b.id]) {
        const own = beforeHeaders.filter((h) => h.playerId === id && h.queue === queue);
        expect(own.map((h) => h.kind)).toContain("identity_capture");
        expect(own.map((h) => h.kind)).toContain("rank_capture");
        expect(own.some((h) => h.operationKey.startsWith("remake:"))).toBe(true);
        expect(own.some((h) => h.operationKey.startsWith("match:"))).toBe(true);
      }
    const preserved = {
      player: (await database.select().from(schema.players).where(eq(schema.players.id, b.id)))[0],
      headers: beforeHeaders.filter((h) => h.playerId === b.id),
      units: (await database.select().from(schema.achievementEvidenceUnits)).filter(
        (u) => u.playerId === b.id,
      ),
      snapshots: (await database.select().from(schema.rankedSnapshots)).filter(
        (s) => s.playerId === b.id,
      ),
      matches: (await database.select().from(schema.playerMatches)).filter(
        (p) => p.playerId === b.id,
      ),
    };
    const shared = (await database.select().from(schema.matches)).find((m) => m.id === "LA2_900");
    await createSession();
    expect((await DELETE(request(a.id))).status).toBe(200);
    for (const table of [
      schema.players,
      schema.rankedSnapshots,
      schema.playerMatches,
      schema.achievementEvidenceHeaders,
      schema.achievementEvidenceUnits,
    ])
      expect(
        (await database.select().from(table)).some((r) =>
          "playerId" in r ? r.playerId === a.id : "id" in r && r.id === a.id,
        ),
      ).toBe(false);
    expect((await database.select().from(schema.players))[0]).toEqual(preserved.player);
    expect(await database.select().from(schema.achievementEvidenceHeaders)).toEqual(
      preserved.headers,
    );
    expect(await database.select().from(schema.achievementEvidenceUnits)).toEqual(preserved.units);
    expect(await database.select().from(schema.rankedSnapshots)).toEqual(preserved.snapshots);
    expect(await database.select().from(schema.playerMatches)).toEqual(preserved.matches);
    expect(await database.select().from(schema.matches)).toEqual([shared]); // orphan LA2_901 removed
    const content = JSON.stringify(
      (await database.select().from(schema.achievementEvidenceHeaders)).map((h) => h.data),
    );
    expect(content).not.toContain(a.puuid);
    expect(content).not.toContain('"grantAuthorized":true');
    expect(content).not.toContain('"certification":"established"');
  });
  it.each([false, true])(
    "redacts latest/previous owner fields and match references without recalculating aggregate results (individual=%s)",
    async (individual) => {
      const a = await player("a"),
        b = await player("b");
      const before = await progress(a.id, b.id, individual);
      const lock = await row();
      await createSession();
      expect((await DELETE(request(a.id))).status).toBe(200);
      const after = (await row()).runProgress!;
      expect(progressEnvelopeSchema.safeParse(after).success).toBe(true);
      const expected = structuredClone(before);
      for (const r of [expected.latest, expected.previous!]) {
        if (r.playerId === a.id) r.playerId = null;
        r.currentPlayerId = null;
        r.players = r.players.filter((p) => p.playerId !== a.id);
      }
      expect(after).toEqual(expected);
      expect(JSON.stringify(after)).not.toContain(a.id);
      expect(JSON.stringify(after)).not.toContain("LA2_101");
      expect(after.latest.history?.imported).toBe(14); // original global aggregate
      expect(after.latest.players[0].history?.lastConfirmedMatchId).toBe("LA2_102");
      const saved = await row();
      expect(saved.lastFinishedAt).toEqual(lock.lastFinishedAt);
      expect(saved.lastSuccessfulSyncAt).toEqual(lock.lastSuccessfulSyncAt);
      expect(saved.lastOutcome).toEqual(lock.lastOutcome);
      const dto = await readSyncProgress();
      expect(JSON.stringify(dto)).not.toContain(a.id);
      expect(dto.run).not.toHaveProperty("leaseOwner");
    },
  );
  it("retains null and unrelated progress and does not introduce another run", async () => {
    const a = await player("a"),
      b = await player("b"),
      c = await player("c");
    const original = await progress(b.id, c.id);
    await createSession();
    expect((await DELETE(request(a.id))).status).toBe(200);
    expect((await row()).runProgress).toEqual(original);
    await expire();
    await database.update(schema.syncLocks).set({ runProgress: null });
    expect((await DELETE(request(b.id))).status).toBe(200);
    expect((await row()).runProgress).toBeNull();
  });
  it("rejects deletion during an active lease or cooldown, preserving progress and sources", async () => {
    const a = await player("a"),
      b = await player("b");
    const original = await progress(a.id, b.id);
    original.latest.status = "running";
    original.latest.finishedAt = null;
    await database
      .update(schema.syncLocks)
      .set({ expiresAt: new Date(Date.now() + 60000), runProgress: original });
    await createSession();
    expect((await DELETE(request(a.id))).status).toBe(409);
    expect((await row()).runProgress).toEqual(original);
    expect(await database.select().from(schema.players)).toHaveLength(2);
    original.latest.status = "partial";
    original.latest.finishedAt = new Date().toISOString();
    await database.update(schema.syncLocks).set({ runProgress: original });
    expect((await DELETE(request(a.id))).status).toBe(409);
    expect((await row()).runProgress).toEqual(original);
  });
  it("fences an expired writer and prevents later checkpoints or finalization restoring deleted references", async () => {
    const a = await player("a"),
      b = await player("b");
    await createSession();
    const cHolder: { client?: RiotClient } = {};
    await expect(
      withSyncLease(
        async (c) => {
          cHolder.client = c;
          await checkpoint(c, { type: "phase", phase: "history", playerId: a.id });
          await checkpoint(c, {
            type: "rank",
            playerId: b.id,
            checkedAt: new Date().toISOString(),
          });
          await expire(); // controlled interleaving, not independent sessions
          expect((await DELETE(request(a.id))).status).toBe(200);
          await expect(
            checkpoint(c, { type: "phase", phase: "history", playerId: a.id }),
          ).rejects.toBeInstanceOf(LeaseLost);
        },
        230000,
        undefined,
        { action: "global" },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await row()).runProgress!.latest.status).toBe("interrupted");
    expect((await row()).runProgress!.latest.players.map((p) => p.playerId)).toEqual([b.id]);
    expect(JSON.stringify((await row()).runProgress)).not.toContain(a.id);
    await expire();
    await withSyncLease(
      async (c) => {
        await checkpoint(c, { type: "rank", playerId: b.id, checkedAt: new Date().toISOString() });
      },
      230000,
      undefined,
      { action: "player_recent", playerId: b.id },
    );
    expect(JSON.stringify((await row()).runProgress)).not.toContain(a.id);
    await expect(
      syncWrite(cHolder.client!, (tx) => tx.insert(schema.players).values({ ...a })),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(await database.select().from(schema.players)).toHaveLength(1);
  });
  it("rolls back all cascades, orphan cleanup and redaction when redaction fails", async () => {
    const a = await player("a"),
      b = await player("b");
    await personalData(a, b);
    await database.delete(schema.syncLocks);
    const original = await progress(a.id, b.id);
    const before = {
      players: await database.select().from(schema.players),
      headers: await database.select().from(schema.achievementEvidenceHeaders),
      units: await database.select().from(schema.achievementEvidenceUnits),
      snapshots: await database.select().from(schema.rankedSnapshots),
      matches: await database.select().from(schema.matches),
      participations: await database.select().from(schema.playerMatches),
    };
    const redact = deletion.redactDeletedPlayerProgressInTx;
    vi.spyOn(deletion, "redactDeletedPlayerProgressInTx").mockImplementation(async (...args) => {
      await redact(...args);
      throw new Error("synthetic-private-failure-payload");
    });
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    await createSession();
    const response = await DELETE(request(a.id));
    expect(response.status).toBe(500);
    expect(await database.select().from(schema.players)).toEqual(before.players);
    expect(await database.select().from(schema.achievementEvidenceHeaders)).toEqual(before.headers);
    expect(await database.select().from(schema.achievementEvidenceUnits)).toEqual(before.units);
    expect(await database.select().from(schema.rankedSnapshots)).toEqual(before.snapshots);
    expect(await database.select().from(schema.matches)).toEqual(before.matches);
    expect(await database.select().from(schema.playerMatches)).toEqual(before.participations);
    expect((await row()).runProgress).toEqual(original);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("synthetic-private-failure-payload");
    expect(await response.text()).not.toContain("synthetic-private-failure-payload");
  });
  it("retains existing second DELETE behavior (404 after lease cooldown), not a fabricated success", async () => {
    const a = await player("a"),
      b = await player("b");
    await progress(a.id, b.id);
    await createSession();
    expect((await DELETE(request(a.id))).status).toBe(200);
    const after = (await row()).runProgress;
    expect((await DELETE(request(a.id))).status).toBe(409);
    await expire();
    expect((await DELETE(request(a.id))).status).toBe(404);
    expect((await row()).runProgress).toEqual(after);
  });
  it("does not permit an unleased or tracked sync to invoke maintenance redaction", async () => {
    const a = await player("a"),
      b = await player("b");
    const envelope = await progress(a.id, b.id);
    const c = new RiotClient();
    await expect(
      database.transaction((tx) => deletion.redactDeletedPlayerProgressInTx(tx, c, a.id)),
    ).rejects.toBeInstanceOf(LeaseLost);
    bindLease(c, { owner: envelope.latest.leaseOwner, runId: envelope.latest.runId, envelope });
    await expect(
      database.transaction((tx) => deletion.redactDeletedPlayerProgressInTx(tx, c, a.id)),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await row()).runProgress).toEqual(envelope);
  });
  it("keeps Demo and unauthenticated DELETE isolated from sources and evidence", async () => {
    const a = await player("a");
    expect((await DELETE(request(a.id))).status).toBe(401);
    await createSession();
    vi.stubEnv("DEMO_MODE", "true");
    expect((await DELETE(request(a.id))).status).toBe(503);
    expect(await database.select().from(schema.players)).toHaveLength(1);
    expect(await database.select().from(schema.syncLocks)).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps private capture data out of public/admin projections and sanitized error logs", async () => {
    const a = await player("a");
    const c = new RiotClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(c, "identity").mockRejectedValue(
      new Error(`${a.puuid} https://riot.invalid/private TOKEN synthetic-payload`),
    );
    await expect(syncPlayer(a.id, c)).rejects.toThrow();
    const stored = (await database.select().from(schema.players))[0];
    const dto = JSON.stringify(toAdminPlayer(stored));
    expect(dto).not.toContain(a.puuid);
    expect(dto).not.toContain("synthetic-payload");
    expect(dto).not.toContain("achievementEvidence");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.id);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.puuid);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-payload");
    expect(JSON.stringify(warn.mock.calls)).toContain('"phase":"rank"');
    const recent = new RiotClient();
    vi.spyOn(recent, "identity").mockResolvedValue({
      puuid: a.puuid,
      gameName: "Fixture",
      tagLine: "TEST",
    });
    vi.spyOn(recent, "summoner").mockResolvedValue({ profileIconId: 1 });
    vi.spyOn(recent, "leagues").mockResolvedValue([]);
    vi.spyOn(recent, "matchIds").mockRejectedValue(new Error(a.puuid));
    await expect(syncPlayer(a.id, recent)).rejects.toThrow();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.id);
    expect(JSON.stringify(warn.mock.calls)).toContain('"phase":"recent"');
  });
  it("logs only aggregate scheduling results and sanitized backoff codes", async () => {
    const a = await player("a");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(RiotClient.prototype, "identity").mockResolvedValue({
      puuid: a.puuid,
      gameName: "Fixture",
      tagLine: "TEST",
    });
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 1 });
    vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]);
    vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    await syncAllPlayers();
    expect(JSON.stringify(info.mock.calls)).not.toContain(a.id);
    expect(JSON.stringify(info.mock.calls)).not.toContain(a.puuid);
    expect(info).toHaveBeenCalled();
    await expire();
    vi.spyOn(RiotClient.prototype, "identity").mockRejectedValue(new RiotError(429, 1300));
    await expect(syncAllPlayers()).rejects.toBeInstanceOf(RiotError);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.id);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.puuid);
    expect(JSON.stringify(warn.mock.calls)).toContain('"code":429');
  });
  it("has no grant tables and keeps evidence outside public consumers", async () => {
    const tables = await database.execute(
      sql`select tablename from pg_tables where schemaname='public'`,
    );
    expect(JSON.stringify(tables)).not.toMatch(/badge_grants|achievement_grants|equipped_titles/);
    for (const path of [
      "src/server/queries.ts",
      "src/server/admin-queries.ts",
      "src/server/achievements/queries.ts",
      "src/app/player/[id]/page.tsx",
      "src/components/leaderboard.tsx",
      "src/lib/awards.ts",
    ])
      expect(readFileSync(path, "utf8")).not.toMatch(
        /achievementEvidenceHeaders|achievementEvidenceUnits|achievement_evidence_headers|achievement_evidence_units/,
      );
  });
});
