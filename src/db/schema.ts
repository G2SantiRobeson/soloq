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
  bigint,
  check,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Platform } from "../lib/routing";
import type { RankedQueue } from "../lib/queues";
import type { PlayerSyncAttempt, PlayerSyncError } from "../lib/player-sync-state";
import type { ProgressEnvelope } from "../lib/sync-progress";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const players = pgTable(
  "players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameName: text("game_name").notNull(),
    tagLine: text("tag_line").notNull(),
    puuid: text("puuid").notNull().unique(),
    platform: text("platform").$type<Platform>().notNull(),
    profileIconId: integer("profile_icon_id"),
    enabled: boolean("enabled").default(true).notNull(),
    // Local protocol only; zero does not authenticate legacy sources.
    sourceRevision: bigint("source_revision", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at").defaultNow().notNull(),
    lastSyncedAt: time("last_synced_at"),
    // Successful first recent-ID page; retain its scheduling semantics.
    lastAttemptAt: time("last_attempt_at"),
    // Deprecated compatibility summary; unclassified legacy messages remain here.
    syncError: text("sync_error"),
    // Validated LEAGUE-V4 observation, never inferred from updatedAt or matches.
    rankCheckedAt: time("rank_checked_at"),
    rankError: jsonb("rank_error").$type<PlayerSyncError>(),
    recentError: jsonb("recent_error").$type<PlayerSyncError>(),
    backfillError: jsonb("backfill_error").$type<PlayerSyncError>(),
    lastSyncAttempt: jsonb("last_sync_attempt").$type<PlayerSyncAttempt>(),
    scanStart: time("scan_start").notNull(),
    scanEnd: time("scan_end"),
    scanOffset: integer("scan_offset").default(0).notNull(),
    scanPending: jsonb("scan_pending").$type<string[]>().default([]).notNull(),
    scanExhausted: boolean("scan_exhausted").default(false).notNull(),
    backfillSeason: text("backfill_season"),
    backfillStatus: text("backfill_status")
      .$type<"not_started" | "running" | "completed" | "failed">()
      .default("not_started")
      .notNull(),
    backfillStartedAt: time("backfill_started_at"),
    backfillUpdatedAt: time("backfill_updated_at"),
    lastBackfillAt: time("last_backfill_at"),
    backfillDiscovered: integer("backfill_discovered").default(0).notNull(),
    backfillProcessed: integer("backfill_processed").default(0).notNull(),
    backfillUnavailable: integer("backfill_unavailable").default(0).notNull(),
  },
  (t) => [check("players_source_revision_nonnegative", sql`${t.sourceRevision} >= 0`)],
).enableRLS();
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
export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey(),
    queueId: integer("queue_id").notNull(),
    mapId: integer("map_id").notNull(),
    timestamp: time("timestamp").notNull(),
    duration: integer("duration").notNull(),
    // Null marks legacy rows awaiting a Riot-backed classification.
    isRemake: boolean("is_remake"),
  },
  (t) => [index("match_queue_time_idx").on(t.queueId, t.timestamp)],
).enableRLS();
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
  runProgress: jsonb("run_progress").$type<ProgressEnvelope>(),
  expiresAt: time("expires_at").notNull(),
  lastSuccessfulSyncAt: time("last_successful_sync_at"),
  lastStartedAt: time("last_started_at"),
  lastFinishedAt: time("last_finished_at"),
  lastOutcome: text("last_outcome").$type<"running" | "success" | "partial" | "failed">(),
}).enableRLS();

// B.2.D: additive, private, disconnected from operational writers and readers.
export const achievementEvidenceHeaders = pgTable(
  "achievement_evidence_headers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    queue: text("queue").$type<RankedQueue>().notNull(),
    season: text("season").notNull(),
    kind: text("kind")
      .$type<"rank_capture" | "match_scan" | "structural_receipt" | "identity_capture">()
      .notNull(),
    status: text("status").$type<"collecting" | "sealed">().notNull(),
    source: text("source").$type<"unknown" | "synthetic" | "server_riot_received">().notNull(),
    version: text("version").notNull(),
    operationKey: text("operation_key").notNull(),
    parentId: uuid("parent_id"),
    from: time("from_at"),
    to: time("to_at"),
    inputRevision: bigint("input_revision", { mode: "bigint" }),
    sealedAtRevision: bigint("sealed_at_revision", { mode: "bigint" }),
    fingerprint: text("fingerprint"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    // Storage time, not Riot reception or historical capture time.
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("evidence_header_operation_unique").on(t.playerId, t.operationKey),
    unique("evidence_header_owner_scope_unique").on(
      t.playerId,
      t.id,
      t.platform,
      t.queue,
      t.season,
    ),
    foreignKey({
      name: "evidence_header_parent_scope_fk",
      columns: [t.playerId, t.parentId, t.platform, t.queue, t.season],
      foreignColumns: [t.playerId, t.id, t.platform, t.queue, t.season],
    }).onDelete("cascade"),
    check(
      "evidence_header_kind",
      sql`${t.kind} IN ('rank_capture', 'match_scan', 'structural_receipt', 'identity_capture')`,
    ),
    check(
      "evidence_header_source",
      sql`${t.source} IN ('unknown', 'synthetic', 'server_riot_received')`,
    ),
    check("evidence_header_queue", sql`${t.queue} IN ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR')`),
    check(
      "evidence_header_keys",
      sql`length(${t.operationKey}) BETWEEN 1 AND 128 AND length(${t.season}) BETWEEN 1 AND 64 AND length(${t.version}) BETWEEN 1 AND 128`,
    ),
    check(
      "evidence_header_interval",
      sql`(${t.from} IS NULL AND ${t.to} IS NULL) OR (${t.from} IS NOT NULL AND ${t.to} IS NOT NULL AND ${t.from} < ${t.to})`,
    ),
    check(
      "evidence_header_seal",
      sql`(${t.status} = 'collecting' AND ${t.kind} <> 'structural_receipt' AND ${t.inputRevision} IS NULL AND ${t.sealedAtRevision} IS NULL AND ${t.fingerprint} IS NULL) OR (${t.status} = 'sealed' AND ${t.kind} = 'structural_receipt' AND ${t.parentId} IS NOT NULL AND ${t.inputRevision} IS NOT NULL AND ${t.sealedAtRevision} IS NOT NULL AND ${t.fingerprint} IS NOT NULL AND ${t.inputRevision} >= 0 AND ${t.sealedAtRevision} = ${t.inputRevision} + 1 AND ${t.fingerprint} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      "evidence_header_data_limit",
      sql`jsonb_typeof(${t.data}) = 'object' AND octet_length(${t.data}::text) <= 65536`,
    ),
    check("evidence_header_no_self_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
).enableRLS();

export const achievementEvidenceUnits = pgTable(
  "achievement_evidence_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    headerId: uuid("header_id").notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    queue: text("queue").$type<RankedQueue>().notNull(),
    season: text("season").notNull(),
    kind: text("kind").$type<"page" | "disposition" | "snapshot" | "reference">().notNull(),
    unitKey: text("unit_key").notNull(),
    ordinal: integer("ordinal").notNull(),
    offset: integer("offset"),
    attempt: integer("attempt"),
    entityKey: text("entity_key"),
    previousUnitId: uuid("previous_unit_id"),
    referenceUnitId: uuid("reference_unit_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    unique("evidence_unit_key_unique").on(t.headerId, t.unitKey),
    unique("evidence_unit_order_unique").on(t.headerId, t.ordinal),
    unique("evidence_unit_owner_scope_unique").on(t.playerId, t.id, t.platform, t.queue, t.season),
    foreignKey({
      name: "evidence_unit_header_scope_fk",
      columns: [t.playerId, t.headerId, t.platform, t.queue, t.season],
      foreignColumns: [
        achievementEvidenceHeaders.playerId,
        achievementEvidenceHeaders.id,
        achievementEvidenceHeaders.platform,
        achievementEvidenceHeaders.queue,
        achievementEvidenceHeaders.season,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "evidence_unit_previous_scope_fk",
      columns: [t.playerId, t.previousUnitId, t.platform, t.queue, t.season],
      foreignColumns: [t.playerId, t.id, t.platform, t.queue, t.season],
    }).onDelete("cascade"),
    foreignKey({
      name: "evidence_unit_reference_scope_fk",
      columns: [t.playerId, t.referenceUnitId, t.platform, t.queue, t.season],
      foreignColumns: [t.playerId, t.id, t.platform, t.queue, t.season],
    }).onDelete("cascade"),
    check("evidence_unit_kind", sql`${t.kind} IN ('page', 'disposition', 'snapshot', 'reference')`),
    check("evidence_unit_revision", sql`${t.revision} >= 0 AND ${t.ordinal} >= 0`),
    check(
      "evidence_unit_keys",
      sql`length(${t.unitKey}) BETWEEN 1 AND 128 AND (${t.entityKey} IS NULL OR length(${t.entityKey}) BETWEEN 1 AND 256)`,
    ),
    check("evidence_unit_fingerprint", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check(
      "evidence_unit_page",
      sql`(${t.kind} = 'page' AND ${t.offset} IS NOT NULL AND ${t.offset} >= 0 AND ${t.attempt} IS NOT NULL AND ${t.attempt} > 0) OR (${t.kind} <> 'page' AND ${t.offset} IS NULL AND ${t.attempt} IS NULL)`,
    ),
    check(
      "evidence_unit_reference",
      sql`(${t.kind} = 'reference' AND ${t.referenceUnitId} IS NOT NULL) OR (${t.kind} <> 'reference' AND ${t.referenceUnitId} IS NULL)`,
    ),
    check(
      "evidence_unit_transition",
      sql`(${t.kind} = 'disposition' AND ${t.entityKey} IS NOT NULL) OR (${t.kind} <> 'disposition' AND ${t.previousUnitId} IS NULL)`,
    ),
    check(
      "evidence_unit_no_self_reference",
      sql`(${t.previousUnitId} IS NULL OR ${t.previousUnitId} <> ${t.id}) AND (${t.referenceUnitId} IS NULL OR ${t.referenceUnitId} <> ${t.id})`,
    ),
    check(
      "evidence_unit_data_limit",
      sql`jsonb_typeof(${t.data}) = 'object' AND octet_length(${t.data}::text) <= 16384`,
    ),
  ],
).enableRLS();
