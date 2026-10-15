import { OTP_RULE } from "./catalog";
import { prepareMatches } from "./matches";
import { evaluation } from "./result";
import { otpRuleSchema, parseMatchInput, scopeQueue } from "./validation";
import type { AchievementEvaluation, OtpEvidence } from "./types";

export function evaluateOtpSpecialist(
  input: unknown,
  configuration: unknown = OTP_RULE,
): AchievementEvaluation<OtpEvidence> {
  const parsed = parseMatchInput(input);
  if (!parsed.ok) return evaluation("otp-specialist", null, "invalid_input", parsed.reasons);
  const { scope, coverage } = parsed.value;
  const rule = otpRuleSchema.safeParse(configuration);
  if (!rule.success) return evaluation("otp-specialist", scope, "invalid_input", ["invalid_rule"]);
  const prepared = prepareMatches(parsed.value);
  if (!prepared.ok) return evaluation("otp-specialist", scope, "invalid_input", prepared.reasons);
  const { records, reasons } = prepared;
  const games = records.filter(
    (m) => m.isRemake === false && m.championId !== null && m.win !== null,
  );
  let uncertain = false;
  for (const m of records) {
    if (m.isRemake === true) continue;
    if (m.isRemake === null) {
      uncertain = true;
      reasons.push("unknown_remake");
    }
    if (m.championId === null) {
      uncertain = true;
      reasons.push("invalid_champion");
    }
    if (m.win === null) {
      uncertain = true;
      reasons.push("unknown_result");
    }
  }
  const counts = new Map<number, number>();
  for (const m of games) counts.set(m.championId!, (counts.get(m.championId!) ?? 0) + 1);
  // A lower champion ID wins an exact tie; names and input ordering never participate.
  let championId = 0,
    championGames = 0;
  for (const [id, count] of counts)
    if (count > championGames || (count === championGames && id < championId)) {
      championId = id;
      championGames = count;
    }
  const evidence: OtpEvidence | null = games.length
    ? {
        kind: "recorded_champion_share",
        ruleVersion: rule.data.version,
        queue: scopeQueue(scope),
        season: scope.season.id,
        from: games[0].timestamp,
        to: games.at(-1)!.timestamp,
        championId,
        championGames,
        validGames: games.length,
        share: { numerator: championGames, denominator: games.length },
        coverage,
        limitation: "imported_sample_not_season_certification",
        rule: rule.data,
      }
    : null;
  if (uncertain || games.length < rule.data.minGames)
    return evaluation(
      "otp-specialist",
      scope,
      "insufficient_evidence",
      [...reasons, ...(games.length < rule.data.minGames ? ["insufficient_sample" as const] : [])],
      evidence,
    );
  // BigInt multiplication preserves the exact rational comparison even for large configurations.
  const meets =
    BigInt(championGames) * BigInt(rule.data.minShare.denominator) >=
    BigInt(games.length) * BigInt(rule.data.minShare.numerator);
  return evaluation(
    "otp-specialist",
    scope,
    meets ? "observed" : "not_observed",
    [...reasons, ...(!meets ? ["no_matching_event" as const] : [])],
    evidence,
  );
}
