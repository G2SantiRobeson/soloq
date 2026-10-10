import "server-only";
import type { View } from "@/lib/queues";
import { queueIds } from "@/lib/queues";
import type { PlayerProfile, RecentMatch } from "@/lib/types";
import { CURRENT_SEASON, periodStart, type MetricsPeriod } from "@/lib/season";
import { rollingWinrate, lpObservations } from "@/lib/history";
import { aggregate } from "@/lib/stats";
import { summarizeLp, type RankSnapshot } from "@/lib/lp-metrics";
import { rankProgress, TIERS } from "@/lib/ranking";
// Entirely fictional fixtures, isolated from the Riot client and database.
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
export function demoPlayers(view: View, period: MetricsPeriod = "season"): PlayerProfile[] {
  return names.map((name, index) => {
    const now = Date.now();
    const all: RecentMatch[] = Array.from({ length: 360 }, (_, i) => {
      const champion = champions[(i + index) % champions.length];
      return {
        matchId: `DEMO_${index}_${i}`,
        queueId: [420, 420, 440, 400, 440][i % 5],
        timestamp: new Date(
          now - (i + 1) * Math.max(3600_000, (now - periodStart("LA2").getTime()) / 365),
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
        win: (i + index * 2) % 7 < 4,
        killParticipation: 0.45 + (i % 5) * 0.08,
      };
    });
    // Deliberate visual cases: no history, few games, 0% and 100% winrate.
    const recent =
      index === 7
        ? []
        : all
            .filter(
              (m) =>
                queueIds(view).includes(m.queueId) &&
                Date.parse(m.timestamp) >=
                  periodStart(index === 3 ? "EUW1" : "LA2", period, now).getTime(),
            )
            .slice(0, index >= 10 ? 1 : 360)
            .map((m) => (index >= 10 ? { ...m, win: index === 10 } : m));
    const rank =
      view === "5v5" || index === 7
        ? null
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
            division: index < 3 ? "I" : index % 2 ? "II" : "I",
            leaguePoints:
              view === "flex"
                ? 42 + index
                : [999, 615, 284, 76, 32, 89, 54, 0, 0, 99, 12, 0][index],
            wins: index === 0 ? 560 : index === 10 ? 1 : index === 11 ? 0 : 80 - index * 7,
            losses: index === 0 ? 410 : index === 10 ? 0 : index === 11 ? 1 : 51 - index * 4,
          };
    // Fictional single-game observations; counters and final LP agree with the current rank.
    const outcomes = Array.from({ length: 11 }, (_, i) =>
      (i + index) % (index % 2 ? 3 : 4) === 0 ? index % 2 === 1 : index % 2 === 0,
    );
    const history: RankSnapshot[] =
      rank && index < 10
        ? Array.from({ length: 12 }, (_, i) => {
            const later = outcomes.slice(i);
            const delta = later.reduce((sum, win) => sum + (win ? 24 : -19), 0);
            const coordinate = Math.max(0, rankProgress(rank)! - delta);
            const state =
              coordinate >= 2800
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
      platform: index === 3 ? "EUW1" : "LA2",
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
