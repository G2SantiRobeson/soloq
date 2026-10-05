export const PLATFORMS = [
  "LA2",
  "LA1",
  "NA1",
  "BR1",
  "EUW1",
  "EUN1",
  "TR1",
  "RU",
  "ME1",
  "KR",
  "JP1",
  "OC1",
  "SG2",
  "TW2",
  "VN2",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Region = "americas" | "europe" | "asia" | "sea";
export const ROUTING: Record<Platform, Region> = {
  LA2: "americas",
  LA1: "americas",
  NA1: "americas",
  BR1: "americas",
  EUW1: "europe",
  EUN1: "europe",
  TR1: "europe",
  RU: "europe",
  ME1: "europe",
  KR: "asia",
  JP1: "asia",
  OC1: "sea",
  SG2: "sea",
  TW2: "sea",
  VN2: "sea",
};
export const PLATFORM_LABELS: Record<Platform, string> = {
  LA2: "LAS",
  LA1: "LAN",
  NA1: "NA",
  BR1: "BR",
  EUW1: "EUW",
  EUN1: "EUNE",
  TR1: "TR",
  RU: "RU",
  ME1: "ME",
  KR: "KR",
  JP1: "JP",
  OC1: "OCE",
  SG2: "SG",
  TW2: "TW",
  VN2: "VN",
};
export function regionalRouting(platform: Platform) {
  return ROUTING[platform];
}
// ACCOUNT-V1 exposes AMERICAS, EUROPE and ASIA, not MATCH-V5's SEA cluster.
// Account data is replicated between clusters; SEA platforms use ASIA here.
export function accountRouting(platform: Platform): Exclude<Region, "sea"> {
  const region = ROUTING[platform];
  return region === "sea" ? "asia" : region;
}
export function platformRouting(platform: Platform) {
  return platform.toLowerCase();
}
