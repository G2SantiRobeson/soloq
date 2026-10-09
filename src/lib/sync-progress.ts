import { z } from "zod";
import { PENDING_LABELS, type SyncPlayerResult } from "./sync-scheduling";

const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const nullableTime = instant.nullable();
export const syncActionSchema = z.enum(["global", "player_recent", "player_history", "player_add"]);
const phaseSchema = z.enum(["planning", "identity", "rank", "recent", "history", "finalizing"]);
const reasonSchema = z.enum([
  ...(Object.keys(PENDING_LABELS) as [
    keyof typeof PENDING_LABELS,
    ...Array<keyof typeof PENDING_LABELS>,
  ]),
  "aborted",
]);
const errorSchema = z.object({
  code: z.union([
    z.number().int().min(400).max(599),
    z.enum(["internal", "deadline", "lease_lost"]),
  ]),
  step: z.enum(["identity", "summoner", "league", "snapshots", "recent", "history"]),
});
const historySchema = z.object({
  season: z.string().max(30),
  mode: z.enum(["season_backfill", "incremental_repair"]),
  discovered: count.nullable(),
  processed: count.nullable(),
  unavailable: count.nullable(),
  cursorPending: count,
  scanExhausted: z.boolean(),
  scanThrough: nullableTime,
});
const workSchema = z.object({
  status: z.enum(["queued", "running", "complete", "partial", "error", "skipped"]),
  attempted: z.boolean(),
  reason: reasonSchema.nullable(),
  error: errorSchema.nullable(),
  imported: count,
  coveredThrough: nullableTime,
  history: historySchema.nullable(),
});
const playerSchema = z.object({
  playerId: z.uuid(),
  rank: z.object({ checkedAt: instant, outcome: z.literal("verified") }).nullable(),
  recent: workSchema.nullable(),
  history: workSchema.nullable(),
});
const passSchema = z.object({
  eligible: count,
  visited: count,
  settled: count,
  complete: count,
  partial: count,
  errors: count,
  skipped: count,
  unvisited: count,
  imported: count,
});
export const persistedRunSchema = z.object({
  runId: z.uuid(),
  requestId: z.uuid().nullable(),
  leaseOwner: z.uuid(),
  source: z.enum(["admin", "cron"]),
  action: syncActionSchema,
  playerId: z.uuid().nullable(),
  season: z.string().max(30),
  status: z.enum(["running", "completed", "partial", "failed", "interrupted"]),
  phase: phaseSchema,
  currentPlayerId: z.uuid().nullable(),
  startedAt: instant,
  phaseStartedAt: instant,
  lastCheckpointAt: nullableTime,
  finishedAt: nullableTime,
  interruptionObservedAt: nullableTime,
  cooldownReason: z.enum(["pacing", "riot_retry_after"]).nullable(),
  revision: count,
  recentOutcome: z.enum(["success", "partial", "failed"]).nullable(),
  recent: passSchema.nullable(),
  history: passSchema.nullable(),
  players: z.array(playerSchema),
});
export const progressEnvelopeSchema = z.object({
  version: z.literal(1),
  latest: persistedRunSchema,
  previous: persistedRunSchema.nullable(),
});
const publicRunSchema = persistedRunSchema.omit({ leaseOwner: true, status: true }).extend({
  state: z.enum([
    "running",
    "completed",
    "partial",
    "failed",
    "interrupted",
    "possibly_interrupted",
  ]),
  activity: z.enum(["lease_valid", "lease_expired", "ownership_lost", "not_running"]),
});
export const progressDtoSchema = z.object({
  version: z.literal(1),
  serverNow: instant,
  selection: z.enum(["found", "not_found"]),
  control: z.object({
    state: z.enum(["available", "lease_held", "cooldown", "busy_unknown"]),
    until: nullableTime,
    reason: z.enum(["pacing", "riot_retry_after"]).nullable(),
  }),
  run: publicRunSchema.nullable(),
});
export type PersistedRun = z.infer<typeof persistedRunSchema>;
export type ProgressEnvelope = z.infer<typeof progressEnvelopeSchema>;
export type ProgressDto = z.infer<typeof progressDtoSchema>;
export type ProgressRun = z.infer<typeof publicRunSchema>;
export type SyncRunAction = z.infer<typeof syncActionSchema>;
export type RunMeta = {
  action: SyncRunAction;
  source?: "admin" | "cron";
  playerId?: string;
  requestId?: string | null;
};
export type ProgressSelector = { requestId?: string; runId?: string };
type Pass = "recent" | "history";
export type ProgressEvent =
  | { type: "select"; pass: Pass; ids: string[] }
  | { type: "phase"; phase: "identity" | "rank" | "recent" | "history"; playerId: string }
  | { type: "rank"; playerId: string; checkedAt: string }
  | {
      type: "import";
      pass: Pass;
      playerId: string;
      imported: number;
      history?: z.infer<typeof historySchema>;
    }
  | {
      type: "result";
      pass: Pass;
      result: SyncPlayerResult;
      error?: z.infer<typeof errorSchema>;
      coveredThrough?: string;
    }
  | { type: "history"; playerId: string; history: z.infer<typeof historySchema> };

export function newRun(
  meta: RunMeta,
  owner: string,
  runId: string,
  now: string,
  season: string,
): PersistedRun {
  return {
    runId,
    requestId: meta.requestId ?? null,
    leaseOwner: owner,
    source: meta.source ?? "admin",
    action: meta.action,
    playerId: meta.playerId ?? null,
    season,
    status: "running",
    phase: meta.action === "player_add" ? "identity" : "planning",
    currentPlayerId: null,
    startedAt: now,
    phaseStartedAt: now,
    lastCheckpointAt: null,
    finishedAt: null,
    interruptionObservedAt: null,
    cooldownReason: null,
    revision: 0,
    recentOutcome: null,
    recent: null,
    history: null,
    players: [],
  };
}
const emptyWork = (): z.infer<typeof workSchema> => ({
  status: "queued",
  attempted: false,
  reason: null,
  error: null,
  imported: 0,
  coveredThrough: null,
  history: null,
});
function player(run: PersistedRun, id: string) {
  let value = run.players.find((p) => p.playerId === id);
  if (!value) {
    value = { playerId: id, rank: null, recent: null, history: null };
    run.players.push(value);
  }
  return value;
}
export function summarizeRun(run: PersistedRun) {
  for (const pass of ["recent", "history"] as const) {
    const states = run.players.map((p) => p[pass]).filter((p) => p !== null);
    if (!states.length && run[pass] === null) continue;
    run[pass] = {
      eligible: states.length,
      visited: states.filter((p) => p.attempted).length,
      settled: states.filter((p) => p.status !== "queued" && p.status !== "running").length,
      complete: states.filter((p) => p.status === "complete").length,
      partial: states.filter((p) => p.status === "partial").length,
      errors: states.filter((p) => p.status === "error").length,
      skipped: states.filter((p) => p.status === "skipped").length,
      unvisited: states.filter((p) => !p.attempted).length,
      imported: states.reduce((sum, p) => sum + p.imported, 0),
    };
  }
  if (run.recent)
    run.recentOutcome = run.recent.errors
      ? "failed"
      : run.recent.complete === run.recent.eligible
        ? "success"
        : "partial";
}
export function applyProgressEvent(run: PersistedRun, event: ProgressEvent, now: string) {
  if (event.type === "select") {
    for (const id of event.ids) player(run, id)[event.pass] ??= emptyWork();
    run[event.pass] ??= {
      eligible: 0,
      visited: 0,
      settled: 0,
      complete: 0,
      partial: 0,
      errors: 0,
      skipped: 0,
      unvisited: 0,
      imported: 0,
    };
  } else {
    const id = event.type === "result" ? event.result.playerId : event.playerId;
    const p = player(run, id);
    if (event.type === "phase") {
      if (run.action === "player_add") run.playerId = id;
      run.phase = event.phase;
      run.phaseStartedAt = now;
      run.currentPlayerId = id;
      const pass = event.phase === "history" ? "history" : "recent";
      p[pass] ??= emptyWork();
      p[pass].status = "running";
      p[pass].attempted = true;
    } else if (event.type === "rank") p.rank = { checkedAt: event.checkedAt, outcome: "verified" };
    else if (event.type === "history") {
      p.history ??= emptyWork();
      p.history.history = event.history;
    } else {
      const phase = (p[event.pass] ??= emptyWork());
      if (event.type === "import") {
        phase.imported += event.imported;
        if (event.history) phase.history = event.history;
      } else {
        phase.status = event.result.status;
        phase.attempted = event.result.attempted ?? phase.attempted;
        phase.reason = event.result.reason ?? null;
        phase.error = event.error ?? phase.error;
        if (event.coveredThrough) phase.coveredThrough = event.coveredThrough;
      }
    }
  }
  summarizeRun(run);
}
export function finishRun(
  run: PersistedRun,
  now: string,
  failed: boolean,
  reason: "aborted" | "riot_backoff" | "execution_budget",
) {
  for (const p of run.players)
    for (const pass of ["recent", "history"] as const) {
      const phase = p[pass];
      if (phase?.status === "queued" || phase?.status === "running") {
        phase.status = "partial";
        phase.reason = reason;
      }
    }
  summarizeRun(run);
  run.status =
    failed || (run.recent?.errors ?? 0) + (run.history?.errors ?? 0) > 0
      ? "failed"
      : [run.recent, run.history].some((p) => p && p.complete + p.skipped < p.eligible)
        ? "partial"
        : "completed";
  run.finishedAt = now;
  run.lastCheckpointAt = now;
  run.revision++;
  if (!failed) run.phase = "finalizing";
  run.currentPlayerId = null;
}
export function progressDto(
  row: { owner: string; expiresAt: Date; runProgress: unknown } | undefined,
  now: Date,
  selector: ProgressSelector = {},
): ProgressDto {
  const parsed = progressEnvelopeSchema.safeParse(row?.runProgress);
  const envelope = parsed.success ? parsed.data : null;
  const latest = envelope?.latest;
  const valid = !!row && row.expiresAt > now;
  const matchingOwner = latest?.leaseOwner === row?.owner;
  const control: ProgressDto["control"] = !valid
    ? { state: "available", until: null, reason: null }
    : {
        state:
          !matchingOwner || !latest
            ? "busy_unknown"
            : latest.status === "running"
              ? "lease_held"
              : latest.finishedAt
                ? "cooldown"
                : "busy_unknown",
        until: row!.expiresAt.toISOString(),
        reason: matchingOwner && latest?.finishedAt ? latest.cooldownReason : null,
      };
  const runs = [latest, envelope?.previous].filter((r) => !!r);
  const selected = selector.runId
    ? runs.find((r) => r.runId === selector.runId)
    : selector.requestId
      ? runs.find((r) => r.requestId === selector.requestId)
      : latest;
  let run: ProgressRun | null = null;
  if (selected) {
    const owned = selected.leaseOwner === row?.owner;
    const state =
      selected.status === "running"
        ? !owned
          ? "interrupted"
          : !valid
            ? "possibly_interrupted"
            : "running"
        : selected.status;
    const activity =
      state === "running"
        ? "lease_valid"
        : state === "possibly_interrupted"
          ? "lease_expired"
          : state === "interrupted"
            ? "ownership_lost"
            : "not_running";
    run = publicRunSchema.parse({ ...selected, state, activity });
  }
  return {
    version: 1,
    serverNow: now.toISOString(),
    selection: run ? "found" : "not_found",
    control,
    run,
  };
}
