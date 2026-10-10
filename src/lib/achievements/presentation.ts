import type { AchievementCode, AchievementEvaluationStatus } from "./types";

/** Display-only, serializable and bounded; no player identity or unfiltered input. */
export type AchievementDisplay = {
  code: AchievementCode;
  name: string;
  description: string;
  status: AchievementEvaluationStatus;
  statusText: string;
  measurement: string | null;
  reasons: string[];
  evidence: { label: string; value: string }[];
  ruleVersion: string;
  conditions: string;
  certification: "not_established";
  grantAuthorized: false;
};
export type AchievementPresentation =
  | {
      status: "available";
      demo: boolean;
      mode: "SoloQ" | "Flex";
      season: string;
      from: string;
      to: string;
      sourceText: string;
      coverageText: string;
      coverageDetails: string[];
      items: AchievementDisplay[];
    }
  | {
      status:
        | "invalid_request"
        | "not_found"
        | "ineligible"
        | "not_applicable"
        | "unavailable"
        | "invalid_data";
      message: string;
    };

export const ACHIEVEMENT_STATUS_TEXT: Record<AchievementEvaluationStatus, string> = {
  observed: "Condición observada en los datos registrados",
  not_observed: "No observado en los registros disponibles",
  insufficient_evidence: "Datos insuficientes para determinarlo",
  invalid_input: "Datos no válidos para evaluar",
};
