import "server-only";
import { cache } from "react";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots } from "@/db/schema";
import { rankedQueue, type View } from "@/lib/queues";
import { selectNearestRival, type NearestRival, type RivalIdentity } from "@/lib/nearest-rival";
import { selectRivalries } from "@/lib/rivalries";
import { rivalryKey } from "@/lib/weekly-rivalry";
import { demoPlayers } from "./demo";
import { isDemo } from "./env";
import { seasonFilter } from "./season-filter";
import type { Platform } from "@/lib/routing";
export const PROFILE_RIVAL_LIMIT = 512;
export type ProfileRivalResult =
  | { status: "ready"; selection: NearestRival; visibleOnLadder: boolean }
  | { status: "none" | "incomplete" | "changed" };
/** One bounded rank-only SQL statement, cached per queue/platform/reference.
 * No match statistics, community profiles or historic LP arrays are loaded.
 */
export const getProfileRivalPool = cache(
  async (view: View, platform: Platform, asOf: string): Promise<RivalIdentity[] | null> => {
    const queue = rankedQueue(view);
    if (!queue) return [];
    if (!Number.isFinite(Date.parse(asOf))) return null;
    if (isDemo()) return demoPlayers(view).filter((p) => p.platform === platform);
    const database = db();
    const latest = database
      .select({
        playerId: rankedSnapshots.playerId,
        tier: rankedSnapshots.tier,
        division: rankedSnapshots.division,
        leaguePoints: rankedSnapshots.leaguePoints,
        wins: rankedSnapshots.wins,
        losses: rankedSnapshots.losses,
        position:
          sql<number>`row_number() over (partition by ${rankedSnapshots.playerId} order by ${rankedSnapshots.timestamp} desc, ${rankedSnapshots.id} desc)`.as(
            "rival_position",
          ),
      })
      .from(rankedSnapshots)
      .innerJoin(players, eq(players.id, rankedSnapshots.playerId))
      .where(
        and(
          eq(players.enabled, true),
          eq(players.platform, platform),
          eq(rankedSnapshots.queue, queue),
          lte(rankedSnapshots.timestamp, new Date(asOf)),
          seasonFilter(rankedSnapshots.timestamp, players.platform),
        ),
      )
      .as("profile_rival_latest");
    const rows = await database
      .select({
        id: players.id,
        gameName: players.gameName,
        tagLine: players.tagLine,
        platform: players.platform,
        profileIconId: players.profileIconId,
        tier: latest.tier,
        division: latest.division,
        leaguePoints: latest.leaguePoints,
        wins: latest.wins,
        losses: latest.losses,
      })
      .from(players)
      .innerJoin(latest, eq(latest.playerId, players.id))
      .where(and(eq(players.enabled, true), eq(players.platform, platform), eq(latest.position, 1)))
      .limit(PROFILE_RIVAL_LIMIT + 1);
    if (rows.length > PROFILE_RIVAL_LIMIT) return null;
    return rows.map((p) => ({
      id: p.id,
      gameName: p.gameName,
      tagLine: p.tagLine,
      platform: p.platform,
      profileIconId: p.profileIconId,
      observedAt: asOf,
      rank: {
        tier: p.tier,
        division: p.division,
        leaguePoints: p.leaguePoints,
        wins: p.wins,
        losses: p.losses,
      },
    }));
  },
);
export async function getProfileRival(
  player: RivalIdentity,
  view: View,
): Promise<ProfileRivalResult> {
  if (!rankedQueue(view) || !player.rank) return { status: "none" };
  const pool = await getProfileRivalPool(view, player.platform, player.observedAt);
  if (!pool) return { status: "incomplete" };
  const current = pool.find((p) => p.id === player.id);
  if (!current?.rank) return { status: "none" };
  if (
    ["tier", "division", "leaguePoints", "wins", "losses"].some(
      (key) =>
        current.rank![key as keyof typeof current.rank] !==
        player.rank![key as keyof typeof player.rank],
    )
  )
    return { status: "changed" };
  const selection = selectNearestRival(pool, player.id, view);
  if (!selection) return { status: "none" };
  const key = rivalryKey(selection.pair);
  return {
    status: "ready",
    selection,
    visibleOnLadder: selectRivalries(pool, view).some((r) => rivalryKey(r) === key),
  };
}
