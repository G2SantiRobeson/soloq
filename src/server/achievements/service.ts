import "server-only";
import { isDemo } from "@/server/env";
import {
  evaluateStoredAchievements,
  parseAchievementRequest,
  type AchievementReadResult,
} from "./evaluate";
/** RC2 public adapter: fictional reads only. Real evidence infrastructure is not promoted. */
export async function readPlayerAchievements(request: unknown): Promise<AchievementReadResult> {
  const parsed = parseAchievementRequest(request);
  if (!parsed.success) return { status: "invalid_request" };
  if (parsed.data.view === "5v5") return { status: "not_applicable" };
  if (!isDemo()) return { status: "unavailable" };
  const { demoAchievementReader } = await import("./demo");
  return evaluateStoredAchievements(demoAchievementReader, request, "fictitious");
}
