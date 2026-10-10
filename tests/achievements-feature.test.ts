import { afterEach, describe, expect, it, vi } from "vitest";
import { achievementsExperimentalEnabled } from "@/server/achievements/feature";

afterEach(() => vi.unstubAllEnvs());
function environment(
  flag: string | undefined,
  node: string | undefined,
  vercel?: string,
  env?: string,
  target?: string,
) {
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", flag);
  vi.stubEnv("NODE_ENV", node);
  vi.stubEnv("VERCEL", vercel);
  vi.stubEnv("VERCEL_ENV", env);
  vi.stubEnv("VERCEL_TARGET_ENV", target);
}
describe("server-owned fail-closed experimental flag", () => {
  it.each([undefined, "", "false", "FALSE", "TRUE", "1", "unexpected", " true "])(
    "rejects %s",
    (flag) => {
      environment(flag, "development");
      expect(achievementsExperimentalEnabled()).toBe(false);
    },
  );
  it("allows only explicit true in local development", () => {
    environment("true", "development");
    expect(achievementsExperimentalEnabled()).toBe(true);
  });
  it("allows identified Vercel Preview even with NODE_ENV production", () => {
    environment("true", "production", "1", "preview", "preview");
    expect(achievementsExperimentalEnabled()).toBe(true);
  });
  it.each([
    ["production", "1", "production", "production"],
    ["development", "1", "production", undefined],
    ["production", "1", "preview", "production"],
    ["production", undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined],
    ["test", undefined, undefined, undefined],
    ["development", "1", undefined, undefined],
    ["development", undefined, "preview", undefined],
    ["production", "1", "preview", "custom"],
    ["development", "0", undefined, undefined],
    ["development", "1", "development", undefined],
  ])("rejects unsafe or unknown environment %o", (node, vercel, env, target) => {
    environment("true", node, vercel, env, target);
    expect(achievementsExperimentalEnabled()).toBe(false);
  });
});
