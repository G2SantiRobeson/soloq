export const VIEWS = ["soloq", "flex", "5v5"] as const;
export type View = (typeof VIEWS)[number];
export const RANKED_QUEUES = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] as const;
export type RankedQueue = (typeof RANKED_QUEUES)[number];
export const QUEUE_LABELS: Record<View, string> = { soloq: "SoloQ", flex: "Flex", "5v5": "5v5" };
// Official catalog: https://static.developer.riotgames.com/docs/lol/queues.json
// Deliberate classic PvP scope. Swiftplay (480), customs (0), bots and rotating modes excluded.
export const STANDARD_QUEUES = {
  400: "Draft Pick",
  420: "Ranked Solo/Duo",
  430: "Blind Pick",
  440: "Ranked Flex",
  490: "Quickplay",
  700: "Clash",
} as const;
export function queueIds(view: View): number[] {
  return view === "soloq"
    ? [420]
    : view === "flex"
      ? [440]
      : Object.keys(STANDARD_QUEUES).map(Number);
}
export function isStandardMatch(queueId: number, mapId: number, mode: string) {
  return mapId === 11 && mode === "CLASSIC" && queueId in STANDARD_QUEUES;
}
export function rankedQueue(view: View): RankedQueue | null {
  return view === "soloq" ? RANKED_QUEUES[0] : view === "flex" ? RANKED_QUEUES[1] : null;
}
export function parseView(value: string | string[] | undefined): View {
  return VIEWS.includes(value as View) ? (value as View) : "soloq";
}
