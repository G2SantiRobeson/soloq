import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const pg = new PGlite();
const migration = "0006_sync_run_progress.sql";
let before: Record<string, unknown>[];
beforeAll(async () => {
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql") && f < migration)
    .sort())
    await pg.exec(readFileSync(`drizzle/${f}`, "utf8"));
  await pg.exec(
    `INSERT INTO sync_locks(name, owner, expires_at, last_started_at, last_finished_at, last_successful_sync_at, last_outcome) VALUES ('riot','00000000-0000-4000-8000-000000000001','2026-10-09T13:00:00Z','2026-10-09T12:00:00Z','2026-10-09T12:01:00Z','2026-10-09T12:01:00Z','success')`,
  );
  before = (await pg.query<Record<string, unknown>>("SELECT * FROM sync_locks")).rows;
  await pg.exec(readFileSync(`drizzle/${migration}`, "utf8"));
});
afterAll(() => pg.close());
it("adds exactly one nullable JSONB without rewriting any old value", async () => {
  expect(readFileSync(`drizzle/${migration}`, "utf8").trim()).toBe(
    'ALTER TABLE "sync_locks" ADD COLUMN "run_progress" jsonb;',
  );
  const rows = (await pg.query<Record<string, unknown>>("SELECT * FROM sync_locks")).rows;
  expect(rows[0].run_progress).toBeNull();
  expect(
    rows.map(({ run_progress: ignored, ...old }) => {
      expect(ignored).toBeNull();
      return old;
    }),
  ).toEqual(before);
  expect(
    (
      await pg.query(
        "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='sync_locks' AND column_name='run_progress'",
      )
    ).rows,
  ).toEqual([{ data_type: "jsonb", is_nullable: "YES", column_default: null }]);
  // The old lease writer remains compatible, including an occupied lease.
  await pg.exec("UPDATE sync_locks SET expires_at='2026-10-09T14:00:00Z' WHERE name='riot'");
  expect((await pg.query("SELECT run_progress FROM sync_locks")).rows[0]).toEqual({
    run_progress: null,
  });
});
it("preserves all applied migration metadata and appends 0006", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const old = JSON.parse(
    execFileSync(
      "git",
      ["show", "f9c0fd0470dd7e6ed42ebb0c2b561e6627c834c0:drizzle/meta/_journal.json"],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(journal.entries.slice(0, 6)).toEqual(old.entries);
  expect(journal.entries).toHaveLength(7);
  expect(journal.entries[6]).toMatchObject({ idx: 6, tag: "0006_sync_run_progress" });
  const snapshot = JSON.parse(readFileSync("drizzle/meta/0006_snapshot.json", "utf8"));
  const previous = JSON.parse(readFileSync("drizzle/meta/0005_snapshot.json", "utf8"));
  expect(snapshot.prevId).toBe(previous.id);
  const added = snapshot.tables["public.sync_locks"].columns.run_progress;
  expect(added).toMatchObject({ type: "jsonb", notNull: false });
  delete snapshot.tables["public.sync_locks"].columns.run_progress;
  expect(snapshot.tables).toEqual(previous.tables);
});
