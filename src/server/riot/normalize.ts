import { killParticipation } from "@/lib/stats";
import type { RiotMatch } from "./schemas";
export function normalizeParticipant(match: RiotMatch, puuid: string) {
  const p = match.info.participants.find((p) => p.puuid === puuid);
  if (!p) return null;
  const teamKills = match.info.participants
    .filter((ally) => ally.teamId === p.teamId)
    .reduce((sum, ally) => sum + ally.kills, 0);
  return {
    champion: p.championName,
    championId: p.championId,
    position: p.teamPosition || "UNKNOWN",
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    damage: p.totalDamageDealtToChampions,
    win: p.win,
    killParticipation: killParticipation(p.kills, p.assists, teamKills),
  };
}
