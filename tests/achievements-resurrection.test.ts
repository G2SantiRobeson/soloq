import { describe, expect, it } from "vitest";
import { evaluateResurrection, RESURRECTION_RULE } from "@/lib/achievements";
import { DAY, deepFreeze, rankInput, shuffle, snapshot } from "./achievements-fixtures";

describe("Resurrección: official observations only", () => {
  it("returns all exact fictitious 80 -> 25 -> 80 observations and counters, without a grant", () => {
    const input = rankInput();
    const result = evaluateResurrection(input);
    expect(result).toMatchObject({
      status: "observed",
      certification: "not_established",
      grantAuthorized: false,
      evidence: {
        dropLp: 55,
        observationCount: 3,
        before: input.snapshots[0],
        minimum: input.snapshots[1],
        recovered: input.snapshots[2],
        observations: input.snapshots,
        rule: RESURRECTION_RULE,
      },
    });
    expect(result.reasons).toContain("unobserved_rank_path");
  });
  it.each([
    [31, 80, "not_observed"],
    [30, 79, "not_observed"],
    [30, 80, "observed"],
    [25, 95, "observed"],
  ])("evaluates 80 -> %i -> %i at the exact LP boundary", (low, recovered, status) => {
    expect(
      evaluateResurrection(rankInput([snapshot(80, 0), snapshot(low, 1), snapshot(recovered, 2)]))
        .status,
    ).toBe(status);
  });
  it.each([30, 30 + 1 / DAY])(
    "respects the 30-day duration (%f days) with all intermediate observations",
    (days) => {
      const rows = [
        snapshot(80, 0),
        snapshot(25, 1),
        snapshot(25, 7),
        snapshot(25, 14),
        snapshot(25, 21),
        snapshot(25, 28),
        snapshot(80, days),
      ];
      expect(evaluateResurrection(rankInput(rows)).status).toBe(
        days === 30 ? "observed" : "not_observed",
      );
    },
  );
  it.each([7, 7 + 1 / DAY])("uses the same <=7-day comparability boundary (%f days)", (days) => {
    const result = evaluateResurrection(
      rankInput([snapshot(80, 0), snapshot(25, days), snapshot(80, days + 1)]),
    );
    expect(result.status).toBe(days === 7 ? "observed" : "insufficient_evidence");
    if (days > 7) expect(result.reasons).toContain("snapshot_gap");
  });
  it.each([
    [{ tier: "EMERALD" }, "non_comparable_rank"],
    [{ division: "II" }, "non_comparable_rank"],
    [{ wins: 1 }, "counter_reset"],
    [{ losses: 1 }, "counter_reset"],
    [{ wins: -1 }, "invalid_rank"],
    [{ losses: -1 }, "invalid_rank"],
    [{ leaguePoints: -1 }, "invalid_rank"],
    [{ tier: "ALIEN" }, "invalid_rank"],
    [{ division: "V" }, "invalid_rank"],
    [{ tier: "UNRANKED" }, "unranked"],
  ] as const)("does not bridge an intermediate barrier %j", (changes, reason) => {
    const result = evaluateResurrection(
      rankInput([snapshot(80, 0), snapshot(25, 1, changes), snapshot(80, 2)]),
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain(reason);
  });
  it("can find a later clean segment after a barrier", () => {
    const result = evaluateResurrection(
      rankInput([
        snapshot(80, 0),
        snapshot(25, 1, { tier: "UNRANKED" }),
        snapshot(80, 2),
        snapshot(25, 3),
        snapshot(80, 4),
      ]),
    );
    expect(result).toMatchObject({
      status: "observed",
      evidence: { before: { id: "snapshot-2" } },
    });
  });
  it("excludes Flex and other-season observations without making them SoloQ evidence", () => {
    for (const row of [
      snapshot(25, 1, { queue: "RANKED_FLEX_SR" }),
      snapshot(25, 1, { timestamp: "2025-10-01T12:00:00Z" }),
    ]) {
      expect(evaluateResurrection(rankInput([snapshot(80, 0), row, snapshot(80, 2)])).status).toBe(
        "insufficient_evidence",
      );
    }
  });
  it.each(["I", ""])(
    "supports supplied apex division representation %j without synthesizing ranks",
    (division) => {
      expect(
        evaluateResurrection(
          rankInput(
            [snapshot(180, 0), snapshot(125, 1), snapshot(180, 2)].map((p) => ({
              ...p,
              tier: "MASTER",
              division,
            })),
          ),
        ).status,
      ).toBe("observed");
    },
  );
  it("an apex tier transition interrupts the segment", () => {
    expect(
      evaluateResurrection(
        rankInput([
          snapshot(180, 0, { tier: "MASTER" }),
          snapshot(125, 1, { tier: "GRANDMASTER" }),
          snapshot(180, 2, { tier: "MASTER" }),
        ]),
      ).status,
    ).toBe("insufficient_evidence");
  });
  it.each([
    [
      snapshot(80, 0, { losses: 10 }),
      snapshot(25, 1, { losses: 10 }),
      snapshot(80, 2, { losses: 10 }),
    ],
    [snapshot(80, 0, { wins: 20 }), snapshot(25, 1, { wins: 20 }), snapshot(80, 2, { wins: 20 })],
    [snapshot(80, 0), snapshot(80, 1), snapshot(80, 2)],
  ])("requires a loss in the fall and a win in the recovery", (...rows) => {
    expect(evaluateResurrection(rankInput(rows)).status).toBe("not_observed");
  });
  it.each([{ rows: [] }, { rows: [snapshot(80, 0), snapshot(25, 1)] }])(
    "reports insufficient snapshots: %j",
    ({ rows }) => {
      expect(evaluateResurrection(rankInput(rows))).toMatchObject({
        status: "insufficient_evidence",
        evidence: null,
      });
    },
  );
  it("deduplicates identical IDs, rejects contradictory IDs, and cuts distinct same-time observations", () => {
    const rows = rankInput().snapshots;
    expect(evaluateResurrection(rankInput([...rows, { ...rows[1] }])).status).toBe("observed");
    expect(evaluateResurrection(rankInput([...rows, { ...rows[1], leaguePoints: 1 }])).status).toBe(
      "invalid_input",
    );
    const result = evaluateResurrection(
      rankInput([...rows, { ...rows[1], id: "another-snapshot" }]),
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("ambiguous_timestamp");
  });
  it("does not generate missing snapshot IDs", () => {
    const result = evaluateResurrection(
      rankInput(
        rankInput().snapshots.map((source) => {
          const point = { ...source };
          delete point.id;
          return point;
        }),
      ),
    );
    expect(result.status).toBe("observed");
    if (result.status !== "observed") throw new Error("Expected recovery");
    for (const point of result.evidence.observations) expect(point).not.toHaveProperty("id");
  });
  it("selects oldest recovery, then greatest drop; considers every intermediate minimum", () => {
    const rows = [
      snapshot(70, 0),
      snapshot(80, 1),
      snapshot(25, 2),
      snapshot(20, 3),
      snapshot(80, 4),
      snapshot(0, 5),
      snapshot(99, 6),
    ];
    expect(evaluateResurrection(rankInput(rows))).toMatchObject({
      status: "observed",
      evidence: {
        before: rows[1],
        minimum: rows[3],
        recovered: rows[4],
        dropLp: 60,
        observationCount: 4,
      },
    });
  });
  it("keeps a valid later anchor when an older high anchor expires", () => {
    const rows = [
      snapshot(99, 0),
      snapshot(80, 6),
      snapshot(25, 12),
      snapshot(25, 18),
      snapshot(25, 24),
      snapshot(25, 30),
      snapshot(80, 35),
    ];
    expect(evaluateResurrection(rankInput(rows))).toMatchObject({
      status: "observed",
      evidence: { before: rows[1], recovered: rows[6] },
    });
  });
  it("can use a later equal minimum when the first low had no official loss yet", () => {
    const rows = [
      snapshot(80, 0, { losses: 10 }),
      snapshot(25, 1, { losses: 10 }),
      snapshot(25, 2, { losses: 11 }),
      snapshot(80, 3, { losses: 11 }),
    ];
    expect(evaluateResurrection(rankInput(rows))).toMatchObject({
      status: "observed",
      evidence: { minimum: rows[2] },
    });
  });
  it.each(["invalid", "2026-02-30T00:00:00Z", "2026-09-02T12:00:00", "2026-09-02"])(
    "rejects unplaceable timestamp %s",
    (timestamp) => {
      const result = evaluateResurrection(
        rankInput([snapshot(80, 0), snapshot(25, 1, { timestamp }), snapshot(80, 2)]),
      );
      expect(result.status).toBe("invalid_input");
      expect(result.reasons).toContain("invalid_timestamp");
    },
  );
  it("uses explicit provisional configuration, retaining it in evidence", () => {
    const rule = { ...RESURRECTION_RULE, minDropLp: 56 };
    expect(evaluateResurrection(rankInput(), rule).status).toBe("not_observed");
    expect(evaluateResurrection(rankInput(), { ...rule, minDropLp: 49 })).toMatchObject({
      evidence: { rule: { minDropLp: 49 } },
    });
    expect(evaluateResurrection(rankInput(), { ...rule, maxGapMs: 8 * DAY }).status).toBe(
      "invalid_input",
    );
  });
  it("is immutable and stable under seeded permutations", () => {
    const input = deepFreeze(rankInput());
    const baseline = evaluateResurrection(input);
    for (let seed = 0; seed < 20; seed++)
      expect(evaluateResurrection({ ...input, snapshots: shuffle(input.snapshots, seed) })).toEqual(
        baseline,
      );
  });
});
