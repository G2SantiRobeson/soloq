import { UNSTOPPABLE_RULE } from "./catalog";
import { prepareMatches } from "./matches";
import { evaluation } from "./result";
import { parseMatchInput, scopeQueue, unstoppableRuleSchema } from "./validation";
import type { AchievementEvaluation, AchievementMatch, UnstoppableEvidence } from "./types";

/** Unknown rows cut the observable sequence; missing unrecorded rows remain a coverage limitation. */
export function evaluateUnstoppable(
  input: unknown,
  configuration: unknown = UNSTOPPABLE_RULE,
): AchievementEvaluation<UnstoppableEvidence> {
  const parsed = parseMatchInput(input);
  if (!parsed.ok) return evaluation("unstoppable", null, "invalid_input", parsed.reasons);
  const { scope, coverage } = parsed.value;
  const rule = unstoppableRuleSchema.safeParse(configuration);
  if (!rule.success) return evaluation("unstoppable", scope, "invalid_input", ["invalid_rule"]);
  const prepared = prepareMatches(parsed.value);
  if (!prepared.ok) return evaluation("unstoppable", scope, "invalid_input", prepared.reasons);
  const { records, reasons } = prepared;
  let run: AchievementMatch[] = [],
    best: AchievementMatch[] = [];
  let uncertain = false;
  for (let i = 0; i < records.length;) {
    let end = i + 1;
    while (
      end < records.length &&
      Date.parse(records[end].timestamp) === Date.parse(records[i].timestamp)
    )
      end++;
    if (end > i + 1) {
      reasons.push("ambiguous_timestamp");
      uncertain = true;
      run = [];
      i = end;
      continue;
    }
    const m = records[i++];
    if (m.isRemake === true) continue;
    if (m.isRemake === null || m.win === null) {
      if (m.isRemake === null) reasons.push("unknown_remake");
      if (m.win === null) reasons.push("unknown_result");
      uncertain = true;
      run = [];
      continue;
    }
    if (!m.win) {
      run = [];
      continue;
    }
    run.push(m);
    // Keep the run reference until it ends; avoid copying a growing run on each win.
    // Earliest maximum run wins ties.
    if (run.length > best.length) best = run;
  }
  const evidence: UnstoppableEvidence | null = best.length
    ? {
        kind: "recorded_win_streak",
        ruleVersion: rule.data.version,
        queue: scopeQueue(scope),
        season: scope.season.id,
        from: best[0].timestamp,
        to: best.at(-1)!.timestamp,
        maxObservedWins: best.length,
        matchIds: best.map((m) => m.matchId),
        ignoredRemakeIds: records
          .filter(
            (m) =>
              m.isRemake === true &&
              Date.parse(m.timestamp) > Date.parse(best[0].timestamp) &&
              Date.parse(m.timestamp) < Date.parse(best.at(-1)!.timestamp),
          )
          .map((m) => m.matchId),
        coverage,
        limitation: "recorded_sequence_not_exhaustive_riot_history",
        rule: rule.data,
      }
    : null;
  const observed = best.length >= rule.data.minWins;
  const smallSample =
    records.filter((m) => m.isRemake === false && m.win !== null).length < rule.data.minWins;
  const status = observed
    ? "observed"
    : uncertain || smallSample
      ? "insufficient_evidence"
      : "not_observed";
  if (!observed && smallSample) reasons.push("insufficient_sample");
  if (status === "not_observed") reasons.push("no_matching_event");
  return evaluation("unstoppable", scope, status, reasons, evidence);
}
