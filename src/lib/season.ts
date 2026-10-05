import type { Platform } from "./routing";

// Annual ranked cycle (not the three thematic seasons). Update here once per year.
// Riot 26.1: Jan 8, 2026, noon local server time.
// https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/
// Server zones: https://www.leagueoflegends.com/en-au/news/game-updates/patch-14-16-notes/
export const CURRENT_SEASON = {
  id: "2026",
  label: "Temporada 2026",
  startAt: "2026-01-08T12:00:00",
  endAt: null as string | null,
};
const serverZones: Record<Platform, string> = {
  LA2: "America/Argentina/Buenos_Aires", LA1: "America/Mexico_City", NA1: "America/Chicago",
  BR1: "America/Sao_Paulo", EUW1: "Europe/London", EUN1: "Europe/Warsaw",
  TR1: "Europe/Istanbul", RU: "Europe/Moscow", ME1: "Asia/Riyadh", KR: "Asia/Seoul",
  JP1: "Asia/Tokyo", OC1: "Australia/Sydney", SG2: "Asia/Singapore", TW2: "Asia/Taipei", VN2: "Asia/Ho_Chi_Minh",
};
export function seasonStart(platform: Platform): Date {
  const wall = Date.parse(`${CURRENT_SEASON.startAt}Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: serverZones[platform], timeZoneName: "longOffset",
  }).formatToParts(new Date(wall));
  const offset = parts.find(p => p.type === "timeZoneName")!.value.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "+" ? 1 : -1) : 0;
  return new Date(wall - minutes * 60_000);
}
export type MetricsPeriod = "season" | "30d" | "7d";
export function parsePeriod(value?: string): MetricsPeriod {
  return value === "30d" || value === "7d" ? value : "season";
}
export function periodStart(platform: Platform, period: MetricsPeriod = "season", now = Date.now()) {
  return new Date(Math.max(seasonStart(platform).getTime(), period === "season" ? 0 : now - (period === "7d" ? 7 : 30) * 86400_000));
}
export type HistoryStatus = {
  season: string;
  status: "not_started" | "running" | "completed" | "failed";
  processed: number;
  discovered: number;
  unavailable: number;
  completedAt: string | null;
};
export const HISTORY_LABELS: Record<HistoryStatus["status"], string> = {
  not_started: "Pendiente", running: "Importación en curso", completed: "Historial disponible importado", failed: "Interrumpido · reintentable",
};
