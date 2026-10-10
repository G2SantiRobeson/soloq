import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_REASON_TEXT,
  currentAchievementScope,
  evaluateOtpSpecialist,
  evaluateResurrection,
  evaluateUnstoppable,
  historyCoverage,
  matchInput,
  snapshotInput,
  RESURRECTION_RULE,
} from "@/lib/achievements";
import type { RecentMatch } from "@/lib/types";
import {
  coverage,
  fixedScope,
  match,
  matchContext,
  otpMatches,
  rankInput,
  snapshot,
} from "./achievements-fixtures";

describe("achievement boundaries, adapters and safety", () => {
  it("catalog remains separate from awards and permanently unavailable for grants", () => {
    expect(ACHIEVEMENTS.map((d) => d.code)).toEqual([
      "resurrection",
      "unstoppable",
      "otp-specialist",
    ]);
    expect(ACHIEVEMENTS.map((d) => d.name)).toEqual([
      "Resurrección",
      "Imparable",
      "OTP certificado",
    ]);
    expect(
      ACHIEVEMENTS.every((d) => d.availability === "observation_only" && d.views.length === 2),
    ).toBe(true);
    expect(ACHIEVEMENTS.find((d) => d.code === "otp-specialist")?.description).toContain(
      "sin certificación anual",
    );
  });
  it("reuses regional season boundaries with an explicit asOf", () => {
    const las = currentAchievementScope("soloq", "LA2", fixedScope.asOf);
    const kr = currentAchievementScope("flex", "KR", fixedScope.asOf);
    expect(las.season.startAt).toBe("2026-01-08T15:00:00.000Z");
    expect(kr.season.startAt).toBe("2026-01-08T03:00:00.000Z");
    expect(las.asOf).toBe(fixedScope.asOf);
    expect(kr.view).toBe("flex");
  });
  it("evaluates regional start boundaries rather than one universal UTC start", () => {
    const rows = [match(0, { timestamp: "2026-01-08T10:00:00Z" })];
    const rule = { version: RESURRECTION_RULE.version, minWins: 1 };
    for (const platform of ["LA2", "KR"] as const) {
      const scope = currentAchievementScope("soloq", platform, "2026-01-09T00:00:00Z");
      expect(evaluateUnstoppable({ ...matchContext(rows), scope }, rule).status).toBe(
        platform === "KR" ? "observed" : "insufficient_evidence",
      );
    }
  });
  it("duplicates alone never lift an insufficient sample over any threshold", () => {
    const wins = [match(0), match(1), match(2), match(3)];
    expect(evaluateUnstoppable(matchContext([...wins, wins[0]])).status).toBe(
      "insufficient_evidence",
    );
    const pool = otpMatches(49, 49);
    expect(evaluateOtpSpecialist(matchContext([...pool, pool[0]])).status).toBe(
      "insufficient_evidence",
    );
    const ranks = [snapshot(80, 0), snapshot(25, 1)];
    expect(evaluateResurrection(rankInput([...ranks, ranks[1]])).status).toBe(
      "insufficient_evidence",
    );
  });
  it.each([evaluateResurrection, evaluateUnstoppable, evaluateOtpSpecialist])(
    "rejects unsupported, malformed or empty temporal scopes",
    (evaluate) => {
      const input = { ...rankInput(), ...matchContext(otpMatches()) };
      for (const scope of [
        { ...fixedScope, view: "5v5" },
        { ...fixedScope, platform: "OTHER" },
        { ...fixedScope, asOf: fixedScope.season.startAt },
        { ...fixedScope, season: { ...fixedScope.season, endAt: fixedScope.season.startAt } },
      ]) {
        expect(evaluate({ ...input, scope }).status).toBe("invalid_input");
      }
      expect(evaluate(null).status).toBe("invalid_input");
      expect(evaluate({}).status).toBe("invalid_input");
    },
  );
  it("keeps season start inclusive and season/asOf end exclusive, including offset timestamps", () => {
    const start = fixedScope.season.startAt;
    const scope = {
      ...fixedScope,
      asOf: "2026-01-09T15:00:00Z",
      season: { ...fixedScope.season, endAt: "2026-01-09T15:00:00Z" },
    };
    const rows = [
      match(0, { timestamp: start }),
      match(1, { timestamp: "2026-01-08T12:01:00-03:00" }),
      match(2, { timestamp: scope.asOf }),
      match(3, { timestamp: "2026-01-08T14:59:59Z" }),
    ];
    expect(
      evaluateUnstoppable(
        { ...matchContext(rows), scope },
        { version: RESURRECTION_RULE.version, minWins: 2 },
      ),
    ).toMatchObject({
      status: "observed",
      evidence: { matchIds: ["fictitious-0", "fictitious-1"] },
    });
  });
  it("snapshot adapter preserves real IDs and queue provenance, never rewriting a conflicting queue", () => {
    const row = snapshot(80, 0);
    expect(snapshotInput(row, "RANKED_FLEX_SR")).toEqual(row);
    const { id, queue, ...anonymous } = row;
    expect(id).toBe("snapshot-0");
    expect(queue).toBe("RANKED_SOLO_5x5");
    expect(snapshotInput(anonymous, "RANKED_FLEX_SR")).toEqual({
      ...anonymous,
      queue: "RANKED_FLEX_SR",
    });
  });
  it("recent match adapter keeps missing remake classification unknown and removes unnecessary fields", () => {
    const row: RecentMatch = {
      ...match(0),
      win: true,
      championId: 157,
      isRemake: undefined,
      champion: "Fictitious",
      position: "MIDDLE",
      kills: 1,
      deaths: 2,
      assists: 3,
      cs: 100,
      duration: 1200,
      damage: 10000,
      killParticipation: null,
    };
    expect(matchInput(row)).toEqual({
      matchId: row.matchId,
      queueId: 420,
      timestamp: row.timestamp,
      win: true,
      championId: 157,
      isRemake: null,
    });
  });
  it("completed metadata and a forty-game profile window cannot manufacture interval proof", () => {
    const history = {
      season: "2026",
      status: "completed" as const,
      processed: 100,
      discovered: 100,
      unavailable: 0,
      completedAt: fixedScope.asOf,
    };
    expect(historyCoverage(history, "2026", "profile_recent_window")).toEqual({
      ...coverage,
      source: "profile_recent_window",
      historyStatus: "completed",
    });
    expect(historyCoverage(history, "2025", "imported_history").historyStatus).toBe("unknown");
    expect(historyCoverage(undefined, "2026", "imported_history").unavailable).toBeNull();
    const result = evaluateOtpSpecialist({
      ...matchContext(otpMatches(40, 40)),
      coverage: historyCoverage(history, "2026", "profile_recent_window"),
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("limited_profile_window");
  });
  it.each([evaluateUnstoppable, evaluateOtpSpecialist])(
    "rejects fabricated coverage certificates",
    (evaluate) => {
      expect(
        evaluate({
          ...matchContext(otpMatches()),
          coverage: { ...coverage, intervalCoverage: "certified" },
        }).status,
      ).toBe("invalid_input");
    },
  );
  it.each([
    [evaluateResurrection, rankInput(), { ...RESURRECTION_RULE, minDropLp: NaN }],
    [evaluateUnstoppable, matchContext([]), { version: "v999", minWins: 5 }],
    [
      evaluateOtpSpecialist,
      matchContext([]),
      {
        version: RESURRECTION_RULE.version,
        minGames: 50,
        minShare: { numerator: 2, denominator: 1 },
      },
    ],
    [
      evaluateOtpSpecialist,
      matchContext([]),
      {
        version: RESURRECTION_RULE.version,
        minGames: 50,
        minShare: { numerator: 0, denominator: 0 },
      },
    ],
  ] as const)("rejects invalid or unsupported rule configurations", (evaluate, input, rule) => {
    const result = evaluate(input, rule);
    expect(result.status).toBe("invalid_input");
    expect(result.reasons).toContain("invalid_rule");
  });
  it("strips unrelated personal data and produces no timestamps beyond evidence or explicit bounds", () => {
    const input = {
      ...rankInput(),
      puuid: "PRIVATE_SENTINEL",
      apiKey: "PRIVATE_SENTINEL",
      snapshots: rankInput().snapshots.map((s) => ({ ...s, puuid: "PRIVATE_SENTINEL" })),
    };
    const result = evaluateResurrection(input);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    if (result.status !== "observed") throw new Error("Expected fictitious recovery");
    expect(result.evidence.observations.map((s) => s.timestamp)).toEqual(
      input.snapshots.map((s) => s.timestamp),
    );
    expect(result).not.toHaveProperty("earnedAt");
    expect(result).not.toHaveProperty("detectedAt");
  });
  it("all reasons have interpretation text; no environment, IO, clock or service imports in the new domain", () => {
    for (const file of readdirSync("src/lib/achievements").filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(`src/lib/achievements/${file}`, "utf8");
      expect(source).not.toMatch(
        /process\.env|Date\.now\s*\(|Math\.random\s*\(|console\.|fetch\s*\(/,
      );
      expect(source).not.toMatch(/from ["'](?:next|react|postgres|drizzle|node:|@\/server|@\/db)/);
    }
    for (const result of [
      evaluateResurrection(rankInput()),
      evaluateOtpSpecialist(matchContext([])),
      evaluateUnstoppable({}),
    ]) {
      expect(result.reasons).toEqual([...new Set(result.reasons)].sort());
      for (const reason of result.reasons) expect(ACHIEVEMENT_REASON_TEXT[reason]).toBeTruthy();
    }
  });
});
