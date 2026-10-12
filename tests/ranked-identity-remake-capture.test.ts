import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { RiotClient, RiotError } from "@/server/riot/client";
import { MatchCaptureError } from "@/server/riot/match-capture";
import { RANKED_CAPTURE_VERSION, REMAKE_CLASSIFIER_VERSION } from "@/server/riot/ranked-capture";
import { bindLease, syncWrite, LeaseLost } from "@/server/sync/progress";
import {
  captureIdentityInTx,
  captureLeagueInTx,
  captureRemakeInTx,
  type SnapshotLink,
} from "@/server/sync/ranked-evidence";
import { syncPlayer } from "@/server/sync/service";
import { insertMatchParticipation, SourceConflict } from "@/server/sync/source-revision";
import { normalizeParticipant } from "@/server/riot/normalize";
import { seasonStart, CURRENT_SEASON } from "@/lib/season";
import type { RankedQueue } from "@/lib/queues";
import type { RiotMatch } from "@/server/riot/schemas";
import * as capacity from "@/server/achievements/verification/evidence-in-tx";
import { LocalEvidenceError } from "@/server/achievements/verification/persistence-contracts";
import { POST } from "@/app/api/admin/players/route";
import { createSession } from "@/server/auth";
import { playerSyncError } from "@/server/sync/player-state";
import { projectRankedEvents } from "@/server/sync/ranked-event-store";

const pg = new PGlite();
const queries: string[] = [];
const database = drizzle(pg, {
  schema,
  logger: {
    logQuery(q) {
      queries.push(q);
    },
  },
});
const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("@/db", () => ({ db: () => database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (cookieJar.has(k) ? { value: cookieJar.get(k) } : undefined),
    set: (k: string, v: string) => cookieJar.set(k, v),
  }),
}));
const puuid = "synthetic-private-owner-puuid";
const account = { puuid, gameName: "Fixture", tagLine: "TEST" };
const solo = {
  queueType: "RANKED_SOLO_5x5",
  tier: "DIAMOND",
  rank: "I",
  leaguePoints: 49,
  wins: 20,
  losses: 10,
};
const flex = { ...solo, queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "IV", leaguePoints: 28 };
const storedHeaders = () => database.select().from(schema.achievementEvidenceHeaders);
const units = () => database.select().from(schema.achievementEvidenceUnits);
// Assertions about receptions keep counting events, not their new storage containers.
const headers = async () => {
  const hs = await storedHeaders();
  const events = projectRankedEvents(hs, await units()).map(({ header, unit }) => ({
    ...header,
    version: String(unit.data.version),
    data: unit.data,
  }));
  return [...events, ...hs.filter((h) => h.kind === "match_scan")];
};
const row = async (id: string) =>
  (await database.select().from(schema.players).where(eq(schema.players.id, id)))[0];
async function player(identity = puuid) {
  return (
    await database
      .insert(schema.players)
      .values({
        puuid: identity,
        gameName: "Fixture",
        tagLine: "TEST",
        platform: "LA2",
        scanStart: seasonStart("LA2"),
        backfillSeason: CURRENT_SEASON.id,
      })
      .returning()
  )[0];
}
const binding = (p: typeof schema.players.$inferSelect) => ({
  playerId: p.id,
  platform: p.platform,
  puuid: p.puuid,
});
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
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE players,matches,sync_locks,admin_sessions CASCADE");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("RIOT_API_KEY", "synthetic-not-operational");
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-only-ranked-secret".repeat(4));
  vi.stubEnv("APP_URL", "http://localhost");
  cookieJar.clear();
  queries.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => pg.close());

describe("ranked/identity capture (PGlite SQL and simulated transport, not authenticated Riot or multi-session concurrency)", () => {
  it("captures successful admin creation within its existing lease/SW, with no private identity in evidence", async () => {
    await createSession();
    vi.spyOn(RiotClient.prototype, "account").mockResolvedValue(account);
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    // Stop further work with an observable HTTP failure. Account is already committed.
    vi.spyOn(RiotClient.prototype, "identity").mockRejectedValue(new RiotError(404));
    const request = () =>
      new Request("http://localhost/api/admin/players", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ gameName: "Fixture", tagLine: "TEST", platform: "LA2" }),
      });
    expect((await POST(request())).status).toBe(201);
    const [p] = await database.select().from(schema.players);
    const identity = (await headers()).filter(
      (h) => h.data.record && (h.data.record as { endpoint: string }).endpoint === "ACCOUNT-V1",
    );
    expect(identity).toHaveLength(2);
    expect(identity.every((h) => h.data.identityMatch === true && h.source === "unknown")).toBe(
      true,
    );
    expect(p.sourceRevision).toBe(2n); // alta then failed identity attempt, each once.
    await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    expect((await POST(request())).status).toBe(409);
    expect((await row(p.id)).sourceRevision).toBe(2n);
    expect(JSON.stringify(await headers())).not.toContain(puuid);
    expect(JSON.stringify((await units()).map((u) => u.data))).not.toContain("Fixture");
  });
  it("denies administrative creation before transport without authorization", async () => {
    const spy = vi.spyOn(RiotClient.prototype, "account");
    const response = await POST(
      new Request("http://localhost/api/admin/players", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ gameName: "Fixture", tagLine: "TEST", platform: "LA2" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(await headers()).toHaveLength(0);
  });
  it("admin HTTP mock creates only synthetic identity reception with its original receipt time", async () => {
    await createSession();
    const responses = [
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      new Response(null, { status: 404 }),
    ];
    const fetcher = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Fixture exhausted");
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request("http://localhost/api/admin/players", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ gameName: "Fixture", tagLine: "TEST", platform: "LA2" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const hs = await headers();
    expect(hs).toHaveLength(4);
    expect(hs.every((h) => h.source === "synthetic")).toBe(true);
    expect(
      hs
        .filter((h) => (h.data.record as { endpoint: string }).endpoint === "ACCOUNT-V1")
        .every(
          (h) =>
            h.data.identityMatch === true &&
            (h.data.record as { receptions: { receivedAt: string | null }[] }).receptions[0]
              .receivedAt !== null,
        ),
    ).toBe(true);
    expect(JSON.stringify(hs)).not.toContain(puuid);
  });
  it("rolls back administrative insertion if mandatory identity evidence fails", async () => {
    await createSession();
    vi.spyOn(RiotClient.prototype, "account").mockResolvedValue(account);
    vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 });
    vi.spyOn(capacity, "assertEvidenceCapacityInTx").mockRejectedValue(
      new LocalEvidenceError("limit"),
    );
    const response = await POST(
      new Request("http://localhost/api/admin/players", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ gameName: "Fixture", tagLine: "TEST", platform: "LA2" }),
      }),
    );
    expect(response.status).toBe(500);
    expect(await database.select().from(schema.players)).toHaveLength(0);
    expect(await headers()).toHaveLength(0);
  });
  it.each([{ entries: [solo] }, { entries: [solo, flex] }, { entries: [] }])(
    "records queue entries and absence without claiming literal Unranked: $entries",
    async ({ entries }) => {
      const p = await player();
      const { c, fetcher } = client([
        Response.json(account),
        Response.json({ profileIconId: 23 }),
        Response.json(entries),
      ]);
      await lease(c);
      await syncPlayer(p.id, c, { rankOnly: true });
      const hs = await headers();
      expect(hs).toHaveLength(4);
      expect(await units()).toHaveLength(6); // four receptions + two identity FK references
      expect((await row(p.id)).sourceRevision).toBe(1n);
      expect(fetcher).toHaveBeenCalledTimes(3);
      for (const h of hs.filter((h) => h.kind === "rank_capture")) {
        const expected = entries.filter((e) => e.queueType === h.queue);
        expect(h.data.entryPresent).toBe(expected.length > 0);
        expect(h.data.queueAmbiguous).toBe(false);
        expect((h.data.record as { entries: unknown[] }).entries).toHaveLength(expected.length);
        expect((h.data.snapshot as { origin: string }).origin).toBe(
          expected.length ? "observational_first_entry" : "existing_absence_policy",
        );
      }
      expect(
        hs.every(
          (h) =>
            h.source === "synthetic" &&
            h.status === "collecting" &&
            h.sealedAtRevision === null &&
            h.data.certification === "not_established" &&
            h.data.grantAuthorized === false,
        ),
      ).toBe(true);
      expect(JSON.stringify(hs)).not.toContain(puuid);
      expect(JSON.stringify(hs)).not.toContain("synthetic-not-operational");
      const updates = queries.filter(
        (q) =>
          q.startsWith('update "players"') &&
          q.includes('"source_revision" = "players"."source_revision" + 1'),
      );
      expect(updates).toHaveLength(1);
    },
  );
  it("preserves ambiguous duplicates while retaining the prior observational first-entry policy", async () => {
    const p = await player();
    const { c } = client([
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([solo, { ...solo, leaguePoints: 88 }]),
    ]);
    await lease(c);
    await syncPlayer(p.id, c, { rankOnly: true });
    const h = (await headers()).find(
      (h) => h.kind === "rank_capture" && h.queue === "RANKED_SOLO_5x5",
    )!;
    expect(h.data.queueAmbiguous).toBe(true);
    expect((h.data.record as { entries: unknown[] }).entries).toHaveLength(2);
    expect((h.data.snapshot as { leaguePoints: number }).leaguePoints).toBe(49);
  });
  it("new verification links unchanged snapshot with original timestamp and no synthetic historic date", async () => {
    const p = await player();
    const { c } = client([
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([solo]),
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([solo]),
    ]);
    await lease(c);
    await syncPlayer(p.id, c, { rankOnly: true });
    const originals = await database.select().from(schema.rankedSnapshots);
    const oldTime = new Date(Date.now() - 100000);
    await database.update(schema.rankedSnapshots).set({ timestamp: oldTime });
    await syncPlayer(p.id, c, { rankOnly: true });
    const snaps = await database.select().from(schema.rankedSnapshots);
    expect(snaps.map((s) => s.id)).toEqual(originals.map((s) => s.id));
    expect((await row(p.id)).sourceRevision).toBe(2n);
    const hs = (await headers()).filter(
      (h) =>
        h.kind === "rank_capture" && (h.data.snapshot as { inserted: boolean }).inserted === false,
    );
    expect(hs).toHaveLength(2);
    expect(
      hs.every(
        (h) => (h.data.snapshot as { timestamp: string }).timestamp === oldTime.toISOString(),
      ),
    ).toBe(true);
    expect(
      hs.every(
        (h) =>
          (h.data.record as { receptions: { receivedAt: string }[] }).receptions[0].receivedAt !==
          oldTime.toISOString(),
      ),
    ).toBe(true);
  });
  it("only the changed queue inserts a new snapshot while both receptions share one destination revision", async () => {
    const p = await player();
    const { c } = client([
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([solo, flex]),
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([{ ...solo, leaguePoints: 28 }, flex]),
    ]);
    await lease(c);
    await syncPlayer(p.id, c, { rankOnly: true });
    await syncPlayer(p.id, c, { rankOnly: true });
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(3);
    expect((await row(p.id)).sourceRevision).toBe(2n);
    const latestUnits = (await units()).filter(
      (u) => u.revision === 2n && u.data.snapshot !== null && u.data.snapshot !== undefined,
    );
    expect(latestUnits.find((u) => u.queue === "RANKED_SOLO_5x5")?.kind).toBe("snapshot");
    expect(latestUnits.find((u) => u.queue === "RANKED_FLEX_SR")?.kind).toBe("disposition");
  });
  it("destination revision uses exact SQL bigint beyond Number precision", async () => {
    const p = await player();
    await database.update(schema.players).set({ sourceRevision: 9007199254740993n });
    const { c } = client([
      Response.json(account),
      Response.json({ profileIconId: 23 }),
      Response.json([solo, flex]),
    ]);
    await lease(c);
    await syncPlayer(p.id, c, { rankOnly: true });
    expect((await row(p.id)).sourceRevision).toBe(9007199254740994n);
    expect((await units()).every((u) => u.revision === 9007199254740994n)).toBe(true);
  });
  it("summoner failure retains identity receipt without asserting a league check", async () => {
    const p = await player();
    const { c, fetcher } = client([Response.json(account), new Response(null, { status: 404 })]);
    await lease(c);
    await expect(syncPlayer(p.id, c, { rankOnly: true })).rejects.toBeInstanceOf(RiotError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await headers()).every((h) => h.kind === "identity_capture")).toBe(true);
    expect(await headers()).toHaveLength(2);
    expect((await row(p.id)).rankCheckedAt).toBeNull();
  });
  it("mismatched identity records a negative check without changing snapshots/rank/context", async () => {
    const p = await player();
    const { c, fetcher } = client([
      Response.json({ ...account, puuid: "different-private-owner" }),
    ]);
    await lease(c);
    await expect(syncPlayer(p.id, c, { rankOnly: true })).rejects.toMatchObject({ code: "scope" });
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
    expect((await row(p.id)).rankCheckedAt).toBeNull();
    expect((await row(p.id)).gameName).toBe("Fixture");
    expect((await headers()).every((h) => h.data.identityMatch === false)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await headers())).not.toContain("different-private-owner");
  });
  it("legacy method substitution remains unknown with no receipt dates", async () => {
    const p = await player();
    const c = new RiotClient();
    vi.spyOn(c, "identity").mockResolvedValue(account);
    const o = await c.observeIdentity(binding(p));
    await syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, o.capture));
    expect((await headers()).every((h) => h.source === "unknown")).toBe(true);
    expect(c.confirmedRankedInput(o.capture, binding(p)).record.receptions[0]).toMatchObject({
      outcome: "unobserved",
      receivedAt: null,
      receptionId: null,
    });
  });
  it("global fetch mocks are synthetic and need a bound lease", async () => {
    const p = await player();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(account)),
    );
    const c = new RiotClient();
    const o = await c.observeIdentity(binding(p));
    expect(c.confirmedRankedInput(o.capture, binding(p)).record.source).toBe("synthetic");
    await expect(
      syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, o.capture)),
    ).rejects.toMatchObject({ code: "unleased" });
    expect(await headers()).toHaveLength(0);
  });
  it("unattributed runtime wrappers cannot become Riot provenance or bypass authorization", async () => {
    const p = await player();
    vi.stubEnv("NODE_ENV", "production");
    // A controlled stand-in for a later wrapper, not a real provider or MVCC test.
    vi.stubGlobal("fetch", async () => Response.json(account));
    const c = new RiotClient();
    const o = await c.observeIdentity(binding(p));
    expect(c.confirmedRankedInput(o.capture, binding(p)).record.source).toBe("unknown");
    await expect(
      syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, o.capture)),
    ).rejects.toMatchObject({ code: "unleased" });
    await lease(c);
    await syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, o.capture));
    expect(
      (await headers()).every(
        (h) =>
          h.source === "unknown" &&
          (h.data.record as { receptions: { receivedAt: string | null }[] }).receptions[0]
            .receivedAt !== null,
      ),
    ).toBe(true);
  });
  it("rejects copied/cross-client/cross-owner handles and forged identity parent", async () => {
    const p = await player();
    const other = await player("second-private");
    const { c } = client([Response.json(account), Response.json([solo])]);
    await lease(c);
    const o = await c.observeIdentity(binding(p));
    expect(() => c.confirmedRankedInput({ ...o.capture }, binding(p))).toThrow(MatchCaptureError);
    expect(() => new RiotClient().confirmedRankedInput(o.capture, binding(p))).toThrow(
      MatchCaptureError,
    );
    expect(() => c.confirmedRankedInput(o.capture, binding(other))).toThrow(MatchCaptureError);
    const l = await c.observeLeagues(binding(p));
    await expect(
      syncWrite(c, (tx) =>
        captureLeagueInTx(tx, c, p, l.capture, {
          identityMatch: true,
          ids: new Map(),
          handle: { ...o.capture },
        }),
      ),
    ).rejects.toMatchObject({ code: "scope" });
    expect(await headers()).toHaveLength(0);
  });
  it.each(["capacity", "second_queue", "overflow", "final_fence"])(
    "rolls back the complete ranked unit for %s",
    async (failure) => {
      const p = await player();
      const { c } = client([
        Response.json(account),
        Response.json({ profileIconId: 23 }),
        Response.json([solo, flex]),
      ]);
      await lease(c);
      if (failure === "capacity")
        vi.spyOn(capacity, "assertEvidenceCapacityInTx").mockRejectedValue(
          new LocalEvidenceError("limit"),
        );
      if (failure === "overflow")
        await database.update(schema.players).set({ sourceRevision: 9223372036854775807n });
      if (failure === "second_queue")
        await pg.exec(
          "CREATE FUNCTION capture_fail_rank() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='rank_capture' AND NEW.queue='RANKED_FLEX_SR' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER capture_fail_rank BEFORE INSERT ON achievement_evidence_headers FOR EACH ROW EXECUTE FUNCTION capture_fail_rank();",
        );
      if (failure === "final_fence")
        await pg.exec(
          "CREATE FUNCTION capture_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='rank_capture' AND NEW.queue='RANKED_FLEX_SR' THEN UPDATE sync_locks SET expires_at='1970-01-01'; END IF; RETURN NEW; END $$; CREATE TRIGGER capture_fence AFTER INSERT ON achievement_evidence_headers FOR EACH ROW EXECUTE FUNCTION capture_fence();",
        );
      try {
        await expect(syncPlayer(p.id, c, { rankOnly: true })).rejects.toThrow();
        expect(await headers()).toHaveLength(0);
        expect(await units()).toHaveLength(0);
        expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
        expect((await row(p.id)).rankCheckedAt).toBeNull();
        expect((await row(p.id)).sourceRevision).toBe(
          failure === "overflow" ? 9223372036854775807n : 0n,
        );
      } finally {
        if (failure === "second_queue")
          await pg.exec(
            "DROP TRIGGER capture_fail_rank ON achievement_evidence_headers; DROP FUNCTION capture_fail_rank()",
          );
        if (failure === "final_fence")
          await pg.exec(
            "DROP TRIGGER capture_fence ON achievement_evidence_headers; DROP FUNCTION capture_fence()",
          );
      }
    },
  );
  it("identity/league retry is idempotent; another identical HTTP reception is a new event", async () => {
    const p = await player();
    const { c } = client([
      Response.json(account),
      Response.json([solo]),
      Response.json(account),
      Response.json([solo]),
    ]);
    await lease(c);
    const i = await c.observeIdentity(binding(p));
    const l = await c.observeLeagues(binding(p));
    const persist = () =>
      syncWrite(c, async (tx) => {
        const id = await captureIdentityInTx(tx, c, p, i.capture);
        await captureLeagueInTx(tx, c, p, l.capture, id);
      });
    await persist();
    await persist();
    expect((await row(p.id)).sourceRevision).toBe(1n);
    expect(await headers()).toHaveLength(4);
    const i2 = await c.observeIdentity(binding(p));
    const l2 = await c.observeLeagues(binding(p));
    await syncWrite(c, async (tx) => {
      const id = await captureIdentityInTx(tx, c, p, i2.capture);
      await captureLeagueInTx(tx, c, p, l2.capture, id);
    });
    expect((await row(p.id)).sourceRevision).toBe(2n);
    expect(await headers()).toHaveLength(8);
    expect(await storedHeaders()).toHaveLength(4);
    expect(await units()).toHaveLength(12);
  });
  it("immutable event conflict cannot overwrite stored source", async () => {
    const p = await player();
    const { c } = client([Response.json(account)]);
    await lease(c);
    const i = await c.observeIdentity(binding(p));
    await syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, i.capture));
    const h = (await storedHeaders())[0];
    await database
      .update(schema.achievementEvidenceHeaders)
      .set({ data: { ...h.data, identityMatch: false } })
      .where(eq(schema.achievementEvidenceHeaders.id, h.id));
    await expect(
      syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, i.capture)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await row(p.id)).sourceRevision).toBe(1n);
    expect((await storedHeaders()).find((x) => x.id === h.id)?.data.identityMatch).toBe(false);
    expect(() => projectRankedEvents([h], [])).toThrow(MatchCaptureError);
  });
  it("snapshot-bearing persistence retry keeps the immutable original link and revision", async () => {
    const p = await player();
    const { c } = client([Response.json(account), Response.json([solo])]);
    await lease(c);
    const i = await c.observeIdentity(binding(p));
    const l = await c.observeLeagues(binding(p));
    const [s] = await database
      .insert(schema.rankedSnapshots)
      .values({
        playerId: p.id,
        queue: "RANKED_SOLO_5x5",
        tier: solo.tier,
        division: solo.rank,
        leaguePoints: solo.leaguePoints,
        wins: solo.wins,
        losses: solo.losses,
      })
      .returning();
    const links = new Map<RankedQueue, SnapshotLink>([
      ["RANKED_SOLO_5x5", { snapshot: s, inserted: true }],
    ]);
    const persist = () =>
      syncWrite(c, async (tx) => {
        const id = await captureIdentityInTx(tx, c, p, i.capture);
        await captureLeagueInTx(tx, c, p, l.capture, id, links);
      });
    await persist();
    const before = await units();
    await persist();
    expect(await units()).toEqual(before);
    expect((await row(p.id)).sourceRevision).toBe(1n);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(1);
  });
  it("conflicting snapshot link aborts evidence with no overwrite", async () => {
    const p = await player();
    const { c } = client([Response.json(account), Response.json([solo])]);
    await lease(c);
    const i = await c.observeIdentity(binding(p));
    const l = await c.observeLeagues(binding(p));
    await expect(
      syncWrite(c, async (tx) => {
        const id = await captureIdentityInTx(tx, c, p, i.capture);
        const [s] = await tx
          .insert(schema.rankedSnapshots)
          .values({
            playerId: p.id,
            queue: "RANKED_SOLO_5x5",
            tier: "DIAMOND",
            division: "I",
            leaguePoints: 999,
            wins: 20,
            losses: 10,
          })
          .returning();
        await captureLeagueInTx(
          tx,
          c,
          p,
          l.capture,
          id,
          new Map<RankedQueue, SnapshotLink>([
            ["RANKED_SOLO_5x5", { snapshot: s, inserted: true }],
          ]),
        );
      }),
    ).rejects.toThrow(SourceConflict);
    expect(await headers()).toHaveLength(0);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
  });
  it.each(["http", "invalid", "network", "timeout", "429"])(
    "retains %s failure without asserting rank coverage",
    async (type) => {
      const p = await player();
      const failed =
        type === "http"
          ? new Response(null, { status: 404 })
          : type === "invalid"
            ? Response.json([{ ...solo, leaguePoints: -1 }])
            : type === "429"
              ? new Response(null, { status: 429, headers: { "retry-after": "600" } })
              : Object.assign(new Error("synthetic transport"), {
                  name: type === "timeout" ? "TimeoutError" : "Error",
                });
      const { c } = client([
        Response.json(account),
        Response.json({ profileIconId: 23 }),
        failed,
        failed,
        failed,
      ]);
      await lease(c);
      await expect(syncPlayer(p.id, c, { rankOnly: true })).rejects.toThrow();
      const hs = await headers();
      expect(hs).toHaveLength(4);
      expect(
        hs
          .filter((h) => h.kind === "rank_capture")
          .every((h) => h.data.entryPresent === null && h.data.snapshot === null),
      ).toBe(true);
      expect((await row(p.id)).rankCheckedAt).toBeNull();
      expect((await row(p.id)).rankError).not.toBeNull();
    },
  );
  it("lost lease rejects before evidence or context changes", async () => {
    const p = await player();
    const { c } = client([Response.json(account)]);
    await lease(c);
    const i = await c.observeIdentity(binding(p));
    await database.update(schema.syncLocks).set({ owner: randomUUID() });
    await expect(syncWrite(c, (tx) => captureIdentityInTx(tx, c, p, i.capture))).rejects.toThrow(
      LeaseLost,
    );
    expect(await headers()).toHaveLength(0);
    expect((await row(p.id)).sourceRevision).toBe(0n);
  });
  it("Demo prevents every observer without dispatch or SQL", async () => {
    const p = await player();
    const { c, fetcher } = client([]);
    vi.stubEnv("DEMO_MODE", "true");
    queries.length = 0;
    await expect(c.observeIdentity(binding(p))).rejects.toThrow(MatchCaptureError);
    await expect(
      c.observeAccount({ ...binding(p), puuid: null }, "Fixture", "TEST"),
    ).rejects.toThrow(MatchCaptureError);
    await expect(c.observeLeagues(binding(p))).rejects.toThrow(MatchCaptureError);
    await expect(c.observeRemakeDetail("LA2", "LA2_1")).rejects.toThrow(MatchCaptureError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });
});

function match(markers: (boolean | undefined)[], id = "LA2_900"): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: seasonStart("LA2").getTime() + 86400000,
      gameDuration: 1800,
      participants: markers.map((m, i) => ({
        puuid: `participant-${i}`,
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
        ...(m === undefined ? {} : { gameEndedInEarlySurrender: m }),
      })),
    },
  };
}
async function sharedOwners(m: RiotMatch) {
  const a = await player();
  const b = await player("second-private-owner");
  const c = new RiotClient();
  const source = {
    id: "LA2_900",
    queueId: m.info.queueId,
    mapId: m.info.mapId,
    timestamp: new Date(m.info.gameStartTimestamp),
    duration: m.info.gameDuration,
    isRemake: null,
  };
  await syncWrite(c, async (tx) => {
    for (const p of [a, b])
      await insertMatchParticipation(tx, source, {
        playerId: p.id,
        matchId: source.id,
        ...normalizeParticipant(m, m.info.participants[0].puuid)!,
      });
  });
  return [a, b] as const;
}
describe("shared remake basis under match then ordered-owner locks", () => {
  it.each([
    { markers: [true, false, undefined] },
    { markers: [false, false] },
    { markers: [undefined, undefined] },
    { markers: [false, undefined] },
  ])(
    "preserves markers $markers with personal fanout, one R per owner, safe retry",
    async ({ markers }) => {
      const m = match(markers);
      const owners = await sharedOwners(m);
      const { c, fetcher } = client([Response.json(m), Response.json(m)]);
      await lease(c);
      const o = await c.observeRemakeDetail("LA2", "LA2_900");
      const persist = () =>
        syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture));
      const result = await persist();
      expect(result).toEqual({ matching: true, classification: markers.includes(true) });
      await persist();
      expect(await headers()).toHaveLength(4);
      for (const p of owners) expect((await row(p.id)).sourceRevision).toBe(2n);
      const hs = await headers();
      expect(
        hs.every(
          (h) =>
            h.data.classifierVersion === REMAKE_CLASSIFIER_VERSION &&
            h.data.previousClassification === null,
        ),
      ).toBe(true);
      const detail = c.confirmedRemakeInput(o.capture, "LA2").detail!;
      expect(detail.remake.truePresent).toBe(markers.filter((m) => m === true).length);
      expect(detail.remake.falsePresent).toBe(markers.filter((m) => m === false).length);
      expect(detail.remake.absent).toBe(markers.filter((m) => m === undefined).length);
      expect(detail.remake.evidentiarySufficiency).toBe("unknown");
      expect(detail.remake.basis).toBe(
        markers.includes(true)
          ? "true_marker_present"
          : markers.every((m) => m === false)
            ? "all_markers_false"
            : "unknown",
      );
      expect(
        hs
          .filter((h) => h.queue === "RANKED_FLEX_SR")
          .every((h) => h.data.belongsToTargetQueue === false),
      ).toBe(true);
      const another = await c.observeRemakeDetail("LA2", "LA2_900");
      await syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", another.capture));
      for (const p of owners) expect((await row(p.id)).sourceRevision).toBe(3n);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const remainingId = owners[1].id;
      await database.delete(schema.players).where(eq(schema.players.id, owners[0].id));
      expect((await headers()).every((h) => h.playerId === remainingId)).toBe(true);
      expect(await headers()).toHaveLength(4);
      expect(await units()).toHaveLength(4);
      expect(await database.select().from(schema.matches)).toHaveLength(1);
    },
  );
  it("mismatched match ID persists uncertainty without classifying the requested source", async () => {
    const m = match([true]);
    const owners = await sharedOwners(m);
    const { c } = client([Response.json(match([true], "LA2_901"))]);
    await lease(c);
    const o = await c.observeRemakeDetail("LA2", "LA2_900");
    const result = await syncWrite(c, (tx) =>
      captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture),
    );
    expect(result).toEqual({ matching: false, classification: null });
    expect((await database.select().from(schema.matches))[0].isRemake).toBeNull();
    expect(
      (await headers()).every(
        (h) => h.data.matchIdMatches === false && h.data.basis === "unresolved",
      ),
    ).toBe(true);
    for (const p of owners) expect((await row(p.id)).sourceRevision).toBe(2n);
  });
  it("HTTP error preserves minimal failed attempt and leaves shared classification unknown", async () => {
    const m = match([false]);
    await sharedOwners(m);
    const { c } = client([new Response(null, { status: 404 })]);
    await lease(c);
    const o = await c.observeRemakeDetail("LA2", "LA2_900");
    expect(o.error).toBeInstanceOf(RiotError);
    await syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture));
    expect((await database.select().from(schema.matches))[0].isRemake).toBeNull();
    expect(await headers()).toHaveLength(4);
  });
  it("malformed remake JSON retains failure without leaking payload through script diagnostics", async () => {
    const m = match([false]);
    await sharedOwners(m);
    const { c } = client([
      new Response('{"puuid":"private-payload-not-to-log",', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    await lease(c);
    const o = await c.observeRemakeDetail("LA2", "LA2_900");
    expect(o.error).toBeInstanceOf(SyntaxError);
    await syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture));
    expect((await database.select().from(schema.matches))[0].isRemake).toBeNull();
    expect(c.confirmedRemakeInput(o.capture, "LA2").receptions[0].outcome).toBe("invalid_json");
    expect(JSON.stringify(await headers())).not.toContain("private-payload-not-to-log");
    expect(playerSyncError(o.error, "recent").message).toBe(
      "Error de sincronización; consulta el registro del servidor.",
    );
    expect(
      playerSyncError(new Error("SQL params: private-payload-not-to-log"), "recent").message,
    ).not.toContain("private-payload-not-to-log");
    expect(readFileSync("scripts/backfill-remakes.ts", "utf8")).toContain(
      'console.error(playerSyncError(error, "recent").message)',
    );
  });
  it.each(["second_owner", "overflow"])(
    "fanout failure %s rolls back every owner and match",
    async (failure) => {
      const m = match([true]);
      const owners = await sharedOwners(m);
      const { c } = client([Response.json(m)]);
      await lease(c);
      const o = await c.observeRemakeDetail("LA2", "LA2_900");
      if (failure === "overflow")
        await database
          .update(schema.players)
          .set({ sourceRevision: 9223372036854775807n })
          .where(eq(schema.players.id, owners[1].id));
      if (failure === "second_owner") {
        let calls = 0;
        const original = capacity.assertEvidenceCapacityInTx;
        vi.spyOn(capacity, "assertEvidenceCapacityInTx").mockImplementation(async (...args) => {
          if (++calls === 5) throw new LocalEvidenceError("limit");
          return original(...args);
        });
      }
      await expect(
        syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture)),
      ).rejects.toThrow();
      expect((await database.select().from(schema.matches))[0].isRemake).toBeNull();
      expect(await headers()).toHaveLength(0);
      expect(await units()).toHaveLength(0);
      expect((await row(owners[0].id)).sourceRevision).toBe(1n);
      expect((await row(owners[1].id)).sourceRevision).toBe(
        failure === "overflow" ? 9223372036854775807n : 1n,
      );
    },
  );
  it("rejects shared source conflict and normal player handle as remake authority", async () => {
    const m = match([false]);
    const [a] = await sharedOwners(m);
    const { c } = client([
      Response.json({ ...m, info: { ...m.info, queueId: 440 } }),
      Response.json(m),
    ]);
    await lease(c);
    const o = await c.observeRemakeDetail("LA2", "LA2_900");
    await expect(
      syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture)),
    ).rejects.toThrow(SourceConflict);
    const normal = await c.observeMatchDetail(binding(a), "LA2_900");
    expect(() => c.confirmedRemakeInput(normal.capture, "LA2")).toThrow(MatchCaptureError);
    expect(await headers()).toHaveLength(0);
  });
  it("uses only existing schema and leaves all experimental restrictions intact", async () => {
    const m = match([true]);
    await sharedOwners(m);
    const { c } = client([Response.json(m)]);
    await lease(c);
    const o = await c.observeRemakeDetail("LA2", "LA2_900");
    await syncWrite(c, (tx) => captureRemakeInTx(tx, c, "LA2", "LA2_900", o.capture));
    expect(
      (await headers()).every(
        (h) =>
          h.version === RANKED_CAPTURE_VERSION &&
          h.status === "collecting" &&
          h.fingerprint === null &&
          h.sealedAtRevision === null &&
          h.data.certification === "not_established" &&
          h.data.grantAuthorized === false,
      ),
    ).toBe(true);
    expect(JSON.stringify((await units()).map((u) => u.data))).not.toContain("participant-");
    expect(queries.some((q) => /insert into.*(grant|badge|equip)/i.test(q))).toBe(false);
  });
});
