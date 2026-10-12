import "server-only";
import type { Platform } from "@/lib/routing";
import type { RiotMatch } from "./schemas";

export const MATCH_CAPTURE_VERSION = "1.2.B.2.E.2.2-match-capture-v1";
export type MatchCaptureHandle = Readonly<{ key: string }>;
export type MatchCaptureBinding = {
  playerId: string;
  platform: Platform;
  puuid: string; // Memory only. Never included in serialized evidence.
};
export type MatchQuery = { startTime: number; endTime: number; start: number; count: 100 };
export type MatchReception = {
  captureId: string;
  receptionId: string | null;
  attempt: number;
  receivedAt: string | null;
  validatedAt: string | null;
  failedAt: string | null;
  status: number | null;
  retryAfterMs: number | null;
  outcome:
    | "success"
    | "http_error"
    | "invalid_json"
    | "invalid_schema"
    | "invalid_normalization"
    | "network"
    | "timeout"
    | "unobserved";
};
export type MinimalMatchDetail = {
  matchId: string;
  queueId: number;
  mapId: number;
  gameMode: "CLASSIC" | "OTHER";
  timestampMs: number;
  matchingCount: number;
  win: boolean | null;
  championId: number | null;
  remake: {
    truePresent: number;
    falsePresent: number;
    absent: number;
    observationalIsRemake: boolean;
    evidentiarySufficiency: "unknown";
  };
};
export type MatchCaptureRecord = {
  version: typeof MATCH_CAPTURE_VERSION;
  normalizationVersion: "minimal-match-v1";
  requestId: string;
  endpoint: "MATCH-V5-IDS" | "MATCH-V5-DETAIL";
  source: "server_riot_received" | "synthetic" | "unknown";
  query: MatchQuery | null;
  requestedMatchId: string | null;
  receptions: MatchReception[];
  ids: string[] | null;
  detail: MinimalMatchDetail | null;
  certification: "not_established";
  grantAuthorized: false;
};
export class MatchCaptureError extends Error {
  constructor(
    public readonly code: "invalid" | "scope" | "conflict" | "limit" | "lifecycle" | "unleased",
  ) {
    super(`No se pudo confirmar la evidencia MATCH: ${code}.`);
  }
}
export function validMatchId(id: string, platform: Platform) {
  return new RegExp(`^${platform}_[0-9]{1,20}$`).test(id);
}
// A bounded legacy/test key is not evidence of a valid Riot match ID.
export function validStoredMatchKey(id: string) {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(id);
}
// Projection only, not a receipt factory. The client owns the unforgeable handles.
export function minimalMatchDetail(match: RiotMatch, puuid: string): MinimalMatchDetail {
  const matching = match.info.participants.filter((p) => p.puuid === puuid);
  const p = matching.length === 1 ? matching[0] : null;
  const truePresent = match.info.participants.filter(
    (p) => p.gameEndedInEarlySurrender === true,
  ).length;
  const falsePresent = match.info.participants.filter(
    (p) => p.gameEndedInEarlySurrender === false,
  ).length;
  if (
    match.info.participants.length > 20 ||
    !Number.isSafeInteger(match.info.gameStartTimestamp) ||
    match.info.gameStartTimestamp < 0 ||
    match.info.gameStartTimestamp > 8640000000000000 ||
    (p && (!Number.isSafeInteger(p.championId) || p.championId <= 0))
  )
    throw new MatchCaptureError("invalid");
  return {
    matchId: match.metadata.matchId,
    queueId: match.info.queueId,
    mapId: match.info.mapId,
    gameMode: match.info.gameMode === "CLASSIC" ? "CLASSIC" : "OTHER",
    timestampMs: match.info.gameStartTimestamp,
    matchingCount: matching.length,
    win: p?.win ?? null,
    championId: p?.championId ?? null,
    remake: {
      truePresent,
      falsePresent,
      absent: match.info.participants.length - truePresent - falsePresent,
      observationalIsRemake: truePresent > 0,
      evidentiarySufficiency: "unknown",
    },
  };
}
