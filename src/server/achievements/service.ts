import "server-only";
import { isDemo } from "@/server/env";
import {
  evaluateStoredAchievements,
  parseAchievementRequest,
  type AchievementReadResult,
} from "./evaluate";

/** Internal only; no route, Server Action, grants, cache or write path. */
export async function readPlayerAchievements(request: unknown): Promise<AchievementReadResult> {
  const parsed = parseAchievementRequest(request);
  if (!parsed.success) return { status: "invalid_request" };
  if (parsed.data.view === "5v5") return { status: "not_applicable" };
  if (isDemo()) {
    const { demoAchievementReader } = await import("./demo");
    return evaluateStoredAchievements(demoAchievementReader, request, "fictitious");
  }
  try {
    const [{ db }, { achievementReader }] = await Promise.all([
      import("@/db"),
      import("./queries"),
    ]);
    return await evaluateStoredAchievements(achievementReader(db()), request);
  } catch {
    return { status: "unavailable" };
  }
}
