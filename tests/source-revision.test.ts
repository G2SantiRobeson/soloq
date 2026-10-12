import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { RiotClient, RiotError } from "@/server/riot/client";
import type { RiotMatch } from "@/server/riot/schemas";
import { normalizeParticipant } from "@/server/riot/normalize";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { syncBackfillPlayer, syncPlayer } from "@/server/sync/service";
import { importRecent } from "@/server/sync/recent";
import { beginPlayerSyncPhase } from "@/server/sync/player-state";
import { bindLease, checkpoint, LeaseLost, syncWrite } from "@/server/sync/progress";
import {
  classifyStoredRemake,
  insertMatchParticipation,
  SourceConflict,
  updateSourcePlayer,
} from "@/server/sync/source-revision";
import { PATCH, DELETE } from "@/app/api/admin/players/[id]/route";
import { POST } from "@/app/api/admin/players/route";
import { createSession } from "@/server/auth";
import { getProfile } from "@/server/queries";

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
  await pg.exec("TRUNCATE players, matches, sync_locks, admin_sessions CASCADE");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-only-source-revision-secret".repeat(3));
  vi.stubEnv("APP_URL", "http://localhost");
  cookieJar.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => pg.close());

async function player(puuid = "synthetic-source-owner") {
  return (
    await database
      .insert(schema.players)
      .values({
        gameName: "Synthetic",
        tagLine: "TEST",
        puuid,
        platform: "LA2",
        scanStart: seasonStart("LA2"),
        backfillSeason: CURRENT_SEASON.id,
      })
      .returning()
  )[0];
}
const row = async (id: string) =>
  (await database.select().from(schema.players).where(eq(schema.players.id, id)))[0];
function fixture(id = "LA2_501", puuid = "synthetic-source-owner"): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: Date.now() - 3600_000,
      gameDuration: 1800,
      participants: [
        {
          puuid,
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
          gameEndedInEarlySurrender: false,
        },
      ],
    },
  };
}
function sources(m = fixture(), owner: string) {
  return [
    {
      id: m.metadata.matchId,
      queueId: m.info.queueId,
      mapId: m.info.mapId,
      timestamp: new Date(m.info.gameStartTimestamp),
      duration: m.info.gameDuration,
      isRemake: false,
    },
    {
      playerId: owner,
      matchId: m.metadata.matchId,
      ...normalizeParticipant(m, m.info.participants[0].puuid)!,
    },
  ] as const;
}
function client() {
  const c = new RiotClient();
  vi.spyOn(c, "identity").mockImplementation(async (_platform, puuid) => ({
    puuid,
    gameName: "Synthetic",
    tagLine: "TEST",
  }));
  vi.spyOn(c, "summoner").mockResolvedValue({ profileIconId: 23 });
  vi.spyOn(c, "leagues").mockResolvedValue([
    {
      queueType: "RANKED_SOLO_5x5",
      tier: "DIAMOND",
      rank: "I",
      leaguePoints: 49,
      wins: 20,
      losses: 10,
    },
  ]);
  vi.spyOn(c, "matchIds").mockResolvedValue([]);
  vi.spyOn(c, "match").mockImplementation(async (_p, id) => fixture(id));
  return c;
}
const request = (id: string, method: string, body: unknown) =>
  new Request(`http://localhost/api/admin/players/${id}`, {
    method,
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const release = () => database.update(schema.syncLocks).set({ expiresAt: new Date(0) });

describe("source revision writers (ephemeral SQL, not independent PostgreSQL concurrency)", () => {
  it("starts a legacy source at zero and increments once for snapshots of two queues", async () => {
    const p = await player();
    const c = client();
    expect(p.sourceRevision).toBe(0n);
    await syncPlayer(p.id, c, { rankOnly: true });
    expect((await row(p.id)).sourceRevision).toBe(1n);
    const snaps = await database.select().from(schema.rankedSnapshots);
    expect(snaps).toHaveLength(2); // SoloQ plus unchanged Unranked Flex policy.
  });
  it("does not create snapshots without a change but revises a new official verification", async () => {
    const p = await player();
    const c = client();
    await syncPlayer(p.id, c, { rankOnly: true });
    const checked = (await row(p.id)).rankCheckedAt!;
    await database
      .update(schema.players)
      .set({ rankCheckedAt: new Date(checked.getTime() - 1000) });
    await syncPlayer(p.id, c, { rankOnly: true });
    expect((await row(p.id)).sourceRevision).toBe(2n);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
  });
  it("increments once when both ranked queues change in the same transaction", async () => {
    const p = await player();
    const c = client();
    await syncPlayer(p.id, c, { rankOnly: true });
    vi.mocked(c.leagues).mockResolvedValue([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "I",
        leaguePoints: 28,
        wins: 20,
        losses: 11,
      },
      {
        queueType: "RANKED_FLEX_SR",
        tier: "GOLD",
        rank: "IV",
        leaguePoints: 10,
        wins: 5,
        losses: 2,
      },
    ]);
    await syncPlayer(p.id, c, { rankOnly: true });
    expect((await row(p.id)).sourceRevision).toBe(2n);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(4);
  });
  it("rolls back snapshots, context and revision when the second snapshot fails", async () => {
    const p = await player();
    const c = client();
    await pg.exec(
      "CREATE FUNCTION source_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.queue = 'RANKED_FLEX_SR' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER source_fail_snapshot BEFORE INSERT ON ranked_snapshots FOR EACH ROW EXECUTE FUNCTION source_fail_snapshot();",
    );
    try {
      await expect(syncPlayer(p.id, c, { rankOnly: true })).rejects.toThrow();
      expect((await row(p.id)).sourceRevision).toBe(0n);
      expect((await row(p.id)).rankCheckedAt).toBeNull();
      expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
    } finally {
      await pg.exec(
        "DROP TRIGGER source_fail_snapshot ON ranked_snapshots; DROP FUNCTION source_fail_snapshot()",
      );
    }
  });
  it("persists a new participation and revision atomically, deduplicating identical reuse", async () => {
    const p = await player();
    const c = client();
    const input = sources(fixture(), p.id);
    expect(await syncWrite(c, (tx) => insertMatchParticipation(tx, ...input))).toBe(1);
    expect(await syncWrite(c, (tx) => insertMatchParticipation(tx, ...input))).toBe(0);
    expect((await row(p.id)).sourceRevision).toBe(1n);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
  });
  it("compares PostgreSQL float4 participation without false conflicts", async () => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    const input = { ...pm, killParticipation: 0.123456789 };
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, input));
    const before = await database.select().from(schema.playerMatches);
    expect(await syncWrite(c, (tx) => insertMatchParticipation(tx, m, input))).toBe(0);
    expect((await row(p.id)).sourceRevision).toBe(1n);
    expect(await database.select().from(schema.playerMatches)).toEqual(before);
  });
  it("reuses different JS decimals representing the same float4 without replacing participation", async () => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    const first = 0.123456789;
    const second = 0.123456788;
    expect(first).not.toBe(second);
    expect(Math.fround(first)).toBe(Math.fround(second));
    await syncWrite(c, (tx) =>
      insertMatchParticipation(tx, m, { ...pm, killParticipation: first }),
    );
    const before = await database.select().from(schema.playerMatches);
    expect(
      await syncWrite(c, (tx) =>
        insertMatchParticipation(tx, m, { ...pm, killParticipation: second }),
      ),
    ).toBe(0);
    expect(await database.select().from(schema.playerMatches)).toEqual(before);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it("rejects a difference representable in float4 with source and revision unchanged", async () => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    const first = 0.123456789;
    const second = 0.1234568;
    expect(Math.fround(first)).not.toBe(Math.fround(second));
    await syncWrite(c, (tx) =>
      insertMatchParticipation(tx, m, { ...pm, killParticipation: first }),
    );
    const before = await database.select().from(schema.playerMatches);
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, killParticipation: second })),
    ).rejects.toBeInstanceOf(SourceConflict);
    expect(await database.select().from(schema.playerMatches)).toEqual(before);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it.each([NaN, Infinity, -Infinity, -0.1, 1.00000001, Number.MAX_VALUE])(
    "rejects invalid participation %s before any new source is written",
    async (value) => {
      const p = await player();
      const c = client();
      const [m, pm] = sources(fixture(), p.id);
      await expect(
        syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, killParticipation: value })),
      ).rejects.toBeInstanceOf(SourceConflict);
      expect(await database.select().from(schema.matches)).toHaveLength(0);
      expect(await database.select().from(schema.playerMatches)).toHaveLength(0);
      expect((await row(p.id)).sourceRevision).toBe(0n);
    },
  );
  it("rejects invalid incoming or stored float4 on reuse instead of treating it as identical", async () => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, killParticipation: 0.5 }));
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, killParticipation: NaN })),
    ).rejects.toBeInstanceOf(SourceConflict);
    expect((await database.select().from(schema.playerMatches))[0].killParticipation).toBe(0.5);
    // Deliberately corrupt only the ephemeral fixture; PostgreSQL REAL accepts NaN.
    await pg.exec("UPDATE player_matches SET kill_participation = 'NaN'::real");
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, killParticipation: 0.5 })),
    ).rejects.toBeInstanceOf(SourceConflict);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it.each([null, 0, 1])("preserves nullable and boundary participation %s", async (value) => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    const input = { ...pm, killParticipation: value };
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, input));
    expect(await syncWrite(c, (tx) => insertMatchParticipation(tx, m, input))).toBe(0);
    expect((await database.select().from(schema.playerMatches))[0].killParticipation).toBe(value);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it("keeps an integer metric difference even if float4 rounding would erase it", async () => {
    const p = await player();
    const c = client();
    const [m, pm] = sources(fixture(), p.id);
    const damage = 16777216;
    expect(Math.fround(damage)).toBe(Math.fround(damage + 1));
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, damage }));
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, damage: damage + 1 })),
    ).rejects.toBeInstanceOf(SourceConflict);
    expect((await database.select().from(schema.playerMatches))[0].damage).toBe(damage);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it.each(["queue", "timestamp", "remake", "champion", "result"])(
    "rejects unresolved %s conflict without replacing sources",
    async (kind) => {
      const p = await player();
      const c = client();
      const [m, pm] = sources(fixture(), p.id);
      await syncWrite(c, (tx) => insertMatchParticipation(tx, m, pm));
      const incoming = {
        ...m,
        ...(kind === "queue" ? { queueId: 440 } : {}),
        ...(kind === "timestamp" ? { timestamp: new Date(m.timestamp.getTime() + 1) } : {}),
        ...(kind === "remake" ? { isRemake: true } : {}),
      };
      const participant = {
        ...pm,
        ...(kind === "champion" ? { championId: 222 } : {}),
        ...(kind === "result" ? { win: false } : {}),
      };
      await expect(
        syncWrite(c, (tx) => insertMatchParticipation(tx, incoming, participant)),
      ).rejects.toBeInstanceOf(SourceConflict);
      expect((await row(p.id)).sourceRevision).toBe(1n);
      expect((await database.select().from(schema.matches))[0]).toMatchObject(m);
      expect((await database.select().from(schema.playerMatches))[0]).toMatchObject(pm);
    },
  );
  it("rolls back a new match, participation, context and revision together", async () => {
    const p = await player();
    const c = client();
    await expect(
      syncWrite(c, async (tx) => {
        await insertMatchParticipation(tx, ...sources(fixture(), p.id));
        await updateSourcePlayer(tx, p.id, { backfillProcessed: 1 });
        throw new Error("test interruption");
      }),
    ).rejects.toThrow("test interruption");
    expect(await database.select().from(schema.matches)).toHaveLength(0);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(0);
    expect((await row(p.id)).sourceRevision).toBe(0n);
    expect((await row(p.id)).backfillProcessed).toBe(0);
  });
  it("recent retry skips persisted participants without another source increment", async () => {
    const p = await player();
    const c = client();
    const m = fixture();
    vi.mocked(c.matchIds).mockResolvedValue([m.metadata.matchId]);
    vi.mocked(c.match).mockResolvedValue(m);
    const attempt = await beginPlayerSyncPhase(p.id, "recent", c);
    await importRecent(p, c, 5, attempt);
    const after = await row(p.id);
    expect(after.sourceRevision).toBe(2n); // participation + complete coverage.
    // Freeze the effective end at its stored second; repeated coverage is identical.
    vi.spyOn(Date, "now").mockReturnValue(after.lastSyncedAt!.getTime() + 120000);
    await importRecent(after, c, 5, attempt);
    expect((await row(p.id)).sourceRevision).toBe(after.sourceRevision);
    expect(c.match).toHaveBeenCalledTimes(1);
  });
  it("continues a partial historical cursor, counting participation and disposition only once per transaction", async () => {
    const p = await player();
    const c = client();
    vi.mocked(c.matchIds).mockResolvedValue(["LA2_501", "LA2_502"]);
    expect(await syncBackfillPlayer(p.id, c, 1)).toMatchObject({ status: "partial", imported: 1 });
    const partial = await row(p.id);
    expect(partial.sourceRevision).toBe(3n); // open window, page, participant + context.
    expect(partial.scanPending).toEqual(["LA2_502"]);
    expect(partial.backfillProcessed).toBe(1);
    expect(await syncBackfillPlayer(p.id, c, 1)).toMatchObject({ status: "complete", imported: 1 });
    const done = await row(p.id);
    expect(done.sourceRevision).toBe(5n); // second participant + context, close.
    expect(done.backfillProcessed).toBe(2);
    expect(done.backfillDiscovered).toBe(2);
    expect(done.backfillStatus).toBe("completed");
    expect(c.matchIds).toHaveBeenCalledTimes(1);
  });
  it("identical resumed history opening and diagnostic attempts do not increment", async () => {
    const p = await player();
    const c = client();
    vi.mocked(c.matchIds).mockResolvedValue(["LA2_501"]);
    await syncBackfillPlayer(p.id, c, 0);
    const first = await row(p.id);
    await syncBackfillPlayer(p.id, c, 0);
    expect((await row(p.id)).sourceRevision).toBe(first.sourceRevision);
    expect(c.matchIds).not.toHaveBeenCalled();
  });
  it("revises seasonal reset without removing historical matches or fabricating evidence", async () => {
    const p = await player();
    const c = client();
    await syncWrite(c, (tx) => insertMatchParticipation(tx, ...sources(fixture(), p.id)));
    await database
      .update(schema.players)
      .set({ backfillSeason: "2025", backfillStatus: "completed", backfillProcessed: 10 });
    await syncBackfillPlayer(p.id, c, 0);
    const current = await row(p.id);
    expect(current.sourceRevision).toBe(3n); // reset + open, plus earlier participation.
    expect(current.backfillProcessed).toBe(0);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect(await database.select().from(schema.achievementEvidenceHeaders)).toHaveLength(0);
  });
  it("records historical 404 context, not manufactured match evidence", async () => {
    const p = await player();
    const c = client();
    vi.mocked(c.matchIds).mockResolvedValue(["LA2_501"]);
    vi.mocked(c.match).mockRejectedValue(new RiotError(404));
    await syncBackfillPlayer(p.id, c, 1);
    expect(await row(p.id)).toMatchObject({
      sourceRevision: 4n,
      backfillProcessed: 1,
      backfillUnavailable: 1,
      backfillStatus: "completed",
    });
    expect(await database.select().from(schema.matches)).toHaveLength(0);
  });
  it("a historical error revises changed status but an identical failed status is idempotent", async () => {
    const p = await player();
    const c = client();
    vi.mocked(c.matchIds).mockRejectedValue(new RiotError(500));
    await expect(syncBackfillPlayer(p.id, c)).rejects.toThrow();
    const failed = await row(p.id);
    expect(failed.backfillStatus).toBe("failed");
    expect(failed.sourceRevision).toBe(2n); // open + fail.
    await syncWrite(c, (tx) =>
      updateSourcePlayer(tx, p.id, { backfillStatus: "failed", backfillUpdatedAt: new Date() }),
    );
    expect((await row(p.id)).sourceRevision).toBe(failed.sourceRevision);
  });
  it("does not revise diagnostic fields, presentation-only identity, or identical context", async () => {
    const p = await player();
    const c = client();
    await beginPlayerSyncPhase(p.id, "rank", c);
    await syncWrite(c, (tx) =>
      updateSourcePlayer(tx, p.id, {
        enabled: true,
        scanPending: [],
        gameName: "Renamed",
        profileIconId: 25,
        updatedAt: new Date(),
        lastAttemptAt: new Date(),
        backfillUpdatedAt: new Date(),
        syncError: "test diagnostic",
      }),
    );
    await checkpoint(c, { type: "phase", phase: "rank", playerId: p.id });
    expect((await row(p.id)).sourceRevision).toBe(0n);
  });
  it("PATCH effective then identical updates eligibility only once", async () => {
    const p = await player();
    await createSession();
    expect((await PATCH(request(p.id, "PATCH", { enabled: false }))).status).toBe(200);
    await release();
    expect((await PATCH(request(p.id, "PATCH", { enabled: false }))).status).toBe(200);
    expect(await row(p.id)).toMatchObject({ enabled: false, sourceRevision: 1n });
  });
  it("PATCH missing player retains 404", async () => {
    await createSession();
    expect(
      (await PATCH(request("11111111-1111-4111-8111-111111111111", "PATCH", { enabled: true })))
        .status,
    ).toBe(404);
  });
  it("bumps all associated players once for a shared remake, not for unchanged classification", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, pm));
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, playerId: b.id }));
    expect(await syncWrite(c, (tx) => classifyStoredRemake(tx, m.id, true))).toBe(true);
    expect((await row(a.id)).sourceRevision).toBe(2n);
    expect((await row(b.id)).sourceRevision).toBe(2n);
    expect(await syncWrite(c, (tx) => classifyStoredRemake(tx, m.id, true))).toBe(false);
    expect((await row(a.id)).sourceRevision).toBe(2n);
    expect((await row(b.id)).sourceRevision).toBe(2n);
  });
  it("a later association must agree with the classified shared source", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, pm));
    await syncWrite(c, (tx) => classifyStoredRemake(tx, m.id, true));
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, playerId: b.id })),
    ).rejects.toBeInstanceOf(SourceConflict);
    expect((await row(b.id)).sourceRevision).toBe(0n);
    await syncWrite(c, (tx) =>
      insertMatchParticipation(tx, { ...m, isRemake: true }, { ...pm, playerId: b.id }),
    );
    expect((await row(b.id)).sourceRevision).toBe(1n);
    expect((await row(a.id)).sourceRevision).toBe(2n);
  });
  it("reclassifies a legacy null and includes players independent of supplied UUID order", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await database.insert(schema.matches).values({ ...m, isRemake: null });
    await database.insert(schema.playerMatches).values([{ ...pm, playerId: b.id }, pm]);
    await syncWrite(c, (tx) => classifyStoredRemake(tx, m.id, false));
    expect((await row(a.id)).sourceRevision).toBe(1n);
    expect((await row(b.id)).sourceRevision).toBe(1n);
    expect((await database.select().from(schema.matches))[0].isRemake).toBe(false);
  });
  it("rolls back remake fanout and revision on interruption", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await database.insert(schema.matches).values(m);
    await database.insert(schema.playerMatches).values([pm, { ...pm, playerId: b.id }]);
    await expect(
      syncWrite(c, async (tx) => {
        await classifyStoredRemake(tx, m.id, true);
        throw new Error("interrupted");
      }),
    ).rejects.toThrow();
    expect((await database.select().from(schema.matches))[0].isRemake).toBe(false);
    expect((await row(a.id)).sourceRevision).toBe(0n);
    expect((await row(b.id)).sourceRevision).toBe(0n);
  });
  it("SQL revision overflow rolls back all associated source updates", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await database.insert(schema.matches).values(m);
    await database.insert(schema.playerMatches).values([pm, { ...pm, playerId: b.id }]);
    await database
      .update(schema.players)
      .set({ sourceRevision: 9223372036854775807n })
      .where(eq(schema.players.id, b.id));
    await expect(syncWrite(c, (tx) => classifyStoredRemake(tx, m.id, true))).rejects.toThrow();
    expect((await row(a.id)).sourceRevision).toBe(0n);
    expect((await row(b.id)).sourceRevision).toBe(9223372036854775807n);
    expect((await database.select().from(schema.matches))[0].isRemake).toBe(false);
  });
  it("uses database bigint arithmetic above Number.MAX_SAFE_INTEGER", async () => {
    const p = await player();
    const c = client();
    await database.update(schema.players).set({ sourceRevision: 9007199254740993n });
    await syncWrite(c, (tx) => updateSourcePlayer(tx, p.id, { enabled: false }));
    expect((await row(p.id)).sourceRevision).toBe(9007199254740994n);
  });
  it("expired lease before persistence cannot change sources or revision", async () => {
    const p = await player();
    const c = client();
    const owner = "11111111-1111-4111-8111-111111111111";
    await database.insert(schema.syncLocks).values({ name: "riot", owner, expiresAt: new Date(0) });
    bindLease(c, { owner, runId: null, envelope: null });
    await expect(
      syncWrite(c, (tx) => insertMatchParticipation(tx, ...sources(fixture(), p.id))),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await row(p.id)).sourceRevision).toBe(0n);
    expect(await database.select().from(schema.matches)).toHaveLength(0);
  });
  it("lease loss at final fencing rolls back the already flushed source revision", async () => {
    const p = await player();
    const c = client();
    const owner = "11111111-1111-4111-8111-111111111111";
    await database
      .insert(schema.syncLocks)
      .values({ name: "riot", owner, expiresAt: new Date(Date.now() + 60000) });
    bindLease(c, { owner, runId: null, envelope: null });
    await expect(
      syncWrite(c, async (tx) => {
        await insertMatchParticipation(tx, ...sources(fixture(), p.id));
        await tx.update(schema.syncLocks).set({ expiresAt: new Date(0) });
      }),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await row(p.id)).sourceRevision).toBe(0n);
    expect(await database.select().from(schema.matches)).toHaveLength(0);
    expect((await database.select().from(schema.syncLocks))[0].expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
  it("DELETE retains existing cascades and another owner of a shared match", async () => {
    const a = await player();
    const b = await player("second-owner");
    const c = client();
    const [m, pm] = sources(fixture(), a.id);
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, pm));
    await syncWrite(c, (tx) => insertMatchParticipation(tx, m, { ...pm, playerId: b.id }));
    await createSession();
    expect((await DELETE(request(a.id, "DELETE", { confirm: true }))).status).toBe(200);
    expect(await row(a.id)).toBeUndefined();
    expect((await row(b.id)).sourceRevision).toBe(1n);
    expect(await database.select().from(schema.matches)).toHaveLength(1);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
  });
  it("new administrative registration initializes revision once and duplicate does not revise", async () => {
    await createSession();
    vi.spyOn(RiotClient.prototype, "account").mockResolvedValue({
      puuid: "synthetic-source-owner",
      gameName: "Synthetic",
      tagLine: "TEST",
    });
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    vi.spyOn(RiotClient.prototype, "identity").mockRejectedValue(new RiotError(500));
    const req = () =>
      new Request("http://localhost/api/admin/players", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ gameName: "Synthetic", tagLine: "TEST", platform: "LA2" }),
      });
    expect((await POST(req())).status).toBe(201);
    const p = (await database.select().from(schema.players))[0];
    expect(p.sourceRevision).toBe(1n);
    await release();
    expect((await POST(req())).status).toBe(409);
    expect((await row(p.id)).sourceRevision).toBe(1n);
  });
  it("reading and rendering existing profile sources never increments", async () => {
    const p = await player();
    const c = client();
    await syncPlayer(p.id, c, { rankOnly: true });
    const before = (await row(p.id)).sourceRevision;
    const { achievementReader } = await import("@/server/achievements/queries");
    const context = await achievementReader(database).player(p.id);
    expect(context?.id).toBe(p.id);
    // Public assets are mocked; no remote request from profile queries.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: {} })),
    );
    await getProfile(p.id, "soloq");
    expect((await row(p.id)).sourceRevision).toBe(before);
    expect(await database.select().from(schema.achievementEvidenceUnits)).toHaveLength(0);
  });
  it("does not introduce grants, capture writers, or changes to R1/I1/OTP", async () => {
    const { rows } = await pg.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname='public'",
    );
    expect(rows.some((r) => /grant|equip/.test(r.name))).toBe(false);
    const { RESURRECTION_RULE, UNSTOPPABLE_RULE, OTP_RULE } =
      await import("@/lib/achievements/catalog");
    expect(RESURRECTION_RULE).toMatchObject({ version: "1.1.A-observed-v1", minDropLp: 50 });
    expect(UNSTOPPABLE_RULE).toEqual({ version: "1.1.A-observed-v1", minWins: 5 });
    expect(OTP_RULE).toEqual({
      version: "1.1-otp-observed-v2",
      minGames: 50,
      minShare: { numerator: 13, denominator: 20 },
    });
    expect(await database.select().from(schema.achievementEvidenceHeaders)).toHaveLength(0);
    expect(await database.execute(sql`select 1`)).toBeDefined();
  });
});
