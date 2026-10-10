import { MAX_RANK_INTERVAL_MS } from "../rank-trajectory";
import type {
  AchievementDefinition,
  AchievementRuleVersion,
  OtpRule,
  ResurrectionRule,
  UnstoppableRule,
} from "./types";

export const ACHIEVEMENT_RULE_VERSION: AchievementRuleVersion = "1.1.A-observed-v1";
export const RESURRECTION_RULE: Readonly<ResurrectionRule> = Object.freeze({
  version: ACHIEVEMENT_RULE_VERSION,
  minDropLp: 50,
  maxRecoveryMs: 30 * 86400_000,
  maxGapMs: MAX_RANK_INTERVAL_MS,
});
export const UNSTOPPABLE_RULE: Readonly<UnstoppableRule> = Object.freeze({
  version: ACHIEVEMENT_RULE_VERSION,
  minWins: 5,
});
export const OTP_RULE: Readonly<OtpRule> = Object.freeze({
  version: ACHIEVEMENT_RULE_VERSION,
  minGames: 50,
  minShare: Object.freeze({ numerator: 7, denominator: 10 }),
});
const definitions: AchievementDefinition[] = [
  {
    code: "resurrection",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
    name: "Resurrección",
    category: "progression",
    views: ["soloq", "flex"],
    evidence: "rank_recovery",
    availability: "observation_only",
    description:
      "Recuperación de un nivel de LP previamente observado después de una caída observada.",
    provisionalConditions:
      "Caída ≥50 LP y recuperación en ≤30 días, misma división, huecos ≤7 días. No describe la trayectoria intermedia.",
  },
  {
    code: "unstoppable",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
    name: "Imparable",
    category: "performance",
    views: ["soloq", "flex"],
    evidence: "recorded_win_streak",
    availability: "observation_only",
    description: "Racha de victorias observada entre las partidas registradas de una cola.",
    provisionalConditions:
      "≥5 victorias; no acredita ausencia de partidas desconocidas ni otorga un logro permanente.",
  },
  {
    code: "otp-specialist",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
    name: "OTP certificado",
    category: "champion",
    views: ["soloq", "flex"],
    evidence: "recorded_champion_share",
    availability: "observation_only",
    description: "Especialización observada en el historial importado, sin certificación anual.",
    provisionalConditions:
      "≥50 partidas y concentración ≥7/10. El nombre del catálogo no constituye una certificación de SoloQ ni de Riot.",
  },
];
export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze(
  definitions.map((definition) =>
    Object.freeze({ ...definition, views: Object.freeze(definition.views) }),
  ),
);
