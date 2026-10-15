import type { AchievementReason } from "./types";

/** Presentation is separate from evaluation; machine reasons remain stable. */
export const ACHIEVEMENT_REASON_TEXT: Readonly<Record<AchievementReason, string>> = {
  invalid_input: "La entrada no cumple el contrato del motor.",
  invalid_rule: "La configuración de la regla no es válida.",
  invalid_scope: "Los límites temporales o el ámbito no son válidos.",
  invalid_timestamp: "Una fecha no representa un instante ISO con zona horaria.",
  invalid_rank: "Una observación de rango contiene valores inválidos.",
  invalid_champion: "Falta una identidad válida de campeón.",
  unknown_queue: "Una cola no pertenece al catálogo admitido.",
  unsupported_view: "Los logros ranked no combinan el ámbito 5v5.",
  conflicting_duplicate: "Un identificador tiene registros contradictorios.",
  duplicate_record: "Se ignoraron copias idénticas de un mismo registro.",
  ambiguous_timestamp: "Hay registros distintos en un mismo instante y su orden es ambiguo.",
  queue_mismatch: "Se excluyeron registros de otra cola.",
  outside_window: "Se excluyeron registros fuera de los límites de temporada y observación.",
  insufficient_sample: "La muestra examinada no alcanza el mínimo de la regla.",
  no_matching_event: "La condición no se observó en los datos examinados.",
  unknown_remake: "Hay partidas cuya clasificación de remake es desconocida.",
  unknown_result: "Hay partidas sin resultado conocido.",
  counter_reset: "Los contadores oficiales disminuyen y cortan el segmento.",
  non_comparable_rank: "Un cambio de tier o división corta el segmento.",
  unranked: "Una observación Unranked corta el segmento.",
  snapshot_gap: "El intervalo entre observaciones supera el límite permitido.",
  incomplete_history:
    "El historial no figura como completado; la interpretación se limita a registros disponibles.",
  unavailable_matches: "Existen detalles de partidas no disponibles.",
  unproven_interval: "No hay una prueba de cobertura exhaustiva del intervalo.",
  limited_profile_window: "La entrada contiene solo la ventana reciente del perfil.",
  provisional_rule: "Los parámetros son provisionales y no autorizan una concesión.",
  unobserved_rank_path:
    "Los snapshots muestran observaciones, no la trayectoria exacta entre ellas.",
};
