import "server-only";
import { and, asc, eq, gte, lt, like } from "drizzle-orm";
import type { db } from "@/db";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { matches, playerMatches, players, rankedSnapshots } from "@/db/schema";
import { queueIds, rankedQueue } from "@/lib/queues";
import type { AchievementReader } from "./contracts";
import { InvalidAchievementRecordError } from "./errors";

function instant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new InvalidAchievementRecordError();
  return value.toISOString();
}

/** PostgreSQL MVCC snapshot, not a second lock or a change to global isolation. */
export function consistentAchievementReader(database: {
  select: ReturnType<typeof db>["select"];
  transaction<T>(
    read: (tx: Pick<ReturnType<typeof db>, "select">) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}): AchievementReader {
  return {
    ...achievementReader(database),
    snapshot: (read) =>
      database.transaction((tx) => read(achievementReader(tx)), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }),
  };
}

/** Dependency injection supports real SQL tests on ephemeral PostgreSQL (PGlite). */
export function achievementReader(
  database: Pick<ReturnType<typeof db>, "select">,
): AchievementReader {
  return {
    async player(id) {
      const [player] = await database
        .select({
          id: players.id,
          platform: players.platform,
          enabled: players.enabled,
          backfillSeason: players.backfillSeason,
          backfillStatus: players.backfillStatus,
          backfillProcessed: players.backfillProcessed,
          backfillDiscovered: players.backfillDiscovered,
          backfillUnavailable: players.backfillUnavailable,
          lastSyncedAt: players.lastSyncedAt,
          rankCheckedAt: players.rankCheckedAt,
        })
        .from(players)
        .where(eq(players.id, id));
      return player;
    },
    async records(player, scope) {
      const start = new Date(scope.season.startAt);
      const end = new Date(
        Math.min(
          Date.parse(scope.asOf),
          scope.season.endAt === null ? Infinity : Date.parse(scope.season.endAt),
        ),
      );
      const [rankRows, matchRows] = await Promise.all([
        database
          .select({
            id: rankedSnapshots.id,
            queue: rankedSnapshots.queue,
            timestamp: rankedSnapshots.timestamp,
            tier: rankedSnapshots.tier,
            division: rankedSnapshots.division,
            leaguePoints: rankedSnapshots.leaguePoints,
            wins: rankedSnapshots.wins,
            losses: rankedSnapshots.losses,
          })
          .from(rankedSnapshots)
          .where(
            and(
              eq(rankedSnapshots.playerId, player.id),
              eq(rankedSnapshots.queue, rankedQueue(scope.view)!),
              gte(rankedSnapshots.timestamp, start),
              lt(rankedSnapshots.timestamp, end),
            ),
          )
          .orderBy(asc(rankedSnapshots.timestamp), asc(rankedSnapshots.id)),
        database
          .select({
            matchId: matches.id,
            queueId: matches.queueId,
            timestamp: matches.timestamp,
            win: playerMatches.win,
            championId: playerMatches.championId,
            isRemake: matches.isRemake,
          })
          .from(playerMatches)
          .innerJoin(matches, eq(matches.id, playerMatches.matchId))
          .where(
            and(
              eq(playerMatches.playerId, player.id),
              eq(matches.queueId, queueIds(scope.view)[0]),
              gte(matches.timestamp, start),
              lt(matches.timestamp, end),
              // Riot MATCH-V5 IDs carry their platform. Exclude incompatible legacy associations.
              like(matches.id, `${player.platform}\\_%`),
            ),
          )
          .orderBy(asc(matches.timestamp), asc(matches.id)),
      ]);
      return {
        snapshots: rankRows.map((row) => ({ ...row, timestamp: instant(row.timestamp) })),
        matches: matchRows.map((row) => ({ ...row, timestamp: instant(row.timestamp) })),
      };
    },
  };
}
