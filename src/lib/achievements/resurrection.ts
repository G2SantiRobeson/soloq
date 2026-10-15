import { comparableRankInterval, validRankObservation } from "../rank-trajectory";
import { RESURRECTION_RULE } from "./catalog";
import { evaluation } from "./result";
import {
  chronological,
  compareId,
  parseRankInput,
  resurrectionRuleSchema,
  scopeBounds,
  scopeQueue,
} from "./validation";
import type {
  AchievementEvaluation,
  AchievementReason,
  AchievementSnapshot,
  ResurrectionEvidence,
  ResurrectionRule,
} from "./types";

type Candidate = { a: number; b: number };
/** Oldest recovery, greatest drop, oldest A/B, then supplied IDs. */
function compareCandidate(a: Candidate, b: Candidate, points: AchievementSnapshot[]) {
  return (
    points[b.a].leaguePoints -
      points[b.b].leaguePoints -
      (points[a.a].leaguePoints - points[a.b].leaguePoints) ||
    chronological(points[a.a], points[b.a]) ||
    chronological(points[a.b], points[b.b]) ||
    compareId(points[a.a].id ?? "", points[b.a].id ?? "") ||
    compareId(points[a.b].id ?? "", points[b.b].id ?? "")
  );
}
function boundary(
  before: AchievementSnapshot,
  after: AchievementSnapshot,
  rule: ResurrectionRule,
): AchievementReason | null {
  if (after.tier !== before.tier || after.division !== before.division)
    return "non_comparable_rank";
  if (after.wins < before.wins || after.losses < before.losses) return "counter_reset";
  if (Date.parse(after.timestamp) - Date.parse(before.timestamp) > rule.maxGapMs)
    return "snapshot_gap";
  return comparableRankInterval(before, after) ? null : "non_comparable_rank";
}

/** Necessary LP-only condition, never a positive evaluation. Preserve the original
 * search for every potentially recoverable segment (including false positives).
 * Any valid A/B/C requires LP on both sides of B to be >= LP_B + minDropLp.
 * Ignoring time windows/counters here can only retain extra work, never discard evidence.
 */
function searchableSegments(
  points: AchievementSnapshot[],
  times: number[],
  rule: ResurrectionRule,
) {
  const searchable = new Uint8Array(points.length);
  const valid = new Uint8Array(points.length);
  const cuts: (AchievementReason | null)[] = Array(points.length).fill(null);
  const suffixMax = new Float64Array(points.length);
  function finish(start: number, end: number) {
    if (end - start < 3) return;
    let maximum = -Infinity;
    for (let i = end - 1; i >= start; i--) {
      maximum = Math.max(maximum, points[i].leaguePoints);
      suffixMax[i] = maximum;
    }
    maximum = points[start].leaguePoints;
    for (let b = start + 1; b < end - 1; b++) {
      const required = points[b].leaguePoints + rule.minDropLp;
      if (maximum >= required && suffixMax[b + 1] >= required) {
        searchable.fill(1, start, end);
        return;
      }
      maximum = Math.max(maximum, points[b].leaguePoints);
    }
  }
  let start = 0,
    previous: AchievementSnapshot | null = null;
  for (let i = 0; i < points.length;) {
    let end = i + 1;
    while (end < points.length && times[end] === times[i]) end++;
    const point = points[i];
    if (end > i + 1 || !validRankObservation(point)) {
      finish(start, i);
      start = end;
      previous = null;
    } else {
      valid[i] = 1;
      cuts[i] = previous ? boundary(previous, point, rule) : null;
      if (cuts[i]) {
        finish(start, i);
        start = i;
      }
      previous = point;
    }
    i = end;
  }
  finish(start, points.length);
  return { searchable, valid, cuts };
}

export function evaluateResurrection(
  input: unknown,
  configuration: unknown = RESURRECTION_RULE,
): AchievementEvaluation<ResurrectionEvidence> {
  const parsed = parseRankInput(input);
  if (!parsed.ok) return evaluation("resurrection", null, "invalid_input", parsed.reasons);
  const { scope } = parsed.value;
  const rule = resurrectionRuleSchema.safeParse(configuration);
  if (!rule.success) return evaluation("resurrection", scope, "invalid_input", ["invalid_rule"]);
  const reasons: AchievementReason[] = ["unobserved_rank_path"];
  const ids = new Map<string, AchievementSnapshot>();
  const anonymous = new Set<string>();
  const unique: AchievementSnapshot[] = [];
  for (const point of parsed.value.snapshots) {
    const previous = point.id ? ids.get(point.id) : undefined;
    const identity = JSON.stringify(point);
    if (previous && JSON.stringify(previous) !== identity)
      return evaluation("resurrection", scope, "invalid_input", ["conflicting_duplicate"]);
    if (previous || (!point.id && anonymous.has(identity))) {
      reasons.push("duplicate_record");
      continue;
    }
    if (point.id) ids.set(point.id, point);
    else anonymous.add(identity);
    unique.push(point);
  }
  const { start, end } = scopeBounds(scope);
  const points = unique
    .filter((p) => {
      if (p.queue !== scopeQueue(scope)) {
        reasons.push("queue_mismatch");
        return false;
      }
      const time = Date.parse(p.timestamp);
      if (time < start || time >= end) {
        reasons.push("outside_window");
        return false;
      }
      return true;
    })
    .sort((a, b) => chronological(a, b) || compareId(a.id ?? "", b.id ?? ""));
  const times = points.map((point) => Date.parse(point.timestamp));
  const { searchable, valid, cuts } = searchableSegments(points, times, rule.data);
  let active: Candidate[] = [];
  let interrupted = false;
  let validCount = 0;
  for (let i = 0; i < points.length;) {
    let end = i + 1;
    while (end < points.length && times[end] === times[i]) end++;
    const current = points[i];
    if (end > i + 1 || !valid[i]) {
      reasons.push(
        end > i + 1
          ? "ambiguous_timestamp"
          : current.tier === "UNRANKED"
            ? "unranked"
            : "invalid_rank",
      );
      interrupted = true;
      active = [];
      i = end;
      continue;
    }
    validCount++;
    const cut = cuts[i];
    if (cut) {
      reasons.push(cut);
      interrupted = true;
      active = [];
    }
    // Still visit every observation to preserve validity, barriers and diagnostic reasons.
    if (!searchable[i]) {
      i++;
      continue;
    }
    active = active.filter(({ a }) => times[i] - times[a] <= rule.data.maxRecoveryMs);
    let selected: Candidate | null = null;
    for (const candidate of active) {
      const a = points[candidate.a],
        b = points[candidate.b];
      if (
        candidate.b > candidate.a &&
        a.leaguePoints - b.leaguePoints >= rule.data.minDropLp &&
        current.leaguePoints >= a.leaguePoints &&
        b.losses > a.losses &&
        current.wins > b.wins &&
        (!selected || compareCandidate(candidate, selected, points) < 0)
      )
        selected = candidate;
    }
    if (selected) {
      const a = points[selected.a],
        b = points[selected.b];
      const observations = points.slice(selected.a, i + 1);
      return evaluation("resurrection", scope, "observed", reasons, {
        kind: "rank_recovery",
        ruleVersion: rule.data.version,
        queue: scopeQueue(scope),
        season: scope.season.id,
        from: a.timestamp,
        to: current.timestamp,
        before: a,
        minimum: b,
        recovered: current,
        dropLp: a.leaguePoints - b.leaguePoints,
        observationCount: observations.length,
        observations,
        rule: rule.data,
        limitation: "observed_endpoints_not_continuous_path",
      });
    }
    for (const candidate of active) {
      const a = points[candidate.a],
        b = points[candidate.b];
      // The minimum includes all intermediate observations. On ties, prefer the earliest
      // minimum with a loss-counter increase; an earlier zero-loss minimum cannot qualify.
      if (
        current.leaguePoints < b.leaguePoints ||
        (current.leaguePoints === b.leaguePoints &&
          b.losses === a.losses &&
          current.losses > a.losses)
      )
        candidate.b = i;
    }
    active.push({ a: i, b: i });
    i++;
  }
  return evaluation(
    "resurrection",
    scope,
    interrupted || validCount < 3 ? "insufficient_evidence" : "not_observed",
    [...reasons, ...(validCount < 3 ? ["insufficient_sample" as const] : []), "no_matching_event"],
  );
}
