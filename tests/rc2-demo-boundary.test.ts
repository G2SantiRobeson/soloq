import { afterEach, expect, it, vi } from "vitest";
import {
  achievementsExperimentalEnabled,
  achievementExperienceEnabled,
} from "@/server/achievements/feature";
import { readPlayerAchievements } from "@/server/achievements/service";
import { getAssets } from "@/server/riot/assets";
import { profileIconAsset } from "@/lib/profile-icon";
vi.mock("next/cache", () => ({ unstable_cache: (f: unknown) => f }));
vi.mock("postgres", () => ({
  default: () => {
    throw Error("FORBIDDEN_DATABASE");
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("public production Demo has fictional experience without activating real experiments", async () => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
  expect(achievementsExperimentalEnabled()).toBe(false);
  expect(achievementExperienceEnabled()).toBe(true);
  const result = await readPlayerAchievements({
    playerId: "123e4567-e89b-42d3-a456-426614174000",
    view: "soloq",
    season: "2026",
    asOf: "2026-10-15T00:00:00Z",
  });
  expect(result.status).not.toBe("unavailable");
});
it("Production presentation stays gated and the operational reader fails closed on connection errors", async () => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(achievementExperienceEnabled()).toBe(false);
  const result = await readPlayerAchievements({
    playerId: "123e4567-e89b-42d3-a456-426614174000",
    view: "soloq",
    season: "2026",
    asOf: "2026-10-15T00:00:00Z",
  });
  expect(result.status).toBe("unavailable");
});
it("Demo artwork resolves locally without fetching Data Dragon", async () => {
  vi.stubEnv("DEMO_MODE", "true");
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("FORBIDDEN_NETWORK"));
  const assets = await getAssets();
  expect(assets.version).toBe("local-demo");
  expect(Object.values(assets.champions).every((c) => c.image.startsWith("/champ-icons/"))).toBe(
    true,
  );
  expect(profileIconAsset(assets.version, 29)).toBe("/champ-icons/29.png");
  expect(profileIconAsset(assets.version, 999999)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
