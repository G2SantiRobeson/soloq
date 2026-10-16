import { observedLeadershipCuts, type LeadershipCut } from "./rivalry-leadership";
import { selectRivalries, type Rivalry } from "./rivalries";
import { rankedQueue, type View } from "./queues";
export type RivalryEventKind = "leadership-change" | "approaching" | "separating" | "tie";
export type RivalryEvent = {
  kind: RivalryEventKind;
  before: LeadershipCut;
  after: LeadershipCut;
  previousGap: number;
  observedGap: number;
};
/** Input cuts must come from the strict, nonoverlapping observation matcher. */
export function classifyRivalryInterval(
  before: LeadershipCut,
  after: LeadershipCut,
): RivalryEvent | null {
  if (Date.parse(before.to) >= Date.parse(after.from)) return null;
  const gap = (cut: LeadershipCut) =>
    Math.abs(cut.observations[0].leaguePoints - cut.observations[1].leaguePoints);
  const previousGap = gap(before),
    observedGap = gap(after);
  let kind: RivalryEventKind;
  if (before.leaderId && after.leaderId && before.leaderId !== after.leaderId)
    kind = "leadership-change";
  else if (before.leaderId && !after.leaderId && observedGap === 0) kind = "tie";
  else if (!before.leaderId || before.leaderId !== after.leaderId || previousGap === observedGap)
    return null;
  else kind = observedGap < previousGap ? "approaching" : "separating";
  return { kind, before, after, previousGap, observedGap };
}
export function detectRivalryDynamics(
  rivalry: Rivalry,
  view: View,
  { asOf }: { asOf: string },
): RivalryEvent | null {
  if (rivalry.queue !== rankedQueue(view) || !selectRivalries(rivalry.players, view).length)
    return null;
  const cuts = observedLeadershipCuts(...rivalry.players, view, { asOf });
  if (!cuts || cuts.length < 2) return null;
  const result = classifyRivalryInterval(cuts[1], cuts[0]);
  return result?.kind === "tie" ? null : result;
}
export const RIVALRY_EVENT_LABELS: Record<RivalryEventKind, string> = {
  "leadership-change": "Liderato invertido",
  approaching: "Acercamiento observado",
  separating: "Separación observada",
  tie: "Empate observado",
};
