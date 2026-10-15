import { MAX_RANK_INTERVAL_MS } from "../rank-trajectory";
import type {
  AchievementDefinition,
  AchievementRuleVersion,
  OtpRule,
  ResurrectionRule,
  UnstoppableRule,
} from "./types";

export const ACHIEVEMENT_RULE_VERSION: AchievementRuleVersion = "1.1.A-observed-v1";
export const OTP_RULE_VERSION: AchievementRuleVersion = "1.1-otp-observed-v2";
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
  version: OTP_RULE_VERSION,
  minGames: 50,
  minShare: Object.freeze({ numerator: 13, denominator: 20 }),
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
      "Caída observada ≥50 LP; recuperación hasta alcanzar o superar el nivel inicial en ≤30 días desde la observación previa a la caída, no desde el mínimo. Mismo tier y división; huecos ≤7 días entre snapshots oficiales comparables. Contadores no decrecientes, derrotas durante la caída y victorias durante la recuperación. No acredita la trayectoria intermedia.",
  },
  {
    code: "unstoppable",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
    name: "Racha imparable",
    category: "performance",
    views: ["soloq", "flex"],
    evidence: "recorded_win_streak",
    availability: "observation_only",
    description:
      "Señal individual experimental de victorias observadas en las partidas importadas de una modalidad.",
    provisionalConditions:
      "≥5 victorias consecutivas en las partidas registradas de esta modalidad. Remakes confirmados se ignoran; derrotas registradas cortan la racha. Resultados o remakes desconocidos y fechas ambiguas interrumpen la evidencia. No acredita ausencia de partidas no importadas; la señal puede cambiar con nuevos registros. Sin concesión permanente.",
  },
  {
    code: "otp-specialist",
    ruleVersion: OTP_RULE_VERSION,
    name: "OTP certificado",
    category: "champion",
    views: ["soloq", "flex"],
    evidence: "recorded_champion_share",
    availability: "observation_only",
    description: "Especialización observada en el historial importado, sin certificación anual.",
    provisionalConditions:
      "≥50 partidas válidas y concentración ≥65 % (13/20). El nombre del catálogo no constituye una certificación de SoloQ ni de Riot.",
  },
];
export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze(
  definitions.map((definition) =>
    Object.freeze({ ...definition, views: Object.freeze(definition.views) }),
  ),
);
