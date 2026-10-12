/** Real MVCC/locks only. Explicitly enabled by the exclusive Docker harness; never DATABASE_URL. */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { localEvidenceRepository } from "@/server/achievements/verification/local-evidence-repository";
import { LocalEvidenceError } from "@/server/achievements/verification/persistence-contracts";
import {
  insertMatchParticipation,
  classifyStoredRemake,
  flushSourceRevisions,
  updateSourcePlayer,
  lockSourcePlayers,
} from "@/server/sync/source-revision";
import { bindLease, leaseContext, LeaseLost, syncWrite } from "@/server/sync/progress";
import { withSyncLease, SyncBusy } from "@/server/sync/lease";
import { redactDeletedPlayerProgressInTx } from "@/server/sync/player-deletion";
import {
  captureDispositionInTx,
  capturePageInTx,
  openMatchScansInTx,
} from "@/server/sync/match-evidence";
import { captureRemakeInTx } from "@/server/sync/ranked-evidence";
import { RiotClient } from "@/server/riot/client";
import { newRun, applyProgressEvent, type ProgressEnvelope } from "@/lib/sync-progress";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { identity, other, headerInput, sealFixture } from "./evidence-concurrency-fixtures";

const config = "artifacts/local-concurrency-postgres.json";
const enabled = existsSync(config);
const port: unknown = enabled ? JSON.parse(readFileSync(config, "utf8")).port : 0;
if (enabled && (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535))
  throw Error("Invalid disposable loopback port");
const options = {
  host: "127.0.0.1",
  port: Number(port),
  username: "postgres",
  database: "soloq_concurrency_test",
  ssl: false as const,
  max: 1,
  prepare: false,
  connect_timeout: 3,
  connection: { statement_timeout: 8000, lock_timeout: 6000 },
};
const a = postgres(options),
  b = postgres(options),
  observer = postgres(options);
const database = drizzle(a, { schema }),
  peer = drizzle(b, { schema });
let selected = database;
vi.mock("@/db", () => ({ db: () => selected }));
const repo = localEvidenceRepository(database),
  peerRepo = localEvidenceRepository(peer);
let pids: number[];
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
// Observed lock graph is the barrier. Poll delay only yields the event loop; never determines PASS.
async function blocked(pid: number, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [row] =
      await observer`select ${blocker}::int = any(pg_blocking_pids(${pid}::int)) blocked`;
    if (row.blocked) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Expected independent-session lock barrier not observed");
}
const row = async (id: string = identity.playerId) =>
  (await observer`select * from players where id=${id}`)[0];
async function state() {
  return (
    await observer`select
    (select jsonb_agg(to_jsonb(t) order by id) from players t) players,
    (select jsonb_agg(to_jsonb(t) order by id) from matches t) matches,
    (select jsonb_agg(to_jsonb(t) order by player_id,match_id) from player_matches t) participations,
    (select jsonb_agg(to_jsonb(t) order by id) from achievement_evidence_headers t) headers,
    (select jsonb_agg(to_jsonb(t) order by id) from achievement_evidence_units t) units,
    (select run_progress from sync_locks where name='riot') progress`
  )[0];
}
const source = (remake: boolean | null = null) => ({
  id: "LA2_900",
  queueId: 420,
  mapId: 11,
  timestamp: new Date("2026-10-01T00:00:00Z"),
  duration: 1800,
  isRemake: remake,
});
const participant = (id: string = identity.playerId) => ({
  playerId: id,
  matchId: "LA2_900",
  champion: "Synthetic",
  championId: 107,
  position: "JUNGLE",
  kills: 1,
  deaths: 1,
  assists: 1,
  cs: 1,
  damage: 1,
  win: true,
});
async function associate(id: string = identity.playerId) {
  await database.transaction(async (tx) => {
    await insertMatchParticipation(tx, source(), participant(id));
    await flushSourceRevisions(tx);
  });
}
async function binding(c: RiotClient, envelope: ProgressEnvelope | null = null) {
  const owner = envelope?.latest.leaseOwner ?? randomUUID();
  await database
    .insert(schema.syncLocks)
    .values({
      name: "riot",
      owner,
      expiresAt: sql`clock_timestamp()+interval '10 minutes'`,
      runProgress: envelope,
    })
    .onConflictDoUpdate({
      target: schema.syncLocks.name,
      set: {
        owner,
        expiresAt: sql`clock_timestamp()+interval '10 minutes'`,
        runProgress: envelope,
      },
    });
  bindLease(c, { owner, runId: envelope?.latest.runId ?? null, envelope });
}
function fakeClient(payload: unknown) {
  let now = Date.now();
  return new RiotClient(now + 230000, {
    fetcher: async () => Response.json(payload),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
  });
}
async function captureFixture(tracked = false) {
  const from = seasonStart("LA2"),
    to = new Date("2026-10-10T00:00:00Z");
  const c = fakeClient(["LA2_1"]);
  await binding(c, tracked ? progress() : null);
  const [p] = await database
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, identity.playerId));
  const scan = await syncWrite(c, (tx) =>
    openMatchScansInTx(tx, c, p, "season_backfill", from, to, 0, []),
  );
  const reception = await c.observeMatchIds(
    { playerId: p.id, platform: p.platform, puuid: p.puuid },
    { startTime: from.getTime() / 1000, endTime: to.getTime() / 1000, start: 0, count: 100 },
  );
  const persist = () =>
    syncWrite(c, async (tx) => {
      await capturePageInTx(tx, c, scan, p, reception.capture);
      await updateSourcePlayer(tx, p.id, { scanOffset: 100, scanPending: ["LA2_1"] });
    });
  return { c, p, scan, reception, persist, from, to };
}
async function maintenanceDelete(id: string, onDeleted?: () => Promise<void>) {
  return withSyncLease((c) =>
    syncWrite(c, async (tx) => {
      const removed = await tx.delete(schema.players).where(eq(schema.players.id, id)).returning();
      if (!removed.length) throw Error("Already absent");
      await redactDeletedPlayerProgressInTx(tx, c, id);
      await tx.execute(
        sql`delete from matches m where not exists(select 1 from player_matches p where p.match_id=m.id)`,
      );
      await onDeleted?.();
    }),
  );
}
async function expire() {
  await observer`update sync_locks set expires_at=clock_timestamp()-interval '1 second' where name='riot'`;
}
function progress() {
  const now = new Date().toISOString(),
    owner = randomUUID();
  const run = (playerId: string) => {
    const r = newRun(
      { action: "player_history", playerId, requestId: randomUUID() },
      owner,
      randomUUID(),
      now,
      CURRENT_SEASON.id,
    );
    for (const p of [identity.playerId, other.playerId])
      applyProgressEvent(
        r,
        { type: "import", pass: "history", playerId: p, imported: 1, confirmedMatchId: "LA2_900" },
        now,
      );
    return r;
  };
  return { version: 1 as const, latest: run(identity.playerId), previous: run(identity.playerId) };
}

describe.skipIf(!enabled)("D/E real PostgreSQL concurrency (exclusive Docker opt-in)", () => {
  beforeAll(async () => {
    pids = (
      await Promise.all([a, b, observer].map((c) => c`select pg_backend_pid()::int pid`))
    ).map((r) => r[0].pid);
    expect(new Set(pids).size).toBe(3);
    console.log("D/E independent PostgreSQL backend PIDs", pids);
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("RIOT_API_KEY", "synthetic-not-operational");
    // Any accidental operational transport fails; receivers use explicit injected mocks only.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw Error("External transport forbidden in F");
      }),
    );
  });
  beforeEach(async () => {
    selected = database;
    await observer`truncate players,matches,sync_locks cascade`;
    for (const id of [identity.playerId, other.playerId])
      await database.insert(schema.players).values({
        id,
        gameName: "Synthetic",
        tagLine: "F",
        platform: "LA2",
        puuid: `synthetic-${id}`,
        scanStart: seasonStart("LA2"),
        backfillSeason: CURRENT_SEASON.id,
      });
  });
  afterEach(() => {
    selected = database;
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await Promise.all([a.end(), b.end(), observer.end()]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("validates all nine migrated hashes, bigint, RLS, cascades and 0008 checks", async () => {
    const applied =
      await observer`select hash,created_at::text stamp from drizzle.__drizzle_migrations order by id`;
    const expected = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(applied.map((r) => [r.hash, r.stamp])).toEqual(
      expected.map((m) => [m.hash, String(m.folderMillis)]),
    );
    const tables =
      await observer`select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname`;
    expect(tables).toHaveLength(9);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    expect(
      (
        await observer`select data_type,is_nullable from information_schema.columns where table_name='players' and column_name='source_revision'`
      )[0],
    ).toMatchObject({ data_type: "bigint", is_nullable: "NO" });
    const fks =
      await observer`select confdeltype from pg_constraint where contype='f' and conrelid in ('achievement_evidence_headers'::regclass,'achievement_evidence_units'::regclass)`;
    expect(fks.length).toBeGreaterThan(3);
    expect(fks.every((f) => f.confdeltype === "c")).toBe(true);
    const checks =
      await observer`select conname,pg_get_constraintdef(oid) definition from pg_constraint where conname in ('evidence_header_kind','evidence_header_source')`;
    expect(checks.find((c) => c.conname === "evidence_header_kind")?.definition).toContain(
      "identity_capture",
    );
    expect(checks.find((c) => c.conname === "evidence_header_source")?.definition).toContain(
      "server_riot_received",
    );
  });
  it("A: serializes owner writers without a lost increment", async () => {
    const ready = gate(),
      release = gate();
    const first = database.transaction(async (tx) => {
      await updateSourcePlayer(tx, identity.playerId, { scanOffset: 100 });
      ready.resolve();
      await release.promise;
      await flushSourceRevisions(tx);
    });
    await ready.promise;
    const second = peer.transaction(async (tx) => {
      await updateSourcePlayer(tx, identity.playerId, { backfillProcessed: 1 });
      await flushSourceRevisions(tx);
    });
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await Promise.all([first, second]);
    expect(await row()).toMatchObject({
      scan_offset: 100,
      backfill_processed: 1,
      source_revision: "2",
    });
  });
  it("A: concurrent D retries recover one immutable header and R", async () => {
    const ready = gate(),
      release = gate();
    const held = database.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.players)
        .where(eq(schema.players.id, identity.playerId))
        .for("update");
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    const competing = peerRepo.insertHeader(headerInput("same-operation"), "0");
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await held;
    const one = await competing;
    const two = await repo.insertHeader(headerInput("same-operation"), "0");
    expect(two.id).toBe(one.id);
    expect(await repo.revision(identity)).toBe("1");
    expect((await state()).headers).toHaveLength(1);
  });
  it("A: rolls back a changed source, participation and revision together", async () => {
    const before = await state();
    await expect(
      database.transaction(async (tx) => {
        await updateSourcePlayer(tx, identity.playerId, { scanOffset: 100 });
        await insertMatchParticipation(tx, source(), participant());
        await flushSourceRevisions(tx);
        throw Error("controlled rollback");
      }),
    ).rejects.toThrow("controlled rollback");
    expect(await state()).toEqual(before);
  });
  it.each(["association-first", "classification-first"])(
    "B: shared match fanout %s under the actual match row lock",
    async (order) => {
      await associate();
      const ready = gate(),
        release = gate();
      const first = database.transaction(async (tx) => {
        if (order === "association-first")
          await insertMatchParticipation(tx, source(), participant(other.playerId));
        else await classifyStoredRemake(tx, "LA2_900", true);
        await flushSourceRevisions(tx);
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      const second = peer.transaction(async (tx) => {
        if (order === "association-first") await classifyStoredRemake(tx, "LA2_900", true);
        else await insertMatchParticipation(tx, source(true), participant(other.playerId));
        await flushSourceRevisions(tx);
      });
      try {
        await blocked(pids[1], pids[0]);
      } finally {
        release.resolve();
      }
      await Promise.all([first, second]);
      expect(await row()).toMatchObject({ source_revision: "2" });
      expect(await row(other.playerId)).toMatchObject({
        source_revision: order === "association-first" ? "2" : "1",
      });
      expect((await state()).participations).toHaveLength(2);
      expect((await state()).matches[0].is_remake).toBe(true);
      // An association after classification sees the already-classified source and bumps its own R.
    },
  );
  it("B: shared classification failure rolls back both owner revisions", async () => {
    await associate();
    await associate(other.playerId);
    const before = await state();
    await expect(
      peer.transaction(async (tx) => {
        await classifyStoredRemake(tx, "LA2_900", true);
        await flushSourceRevisions(tx);
        throw Error("fanout rollback");
      }),
    ).rejects.toThrow("fanout rollback");
    expect(await state()).toEqual(before);
  });
  it("C: commits page/cursor/R, recovers a lost response and distinguishes another reception", async () => {
    const f = await captureFixture();
    await f.persist();
    const committed = await state();
    expect(await row()).toMatchObject({
      source_revision: "2",
      scan_offset: 100,
      scan_pending: ["LA2_1"],
    });
    await f.persist();
    expect(await state()).toEqual(committed); // Caller lost response; same private handle.
    const next = await f.c.observeMatchIds(
      { playerId: f.p.id, platform: f.p.platform, puuid: f.p.puuid },
      { startTime: f.from.getTime() / 1000, endTime: f.to.getTime() / 1000, start: 0, count: 100 },
    );
    await syncWrite(f.c, (tx) => capturePageInTx(tx, f.c, f.scan, f.p, next.capture));
    expect(await repo.revision(identity)).toBe("3");
    expect((await state()).units.filter((u: { kind: string }) => u.kind === "page")).toHaveLength(
      4,
    );
  });
  it("C: rolls back page/disposition/cursor/R and permits safe persistence retry", async () => {
    const f = await captureFixture(),
      before = await state();
    await expect(
      syncWrite(f.c, async (tx) => {
        await capturePageInTx(tx, f.c, f.scan, f.p, f.reception.capture);
        await updateSourcePlayer(tx, f.p.id, { scanOffset: 100 });
        throw Error("cursor rollback");
      }),
    ).rejects.toThrow("cursor rollback");
    expect(await state()).toEqual(before);
    await f.persist();
    expect(await repo.revision(identity)).toBe("2");
  });
  it("C: a takeover rejects an old pending capture without partial persistence", async () => {
    const f = await captureFixture();
    await expire();
    await withSyncLease(async () => undefined);
    const before = await state();
    await expect(f.persist()).rejects.toBeInstanceOf(LeaseLost);
    expect(await state()).toEqual(before);
  });
  it("C: checkpoints commit with page/cursor/R and an event failure rolls everything back", async () => {
    const f = await captureFixture(true),
      before = await state();
    const work = async (tx: Parameters<Parameters<typeof database.transaction>[0]>[0]) => {
      await capturePageInTx(tx, f.c, f.scan, f.p, f.reception.capture);
      await updateSourcePlayer(tx, f.p.id, { scanOffset: 100, scanPending: ["LA2_1"] });
    };
    await expect(
      syncWrite(f.c, work, () => {
        throw Error("checkpoint rollback");
      }),
    ).rejects.toThrow("checkpoint rollback");
    expect(await state()).toEqual(before);
    await syncWrite(f.c, work, {
      type: "result",
      pass: "history",
      result: { playerId: f.p.id, status: "partial", imported: 0, reason: "batch_limit" },
    });
    const saved = await state();
    expect(saved.progress.latest.revision).toBe(before.progress.latest.revision + 1);
    expect(
      saved.progress.latest.players.find((p: { playerId: string }) => p.playerId === f.p.id).history
        .history.cursorPending,
    ).toBe(1);
    expect(await repo.revision(identity)).toBe("2");
    expect(leaseContext(f.c)?.envelope).toEqual(saved.progress);
  });
  it("C: resolved disposition and source persist atomically under the lease", async () => {
    const f = await captureFixture();
    await f.persist();
    const m = {
      metadata: { matchId: "LA2_1" },
      info: {
        queueId: 420,
        mapId: 11,
        gameMode: "CLASSIC",
        gameStartTimestamp: Date.parse("2026-10-01T00:00:00Z"),
        gameDuration: 1800,
        participants: [
          {
            puuid: f.p.puuid,
            championName: "Synthetic",
            championId: 107,
            teamPosition: "JUNGLE",
            teamId: 100,
            kills: 1,
            deaths: 1,
            assists: 1,
            totalMinionsKilled: 1,
            neutralMinionsKilled: 0,
            totalDamageDealtToChampions: 1,
            win: true,
            gameEndedInEarlySurrender: false,
          },
        ],
      },
    };
    vi.spyOn(f.c, "match").mockResolvedValue(m);
    const observed = await f.c.observeMatchDetail(
      { playerId: f.p.id, platform: f.p.platform, puuid: f.p.puuid },
      "LA2_1",
    );
    const work = async (tx: Parameters<Parameters<typeof database.transaction>[0]>[0]) => {
      await insertMatchParticipation(
        tx,
        { ...source(false), id: "LA2_1" },
        { ...participant(), matchId: "LA2_1" },
      );
      await captureDispositionInTx(
        tx,
        f.c,
        f.scan,
        f.p,
        "LA2_1",
        "resolved",
        observed.capture,
        "detail:1",
      );
      await updateSourcePlayer(tx, f.p.id, { scanPending: [], backfillProcessed: 1 });
    };
    const before = await state();
    await expect(
      syncWrite(f.c, async (tx) => {
        await work(tx);
        throw Error("detail rollback");
      }),
    ).rejects.toThrow("detail rollback");
    expect(await state()).toEqual(before);
    await syncWrite(f.c, work);
    const saved = await state();
    await syncWrite(f.c, work);
    expect(await state()).toEqual(saved);
    expect(await row()).toMatchObject({
      source_revision: "3",
      scan_pending: [],
      backfill_processed: 1,
    });
  });
  it("D: REPEATABLE READ pins context/R/units while the other session commits", async () => {
    const { h } = await sealFixture(repo),
      before = await state();
    const captured = await database.transaction(
      async (tx) => {
        const initial = await tx
          .select()
          .from(schema.players)
          .where(eq(schema.players.id, identity.playerId));
        const settings = await tx.execute(
          sql`select current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly`,
        );
        expect(settings[0]).toMatchObject({ isolation: "repeatable read", readonly: "on" });
        await peerRepo.insertUnits(
          identity,
          h.id,
          [
            {
              kind: "disposition",
              unitKey: "new-pending",
              ordinal: 10,
              previousUnitId: null,
              disposition: { state: "pending", matchId: "LA2_999" },
            },
          ],
          "2",
        );
        return {
          initial,
          again: await tx
            .select()
            .from(schema.players)
            .where(eq(schema.players.id, identity.playerId)),
          units: await tx.select().from(schema.achievementEvidenceUnits),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    expect(captured.again).toEqual(captured.initial);
    expect(captured.units).toHaveLength(before.units.length);
    expect(await repo.revision(identity)).toBe("3");
  });
  it("D: rejects a stale prepared seal, preserving previous receipt hashes and references", async () => {
    const f = await sealFixture(repo),
      old = await repo.seal(f.token, "seal:first");
    // Existing token is tied to R=2; identical retry remains valid, a new grant/key is stale.
    await peer.transaction(async (tx) => {
      await updateSourcePlayer(tx, identity.playerId, { backfillProcessed: 2 });
      await flushSourceRevisions(tx);
    });
    const before = await state();
    await expect(repo.seal(f.token, "seal:stale")).rejects.toMatchObject({ code: "revision" });
    expect(await state()).toEqual(before);
    expect((await repo.seal(f.token, "seal:first")).id).toBe(old.id);
    const reproduced = await repo.reproduceSeal(identity, old.id);
    expect(reproduced.fingerprint).toBe(old.fingerprint);
    expect(reproduced).toMatchObject({ certification: "not_established", grantAuthorized: false });
    expect((await repo.sealState(identity, old.id)).state).toBe("review_required");
  });
  it("D: seal compare happens after the owner lock sees the concurrent commit", async () => {
    const f = await sealFixture(repo),
      ready = gate(),
      release = gate();
    const first = peer.transaction(async (tx) => {
      await updateSourcePlayer(tx, identity.playerId, { backfillProcessed: 1 });
      await flushSourceRevisions(tx);
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    const attempt = repo.seal(f.token, "seal:concurrent");
    const outcome = attempt.then(
      () => null,
      (e: unknown) => e,
    );
    try {
      await blocked(pids[0], pids[1]);
    } finally {
      release.resolve();
    }
    await first;
    expect(await outcome).toBeInstanceOf(LocalEvidenceError);
    expect(
      (await state()).headers.filter((h: { kind: string }) => h.kind === "structural_receipt"),
    ).toHaveLength(0);
  });
  it("E: active SW holds the lease; a concurrent administrative delete cannot acquire it", async () => {
    const c = new RiotClient();
    await binding(c);
    const ready = gate(),
      release = gate();
    const write = syncWrite(c, async (tx) => {
      await updateSourcePlayer(tx, identity.playerId, { scanOffset: 100 });
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    selected = peer;
    const deletion = maintenanceDelete(identity.playerId);
    selected = database;
    const outcome = deletion.then(
      () => null,
      (e: unknown) => e,
    );
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await write;
    expect(await outcome).toBeInstanceOf(SyncBusy);
    expect(await row()).toMatchObject({ scan_offset: 100, source_revision: "1" });
  });
  it("E: takeover/DELETE redact latest+previous, preserve other evidence and fence a late finalizer", async () => {
    await associate();
    await associate(other.playerId);
    await repo.insertHeader(headerInput("personal:a"), await repo.revision(identity));
    await peerRepo.insertHeader(
      { ...headerInput("personal:b"), identity: other },
      await peerRepo.revision(other),
    );
    const envelope = progress(),
      c = new RiotClient();
    await binding(c, envelope);
    const otherBefore = (await state()).headers.filter(
      (h: { player_id: string }) => h.player_id === other.playerId,
    );
    // A real tracked lease waits outside a transaction; deletion takes over only after expiry.
    await expire();
    const ready = gate(),
      release = gate();
    const stale = withSyncLease(
      async (old) => {
        ready.resolve();
        await release.promise;
        await syncWrite(old, async (tx) =>
          updateSourcePlayer(tx, identity.playerId, { scanOffset: 999 }),
        );
      },
      230000,
      undefined,
      { action: "player_history", playerId: identity.playerId },
    );
    const staleOutcome = stale.then(
      () => null,
      (e: unknown) => e,
    );
    await ready.promise;
    await expire();
    await maintenanceDelete(identity.playerId);
    const deleted = await state();
    release.resolve();
    expect(await staleOutcome).toBeInstanceOf(LeaseLost);
    expect(await state()).toEqual(deleted);
    expect(await row()).toBeUndefined();
    expect(deleted.headers).toEqual(otherBefore);
    expect(deleted.participations).toHaveLength(1);
    expect(deleted.matches).toHaveLength(1);
    for (const r of [deleted.progress.latest, deleted.progress.previous]) {
      expect(r.playerId).toBeNull();
      expect(r.currentPlayerId).not.toBe(identity.playerId);
      expect(r.players.some((p: { playerId: string }) => p.playerId === identity.playerId)).toBe(
        false,
      );
    }
    expect(
      deleted.progress.previous.players.find(
        (p: { playerId: string }) => p.playerId === other.playerId,
      ),
    ).toEqual(envelope.latest.players.find((p) => p.playerId === other.playerId));
    await expect(syncWrite(c, async () => undefined)).rejects.toBeInstanceOf(LeaseLost);
    await expire();
    await withSyncLease(async () => undefined, 230000, undefined, { action: "global" });
    expect(JSON.stringify((await state()).progress)).not.toContain(identity.playerId);
    expect(
      await observer`select u.id from achievement_evidence_units u left join achievement_evidence_headers h on h.id=u.header_id left join players p on p.id=u.player_id where h.id is null or p.id is null`,
    ).toHaveLength(0);
  });
  it("E: a capture received before DELETE cannot recreate personal evidence", async () => {
    const f = await captureFixture();
    await expire();
    await maintenanceDelete(identity.playerId);
    const before = await state();
    await expect(f.persist()).rejects.toBeInstanceOf(LeaseLost);
    expect(await state()).toEqual(before);
  });
  it("E: association waiting behind DELETE rolls back without resurrecting its owner", async () => {
    const ready = gate(),
      release = gate();
    const deletion = maintenanceDelete(identity.playerId, async () => {
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    const association = peer.transaction(async (tx) => {
      await insertMatchParticipation(tx, source(), participant());
      await flushSourceRevisions(tx);
    });
    const outcome = association.then(
      () => null,
      (e: unknown) => e,
    );
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await deletion;
    expect(await outcome).toBeInstanceOf(Error);
    expect(await row()).toBeUndefined();
    expect((await state()).matches).toBeNull();
  });
  it("E: shared remake capture racing DELETE preserves the other owner's complete fanout", async () => {
    await associate();
    await associate(other.playerId);
    const c = fakeClient({
      metadata: { matchId: "LA2_900" },
      info: {
        queueId: 420,
        mapId: 11,
        gameMode: "CLASSIC",
        gameStartTimestamp: source().timestamp.getTime(),
        gameDuration: 1800,
        participants: [
          {
            puuid: "synthetic",
            championName: "Synthetic",
            championId: 107,
            teamPosition: "JUNGLE",
            teamId: 100,
            kills: 1,
            deaths: 1,
            assists: 1,
            totalMinionsKilled: 1,
            neutralMinionsKilled: 0,
            totalDamageDealtToChampions: 1,
            win: true,
            gameEndedInEarlySurrender: true,
          },
        ],
      },
    });
    await binding(c);
    const observed = await c.observeRemakeDetail("LA2", "LA2_900");
    const ready = gate(),
      release = gate();
    const capture = syncWrite(c, async (tx) => {
      await captureRemakeInTx(tx, c, "LA2", "LA2_900", observed.capture);
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    selected = peer;
    const attempted = maintenanceDelete(identity.playerId);
    selected = database;
    const outcome = attempted.then(
      () => null,
      (e: unknown) => e,
    );
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await capture;
    expect(await outcome).toBeInstanceOf(SyncBusy);
    const before = await state();
    await expire();
    await maintenanceDelete(identity.playerId);
    const after = await state();
    expect(after.headers).toEqual(
      before.headers.filter((h: { player_id: string }) => h.player_id === other.playerId),
    );
    expect(after.units).toEqual(
      before.units.filter((u: { player_id: string }) => u.player_id === other.playerId),
    );
    expect(after.headers).toHaveLength(2);
    expect(after.matches[0].is_remake).toBe(true);
    expect(await row(other.playerId)).toMatchObject({ source_revision: "2" });
  });
  it("F: deliberately inverted privileged lock order exposes 40P01 and rolls back one victim", async () => {
    const readyA = gate(),
      readyB = gate(),
      crossA = gate(),
      crossB = gate();
    const contender = (
      db: typeof database,
      first: string,
      second: string,
      ready: ReturnType<typeof gate>,
      cross: ReturnType<typeof gate>,
    ) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local deadlock_timeout='100ms'`);
        await updateSourcePlayer(tx, first, { scanOffset: 100 });
        ready.resolve();
        await cross.promise;
        await updateSourcePlayer(tx, second, { scanOffset: 100 });
        await flushSourceRevisions(tx);
      });
    const first = contender(database, identity.playerId, other.playerId, readyA, crossA),
      second = contender(peer, other.playerId, identity.playerId, readyB, crossB);
    const outcomes = Promise.allSettled([first, second]);
    await Promise.all([readyA.promise, readyB.promise]);
    crossA.resolve();
    try {
      await blocked(pids[0], pids[1]);
    } finally {
      crossB.resolve();
    }
    const result = await outcomes;
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = result.find((r) => r.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { cause: { code: "40P01" } } });
    expect(await row()).toMatchObject({ source_revision: "1", scan_offset: 100 });
    expect(await row(other.playerId)).toMatchObject({ source_revision: "1", scan_offset: 100 });
    console.log(
      "Controlled privileged inverse-lock deadlock: 40P01; exactly one victim rolled back",
    );
  });
  it("F: REPEATABLE READ stale updater exposes 40001 with complete rollback", async () => {
    await expect(
      database.transaction(
        async (tx) => {
          await tx.select().from(schema.players).where(eq(schema.players.id, identity.playerId));
          await peer.transaction(async (otherTx) => {
            await updateSourcePlayer(otherTx, identity.playerId, { scanOffset: 100 });
            await flushSourceRevisions(otherTx);
          });
          await updateSourcePlayer(tx, identity.playerId, { scanOffset: 200 });
          await flushSourceRevisions(tx);
        },
        { isolationLevel: "repeatable read" },
      ),
    ).rejects.toMatchObject({ cause: { code: "40001" } });
    expect(await row()).toMatchObject({ scan_offset: 100, source_revision: "1" });
  });
  it("F: the ordered multi-owner helper serializes opposite input orders", async () => {
    const ready = gate(),
      release = gate();
    const first = database.transaction(async (tx) => {
      await lockSourcePlayers(tx, [other.playerId, identity.playerId]);
      for (const id of [identity.playerId, other.playerId])
        await updateSourcePlayer(tx, id, { scanOffset: 100 });
      ready.resolve();
      await release.promise;
      await flushSourceRevisions(tx);
    });
    await ready.promise;
    const second = peer.transaction(async (tx) => {
      await lockSourcePlayers(tx, [identity.playerId, other.playerId]);
      for (const id of [identity.playerId, other.playerId])
        await updateSourcePlayer(tx, id, { backfillProcessed: 1 });
      await flushSourceRevisions(tx);
    });
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await Promise.all([first, second]);
    for (const id of [identity.playerId, other.playerId])
      expect(await row(id)).toMatchObject({
        scan_offset: 100,
        backfill_processed: 1,
        source_revision: "2",
      });
  });
  it("E: renewal within SW blocks a competing maintenance acquisition", async () => {
    const c = new RiotClient();
    await binding(c);
    const ready = gate(),
      release = gate();
    const renewed = syncWrite(c, async (tx) => {
      await tx
        .update(schema.syncLocks)
        .set({ expiresAt: sql`greatest(expires_at,clock_timestamp()+interval '20 minutes')` })
        .where(eq(schema.syncLocks.name, "riot"));
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    selected = peer;
    const deletion = maintenanceDelete(identity.playerId);
    selected = database;
    const outcome = deletion.then(
      () => null,
      (e: unknown) => e,
    );
    try {
      await blocked(pids[1], pids[0]);
    } finally {
      release.resolve();
    }
    await renewed;
    expect(await outcome).toBeInstanceOf(SyncBusy);
    expect(await row()).toBeDefined();
    expect(
      (
        await observer`select expires_at>clock_timestamp()+interval '19 minutes' renewed from sync_locks where name='riot'`
      )[0].renewed,
    ).toBe(true);
  });
  it("B: compound FK rejects an evidence reference across owners", async () => {
    const f = await sealFixture(repo);
    const personal = await peerRepo.insertHeader({ ...headerInput("other"), identity: other }, "0");
    const before = await state();
    await expect(
      peer.transaction(async (tx) => {
        const [unit] = await tx
          .select()
          .from(schema.achievementEvidenceUnits)
          .where(eq(schema.achievementEvidenceUnits.headerId, f.h.id));
        await tx.insert(schema.achievementEvidenceUnits).values({
          ...other,
          headerId: personal.id,
          kind: "reference",
          unitKey: "foreign-reference",
          ordinal: 0,
          referenceUnitId: unit.id,
          revision: 1n,
          fingerprint: "a".repeat(64),
          data: {},
        });
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await state()).toEqual(before);
  });
  it("G: privileged old SQL can omit R; structural reproduction still grants nothing", async () => {
    const f = await sealFixture(repo),
      sealed = await repo.seal(f.token, "seal:legacy");
    await b`update players set backfill_processed=999 where id=${identity.playerId}`;
    expect(await repo.revision(identity)).toBe("3");
    // R cannot detect writers outside the protocol. Structural status is expressly NOT certification.
    expect(await repo.sealState(identity, sealed.id)).toMatchObject({
      state: "local_revision_unchanged",
      certification: "not_established",
      grantAuthorized: false,
    });
    expect(await repo.reproduceSeal(identity, sealed.id)).toMatchObject({
      certification: "not_established",
      grantAuthorized: false,
      provenanceAuthentication: "not_performed",
    });
    expect(
      await observer`select tablename from pg_tables where schemaname='public' and tablename like '%grant%'`,
    ).toHaveLength(0);
  });
});
