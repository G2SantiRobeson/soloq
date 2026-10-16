import type { View } from "../queues";
import type { AchievementDefinition } from "./types";
import type { AchievementDisplay, AchievementPresentation } from "./presentation";

export const ACHIEVEMENT_CATEGORIES: readonly {
  code: AchievementDefinition["category"];
  name: string;
  description: string;
}[] = [
  {
    code: "progression",
    name: "Evolución",
    description: "Cambios respaldados por snapshots de rango.",
  },
  {
    code: "performance",
    name: "Rendimiento",
    description: "Secuencias de resultados registrados.",
  },
  { code: "champion", name: "Campeones", description: "Especialización en la muestra importada." },
];
export type AchievementExperienceState = {
  kind:
    | "observed"
    | "pending"
    | "insufficient"
    | "invalid"
    | "disabled"
    | "unselected"
    | "unavailable"
    | "not_applicable";
  label: string;
  explanation: string;
};
/** Display-only mapping. Never turns an observation into an earned badge or a grant. */
export function achievementExperienceState(
  item: AchievementDisplay | undefined,
  presentation: AchievementPresentation | null,
  context: { enabled: boolean; selected: boolean; view: View },
): AchievementExperienceState {
  if (context.view === "5v5")
    return {
      kind: "not_applicable",
      label: "No aplicable",
      explanation: "Esta regla se evalúa por separado en SoloQ o Flex; no combina 5v5.",
    };
  if (!context.enabled)
    return {
      kind: "disabled",
      label: "Evaluación desactivada",
      explanation:
        "La regla está implementada como experimental. El catálogo está disponible; no se evaluó al jugador.",
    };
  if (!context.selected)
    return {
      kind: "unselected",
      label: "Sin jugador consultado",
      explanation: "Abre el centro desde un perfil para consultar su evidencia.",
    };
  if (!presentation || presentation.status !== "available" || !item)
    return {
      kind: "unavailable",
      label: "No evaluable",
      explanation:
        presentation && presentation.status !== "available"
          ? presentation.message
          : "No hay una evaluación disponible para esta regla.",
    };
  if (item.status === "observed")
    return {
      kind: "observed",
      label: "Condición observada",
      explanation:
        "La condición está respaldada por los registros examinados. Sin certificación ni concesión permanente.",
    };
  if (item.status === "not_observed")
    return {
      kind: "pending",
      label: "No observado",
      explanation:
        "La condición no se observó en la muestra examinada. No significa que nunca haya ocurrido.",
    };
  if (item.status === "invalid_input")
    return {
      kind: "invalid",
      label: "Datos no válidos",
      explanation:
        "Los datos no cumplen el contrato de evaluación. No se presenta como un logro pendiente.",
    };
  return {
    kind: "insufficient",
    label: "Datos insuficientes",
    explanation: "Falta evidencia suficiente para determinar si se cumple la condición.",
  };
}
export const achievementDisplayName = (definition: AchievementDefinition) =>
  definition.code === "otp-specialist" ? "OTP · muestra importada" : definition.name;
export function achievementCenterHref(playerId: string, view: View) {
  return "/logros?" + new URLSearchParams({ queue: view, player: playerId });
}
