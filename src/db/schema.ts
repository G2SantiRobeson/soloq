import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  real,
  primaryKey,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import type { Platform } from "../lib/routing";
import type { RankedQueue } from "../lib/queues";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const players = pgTable("players", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  puuid: text("puuid").notNull().unique(),
  platform: text("platform").$type<Platform>().notNull(),
  profileIconId: integer("profile_icon_id"),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
  updatedAt: time("updated_at").defaultNow().notNull(),
  lastSyncedAt: time("last_synced_at"),
  lastAttemptAt: time("last_attempt_at"),
  syncError: text("sync_error"),
  scanStart: time("scan_start").notNull(),
  scanEnd: time("scan_end"),
  scanOffset: integer("scan_offset").default(0).notNull(),
  scanPending: jsonb("scan_pending").$type<string[]>().default([]).notNull(),
  scanExhausted: boolean("scan_exhausted").default(false).notNull(),
  backfillSeason: text("backfill_season"),
  backfillStatus: text("backfill_status").$type<"not_started" | "running" | "completed" | "failed">().default("not_started").notNull(),
  backfillStartedAt: time("backfill_started_at"),
  backfillUpdatedAt: time("backfill_updated_at"),
  lastBackfillAt: time("last_backfill_at"),
  backfillDiscovered: integer("backfill_discovered").default(0).notNull(),
  backfillProcessed: integer("backfill_processed").default(0).notNull(),
  backfillUnavailable: integer("backfill_unavailable").default(0).notNull(),
}).enableRLS();
export const rankedSnapshots = pgTable(
  "ranked_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    queue: text("queue").$type<RankedQueue>().notNull(),
    tier: text("tier").notNull(),
    division: text("division").notNull(),
    leaguePoints: integer("league_points").notNull(),
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    timestamp: time("timestamp").defaultNow().notNull(),
  },
  (t) => [index("snapshot_player_queue_time_idx").on(t.playerId, t.queue, t.timestamp)],
).enableRLS();
export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  queueId: integer("queue_id").notNull(),
  mapId: integer("map_id").notNull(),
  timestamp: time("timestamp").notNull(),
  duration: integer("duration").notNull(),
  // Null marks legacy rows awaiting a Riot-backed classification.
  isRemake: boolean("is_remake"),
}, (t) => [index("match_queue_time_idx").on(t.queueId, t.timestamp)]).enableRLS();
export const playerMatches = pgTable(
  "player_matches",
  {
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    champion: text("champion").notNull(),
    championId: integer("champion_id").notNull(),
    position: text("position").notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    cs: integer("cs").notNull(),
    damage: integer("damage").notNull(),
    win: boolean("win").notNull(),
    killParticipation: real("kill_participation"),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.matchId] }),
    index("player_match_match_idx").on(t.matchId),
  ],
).enableRLS();
export const adminSessions = pgTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: time("expires_at").notNull(),
}).enableRLS();
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetsAt: time("resets_at").notNull(),
}).enableRLS();
export const syncLocks = pgTable("sync_locks", {
  name: text("name").primaryKey(),
  owner: uuid("owner").notNull(),
  expiresAt: time("expires_at").notNull(),
}).enableRLS();
