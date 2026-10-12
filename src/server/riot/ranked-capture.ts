import "server-only";
import type { Platform } from "@/lib/routing";
import type { RankedQueue } from "@/lib/queues";
import type { MatchReception } from "./match-capture";

export const RANKED_CAPTURE_VERSION = "1.2.B.2.E.2.3-ranked-identity-remake-v1";
export const REMAKE_CLASSIFIER_VERSION = "any-early-surrender-true-v1";
export type RankedCaptureHandle = Readonly<{ key: string }>;
export type RankedBinding = { playerId: string; platform: Platform; puuid: string | null };
export type RankedEntry = {
  queue: RankedQueue;
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};
export type RankedRecord = {
  version: typeof RANKED_CAPTURE_VERSION;
  normalizationVersion: "minimal-ranked-identity-v1";
  requestId: string;
  endpoint: "ACCOUNT-V1" | "IDENTITY-V1" | "LEAGUE-V4";
  source: "unknown" | "synthetic" | "server_riot_received";
  receptions: MatchReception[];
  entries: RankedEntry[] | null;
  ignoredEntries: number | null;
  certification: "not_established";
  grantAuthorized: false;
};
