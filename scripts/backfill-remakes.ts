import { config } from "dotenv";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { matches } from "../src/db/schema";
import { isRemake } from "../src/lib/match-outcome";
import { PLATFORMS, type Platform } from "../src/lib/routing";
import { withSyncLease } from "../src/server/sync/lease";

config({ path: ".env.local", quiet: true });
// Existing rows have null classification. Fetch explicit Riot markers, not a duration guess.
// A bounded batch shares the same lease, pacing and retry budget as normal synchronization.
try {
  await withSyncLease(async (client) => {
    const pending = await db()
      .select({ id: matches.id })
      .from(matches)
      .where(isNull(matches.isRemake))
      .orderBy(asc(matches.timestamp))
      .limit(100);
    let remakes = 0;
    for (const { id } of pending) {
      const platform = id.split("_")[0] as Platform;
      if (!PLATFORMS.includes(platform)) throw new Error("Unknown match platform");
      const match = await client.match(platform, id);
      const remake = isRemake(match);
      await db().update(matches).set({ isRemake: remake }).where(eq(matches.id, id));
      remakes += Number(remake);
    }
    console.log(`Classified ${pending.length} stored matches; ${remakes} remakes.`);
  });
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backfill failed");
  process.exitCode = 1;
}
// postgres keeps idle sockets; the batch is persisted before exiting.
process.exit(process.exitCode);
