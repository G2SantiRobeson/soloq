/** Optional synthetic benchmark. No PostgreSQL, Riot, environment file or public routes. */
import { performance } from "node:perf_hooks";
import { evaluateStoredAchievements } from "../src/server/achievements/evaluate";
import { achievementPresentation } from "../src/server/achievements/presentation";
import type { AchievementReader } from "../src/server/achievements/contracts";
import { fixedScope, match, snapshot } from "./achievements-fixtures";

const playerId = "11111111-1111-4111-8111-111111111111";
for (const n of [50, 500, 5000, 50000]) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const stored = Array.from({ length: n }, (_, i) => ({
    ...match(i, { win: i % 9 !== 8, championId: i < n * 0.7 ? 157 : 99 }),
    timestamp: new Date(match(i).timestamp),
  }));
  // Ten percent identical duplicates and reverse ordering exercise validation/dedup/sorting.
  stored.push(...stored.slice(0, Math.floor(n / 10)));
  stored.reverse();
  const normalizeStart = performance.now();
  const normalized = stored.map((row) => ({ ...row, timestamp: row.timestamp.toISOString() }));
  const normalizationMs = performance.now() - normalizeStart;
  const snapshots = Array.from({ length: n <= 500 ? 30 : n <= 5000 ? 300 : 3000 }, (_, i) =>
    snapshot(80, (i / (n <= 500 ? 30 : n <= 5000 ? 300 : 3000)) * 28),
  );
  const reader: AchievementReader = {
    async player() {
      return {
        id: playerId,
        platform: "LA2",
        enabled: true,
        backfillSeason: "2026",
        backfillStatus: "running",
        backfillProcessed: n,
        backfillDiscovered: n,
        backfillUnavailable: 0,
        lastSyncedAt: null,
        rankCheckedAt: null,
      };
    },
    async records() {
      return { matches: normalized, snapshots };
    },
  };
  const start = performance.now();
  const result = await evaluateStoredAchievements(reader, {
    playerId,
    view: "soloq",
    season: "2026",
    asOf: "2026-12-31T23:59:59Z",
  });
  const evaluationMs = performance.now() - start;
  const displayStart = performance.now();
  const dto = achievementPresentation(result);
  const presentationMs = performance.now() - displayStart;
  const serializationStart = performance.now();
  const json = JSON.stringify(dto);
  const serializationMs = performance.now() - serializationStart;
  console.log(
    JSON.stringify({
      n,
      inputRows: stored.length,
      snapshots: snapshots.length,
      normalizationMs: +normalizationMs.toFixed(2),
      evaluationMs: +evaluationMs.toFixed(2),
      presentationMs: +presentationMs.toFixed(2),
      serializationMs: +serializationMs.toFixed(2),
      totalMs: +(normalizationMs + evaluationMs + presentationMs + serializationMs).toFixed(2),
      dtoBytes: Buffer.byteLength(json),
      heapDeltaMiB: +((process.memoryUsage().heapUsed - beforeHeap) / 1048576).toFixed(2),
      status: result.status,
      scope: fixedScope.season.id,
    }),
  );
}
