/** Conceptual catalog only. Never imported by the achievement evaluator. */
export const HALL_PROPOSALS = [
  {
    id: "intocable",
    version: "concept-v1",
    name: "El Intocable",
    category: "legendary",
    categoryName: "Legendarios",
    description: "Una racha que merece quedar en la memoria de la comunidad.",
    requirement:
      "15 victorias consecutivas verificadas en una sola modalidad. Umbral conceptual, no aprobado como regla activa.",
    evidence:
      "Resultados oficiales ordenados, timestamps y remakes validados; continuidad y exhaustividad del intervalo acreditadas.",
    coverage:
      "Una racha en la muestra importada no demuestra que no falten derrotas. No confundir la señal experimental de cinco victorias con esta propuesta.",
    feasibility:
      "Los registros actuales pueden mostrar una racha observada; no acreditan por sí solos una racha exhaustiva ni una concesión permanente.",
    infrastructure:
      "Verificador de cobertura, regla versionada aprobada, registro persistente e idempotente y evidencia inmutable.",
  },
  {
    id: "primero-de-su-nombre",
    version: "concept-v1",
    name: "El Primero de su Nombre",
    category: "pioneer",
    categoryName: "Récords y pioneros",
    description: "El primer nombre escrito cuando comienza una nueva historia.",
    requirement:
      "Primera acreditación válida de una hazaña concreta, después de activarse formalmente el sistema. Desempates, ámbito y momento de activación pendientes de aprobación.",
    evidence:
      "Registro autoritativo de activación y concesiones, orden de acreditación verificable y referencia a la hazaña acreditada.",
    coverage:
      "Ser el primero observado o importado no equivale al primero acreditado. No se reconstruye un pionero anterior al sistema.",
    feasibility:
      "No verificable con los datos actuales: todavía no existe un registro activo de acreditaciones.",
    infrastructure:
      "Activación auditada, ámbito de pionero y desempate definidos, transacción de asignación y ledger persistente.",
  },
  {
    id: "monarca",
    version: "concept-v1",
    name: "El Monarca",
    category: "permanent",
    categoryName: "Permanentes",
    description: "No basta con llegar al trono. Hay que sostenerlo.",
    requirement:
      "Liderazgo sostenido en una clasificación comunitaria y durante un período documentado. Duración, población, empates, frecuencia y tolerancia entre cortes pendientes de aprobación.",
    evidence:
      "Cortes completos de la clasificación oficial de la comunidad, misma plataforma/modalidad, integrantes elegibles e historial temporal reproducible.",
    coverage:
      "Snapshots aislados no acreditan liderazgo continuo entre cortes. No se reconstruyen LP desde partidas.",
    feasibility:
      "Puede observarse liderazgo en cortes existentes; aún no se prueba el período sostenido requerido ni la población histórica completa.",
    infrastructure:
      "Regla temporal aprobada, captura coherente de clasificación, membresía histórica de comunidad y registro de concesiones.",
  },
] as const;
export type HallProposalId = (typeof HALL_PROPOSALS)[number]["id"];
