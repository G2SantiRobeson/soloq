import { z } from "zod";
export const accountSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string(),
  tagLine: z.string(),
});
export const summonerSchema = z.object({ profileIconId: z.number().int() });
export const leagueSchema = z.array(
  z.object({
    queueType: z.string(),
    tier: z.string(),
    rank: z.string(),
    leaguePoints: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
  }),
);
const participantSchema = z.object({
  puuid: z.string(),
  championName: z.string(),
  championId: z.number().int(),
  teamPosition: z.string(),
  teamId: z.number().int(),
  kills: z.number().int(),
  deaths: z.number().int(),
  assists: z.number().int(),
  totalMinionsKilled: z.number().int(),
  neutralMinionsKilled: z.number().int(),
  totalDamageDealtToChampions: z.number().int(),
  win: z.boolean(),
  gameEndedInEarlySurrender: z.boolean().optional(),
});
export const matchSchema = z.object({
  metadata: z.object({ matchId: z.string() }),
  info: z.object({
    queueId: z.number().int(),
    mapId: z.number().int(),
    gameMode: z.string(),
    gameStartTimestamp: z.number(),
    gameDuration: z.number().int(),
    participants: z.array(participantSchema),
  }),
});
export type RiotMatch = z.infer<typeof matchSchema>;
