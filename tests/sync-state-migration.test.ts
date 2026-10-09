import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// In-memory PostgreSQL only: seed the old schema before applying the additive SQL.
const pg = new PGlite();
const migration = "0005_player_sync_states.sql";
const id = "00000000-0000-4000-8000-000000000001";
const newColumns = [
  "rank_checked_at",
  "rank_error",
  "recent_error",
  "backfill_error",
  "last_sync_attempt",
];
let originalPlayers: Record<string, unknown>[];
let originalSnapshots: Record<string, unknown>[];
let originalMatches: Record<string, unknown>[];
let originalParticipants: Record<string, unknown>[];

beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql") && f < migration)
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  await pg.exec(`
    insert into players (id, game_name, tag_line, puuid, platform, scan_start,
      last_synced_at, last_attempt_at, sync_error, backfill_season, backfill_status,
      scan_end, scan_offset, scan_pending, scan_exhausted, backfill_processed,
      backfill_discovered, backfill_unavailable, backfill_updated_at)
    values ('${id}', 'Legacy', 'TEST', 'migration-fixture', 'LA2', '2026-01-08T15:00:00Z',
      '2026-10-08T12:00:00Z', '2026-10-08T12:01:00Z', 'Old unclassified error',
      '2026', 'failed', '2026-10-01T12:00:00Z', 100, '["pending"]', false,
      25, 100, 2, '2026-10-08T12:02:00Z');
    insert into ranked_snapshots (player_id, queue, tier, division, league_points, wins, losses)
    values ('${id}', 'RANKED_SOLO_5x5', 'DIAMOND', 'I', 49, 10, 5);
    insert into matches (id, queue_id, map_id, timestamp, duration, is_remake)
    values ('migration-match', 420, 11, '2026-10-01T00:00:00Z', 1800, false);
    insert into player_matches (player_id, match_id, champion, champion_id, position,
      kills, deaths, assists, cs, damage, win)
    values ('${id}', 'migration-match', 'Ahri', 103, 'MIDDLE', 5, 2, 8, 190, 25000, true);
  `);
  originalPlayers = (await pg.query<Record<string, unknown>>("select * from players")).rows;
  originalSnapshots = (await pg.query<Record<string, unknown>>("select * from ranked_snapshots"))
    .rows;
  originalMatches = (await pg.query<Record<string, unknown>>("select * from matches")).rows;
  originalParticipants = (await pg.query<Record<string, unknown>>("select * from player_matches"))
    .rows;
  await pg.exec(readFileSync(`drizzle/${migration}`, "utf8"));
});
afterAll(() => pg.close());

describe("additive synchronization-state migration", () => {
  it("leaves all new fields nullable and unknown on existing rows", async () => {
    const [row] = (await pg.query<Record<string, unknown>>("select * from players")).rows;
    for (const column of newColumns) expect(row[column]).toBeNull();
    const definitions = await pg.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'players'",
    );
    for (const column of newColumns)
      expect(definitions.rows.find((entry) => entry.column_name === column)).toMatchObject({
        is_nullable: "YES",
        column_default: null,
      });
  });

  it("preserves every old player value, cursor and historical record", async () => {
    const migrated = (await pg.query<Record<string, unknown>>("select * from players")).rows.map(
      (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !newColumns.includes(key))),
    );
    expect(migrated).toEqual(originalPlayers);
    expect((await pg.query("select * from ranked_snapshots")).rows).toEqual(originalSnapshots);
    expect((await pg.query("select * from matches")).rows).toEqual(originalMatches);
    expect((await pg.query("select * from player_matches")).rows).toEqual(originalParticipants);
  });

  it("allows the old writer and deduplication constraints to keep working", async () => {
    await pg.query(
      "insert into players (game_name, tag_line, puuid, platform, scan_start) values ($1,$2,$3,$4,$5)",
      ["Old writer", "TEST", "old-writer-fixture", "LA2", "2026-01-08T15:00:00Z"],
    );
    const [row] = (
      await pg.query<Record<string, unknown>>(
        "select * from players where puuid = 'old-writer-fixture'",
      )
    ).rows;
    for (const column of newColumns) expect(row[column]).toBeNull();
    await expect(
      pg.query("insert into player_matches select * from player_matches where player_id = $1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    expect((await pg.query("select * from player_matches")).rows).toEqual(originalParticipants);
  });
});
