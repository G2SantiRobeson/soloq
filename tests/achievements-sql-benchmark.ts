/** Optional PGlite SQL/materialization benchmark, not Neon latency or CI thresholds.
 * node --conditions=react-server --import tsx tests/achievements-sql-benchmark.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { consistentAchievementReader } from "../src/server/achievements/queries";
import { evaluateStoredAchievements } from "../src/server/achievements/evaluate";
import { achievementPresentation } from "../src/server/achievements/presentation";
import { currentAchievementScope } from "../src/lib/achievements";
import { recoveryDataset } from "./achievements-resurrection-datasets";

const pg = new PGlite();
const statements: { query: string; params: unknown[] }[] = [];
const database = drizzle(pg, {
  schema,
  logger: { logQuery: (query, params) => statements.push({ query, params }) },
});
const playerId = "11111111-1111-4111-8111-111111111111";
const request = { playerId, view: "soloq", season: "2026", asOf: "2026-11-01T00:00:00Z" };
const scope = currentAchievementScope("soloq", "LA2", request.asOf);
const reader = consistentAchievementReader(database);
const median = (values: number[]) => values.toSorted((a, b) => a - b)[1];
type Sample = {
  materializationMs: number;
  evaluationMs: number;
  presentationMs: number;
  serializationMs: number;
  normalizationMs: number;
  totalMs: number;
  heapDeltaMiB: number;
  dtoBytes: number;
};
try {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  for (const n of [50, 500, 5000, 50000]) {
    await database.delete(schema.players);
    await database.delete(schema.matches);
    await database
      .insert(schema.players)
      .values({
        id: playerId,
        gameName: "Synthetic",
        tagLine: "QA",
        puuid: "synthetic-not-a-real-identity",
        platform: "LA2",
        scanStart: new Date(scope.season.startAt),
        backfillSeason: "2026",
        backfillStatus: "running",
        backfillProcessed: n,
        backfillDiscovered: n,
      });
    for (let start = 0; start < n; start += 1000) {
      const rows = Array.from({ length: Math.min(1000, n - start) }, (_, offset) => {
        const i = start + offset;
        return {
          id: `LA2_${String(i).padStart(6, "0")}`,
          queueId: 420,
          mapId: 11,
          timestamp: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 60000),
          duration: 1800,
          isRemake: false,
        };
      });
      await database.insert(schema.matches).values(rows);
      await database.insert(schema.playerMatches).values(
        rows.map((m, i) => ({
          playerId,
          matchId: m.id,
          champion: "Synthetic",
          championId: start + i < n * 0.7 ? 157 : 99,
          position: "MIDDLE",
          kills: 1,
          deaths: 1,
          assists: 1,
          cs: 1,
          damage: 1,
          win: i % 9 !== 8,
        })),
      );
    }
    const snapshotCount = n <= 50 ? 30 : n <= 500 ? 300 : 3000;
    const snapshots = recoveryDataset(snapshotCount, "constant");
    for (let start = 0; start < snapshots.length; start += 1000)
      await database
        .insert(schema.rankedSnapshots)
        .values(
          snapshots
            .slice(start, start + 1000)
            .map((s) => ({
              playerId,
              queue: s.queue,
              tier: s.tier,
              division: s.division,
              leaguePoints: s.leaguePoints,
              wins: s.wins,
              losses: s.losses,
              timestamp: new Date(s.timestamp),
            })),
        );
    // Statistics are local to the disposable database; no change to deployed schema/indexes.
    await pg.exec("analyze");
    const samples: Sample[] = [];
    for (let trial = 0; trial < 3; trial++) {
      statements.length = 0;
      const heap = process.memoryUsage().heapUsed,
        start = performance.now();
      const captured = await reader.snapshot!(async (r) => {
        const player = (await r.player(playerId))!;
        return { player, records: await r.records(player, scope) };
      });
      const materializationMs = performance.now() - start;
      const evaluate = performance.now();
      const result = await evaluateStoredAchievements(
        { player: async () => captured.player, records: async () => captured.records },
        request,
      );
      const evaluationMs = performance.now() - evaluate;
      const project = performance.now(),
        dto = achievementPresentation(result);
      const presentationMs = performance.now() - project;
      const serialize = performance.now(),
        json = JSON.stringify(dto);
      const serializationMs = performance.now() - serialize;
      // A separate controlled projection isolates Date -> ISO cost, not an extra production read.
      const dates = captured.records.matches.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
      const normalize = performance.now();
      dates.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
      const normalizationMs = performance.now() - normalize;
      samples.push({
        materializationMs,
        evaluationMs,
        presentationMs,
        serializationMs,
        normalizationMs,
        totalMs: materializationMs + evaluationMs + presentationMs + serializationMs,
        heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1048576,
        dtoBytes: Buffer.byteLength(json),
      });
    }
    const summary = Object.fromEntries(
      Object.keys(samples[0]).map((key) => [
        key,
        +median(samples.map((sample) => sample[key as keyof typeof sample])).toFixed(2),
      ]),
    );
    const plans = [];
    for (const { query, params } of statements.filter((s) => /^select/i.test(s.query)))
      plans.push((await pg.query(`explain (format json) ${query}`, params)).rows);
    console.log(
      JSON.stringify({ matches: n, snapshots: snapshotCount, medianOf: 3, ...summary, plans }),
    );
  }
} finally {
  await pg.close();
}
