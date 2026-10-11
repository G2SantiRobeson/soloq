import { describe, expect, it } from "vitest";
import { evaluateResurrection, RESURRECTION_RULE } from "@/lib/achievements";
import { referenceResurrection } from "./achievements-resurrection-reference";
import { deepFreeze, rankInput, shuffle, snapshot, DAY, fixedScope } from "./achievements-fixtures";
import { recoveryDataset, recoveryScenarios } from "./achievements-resurrection-datasets";

function equivalent(input: unknown, rule: unknown = RESURRECTION_RULE) {
  const frozen = deepFreeze(input);
  const result = evaluateResurrection(frozen, rule);
  // Full contract: reasons, scope, rules, IDs, all intermediate observations, ties and timestamps.
  expect(result).toEqual(referenceResurrection(frozen, rule));
  expect(result.certification).toBe("not_established");
  expect(result.grantAuthorized).toBe(false);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
}
describe("full-result equivalence against the frozen 1.1.C evaluator", () => {
  it.each(recoveryScenarios)("preserves %s scenarios and input permutations", (scenario) => {
    const rows = recoveryDataset(100, scenario);
    for (const seed of [0, 13, 913]) equivalent(rankInput(shuffle(rows, seed)));
  });
  it("preserves 1,200 seeded adversarial histories, ties, barriers, duplicates and windows", () => {
    let state = 73013;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (let trial = 0; trial < 1200; trial++) {
      let wins = 20,
        losses = 10;
      const rows = Array.from({ length: 3 + (next() % 40) }, (_, i) => {
        wins += next() % 3 === 0 ? 1 : 0;
        losses += next() % 3 === 0 ? 1 : 0;
        const row = snapshot(next() % 101, i * (trial % 4 ? 0.5 : 8), {
          id: `row-${i}`,
          wins,
          losses,
        });
        if (trial % 7 === 0 && i % 9 === 0) row.division = "II";
        if (trial % 11 === 0 && i % 8 === 0) row.losses = 0;
        if (trial % 13 === 0 && i % 5 === 0) row.tier = "UNRANKED";
        if (trial % 17 === 0 && i % 5 === 0) row.queue = "RANKED_FLEX_SR";
        if (trial % 19 === 0 && i % 7 === 0) row.leaguePoints = -1;
        return row;
      });
      if (trial % 3 === 0) rows.push({ ...rows[0] });
      if (trial % 5 === 0) rows.push({ ...rows[1], id: "same-instant" });
      if (trial % 23 === 0) rows.push({ ...rows[0], leaguePoints: 123 });
      equivalent(rankInput(shuffle(rows, trial)), {
        ...RESURRECTION_RULE,
        minDropLp: 1 + (trial % 100),
        maxRecoveryMs: (1 + (trial % 30)) * DAY,
        maxGapMs: (1 + (trial % 7)) * DAY,
      });
    }
  });
  it.each([
    [100, 49, 99],
    [80, 30, 30, 80],
    [80, 30, 90, 25, 80],
    [80, 30, 80, 100, 20, 100],
    [90, 40, 30, 90],
  ])("preserves ambiguous minima and multiple recovery choices %o", (...levels) => {
    const rows = levels.map((lp, i) =>
      snapshot(lp, i, {
        wins: i === 2 ? 1 : i,
        losses: i < 2 ? 0 : i,
      }),
    );
    equivalent(rankInput(rows));
    equivalent(rankInput(rows.map((r) => ({ ...r, id: undefined }))));
  });
  it("preserves exact time boundaries, offset timestamps, tiers, queues and seasonal cutoff", () => {
    const rows = [snapshot(80, 0), snapshot(30, 7), snapshot(80, 30)];
    for (const rule of [RESURRECTION_RULE, { ...RESURRECTION_RULE, maxRecoveryMs: 7 * DAY }]) {
      equivalent(rankInput(rows), rule);
      equivalent({ scope: { ...fixedScope, view: "flex" }, snapshots: rows });
      equivalent(
        {
          scope: { ...fixedScope, season: { ...fixedScope.season, endAt: rows[2].timestamp } },
          snapshots: rows,
        },
        rule,
      );
    }
    equivalent(rankInput(rows.map((r) => ({ ...r, tier: "MASTER", division: "" }))));
    equivalent(
      rankInput([
        snapshot(80, 0),
        snapshot(30, 1, { timestamp: "2026-09-02T09:00:00-03:00" }),
        snapshot(80, 2),
      ]),
    );
    equivalent(rankInput([snapshot(80, 0, { timestamp: "bad-date" })]));
    equivalent(rankInput(), { ...RESURRECTION_RULE, minDropLp: 0 });
  });
});
