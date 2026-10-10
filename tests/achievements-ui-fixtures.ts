import { demoAchievementReader, ACHIEVEMENT_DEMO_PLAYER_ID } from "@/server/achievements/demo";
import {
  evaluateStoredAchievements,
  type AchievementReadResult,
} from "@/server/achievements/evaluate";
import { achievementPresentation } from "@/server/achievements/presentation";
import type { AchievementEvaluationStatus } from "@/lib/achievements";

export async function uiFixture(view: "soloq" | "flex" = "soloq", demo = true) {
  return evaluateStoredAchievements(
    demoAchievementReader,
    {
      playerId: ACHIEVEMENT_DEMO_PLAYER_ID,
      view,
      season: "2026",
      asOf: "2026-11-01T00:00:00Z",
    },
    demo ? "fictitious" : "stored_official",
  );
}
/** Visual-state fixture only. Does not grant or authenticate simulated input. */
export function withStatus(
  result: AchievementReadResult,
  status: AchievementEvaluationStatus,
): AchievementReadResult {
  if (result.status !== "available") throw new Error("Invalid UI fixture");
  if (status === "observed") return result;
  return {
    ...result,
    evaluations: result.evaluations.map((e) =>
      status === "invalid_input"
        ? { ...e, status, evidence: null, reasons: ["invalid_timestamp"] }
        : {
            ...e,
            status,
            reasons:
              status === "insufficient_evidence"
                ? ["unknown_remake", "unproven_interval"]
                : e.reasons,
          },
    ),
  };
}
export const uiPresentation = (result: AchievementReadResult) =>
  achievementPresentation(result, { "157": { name: "Yasuo", image: "/champ-icons/157.png" } });

/** Negative visual examples are evaluated from synthetic records, not relabelled grants. */
export async function uiStateFixture(
  status: AchievementEvaluationStatus,
  view: "soloq" | "flex" = "soloq",
) {
  const reader = {
    ...demoAchievementReader,
    async records(...args: Parameters<typeof demoAchievementReader.records>) {
      const records = await demoAchievementReader.records(...args);
      if (status === "insufficient_evidence")
        return { snapshots: records.snapshots.slice(0, 1), matches: records.matches.slice(0, 1) };
      if (status === "not_observed")
        return {
          snapshots: records.snapshots.map((s) => ({ ...s, leaguePoints: 80 })),
          matches: records.matches.map((m, i) => ({
            ...m,
            win: i % 2 === 0,
            championId: i % 2 ? 99 : 157,
          })),
        };
      if (status === "invalid_input")
        return {
          snapshots: records.snapshots.map((s) => ({ ...s, timestamp: "invalid" })),
          matches: records.matches.map((m) => ({ ...m, timestamp: "invalid" })),
        };
      return records;
    },
  };
  return evaluateStoredAchievements(
    reader,
    { playerId: ACHIEVEMENT_DEMO_PLAYER_ID, view, season: "2026", asOf: "2026-11-01T00:00:00Z" },
    "fictitious",
  );
}
