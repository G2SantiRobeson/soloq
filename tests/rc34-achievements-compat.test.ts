import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPlayerAchievements } from "@/server/achievements/service";
import { profileAchievementPresentation } from "@/server/achievements/profile";
import {
  achievementExperienceEnabled,
  achievementsExperimentalEnabled,
} from "@/server/achievements/feature";
import type { AchievementReadResult } from "@/server/achievements/evaluate";
const io = vi.hoisted(() => ({ db: vi.fn(), reader: vi.fn(), evaluate: vi.fn() }));
vi.mock("@/db", () => ({ db: io.db }));
vi.mock("@/server/achievements/queries", () => ({ consistentAchievementReader: io.reader }));
vi.mock("@/server/achievements/evaluate", async (original) => ({
  ...(await original<typeof import("@/server/achievements/evaluate")>()),
  evaluateStoredAchievements: io.evaluate,
}));
const request = {
  playerId: "11111111-1111-4111-8111-111111111111",
  view: "soloq",
  season: "2026",
  asOf: "2026-10-15T00:00:00Z",
};
beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("NODE_ENV", "development");
  for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "ACHIEVEMENTS_EXPERIMENTAL"])
    vi.stubEnv(key, undefined);
  vi.clearAllMocks();
  io.db.mockReset().mockReturnValue({ fixture: "database" });
  io.reader.mockReset().mockReturnValue({ fixture: "consistent-reader" });
  io.evaluate.mockReset().mockResolvedValue({ status: "not_found" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("RC3 integration preserves achievement contracts", () => {
  it("Demo enables presentation in Production without enabling real experiments or opening the database", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    expect(achievementExperienceEnabled()).toBe(true);
    expect(achievementsExperimentalEnabled()).toBe(false);
    expect(await readPlayerAchievements(request)).toEqual({ status: "not_found" });
    expect(io.evaluate.mock.calls[0][2]).toBe("fictitious");
    expect(io.db).not.toHaveBeenCalled();
    expect(io.reader).not.toHaveBeenCalled();
  });
  it.each(["not_found", "ineligible", "invalid_data", "unavailable"] as const)(
    "operational service preserves %s and the consistent reader",
    async (status) => {
      const result: AchievementReadResult = { status };
      io.evaluate.mockResolvedValue(result);
      expect(await readPlayerAchievements(request)).toBe(result);
      expect(io.db).toHaveBeenCalledOnce();
      expect(io.reader).toHaveBeenCalledWith({ fixture: "database" });
      expect(io.evaluate).toHaveBeenCalledWith({ fixture: "consistent-reader" }, request);
    },
  );
  it("preserves unavailable and sanitised diagnostics after a database error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    io.db.mockImplementation(() => {
      throw Error("private-connection-payload");
    });
    expect(await readPlayerAchievements(request)).toEqual({ status: "unavailable" });
    expect(io.evaluate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[achievements] service:unexpected");
  });
  it("rejects invalid and 5v5 requests before invoking either reader", async () => {
    expect(await readPlayerAchievements({})).toEqual({ status: "invalid_request" });
    expect(await readPlayerAchievements({ ...request, view: "5v5" })).toEqual({
      status: "not_applicable",
    });
    expect(io.db).not.toHaveBeenCalled();
    expect(io.evaluate).not.toHaveBeenCalled();
  });
  it("disabled operational presentation performs no read", async () => {
    expect(
      await profileAchievementPresentation(request.playerId, "soloq", request.asOf, {}),
    ).toBeNull();
    expect(io.db).not.toHaveBeenCalled();
    expect(io.evaluate).not.toHaveBeenCalled();
  });
  it.each(["not_found", "ineligible", "invalid_data", "unavailable"] as const)(
    "enabled operational UI receives the existing %s presentation",
    async (status) => {
      vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
      io.evaluate.mockResolvedValue({ status });
      const result = await profileAchievementPresentation(
        request.playerId,
        "soloq",
        request.asOf,
        {},
      );
      expect(result?.status).toBe(status);
      expect(result).toHaveProperty("message");
      expect(io.db).toHaveBeenCalledOnce();
    },
  );
  it("a flag cannot activate real experiments in Production", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(achievementExperienceEnabled()).toBe(false);
    expect(
      await profileAchievementPresentation(request.playerId, "soloq", request.asOf, {}),
    ).toBeNull();
    expect(io.db).not.toHaveBeenCalled();
  });
});
