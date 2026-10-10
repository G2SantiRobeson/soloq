import "server-only";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots as snapshots } from "@/db/schema";
import { rankedQueue, type View } from "@/lib/queues";
import { weekStart } from "@/lib/time";
import { weeklyRankSummary, type WeeklyLp } from "@/lib/weekly-lp";
import { seasonFilter } from "./season-filter";

export async function getWeeklyLpSummary(
  ids: string[],
  view: View,
  now = new Date(),
): Promise<Map<string, WeeklyLp | null>> {
  const queue = rankedQueue(view);
  if (!queue || !ids.length) return new Map();
  const monday = weekStart(now);
  // Nearest pre-Monday observation plus the week, including invalid ranks: do not bridge resets.
  const candidates = db()
    .select({
      ...getTableColumns(snapshots),
      platform: players.platform,
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
      ),
    )
    .as("weekly_candidates");
  const rows = await db()
    .select()
    .from(candidates)
    .where(sql`not ${candidates.baseline} or ${candidates.n} = 1`);
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.playerId, [...(grouped.get(row.playerId) ?? []), row]);
  return new Map(
    ids.map((id) => {
      const history = grouped.get(id) ?? [];
      return [
        id,
        weeklyRankSummary(
          history.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
          now,
          history[0]?.platform,
          queue,
        ),
      ];
    }),
  );
}
// Preserve the numeric contract for existing consumers.
export async function getWeeklyLp(
  ids: string[],
  view: View,
  now = new Date(),
): Promise<Map<string, number | null>> {
  const summaries = await getWeeklyLpSummary(ids, view, now);
  return new Map([...summaries].map(([id, summary]) => [id, summary?.net ?? null]));
}
