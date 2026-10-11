import "server-only";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_REASON_TEXT,
  type AchievementEvaluation,
} from "@/lib/achievements";
import {
  ACHIEVEMENT_STATUS_TEXT,
  type AchievementDisplay,
  type AchievementPresentation,
} from "@/lib/achievements/presentation";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { rankLabel } from "@/lib/ranking";
import type { AchievementReadResult } from "./evaluate";
import { countLabel } from "@/lib/format";

function display(
  evaluation: AchievementEvaluation,
  champions: ChampionCatalog,
): AchievementDisplay {
  const definition = ACHIEVEMENTS.find((d) => d.code === evaluation.code)!;
  const e = evaluation.evidence;
  let measurement: string | null = null;
  let specialization: AchievementDisplay["specialization"] = null;
  const evidence: AchievementDisplay["evidence"] = [];
  let conditions = definition.provisionalConditions;
  if (e) {
    evidence.push({ label: "Desde (UTC)", value: e.from }, { label: "Hasta (UTC)", value: e.to });
    if (e.kind === "rank_recovery") {
      measurement = `${rankLabel(e.before)} · ${e.before.leaguePoints} LP → ${e.minimum.leaguePoints} LP → ${e.recovered.leaguePoints} LP`;
      evidence.push(
        { label: "Caída observada", value: `${e.dropLp} LP` },
        { label: "Observaciones oficiales utilizadas", value: String(e.observationCount) },
        { label: "Límite", value: "No se conoce la trayectoria intermedia completa." },
      );
      conditions = `Caída ≥${e.rule.minDropLp} LP; recuperación ≤${e.rule.maxRecoveryMs / 86400000} días; huecos ≤${e.rule.maxGapMs / 86400000} días, misma división.`;
    } else if (e.kind === "recorded_win_streak") {
      measurement = `Racha observada de ${e.maxObservedWins} ${e.maxObservedWins === 1 ? "victoria" : "victorias"}`;
      evidence.push(
        { label: "Partidas utilizadas", value: String(e.matchIds.length) },
        { label: "IDs de evidencia (hasta 20)", value: e.matchIds.slice(0, 20).join(", ") },
        { label: "Remakes confirmados intercalados", value: String(e.ignoredRemakeIds.length) },
        { label: "Límite", value: "No acredita ausencia de partidas no recuperadas." },
      );
      conditions = `≥${e.rule.minWins} victorias en la secuencia registrada de una cola.`;
    } else {
      const name = championAsset(e.championId, `Campeón #${e.championId}`, champions).name;
      const share = ((100 * e.championGames) / e.validGames).toLocaleString("es-CL", {
        maximumFractionDigits: 2,
      });
      measurement = `${name} · ${e.championGames} / ${e.validGames} partidas · ${share} % de la muestra importada`;
      specialization = {
        championId: e.championId,
        champion: name,
        games: e.championGames,
        sample: e.validGames,
        share,
      };
      evidence.push(
        { label: "Proporción exacta", value: `${e.share.numerator} / ${e.share.denominator}` },
        { label: "Límite", value: "Especialización provisional; no certificación anual." },
      );
      conditions = `≥${e.rule.minGames} partidas; proporción ≥${e.rule.minShare.numerator}/${e.rule.minShare.denominator}.`;
    }
  }
  return {
    code: evaluation.code,
    // Keep the catalogue identity but do not imply that provisional OTP is certified.
    name: evaluation.code === "otp-specialist" ? "OTP · muestra importada" : definition.name,
    description:
      evaluation.code === "resurrection"
        ? "Recuperación observada entre verificaciones oficiales."
        : evaluation.code === "unstoppable"
          ? "Racha observada en partidas importadas; evaluación independiente del premio comunitario Imparable."
          : "Especialización en muestra importada.",
    status: evaluation.status,
    statusText: ACHIEVEMENT_STATUS_TEXT[evaluation.status],
    measurement,
    specialization,
    reasons: evaluation.reasons.map((reason) => ACHIEVEMENT_REASON_TEXT[reason]),
    evidence,
    ruleVersion: evaluation.ruleVersion,
    conditions,
    certification: "not_established",
    grantAuthorized: false,
  };
}
const errors = {
  invalid_request: "El ámbito solicitado no es válido o la temporada no está soportada.",
  not_found: "No se encontró el jugador solicitado.",
  ineligible: "Jugador pausado: evaluación no disponible.",
  not_applicable: "Los logros ranked no aplican al ámbito combinado 5v5.",
  unavailable: "La lectura de evidencia no está disponible. No se evaluaron logros.",
  invalid_data: "El contexto del jugador no permite una evaluación segura.",
};
/** Called only with server evaluations, never browser-submitted achievement objects. */
export function achievementPresentation(
  result: AchievementReadResult,
  champions: ChampionCatalog = {},
): AchievementPresentation {
  if (result.status !== "available")
    return { status: result.status, message: errors[result.status] };
  const c = result.coverage;
  const coverageDetails = [
    `${countLabel(c.storedMatches, "partida", "partidas")} y ${c.storedSnapshots} snapshots almacenados en esta cola y ventana.`,
    "Cobertura exhaustiva no acreditada; los registros disponibles no prueban todo el historial de Riot.",
    `Última cobertura reciente: ${c.recentCoveredUntil ?? "desconocida"}.`,
    `Última verificación de rango: ${c.rankCheckedAt ?? "desconocida"}.`,
  ];
  if (c.importCounters)
    coverageDetails.push(
      `Importación del jugador, todas las colas: ${c.importCounters.processed} IDs procesados, ${c.importCounters.discovered} descubiertos y ${c.importCounters.unavailable} detalles no disponibles. No es un porcentaje de temporada.`,
    );
  if (
    c.importCounters &&
    (c.importCounters.processed > c.importCounters.discovered ||
      c.importCounters.unavailable > c.importCounters.processed ||
      (c.historyStatus === "completed" &&
        c.importCounters.processed !== c.importCounters.discovered))
  )
    coverageDetails.push(
      "Los contadores de importación no concuerdan con el estado informado; la cobertura debe revisarse. No se acredita una muestra completa.",
    );
  return {
    status: "available",
    demo: result.source === "fictitious",
    mode: result.scope.view === "soloq" ? "SoloQ" : "Flex",
    season: result.scope.season.id,
    from: result.scope.season.startAt,
    to: new Date(
      Math.min(
        Date.parse(result.scope.asOf),
        result.scope.season.endAt === null ? Infinity : Date.parse(result.scope.season.endAt),
      ),
    ).toISOString(),
    sourceText:
      result.source === "fictitious"
        ? "Demo · evidencia ficticia"
        : "Registros almacenados por SoloQ",
    coverageText:
      c.historyStatus === "completed"
        ? c.availability === "partial"
          ? "Historial marcado como completado; muestra parcial, exhaustividad no acreditada"
          : "Historial disponible importado; exhaustividad no acreditada"
        : c.historyStatus === "unknown"
          ? "Cobertura histórica desconocida"
          : c.historyStatus === "failed"
            ? "Importación interrumpida; muestra parcial"
            : c.historyStatus === "not_started"
              ? "Importación histórica pendiente"
              : "Importación en curso; muestra parcial",
    coverageDetails,
    items: result.evaluations.map((e) => display(e, champions)),
  };
}
