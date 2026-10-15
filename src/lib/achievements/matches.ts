import type { AchievementMatch, AchievementReason, MatchEvaluationInput } from "./types";
import { chronological, compareId, scopeBounds, scopeQueueId } from "./validation";

export function prepareMatches(input: MatchEvaluationInput) {
  const reasons: AchievementReason[] = ["unproven_interval"];
  const { coverage, scope } = input;
  if (coverage.historyStatus !== "completed") reasons.push("incomplete_history");
  if (coverage.unavailable) reasons.push("unavailable_matches");
  if (coverage.source === "profile_recent_window") reasons.push("limited_profile_window");
  const byId = new Map<string, AchievementMatch>();
  for (const m of input.matches) {
    const previous = byId.get(m.matchId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(m))
        return { ok: false as const, reasons: [...reasons, "conflicting_duplicate" as const] };
      reasons.push("duplicate_record");
    } else byId.set(m.matchId, m);
  }
  const { start, end } = scopeBounds(scope);
  const records = [...byId.values()]
    .filter((m) => {
      if (m.queueId !== scopeQueueId(scope)) {
        reasons.push("queue_mismatch");
        return false;
      }
      const time = Date.parse(m.timestamp);
      if (time < start || time >= end) {
        reasons.push("outside_window");
        return false;
      }
      return true;
    })
    .sort((a, b) => chronological(a, b) || compareId(a.matchId, b.matchId));
  return { ok: true as const, records, reasons };
}
