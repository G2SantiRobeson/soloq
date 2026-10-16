import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { getProfileRivalPool, getProfileRival, PROFILE_RIVAL_LIMIT } from "@/server/profile-rival";
const state = vi.hoisted(() => ({
  selects: 0,
  executions: 0,
  limits: [] as number[],
  rows: [] as Record<string, unknown>[],
}));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => {
      state.selects++;
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        as: () => chain,
        limit: async (n: number) => {
          state.executions++;
          state.limits.push(n);
          return state.rows;
        },
      };
      return chain;
    },
  }),
}));
const asOf = "2026-10-14T12:00:00Z";
const row = (id: string, lp = 50) => ({
  id,
  gameName: id,
  tagLine: "LAS",
  platform: "LA2",
  profileIconId: null,
  tier: "DIAMOND",
  division: "I",
  leaguePoints: lp,
  wins: 20,
  losses: 10,
});
beforeEach(() => {
  state.selects = 0;
  state.executions = 0;
  state.limits = [];
  state.rows = [];
  vi.stubEnv("DEMO_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());
describe("bounded rank-only profile rival read without real SQL", () => {
  it.each([2, 200])("one statement regardless of %i candidates", async (count) => {
    state.rows = Array.from({ length: count }, (_, i) => row("p" + i));
    const pool = await getProfileRivalPool("soloq", "LA2", asOf);
    expect(pool).toHaveLength(count);
    expect(state.executions).toBe(1);
    expect(state.selects).toBe(2);
    expect(state.limits).toEqual([PROFILE_RIVAL_LIMIT + 1]);
    expect(Object.keys(pool![0]).sort()).toEqual(
      ["id", "gameName", "tagLine", "platform", "profileIconId", "observedAt", "rank"].sort(),
    );
  });
  it("does not assign a nearest player from a truncated pool", async () => {
    state.rows = Array.from({ length: PROFILE_RIVAL_LIMIT + 1 }, (_, i) => row("p" + i));
    expect(await getProfileRivalPool("soloq", "LA2", asOf)).toBeNull();
  });
  it("does not read ranks for 5v5 or invalid reference", async () => {
    expect(await getProfileRivalPool("5v5", "LA2", asOf)).toEqual([]);
    expect(await getProfileRivalPool("soloq", "LA2", "bad")).toBeNull();
    expect(state.executions).toBe(0);
  });
  it("rejects rank mismatch instead of mixing two readings", async () => {
    state.rows = [row("me", 55), row("other", 60)];
    const result = await getProfileRival(
      {
        id: "me",
        gameName: "me",
        tagLine: "LAS",
        platform: "LA2",
        profileIconId: null,
        observedAt: asOf,
        rank: { tier: "DIAMOND", division: "I", leaguePoints: 50, wins: 20, losses: 10 },
      },
      "soloq",
    );
    expect(result.status).toBe("changed");
  });
  it("Demo does not instantiate a SQL client", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const pool = await getProfileRivalPool("soloq", "LA2", asOf);
    expect(pool!.some((p) => p.id === "demo-4")).toBe(true);
    expect(state.selects).toBe(0);
  });
});
