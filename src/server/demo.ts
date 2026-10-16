import "server-only";
import type { View } from "@/lib/queues";
import { queueIds, rankedQueue } from "@/lib/queues";
import type { PlayerProfile, RecentMatch } from "@/lib/types";
import { CURRENT_SEASON, periodStart, type MetricsPeriod } from "@/lib/season";
import { rollingWinrate, lpObservations } from "@/lib/history";
import { aggregate } from "@/lib/stats";
import { summarizeLp, type RankSnapshot } from "@/lib/lp-metrics";
import type { Platform } from "@/lib/routing";
import { rankProgress, TIERS } from "@/lib/ranking";
// Entirely fictional fixtures, isolated from the Riot client and database.
const additionalPlayers: {
  name: string;
  platform: Platform;
  tier: string;
  division: string;
  solo: number;
  flex: number;
}[] = [
  { name: "Demo Fénix", platform: "LA2", tier: "EMERALD", division: "III", solo: 74, flex: 80 },
  { name: "Demo Hydra", platform: "LA2", tier: "EMERALD", division: "III", solo: 46, flex: 52 },
  { name: "Demo Akuma", platform: "LA2", tier: "PLATINUM", division: "III", solo: 61, flex: 64 },
  { name: "Demo Kitsune", platform: "LA2", tier: "PLATINUM", division: "III", solo: 31, flex: 34 },
  { name: "Demo Onyx", platform: "EUW1", tier: "GOLD", division: "II", solo: 78, flex: 79 },
  { name: "Demo Nami", platform: "EUW1", tier: "GOLD", division: "II", solo: 46, flex: 47 },
  { name: "Demo Poro", platform: "LA1", tier: "SILVER", division: "III", solo: 44, flex: 54 },
  { name: "Demo Tilt", platform: "LA1", tier: "SILVER", division: "III", solo: 9, flex: 19 },
  { name: "Demo Nashor", platform: "BR1", tier: "GOLD", division: "IV", solo: 83, flex: 71 },
  { name: "Demo Raptor", platform: "BR1", tier: "GOLD", division: "IV", solo: 48, flex: 36 },
  { name: "Demo Loto", platform: "LA2", tier: "BRONZE", division: "IV", solo: 70, flex: 60 },
  { name: "Demo Pixel", platform: "NA1", tier: "IRON", division: "IV", solo: 35, flex: 41 },
];
const names = [
  "Demo Nebula",
  "Demo Kintsugi",
  "Demo Afterglow",
  "Demo Ronin",
  "Demo Marea",
  "Demo Vanta",
  "Demo Sora",
  "Demo Eclipse",
  "Demo ÚltimoBastión",
  "Demo Silver",
  "Demo Bronze",
  "Demo Iron",
  ...additionalPlayers.map((player) => player.name),
];
const champions = [
  { name: "Ahri", id: 103 },
  { name: "Yasuo", id: 157 },
  { name: "Jinx", id: 222 },
  { name: "LeeSin", id: 64 },
  { name: "Thresh", id: 412 },
  { name: "Orianna", id: 61 },
  { name: "Nunu & Willump", id: 20 },
];
const ONE_TRICK_INDEX = 4;
/** `onlyId` builds a single profile (identical data) instead of the whole fixture set. */
export function demoPlayers(
  view: View,
  period: MetricsPeriod = "season",
  onlyId?: string,
): PlayerProfile[] {
  const indices = names
    .map((_, index) => index)
    .filter((index) => !onlyId || onlyId === `demo-${index + 1}`);
  return indices.map((index) => {
    const name = names[index];
    const extra = additionalPlayers[index - 12];
    const now = Date.now();
    // Ronin/Marea share a nearby fictional Diamond I ladder; Sora retains an EUW example.
    const platform = extra?.platform ?? (index === 6 ? "EUW1" : "LA2");
    // Per-player constants: identical fixture values without thousands of repeated timezone conversions.
    const seasonOrigin = periodStart(extra ? platform : "LA2").getTime();
    const visibleFrom = periodStart(platform, period, now).getTime();
    const selectedQueues = queueIds(view);
    const all: RecentMatch[] = Array.from({ length: extra ? 120 : 360 }, (_, i) => {
      // Demo Marea is a deliberate one-trick (Thresh in 4 of every 5 blocks of games, in
      // every queue), so the experimental OTP badge has a coherent positive example.
      const champion =
        index === ONE_TRICK_INDEX && Math.floor(i / 5) % 5 !== 4
          ? champions[4]
          : champions[(i + index) % champions.length];
      return {
        matchId: `DEMO_${index}_${i}`,
        queueId: [420, 420, 440, 400, 440][i % 5],
        timestamp: new Date(
          now - (i + 1) * Math.max(3600_000, (now - seasonOrigin) / 365),
        ).toISOString(),
        champion: champion.name,
        championId: champion.id,
        position: ["MIDDLE", "TOP", "BOTTOM", "JUNGLE", "UTILITY"][(i + index) % 5],
        kills: 3 + ((i * 3 + index) % 13),
        deaths: 2 + (i % 7),
        assists: 4 + (i % 12),
        cs: 170 + ((i * 11) % 120),
        duration: 1600 + i * 13,
        damage: 18000 + i * 400,
        // F6 positive demo runs, shared with the profile and evaluator; LP/snapshots unchanged.
        win: (index === 3 || index === 4) && i < 15 ? true : (i + index * 2) % 7 < 4,
        killParticipation: 0.45 + (i % 5) * 0.08,
      };
    });
    // Deliberate visual cases: no history, few games, 0% and 100% winrate.
    const recent =
      index === 7
        ? []
        : all
            .filter(
              (m) => selectedQueues.includes(m.queueId) && Date.parse(m.timestamp) >= visibleFrom,
            )
            .slice(0, index === 10 || index === 11 ? 1 : 360)
            .map((m) => (index === 10 || index === 11 ? { ...m, win: index === 10 } : m));
    const rank =
      view === "5v5" || index === 7
        ? null
        : extra
          ? {
              tier: extra.tier,
              division: extra.division,
              leaguePoints: view === "flex" ? extra.flex : extra.solo,
              wins: 42 + (index % 7) * 3,
              losses: 26 + (index % 6) * 2,
            }
          : {
              tier: [
                "CHALLENGER",
                "GRANDMASTER",
                "MASTER",
                "DIAMOND",
                "DIAMOND",
                "EMERALD",
                "PLATINUM",
                "UNRANKED",
                "GOLD",
                "SILVER",
                "BRONZE",
                "IRON",
              ][index],
              division: index <= 3 ? "I" : index % 2 ? "II" : "I",
              leaguePoints:
                view === "flex"
                  ? 42 + index
                  : [999, 615, 284, 57, 32, 89, 54, 0, 0, 99, 12, 0][index],
              wins: index === 0 ? 560 : index === 10 ? 1 : index === 11 ? 0 : 80 - index * 7,
              losses: index === 0 ? 410 : index === 10 ? 0 : index === 11 ? 1 : 51 - index * 4,
            };
    // Fictional single-game observations; counters and final LP agree with the current rank.
    const outcomes = Array.from({ length: 11 }, (_, i) =>
      (i + index) % (index % 2 ? 3 : 4) === 0 ? index % 2 === 1 : index % 2 === 0,
    );
    const rivalryFixture = index === 3 || index === 4;
    // Only these two fictional series demonstrate a final leadership inversion.
    if (rivalryFixture) outcomes[10] = view === "soloq" ? index === 3 : index === 4;
    const rivalryLp =
      view === "soloq"
        ? index === 3
          ? [52, 54, 56, 55, 53, 49, 44, 40, 35, 30, 25, 57]
          : [74, 72, 69, 65, 63, 60, 58, 55, 52, 50, 50, 32]
        : index === 3
          ? [55, 58, 60, 62, 63, 65, 66, 67, 68, 67, 65, 45]
          : [5, 10, 14, 15, 17, 20, 22, 25, 27, 28, 25, 46];
    const history: RankSnapshot[] =
      rank && (index < 10 || !!extra)
        ? Array.from({ length: 12 }, (_, i) => {
            const later = outcomes.slice(i);
            const delta = later.reduce((sum, win) => sum + (win ? 24 : -19), 0);
            const coordinate = Math.max(0, rankProgress(rank)! - delta);
            const state = rivalryFixture
              ? { ...rank, leaguePoints: rivalryLp[i] }
              : coordinate >= 2800
                ? { ...rank, leaguePoints: coordinate - 2800 }
                : {
                    ...rank,
                    tier: TIERS[Math.floor(coordinate / 400)],
                    division: ["IV", "III", "II", "I"][Math.floor((coordinate % 400) / 100)],
                    leaguePoints: coordinate % 100,
                  };
            return {
              ...state,
              wins: rank.wins - later.filter(Boolean).length,
              losses: rank.losses - later.filter((w) => !w).length,
              timestamp: new Date(now - (12 - i) * 3600_000).toISOString(),
            };
          })
        : [];
    return {
      id: `demo-${index + 1}`,
      gameName: name,
      tagLine: "DEMO",
      platform,
      profileIconId: index === 11 ? null : [29, 27, 23, 20, 21, 22, 26, 28][index % 8],
      observedAt: new Date(now).toISOString(),
      rankCheckedAt: null, // Fictional ranks are never officially verified.
      lastSyncedAt:
        index === 6
          ? new Date(now - 172800_000).toISOString()
          : new Date(now - 420_000).toISOString(),
      createdAt: new Date(now - 14 * 86400_000).toISOString(),
      rank,
      stats: aggregate(recent),
      recent,
      champions: champions
        .map((c) => ({
          champion: c.name,
          championId: c.id,
          ...aggregate(recent.filter((m) => m.championId === c.id)),
        }))
        .filter((c) => c.games > 0)
        .sort((a, b) => b.games - a.games),
      history,
      rivalryHistory:
        rivalryFixture && rankedQueue(view)
          ? history.map((point) => ({ ...point, queue: rankedQueue(view)! }))
          : [],
      performance: rollingWinrate(recent),
      trackingSince: history[0]?.timestamp ?? null,
      lpObservations: lpObservations(history, recent),
      seasonHistory: {
        season: CURRENT_SEASON.id,
        status:
          index === 6
            ? "running"
            : index === 7
              ? "not_started"
              : index === 8
                ? "failed"
                : "completed",
        processed: recent.length,
        discovered: recent.length + (index === 6 ? 100 : 0),
        unavailable: 0,
        completedAt: new Date(now).toISOString(),
      },
      momentum: view === "5v5" ? null : summarizeLp(history),
    };
  });
}
