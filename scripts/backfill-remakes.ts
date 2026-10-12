import { config } from "dotenv";
import { asc, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { matches } from "../src/db/schema";
import { PLATFORMS, type Platform } from "../src/lib/routing";
import { withSyncLease } from "../src/server/sync/lease";
import { syncWrite } from "../src/server/sync/progress";
import { captureRemakeInTx } from "../src/server/sync/ranked-evidence";
import { MatchCaptureError } from "../src/server/riot/match-capture";
import { playerSyncError } from "../src/server/sync/player-state";

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
      const observed = await client.observeRemakeDetail(platform, id);
      const result = await syncWrite(client, (tx) =>
        captureRemakeInTx(tx, client, platform, id, observed.capture),
      );
      if (observed.error) throw observed.error;
      if (!result.matching || result.classification === null) throw new MatchCaptureError("scope");
      remakes += Number(result.classification);
    }
    console.log(`Classified ${pending.length} stored matches; ${remakes} remakes.`);
  });
  process.exitCode = 0;
} catch (error) {
  console.error(playerSyncError(error, "recent").message);
  process.exitCode = 1;
}
// postgres keeps idle sockets; the batch is persisted before exiting.
process.exit(process.exitCode);
