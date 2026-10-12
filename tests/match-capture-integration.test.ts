import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { RiotClient, RiotError } from "@/server/riot/client";
import { MatchCaptureError } from "@/server/riot/match-capture";
import { bindLease, syncWrite } from "@/server/sync/progress";
import { insertMatchParticipation, updateSourcePlayer } from "@/server/sync/source-revision";
import {
  captureDispositionInTx,
  capturePageInTx,
  captureReusedInTx,
  finishMatchScansInTx,
  openMatchScansInTx,
  projectMatchDispositionsInTx,
} from "@/server/sync/match-evidence";
import { importHistory } from "@/server/sync/history";
import { importRecent } from "@/server/sync/recent";
import { normalizeParticipant } from "@/server/riot/normalize";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import type { RiotMatch } from "@/server/riot/schemas";
import type { PlayerSyncAttempt } from "@/lib/player-sync-state";
import type { EvidenceTransaction } from "@/server/achievements/verification/evidence-in-tx";
import * as evidenceCapacity from "@/server/achievements/verification/evidence-in-tx";
import { LocalEvidenceError } from "@/server/achievements/verification/persistence-contracts";

const pg = new PGlite();
const queries: string[] = [];
const database = drizzle(pg, {
  schema,
  logger: {
    logQuery(query) {
      queries.push(query);
    },
  },
});
vi.mock("@/db", () => ({ db: () => database }));
const playerId = "11111111-1111-4111-8111-111111111111";
const puuid = "synthetic-private-binding-never-serialize";
const from = seasonStart("LA2");
const to = new Date(Math.floor((Date.now() - 120000) / 1000) * 1000);
const query = {
  startTime: from.getTime() / 1000,
  endTime: to.getTime() / 1000,
  start: 0,
  count: 100 as const,
};
const attempt = (phase: "recent" | "history"): PlayerSyncAttempt => ({
  phase,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  outcome: "running",
});
const headers = () => database.select().from(schema.achievementEvidenceHeaders);
const units = () => database.select().from(schema.achievementEvidenceUnits);
const row = async () =>
  (await database.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
beforeAll(async () => {
  for (const name of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${name}`, "utf8"));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE players,matches,sync_locks CASCADE");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("RIOT_API_KEY", "synthetic-key-not-operational");
  await database.insert(schema.players).values({
    id: playerId,
    puuid,
    gameName: "Fixture",
    tagLine: "TEST",
    platform: "LA2",
    scanStart: from,
    backfillSeason: CURRENT_SEASON.id,
  });
  queries.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => pg.close());
function match(id = "LA2_1", patch: Partial<RiotMatch["info"]> = {}): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: to.getTime() - 1000000,
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
        },
      ],
      ...patch,
    },
  };
}
function client(responses: (Response | Error)[]) {
  let now = Date.now();
  const fetcher = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Fixture exhausted");
    return next;
  });
  const c = new RiotClient(now + 230000, {
    fetcher,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
  });
  return { c, fetcher };
}
async function lease(c: RiotClient) {
  const owner = randomUUID();
  await database
    .insert(schema.syncLocks)
    .values({ name: "riot", owner, expiresAt: new Date(Date.now() + 600000) })
    .onConflictDoUpdate({
      target: schema.syncLocks.name,
      set: { owner, expiresAt: new Date(Date.now() + 600000) },
    });
  bindLease(c, { owner, runId: null, envelope: null });
}
async function scan(c: RiotClient, offset = 0, pending: string[] = []) {
  const p = await row();
  return syncWrite(c, (tx) =>
    openMatchScansInTx(tx, c, p, "season_backfill", from, to, offset, pending),
  );
}
const binding = { playerId, platform: "LA2" as const, puuid };

describe("MATCH receiver boundary (transport explicitly simulated, never Riot authentication)", () => {
  it.each([0, 99, 100])(
    "keeps original %i IDs, offsets, empty/short/full and terminal observations",
    async (length) => {
      const ids = Array.from({ length }, (_, i) => `LA2_${i + 1}`);
      const { c, fetcher } = client([Response.json(ids)]);
      const p = await row();
      const s = await scan(c);
      const observed = await c.observeMatchIds(binding, { ...query, start: 200 });
      await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture));
      const pages = (await units()).filter((u) => u.kind === "page");
      expect(pages).toHaveLength(2);
      expect(pages[0].offset).toBe(200);
      expect(pages[0].data.terminalByImportPolicy).toBe(length < 100);
      expect((pages[0].data.record as { ids: string[] }).ids).toEqual(ids);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        (await headers()).every(
          (h) => h.status === "collecting" && h.data.recoverableCoverage === "not_established",
        ),
      ).toBe(true);
    },
  );
  it("distinguishes duplicate IDs from deduplicated pending and splits 101-unit inserts in one SW", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `LA2_${i + 1}`);
    const { c } = client([Response.json(ids)]);
    const p = await row();
    const s = await scan(c);
    const observed = await c.observeMatchIds(binding, query);
    queries.length = 0;
    await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture));
    expect((await row()).sourceRevision).toBe(2n);
    expect(await units()).toHaveLength(202);
    expect(
      queries.filter((q) => q.startsWith('insert into "achievement_evidence_units"')),
    ).toHaveLength(4);
    const repeated = client([Response.json(["LA2_1", "LA2_1", "LA2_2"])]).c;
    const next = await repeated.observeMatchIds(binding, query);
    await syncWrite(repeated, (tx) => capturePageInTx(tx, repeated, s, p, next.capture));
    expect((await units()).filter((u) => u.kind === "page").at(-1)?.data.record).toMatchObject({
      ids: ["LA2_1", "LA2_1", "LA2_2"],
    });
  });
  it("preserves successive differing responses at the same offset without overwrite", async () => {
    const { c } = client([Response.json(["LA2_1"]), Response.json(["LA2_2"])]);
    const p = await row();
    const s = await scan(c);
    for (let i = 0; i < 2; i++) {
      const observed = await c.observeMatchIds(binding, query);
      await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture));
    }
    const pages = (await units()).filter((u) => u.kind === "page" && u.headerId === s.roots[0].id);
    expect(pages.map((p) => p.attempt)).toEqual([1, 2]);
    expect(pages[1].data.indexComparison).toBe("requires_review");
    expect((pages[0].data.record as { ids: string[] }).ids).toEqual(["LA2_1"]);
  });
  it("rejects arbitrary/copied handles, another client and an altered owner binding", async () => {
    const { c } = client([Response.json([])]);
    const observed = await c.observeMatchIds(binding, query);
    expect(() => c.confirmedMatchInput({ key: observed.capture.key }, binding)).toThrow(
      MatchCaptureError,
    );
    expect(() => client([]).c.confirmedMatchInput(observed.capture, binding)).toThrow(
      MatchCaptureError,
    );
    expect(() => c.confirmedMatchInput(observed.capture, { ...binding, puuid: "other" })).toThrow(
      MatchCaptureError,
    );
    const data = c.confirmedMatchInput(observed.capture, binding);
    expect(data.source).toBe("synthetic");
    expect(JSON.stringify(data)).not.toContain(puuid);
    expect(JSON.stringify(data)).not.toContain("synthetic-key");
    expect(JSON.stringify(data)).not.toContain("https:");
    expect(data).toMatchObject({ grantAuthorized: false, certification: "not_established" });
  });
  it.each([404, 429, 503])(
    "keeps HTTP %i and retries in the original dispatch budget",
    async (status) => {
      const { c, fetcher } = client([
        new Response("", { status, headers: { "Retry-After": "3" } }),
        Response.json(match()),
      ]);
      const observed = await c.withBudget({ deadline: Date.now() + 30000, requests: 1 }, () =>
        c.observeMatchDetail(binding, "LA2_1"),
      );
      expect(observed.error).toMatchObject({ status });
      const r = c.confirmedMatchInput(observed.capture, binding);
      expect(r.receptions).toHaveLength(1);
      expect(r.receptions[0].receivedAt).not.toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves three network failures without inventing HTTP receipt times", async () => {
    const { c, fetcher } = client([new Error("one"), new Error("two"), new Error("three")]);
    const observed = await c.observeMatchDetail(binding, "LA2_1");
    expect(observed.error).toBeInstanceOf(RiotError);
    const r = c.confirmedMatchInput(observed.capture, binding);
    expect(r.receptions).toHaveLength(3);
    expect(
      r.receptions.every(
        (a) => a.receivedAt === null && a.receptionId === null && a.failedAt !== null,
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("retains 429 then successful response as two different events without extra requests", async () => {
    const { c, fetcher } = client([
      new Response("", { status: 429, headers: { "Retry-After": "1.3" } }),
      Response.json([]),
    ]);
    const observed = await c.observeMatchIds(binding, query);
    expect(
      c.confirmedMatchInput(observed.capture, binding).receptions.map((r) => r.status),
    ).toEqual([429, 200]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["json", "schema"])(
    "keeps %s-invalid HTTP response as unresolved, never empty successful page",
    async (kind) => {
      const { c } = client([
        kind === "json" ? new Response("{", { status: 200 }) : Response.json({ unexpected: true }),
      ]);
      const observed = await c.observeMatchIds(binding, query);
      const r = c.confirmedMatchInput(observed.capture, binding);
      expect(observed.error).toBeDefined();
      expect(r.ids).toBeNull();
      expect(r.receptions[0].outcome).toBe(kind === "json" ? "invalid_json" : "invalid_schema");
    },
  );
});

describe("MATCH InTx, persistence, recovery and policy A (PGlite, not multi-session MVCC)", () => {
  it("accepts the actual PGlite transaction as the shared port without casts", async () => {
    await database.transaction(async (tx) => {
      const port: EvidenceTransaction = tx;
      expect(await port.select().from(schema.players)).toHaveLength(1);
    });
  });
  it("commits source, disposition, cursor and one SQL R atomically for both queues", async () => {
    const p = await row();
    const { c } = client([Response.json(match())]);
    const s = await scan(c);
    const observed = await c.observeMatchDetail(binding, "LA2_1");
    const m = observed.value!;
    await syncWrite(c, async (tx) => {
      await insertMatchParticipation(
        tx,
        {
          id: m.metadata.matchId,
          queueId: 420,
          mapId: 11,
          timestamp: new Date(m.info.gameStartTimestamp),
          duration: 1800,
          isRemake: false,
        },
        { playerId, matchId: "LA2_1", ...normalizeParticipant(m, puuid)! },
      );
      await captureDispositionInTx(
        tx,
        c,
        s,
        p,
        "LA2_1",
        "resolved",
        observed.capture,
        observed.capture.key,
      );
      await updateSourcePlayer(tx, playerId, { scanPending: [], scanOffset: 1 });
    });
    expect((await row()).sourceRevision).toBe(2n);
    expect((await units()).map((u) => u.revision)).toEqual([2n, 2n]);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect((await units()).find((u) => u.queue === "RANKED_FLEX_SR")?.data.state).toBe(
      "excluded_with_basis",
    );
    expect((await units())[0].data.record).toMatchObject({
      detail: { remake: { absent: 1, falsePresent: 0, evidentiarySufficiency: "unknown" } },
    });
  });
  it("retries identical persistence without another revision and recovers stored cursor on a fresh invocation", async () => {
    const p = await row();
    const { c } = client([Response.json(["LA2_1"]), Response.json(match())]);
    const s = await scan(c);
    const observed = await c.observeMatchIds(binding, query);
    await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture));
    const before = (await row()).sourceRevision;
    await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture));
    expect((await row()).sourceRevision).toBe(before);
    await database
      .update(schema.players)
      .set({ scanPending: ["LA2_1"], scanOffset: 1, scanEnd: to, scanExhausted: true });
    await importHistory(playerId, c, 1, attempt("history"));
    expect((await row()).scanPending).toEqual([]);
    expect((await row()).backfillProcessed).toBe(1);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect((await headers()).filter((h) => h.data.phase === "season_backfill")).toHaveLength(2);
  });
  it.each(["exception", "overflow", "scope", "lease", "final_fence"])(
    "rolls back source, evidence, cursor and R after %s",
    async (failure) => {
      const p = await row();
      const { c } = client([Response.json(match())]);
      await lease(c);
      const s = await scan(c);
      const observed = await c.observeMatchDetail(binding, "LA2_1");
      const m = observed.value!;
      if (failure === "overflow")
        await database.update(schema.players).set({ sourceRevision: 9223372036854775807n });
      if (failure === "lease")
        await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
      const before = await row();
      await expect(
        syncWrite(c, async (tx) => {
          await insertMatchParticipation(
            tx,
            {
              id: "LA2_1",
              queueId: 420,
              mapId: 11,
              timestamp: new Date(m.info.gameStartTimestamp),
              duration: 1800,
              isRemake: false,
            },
            { playerId, matchId: "LA2_1", ...normalizeParticipant(m, puuid)! },
          );
          await captureDispositionInTx(
            tx,
            c,
            failure === "scope" ? { ...s, platform: "NA1" } : s,
            p,
            "LA2_1",
            "resolved",
            observed.capture,
            observed.capture.key,
          );
          await updateSourcePlayer(tx, playerId, { scanPending: [], scanOffset: 50 });
          if (failure === "final_fence")
            await tx.update(schema.syncLocks).set({ expiresAt: new Date(0) });
          if (failure === "exception") throw new MatchCaptureError("conflict");
        }),
      ).rejects.toThrow();
      expect(await database.select().from(schema.playerMatches)).toHaveLength(0);
      expect(await database.select().from(schema.matches)).toHaveLength(0);
      expect(await units()).toHaveLength(0);
      expect((await row()).sourceRevision).toBe(before.sourceRevision);
      expect((await row()).scanOffset).toBe(before.scanOffset);
    },
  );
  it("keeps prior source/evidence and rejects contradictory participation without overwrite", async () => {
    const p = await row();
    const { c } = client([
      Response.json(match()),
      Response.json(match("LA2_1", { gameDuration: 1801 })),
    ]);
    const s = await scan(c);
    const first = await c.observeMatchDetail(binding, "LA2_1");
    const write = async (observed: typeof first) =>
      syncWrite(c, async (tx) => {
        const m = observed.value!;
        await insertMatchParticipation(
          tx,
          {
            id: "LA2_1",
            queueId: 420,
            mapId: 11,
            timestamp: new Date(m.info.gameStartTimestamp),
            duration: m.info.gameDuration,
            isRemake: false,
          },
          { playerId, matchId: "LA2_1", ...normalizeParticipant(m, puuid)! },
        );
        await captureDispositionInTx(
          tx,
          c,
          s,
          p,
          "LA2_1",
          "resolved",
          observed.capture,
          observed.capture.key,
        );
      });
    await write(first);
    const prior = await units();
    const second = await c.observeMatchDetail(binding, "LA2_1");
    await expect(write(second)).rejects.toThrow();
    expect(await units()).toEqual(prior);
    expect((await row()).sourceRevision).toBe(2n);
  });
  it("preserves unknown prefix and pending legacy; observational completed with gaps is not a receipt", async () => {
    await database
      .update(schema.players)
      .set({ scanOffset: 200, scanPending: ["LA2_1"], scanEnd: to, scanExhausted: true });
    const { c, fetcher } = client([new Response("", { status: 404 })]);
    await importHistory(playerId, c, 1, attempt("history"));
    expect(
      (await headers()).every(
        (h) =>
          h.data.prefix === "prefix_unknown" &&
          h.data.lifecycle === "import_finished" &&
          h.status === "collecting",
      ),
    ).toBe(true);
    expect((await units()).every((u) => u.data.state === "unavailable_404")).toBe(true);
    expect((await row()).backfillUnavailable).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["other_queue", "mode", "outside", "legacy"])(
    "keeps %s disposition and honest coverage without new requests for reused data",
    async (kind) => {
      const m = match(
        "LA2_1",
        kind === "other_queue"
          ? { queueId: 440 }
          : kind === "mode"
            ? { gameMode: "ARAM", mapId: 12 }
            : kind === "outside"
              ? { gameStartTimestamp: from.getTime() - 1000 }
              : {},
      );
      const p = await row();
      const { c, fetcher } = client([Response.json(m)]);
      const s = await scan(c);
      if (kind === "legacy") {
        await syncWrite(c, (tx) => captureReusedInTx(tx, c, s, ["LA2_1"], "fixture"));
        expect(fetcher).not.toHaveBeenCalled();
      } else {
        const observed = await c.observeMatchDetail(binding, "LA2_1");
        await syncWrite(c, (tx) =>
          captureDispositionInTx(
            tx,
            c,
            s,
            p,
            "LA2_1",
            kind === "mode" ? "excluded_with_basis" : "resolved",
            observed.capture,
            observed.capture.key,
          ),
        );
      }
      const projection = await syncWrite(c, (tx) =>
        projectMatchDispositionsInTx(tx, s.roots[0].id, playerId),
      );
      expect(projection[0].data.state).toBe(
        kind === "legacy" ? "reused_without_attestation" : "excluded_with_basis",
      );
      expect((await headers()).every((h) => h.data.recoverableCoverage === "not_established")).toBe(
        true,
      );
    },
  );
  it("rejects ambiguous active roots rather than choosing the newest", async () => {
    const { c } = client([]);
    await scan(c);
    const h = (await headers())[0];
    await database
      .insert(schema.achievementEvidenceHeaders)
      .values({ ...h, id: randomUUID(), operationKey: `duplicate:${randomUUID()}` });
    await expect(scan(c)).rejects.toThrow(MatchCaptureError);
  });
  it("starts a new window/season binding and preserves the previous interrupted root", async () => {
    const { c } = client([]);
    await scan(c);
    const p = await row();
    await syncWrite(c, (tx) =>
      openMatchScansInTx(tx, c, p, "season_backfill", new Date(from.getTime() + 1000), to),
    );
    expect(await headers()).toHaveLength(4);
    expect((await headers()).filter((h) => h.data.lifecycle === "interrupted")).toHaveLength(2);
  });
  it("recent imported five cap leaves pending evidence and lastSyncedAt unchanged", async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((i) => `LA2_${i}`);
    const { c, fetcher } = client([
      Response.json(ids),
      ...ids.slice(0, 5).map((id) => Response.json(match(id))),
    ]);
    const p = await row();
    const result = await importRecent(p, c, 5, attempt("recent"));
    expect(result).toMatchObject({ status: "partial", imported: 5, reason: "batch_limit" });
    expect((await row()).lastSyncedAt).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(6);
    const root = (await headers())[0].id;
    const projection = await syncWrite(c, (tx) => projectMatchDispositionsInTx(tx, root, playerId));
    expect(projection.find((d) => d.matchId === "LA2_6")?.data.state).toBe("pending");
  });
  it("unavailable service fields stay unresolved and do not advance the historical pending cursor", async () => {
    const corrupt = { ...match(), info: { ...match().info, participants: [{}] } };
    const { c } = client([Response.json(["LA2_1"]), Response.json(corrupt)]);
    await expect(importHistory(playerId, c, 1, attempt("history"))).rejects.toThrow();
    expect((await row()).scanPending).toEqual(["LA2_1"]);
    expect((await units()).some((u) => u.data.state === "unknown")).toBe(true);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(0);
  });
  it("keeps Demo completely outside receipt production and DB writes", async () => {
    const { c, fetcher } = client([]);
    vi.stubEnv("DEMO_MODE", "true");
    await expect(c.observeMatchIds(binding, query)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await headers()).toHaveLength(0);
  });
  it.each(["limit", "storage"])(
    "rolls back a source unit when mandatory evidence hits %s failure",
    async (kind) => {
      const p = await row();
      const { c } = client([Response.json(match())]);
      const s = await scan(c);
      const observed = await c.observeMatchDetail(binding, "LA2_1");
      const m = observed.value!;
      const capacity = vi
        .spyOn(evidenceCapacity, "assertEvidenceCapacityInTx")
        .mockRejectedValue(
          kind === "limit"
            ? new LocalEvidenceError("limit")
            : new Error("simulated storage failure"),
        );
      await expect(
        syncWrite(c, async (tx) => {
          await insertMatchParticipation(
            tx,
            {
              id: "LA2_1",
              queueId: 420,
              mapId: 11,
              timestamp: new Date(m.info.gameStartTimestamp),
              duration: 1800,
              isRemake: false,
            },
            { playerId, matchId: "LA2_1", ...normalizeParticipant(m, puuid)! },
          );
          await captureDispositionInTx(
            tx,
            c,
            s,
            p,
            "LA2_1",
            "resolved",
            observed.capture,
            observed.capture.key,
          );
          await updateSourcePlayer(tx, playerId, { scanOffset: 50 });
        }),
      ).rejects.toThrow();
      capacity.mockRestore();
      expect(await database.select().from(schema.matches)).toHaveLength(0);
      expect(await units()).toHaveLength(0);
      expect((await row()).sourceRevision).toBe(1n);
      expect((await row()).scanOffset).toBe(0);
    },
  );
  it("enforces the real thousand-header cap and rolls back the partially opened pair", async () => {
    const { c } = client([]);
    await scan(c);
    const h = (await headers())[0];
    const fixtures = Array.from({ length: 997 }, (_, i) => ({
      ...h,
      id: randomUUID(),
      operationKey: `legacy:${i}`,
      version: "legacy-fixture",
      data: { fixture: true },
    }));
    for (let i = 0; i < fixtures.length; i += 100)
      await database.insert(schema.achievementEvidenceHeaders).values(fixtures.slice(i, i + 100));
    const p = await row();
    await expect(
      syncWrite(c, (tx) => openMatchScansInTx(tx, c, p, "recent", from, to)),
    ).rejects.toThrow(LocalEvidenceError);
    expect(await headers()).toHaveLength(999);
    expect((await row()).sourceRevision).toBe(1n);
  });
  it("does not call a reception source-confirmed when no matching participation exists", async () => {
    const p = await row();
    const { c } = client([Response.json(match())]);
    const s = await scan(c);
    const observed = await c.observeMatchDetail(binding, "LA2_1");
    await syncWrite(c, (tx) =>
      captureDispositionInTx(
        tx,
        c,
        s,
        p,
        "LA2_1",
        "resolved",
        observed.capture,
        observed.capture.key,
      ),
    );
    const solo = (await units()).find((u) => u.queue === "RANKED_SOLO_5x5")!;
    expect(solo.data).toMatchObject({
      state: "unknown",
      sourceConfirmation: "none",
      issues: ["source_not_confirmed"],
    });
  });
  it("keeps duplicate participant ambiguity without changing the observational importer", async () => {
    const m = match();
    m.info.participants.push({ ...m.info.participants[0] });
    const { c } = client([Response.json(["LA2_1"]), Response.json(m)]);
    await importRecent(await row(), c, 5, attempt("recent"));
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect(
      (await units())
        .filter(
          (u) =>
            u.data.record && (u.data.record as { endpoint: string }).endpoint === "MATCH-V5-DETAIL",
        )
        .every((u) => u.data.state === "unknown"),
    ).toBe(true);
  });
  it("requires a bound lease before persisting received-mode evidence (global fetch mocked, no authenticated Riot used)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    const c = new RiotClient();
    const p = await row();
    const s = await scan(c);
    const observed = await c.observeMatchIds(binding, query);
    await expect(
      syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, observed.capture)),
    ).rejects.toMatchObject({ code: "unleased" });
    expect(await units()).toHaveLength(0);
  });
  it("method substitution has no HTTP receipt and cannot masquerade as a real server source", async () => {
    const c = new RiotClient();
    vi.spyOn(c, "matchIds").mockResolvedValue(["legacy_key"]);
    const observed = await c.observeMatchIds(binding, query);
    const record = c.confirmedMatchInput(observed.capture, binding);
    expect(record).toMatchObject({ source: "unknown", ids: ["legacy_key"] });
    expect(record.receptions[0]).toMatchObject({
      receptionId: null,
      receivedAt: null,
      validatedAt: null,
      status: null,
      outcome: "unobserved",
    });
  });
  it("blocks tampered predecessor fingerprints instead of appending a successful event", async () => {
    const p = await row();
    const { c } = client([Response.json(["LA2_1"]), Response.json(match())]);
    const s = await scan(c);
    const page = await c.observeMatchIds(binding, query);
    await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, page.capture));
    const u = (await units()).find((u) => u.entityKey === "LA2_1")!;
    await database
      .update(schema.achievementEvidenceUnits)
      .set({ fingerprint: "0".repeat(64) })
      .where(eq(schema.achievementEvidenceUnits.id, u.id));
    const detail = await c.observeMatchDetail(binding, "LA2_1");
    await expect(
      syncWrite(c, (tx) =>
        captureDispositionInTx(tx, c, s, p, "LA2_1", "unknown", detail.capture, detail.capture.key),
      ),
    ).rejects.toThrow(MatchCaptureError);
    expect((await row()).sourceRevision).toBe(2n);
    expect(await units()).toHaveLength(4);
  });
  it("rejects cross-owner roots and capture linkage even when both players exist", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    await database.insert(schema.players).values({
      id: other,
      puuid: "other-fixture",
      gameName: "Other",
      tagLine: "TEST",
      platform: "LA2",
      scanStart: from,
    });
    const p = await row();
    const { c } = client([Response.json([])]);
    const s = await scan(c);
    const observed = await c.observeMatchIds(binding, query);
    await expect(
      syncWrite(c, (tx) =>
        capturePageInTx(tx, c, { ...s, playerId: other }, { ...p, id: other }, observed.capture),
      ),
    ).rejects.toThrow(MatchCaptureError);
    expect(await units()).toHaveLength(0);
  });
  it("retains a failed bounded normalization reception without advancing source or pending", async () => {
    const invalid = match("LA2_1", { gameStartTimestamp: to.getTime() - 0.5 });
    const { c } = client([Response.json(["LA2_1"]), Response.json(invalid)]);
    await expect(importHistory(playerId, c, 1, attempt("history"))).rejects.toThrow(
      MatchCaptureError,
    );
    expect((await row()).scanPending).toEqual(["LA2_1"]);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(0);
    const recorded = (await units()).find((u) => u.data.state === "unknown")!;
    expect(recorded.data.record).toMatchObject({
      detail: null,
      receptions: [
        { status: 200, outcome: "invalid_normalization", receivedAt: expect.any(String) },
      ],
    });
  });
  it("captures timeout attempts without fabricated HTTP reception timestamps", async () => {
    const { c, fetcher } = client(
      Array.from({ length: 3 }, () =>
        Object.assign(new Error("fixture"), { name: "TimeoutError" }),
      ),
    );
    const observed = await c.observeMatchIds(binding, query);
    expect(observed.error).toBeInstanceOf(RiotError);
    const record = c.confirmedMatchInput(observed.capture, binding);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      record.receptions.every(
        (r) => r.outcome === "timeout" && r.receivedAt === null && r.receptionId === null,
      ),
    ).toBe(true);
  });
  it("keeps two identical provider responses but not duplicate persistence of one handle", async () => {
    const p = await row();
    const { c, fetcher } = client([Response.json(match()), Response.json(match())]);
    const s = await scan(c);
    const persist = async (observed: Awaited<ReturnType<RiotClient["observeMatchDetail"]>>) =>
      syncWrite(c, async (tx) => {
        const m = observed.value!;
        await insertMatchParticipation(
          tx,
          {
            id: "LA2_1",
            queueId: 420,
            mapId: 11,
            timestamp: new Date(m.info.gameStartTimestamp),
            duration: 1800,
            isRemake: false,
          },
          { playerId, matchId: "LA2_1", ...normalizeParticipant(m, puuid)! },
        );
        await captureDispositionInTx(
          tx,
          c,
          s,
          p,
          "LA2_1",
          "resolved",
          observed.capture,
          observed.capture.key,
        );
      });
    const first = await c.observeMatchDetail(binding, "LA2_1");
    await persist(first);
    expect((await row()).sourceRevision).toBe(2n);
    await persist(first); // Lost response after commit: retry the same persistence capability.
    expect((await row()).sourceRevision).toBe(2n);
    const second = await c.observeMatchDetail(binding, "LA2_1");
    await persist(second);
    expect((await row()).sourceRevision).toBe(3n);
    expect(await units()).toHaveLength(4);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    expect(first.capture.key).not.toBe(second.capture.key);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rolls back a failed page and cursor while preserving the earlier scan checkpoint", async () => {
    const p = await row();
    const { c } = client([Response.json(["LA2_1"])]);
    const s = await scan(c);
    const page = await c.observeMatchIds(binding, query);
    const capacity = vi
      .spyOn(evidenceCapacity, "assertEvidenceCapacityInTx")
      .mockRejectedValue(new LocalEvidenceError("limit"));
    await expect(
      syncWrite(c, async (tx) => {
        await updateSourcePlayer(tx, playerId, { scanOffset: 1, scanPending: ["LA2_1"] });
        await capturePageInTx(tx, c, s, p, page.capture);
      }),
    ).rejects.toThrow(LocalEvidenceError);
    capacity.mockRestore();
    expect((await row()).sourceRevision).toBe(1n);
    expect((await row()).scanOffset).toBe(0);
    expect((await row()).scanPending).toEqual([]);
    expect(await headers()).toHaveLength(2);
    expect(await units()).toHaveLength(0);
    await syncWrite(c, (tx) => capturePageInTx(tx, c, s, p, page.capture));
    expect((await row()).sourceRevision).toBe(2n);
  });
  it("validates scope even for an idempotent observational close", async () => {
    const { c } = client([]);
    const s = await scan(c);
    await syncWrite(c, (tx) => finishMatchScansInTx(tx, c, s));
    await syncWrite(c, (tx) => finishMatchScansInTx(tx, c, s));
    expect((await row()).sourceRevision).toBe(2n);
    await expect(
      syncWrite(c, (tx) =>
        finishMatchScansInTx(tx, c, {
          ...s,
          from: new Date(from.getTime() + 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow(MatchCaptureError);
    expect((await row()).sourceRevision).toBe(2n);
  });
  it("does not let caller mutations alter the effective query or owner of a reception", async () => {
    const { c } = client([Response.json([])]);
    const effective = { ...query };
    const owner = { ...binding };
    const observed = await c.observeMatchIds(owner, effective);
    effective.start = 999;
    owner.puuid = "changed-fixture";
    const record = c.confirmedMatchInput(observed.capture, binding);
    expect(record.query?.start).toBe(0);
    await expect(async () => c.confirmedMatchInput(observed.capture, owner)).rejects.toThrow(
      MatchCaptureError,
    );
  });
  it("rejects invalid new scan metadata and rolls back the context in its opening transaction", async () => {
    const { c } = client([]);
    const p = await row();
    await expect(
      syncWrite(c, async (tx) => {
        await updateSourcePlayer(tx, playerId, { scanOffset: 1 });
        await openMatchScansInTx(
          tx,
          c,
          p,
          "season_backfill",
          from,
          to,
          1,
          Array.from({ length: 101 }, (_, i) => `LA2_${i + 1}`),
        );
      }),
    ).rejects.toThrow(MatchCaptureError);
    expect(await headers()).toHaveLength(0);
    expect((await row()).sourceRevision).toBe(0n);
    expect((await row()).scanOffset).toBe(0);
  });
});
