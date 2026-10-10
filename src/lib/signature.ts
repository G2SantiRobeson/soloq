import SignatureMetrics from "./signature-metrics.cjs";
import type { PlayerProfile } from "./types";
import type { View } from "./queues";
import { kda } from "./stats";

export type SignaturePlayer = SignatureMetrics.Player;
export type SignatureReference = "community" | "default";
export type SignatureMetric = SignatureMetrics.Metric & { referenceSource: SignatureReference };
export type SignatureBaseline = SignatureMetrics.Baseline;

/** Engine baselines need a real sample; below this many players the engine defaults are used. */
export const SIGNATURE_BASELINE_MIN_PLAYERS = 5;

/**
 * Maps a profile to the engine's input. Nothing is invented: a missing source simply
 * leaves the field empty and the engine skips the metrics that depend on it.
 * - wins/losses: official ranked record for SoloQ/Flex, imported record for 5v5 (same as the profile).
 * - form: rolling 20-game winrate of the season (first, lowest, highest, latest point).
 * - champs: season pool for the queue; KDA = (kills + assists) / max(1, deaths).
 * - recent: last imported games (up to 40), remakes excluded; kp only when Riot gave team kills.
 */
export function toSignaturePlayer(
  profile: PlayerProfile,
  view: View,
  championName: (championId: number, fallback: string) => string = (_, name) => name,
): SignaturePlayer {
  const record = view !== "5v5" && profile.rank ? profile.rank : profile.stats;
  const rates = profile.performance.map((p) => p.winrate);
  return {
    wins: record.wins,
    losses: record.losses,
    form: rates.length
      ? {
          start: rates[0],
          min: Math.min(...rates),
          max: Math.max(...rates),
          now: rates[rates.length - 1],
        }
      : undefined,
    champs: profile.champions.map((c) => ({
      name: championName(c.championId, c.champion),
      games: c.games,
      wins: c.wins,
      losses: c.losses,
      kda: kda(c.kills, c.deaths, c.assists),
    })),
    recent: profile.recent
      .filter((m) => !m.isRemake)
      .map((m) => ({
        win: m.win,
        dur: m.duration,
        k: m.kills,
        d: m.deaths,
        a: m.assists,
        cs: m.cs,
        ...(m.killParticipation === null ? {} : { kp: m.killParticipation * 100 }),
      })),
  };
}

export function computeSignature(player: SignaturePlayer, baseline?: SignatureBaseline | null) {
  const result = SignatureMetrics.compute(player, baseline ?? undefined);
  // Mirror the engine's per-metric fallback without touching its numbers or ordering.
  const all: SignatureMetric[] = result.all.map((metric) => ({
    ...metric,
    referenceSource: baseline?.[metric.id] ? "community" : "default",
  }));
  const byId = new Map(all.map((metric) => [metric.id, metric]));
  return {
    all,
    featured: result.featured.map((metric) => byId.get(metric.id)!),
    others: result.others.map((metric) => byId.get(metric.id)!),
  };
}

export function signatureBaseline(players: SignaturePlayer[]): SignatureBaseline | null {
  return players.length >= SIGNATURE_BASELINE_MIN_PLAYERS
    ? SignatureMetrics.baselineFrom(players)
    : null;
}
