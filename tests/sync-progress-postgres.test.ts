import { existsSync, readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { withSyncLease, SyncBusy, runIdentity } from "@/server/sync/lease";
import { LeaseLost, readSyncProgress, syncWrite } from "@/server/sync/progress";

// Run via scripts/validate-sync-progress-postgres.mjs. Never reads DATABASE_URL.
const config = "artifacts/local-progress-postgres.json";
const enabled = existsSync(config);
const port: unknown = enabled ? JSON.parse(readFileSync(config, "utf8")).port : 0;
if (enabled && (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535))
  throw new Error("Invalid local QA port");
const options = {
  host: "127.0.0.1",
  port: Number(port),
  database: "soloq_progress_test",
  username: "postgres",
  ssl: false as const,
  max: 2,
};
const pool = postgres(options);
const peer = postgres(options); // Independent connections, actual PostgreSQL row locks.
const database = drizzle(pool, { schema });
vi.mock("@/db", () => ({ db: () => database }));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe.skipIf(!enabled)("real PostgreSQL concurrent lease fencing (loopback only)", () => {
  beforeAll(async () => {
    vi.stubEnv("DEMO_MODE", "false");
    for (const f of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.unsafe(readFileSync(`drizzle/${f}`, "utf8")).simple();
  });
  beforeEach(async () => {
    await pool`TRUNCATE players, sync_locks CASCADE`;
  });
  afterAll(async () => {
    await Promise.all([pool.end(), peer.end()]);
    vi.unstubAllEnvs();
  });
  it("allows one simultaneous acquisition and rejects the other contenders", async () => {
    const work = vi.fn(async () => {
      await pause(100);
    });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => withSyncLease(work, 230000, undefined, { action: "global" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .every((r) => r.status === "rejected" && r.reason instanceof SyncBusy),
    ).toBe(true);
    expect(work).toHaveBeenCalledOnce();
    expect((await readSyncProgress()).run?.state).toBe("completed");
  });
  it("holds the existing lease row through the business transaction and blocks a second connection", async () => {
    const [p] = await database
      .insert(schema.players)
      .values({
        gameName: "Local",
        tagLine: "TEST",
        puuid: "local-only",
        platform: "LA2",
        scanStart: new Date(0),
      })
      .returning();
    await withSyncLease(
      async (client) => {
        let release!: () => void;
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const write = syncWrite(client, async (tx) => {
          await tx
            .update(schema.players)
            .set({ rankCheckedAt: new Date() })
            .where(eq(schema.players.id, p.id));
          started();
          await gate;
        });
        await ready;
        let locked = false;
        const competing = peer.begin(async (sql) => {
          await sql`SELECT name FROM sync_locks WHERE name='riot' FOR UPDATE`;
          locked = true;
        });
        try {
          let blocked = false;
          for (let i = 0; i < 20; i++) {
            const rows =
              await peer`SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE datname='soloq_progress_test' AND wait_event_type='Lock'`;
            if (rows[0].blocked > 0) {
              blocked = true;
              break;
            }
            await pause(10);
          }
          expect(blocked).toBe(true);
          expect(locked).toBe(false);
        } finally {
          release();
          await write;
          await competing;
        }
        expect(locked).toBe(true);
      },
      230000,
      undefined,
      { action: "player_recent", playerId: p.id },
    );
  });
  it("rejects an expired write and rolls back its player data", async () => {
    const [p] = await database
      .insert(schema.players)
      .values({
        gameName: "Local",
        tagLine: "TEST",
        puuid: "local-only",
        platform: "LA2",
        scanStart: new Date(0),
      })
      .returning();
    await expect(
      withSyncLease(
        async (client) => {
          await peer`UPDATE sync_locks SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE name='riot'`;
          await syncWrite(
            client,
            async (tx) => {
              await tx
                .update(schema.players)
                .set({ scanPending: ["must-rollback"] })
                .where(eq(schema.players.id, p.id));
              await pause(150);
            },
            { type: "import", pass: "history", playerId: p.id, imported: 1 },
          );
        },
        230000,
        undefined,
        { action: "player_history", playerId: p.id },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await database.select().from(schema.players))[0].scanPending).toEqual([]);
    expect((await readSyncProgress()).run).toMatchObject({
      state: "possibly_interrupted",
      finishedAt: null,
      players: [],
    });
  });
  it("protects a new owner against a stale worker on another connection", async () => {
    let current: string | undefined;
    let old: string | undefined;
    await expect(
      withSyncLease(
        async (client) => {
          old = runIdentity(client).runId;
          await peer`UPDATE sync_locks SET expires_at=clock_timestamp()-interval '1 second' WHERE name='riot'`;
          await withSyncLease(
            async (next) => {
              current = runIdentity(next).runId;
            },
            230000,
            undefined,
            { action: "global" },
          );
          await syncWrite(client, async () => undefined);
        },
        230000,
        undefined,
        { action: "global" },
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect((await readSyncProgress()).run?.runId).toBe(current);
    expect((await readSyncProgress({ runId: old })).run).toMatchObject({
      state: "interrupted",
      finishedAt: null,
    });
  });
});
