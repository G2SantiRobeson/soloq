import "server-only";
import { and, eq, getTableColumns, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots as snapshots } from "@/db/schema";
import { rankedQueue, type View } from "@/lib/queues";
import { TIERS } from "@/lib/ranking";
import { weekStart } from "@/lib/time";
import { weeklyRankDelta } from "@/lib/weekly-lp";
import { seasonFilter } from "./season-filter";

export async function getWeeklyLp(
  ids: string[],
  view: View,
  now = new Date(),
): Promise<Map<string, number | null>> {
  const queue = rankedQueue(view);
  if (!queue || !ids.length) return new Map();
  const monday = weekStart(now);
  // Each player contributes at most two rows, irrespective of total stored history.
  const candidates = db()
    .select({
      ...getTableColumns(snapshots),
      baseline: sql<boolean>`${snapshots.timestamp} <= ${monday.toISOString()}::timestamptz`.as(
        "baseline",
      ),
      n: sql<number>`row_number() over (partition by ${snapshots.playerId}, (${snapshots.timestamp} <= ${monday.toISOString()}::timestamptz) order by ${snapshots.timestamp} desc, ${snapshots.id} desc)`.as(
        "n",
      ),
    })
    .from(snapshots)
    .innerJoin(players, eq(players.id, snapshots.playerId))
    .where(
      and(
        inArray(snapshots.playerId, ids),
        eq(snapshots.queue, queue),
        seasonFilter(snapshots.timestamp, players.platform, "season", now.getTime() + 1),
        inArray(snapshots.tier, [...TIERS]),
        sql`(${snapshots.tier} in ('MASTER', 'GRANDMASTER', 'CHALLENGER') or ${snapshots.division} in ('I','II','III','IV'))`,
        sql`${snapshots.leaguePoints} >= 0 and ${snapshots.wins} >= 0 and ${snapshots.losses} >= 0`,
      ),
    )
    .as("weekly_candidates");
  const rows = await db().select().from(candidates).where(lte(candidates.n, 1));
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.playerId, [...(grouped.get(row.playerId) ?? []), row]);
  return new Map(
    ids.map((id) => {
      const pair = grouped.get(id) ?? [];
      const before = pair.find((r) => r.baseline);
      const after = pair.find((r) => !r.baseline) ?? before;
      const snapshot = (r: typeof before) =>
        r ? { ...r, timestamp: r.timestamp.toISOString() } : null;
      return [id, weeklyRankDelta(snapshot(before), snapshot(after), now)];
    }),
  );
}
