import { describe, expect, it } from "vitest";
import { detectLeadershipChange, RIVALRY_HISTORY_LIMIT } from "@/lib/rivalry-leadership";
import type { RankSnapshot } from "@/lib/lp-metrics";
import type { PublicPlayer } from "@/lib/types";
const asOf = "2026-10-14T12:00:00Z";
const options = { asOf };
const snapshot = (lp: number, timestamp: string, wins = 20): RankSnapshot => ({
  tier: "DIAMOND",
  division: "I",
  leaguePoints: lp,
  wins,
  losses: 10,
  timestamp,
  queue: "RANKED_SOLO_5x5",
});
const a = () => [snapshot(40, "2026-10-14T10:00:00Z"), snapshot(60, "2026-10-14T11:00:00Z", 21)];
const b = () => [snapshot(65, "2026-10-14T10:05:00Z"), snapshot(50, "2026-10-14T11:05:00Z", 21)];
const player = (
  id: string,
  rivalryHistory: RankSnapshot[],
): Pick<PublicPlayer, "id" | "rank" | "platform" | "rivalryHistory"> => ({
  id,
  platform: "LA2",
  rank: rivalryHistory.at(-1) ?? a()[1],
  rivalryHistory,
});
const detect = (one = a(), two = b(), opts = options) =>
  detectLeadershipChange(player("a", one), player("b", two), "soloq", opts);

describe("strict observed leadership reversals", () => {
  it("detects a strict inversion and preserves original asynchronous observations", () => {
    const one = a(),
      two = b(),
      before = structuredClone([one, two]);
    const change = detect(one, two)!;
    expect(change.before).toMatchObject({
      leaderId: "b",
      from: one[0].timestamp,
      to: two[0].timestamp,
    });
    expect(change.after).toMatchObject({
      leaderId: "a",
      from: one[1].timestamp,
      to: two[1].timestamp,
    });
    expect(change.before.observations[0]).toBe(one[0]);
    expect(change.after.observations[1]).toBe(two[1]);
    expect([one, two]).toEqual(before);
    expect(detect(one, two)).toEqual(change);
  });
  it("allows simultaneous observations", () => {
    const two = b().map((p, i) => ({ ...p, timestamp: a()[i].timestamp }));
    expect(detect(a(), two)).not.toBeNull();
  });
  it("is symmetric in player order while retaining leader identities", () => {
    const change = detectLeadershipChange(player("b", b()), player("a", a()), "soloq", options)!;
    expect(change.before.leaderId).toBe("b");
    expect(change.after.leaderId).toBe("a");
  });
  it("rejects unchanged advantage", () => {
    expect(
      detect(
        a(),
        b().map((p) => ({ ...p, leaguePoints: 70 })),
      ),
    ).toBeNull();
  });
  it.each([0, 1])("does not treat a tie in cut %s as an overtake", (index) => {
    const two = b();
    two[index] = { ...two[index], leaguePoints: a()[index].leaguePoints };
    expect(detect(a(), two)).toBeNull();
  });
  it("never skips a recent tie to cherry-pick an older reversal", () => {
    const one = [
      snapshot(30, "2026-10-14T09:00:00Z"),
      ...a(),
      snapshot(50, "2026-10-14T11:30:00Z", 22),
    ];
    const two = [
      snapshot(50, "2026-10-14T09:05:00Z"),
      ...b(),
      snapshot(50, "2026-10-14T11:35:00Z", 22),
    ];
    expect(detect(one, two)).toBeNull();
  });
  it("supports a conservative configurable tolerance including its boundary", () => {
    expect(
      detectLeadershipChange(player("a", a()), player("b", b()), "soloq", {
        asOf,
        toleranceMs: 5 * 60000,
      }),
    ).not.toBeNull();
    expect(
      detectLeadershipChange(player("a", a()), player("b", b()), "soloq", {
        asOf,
        toleranceMs: 5 * 60000 - 1,
      }),
    ).toBeNull();
    const two = b().map((p, i) => ({
      ...p,
      timestamp: i ? "2026-10-14T11:30:00Z" : "2026-10-14T10:30:00Z",
    }));
    expect(detect(a(), two)).not.toBeNull();
    two[1].timestamp = "2026-10-14T11:30:00.001Z";
    expect(detect(a(), two)).toBeNull();
  });
  it.each([-1, NaN, Infinity, 0.5])("rejects invalid tolerance %s", (toleranceMs) => {
    expect(
      detectLeadershipChange(player("a", a()), player("b", b()), "soloq", { asOf, toleranceMs }),
    ).toBeNull();
  });
  it("skips an unmatched newer observation without synthesizing a pair", () => {
    const two = [...b(), snapshot(55, "2026-10-14T11:50:00Z", 22)];
    expect(detect(a(), two)?.after.to).toBe("2026-10-14T11:05:00Z");
  });
  it("requires strictly nonoverlapping cuts and does not reuse observations", () => {
    const one = [snapshot(40, "2026-10-14T10:00:00Z"), snapshot(60, "2026-10-14T10:20:00Z", 21)];
    const two = [snapshot(65, "2026-10-14T10:25:00Z"), snapshot(50, "2026-10-14T10:30:00Z", 21)];
    expect(detect(one, two)).toBeNull();
    expect(detect(a(), b().slice(1))).toBeNull();
  });
  it.each([[], a().slice(0, 1)].map((points) => ({ points })))(
    "requires two snapshots per player",
    ({ points }) => {
      expect(detect(points, b())).toBeNull();
    },
  );
  it("does not reorder or deduplicate evidence", () => {
    expect(detect(a().toReversed(), b())).toBeNull();
    expect(detect([a()[0], a()[0], a()[1]], b())).toBeNull();
    expect(detect(a(), [b()[0], { ...b()[0], leaguePoints: 40 }, b()[1]])).toBeNull();
  });
  it.each([{ tier: "MASTER" }, { division: "II" }, { tier: "GOLD" }])(
    "rejects different categories %j",
    (patch) => {
      expect(
        detect(
          a(),
          b().map((p) => ({ ...p, ...patch })),
        ),
      ).toBeNull();
    },
  );
  it("rejects intermediate tier/division transitions even if endpoints look comparable", () => {
    const one = [a()[0], { ...snapshot(45, "2026-10-14T10:30:00Z"), division: "II" }, a()[1]];
    expect(detect(one, b())).toBeNull();
  });
  it("compares an apex category only to itself", () => {
    expect(
      detect(
        a().map((p) => ({ ...p, tier: "MASTER", leaguePoints: p.leaguePoints + 500 })),
        b().map((p) => ({ ...p, tier: "MASTER", leaguePoints: p.leaguePoints + 500 })),
      ),
    ).not.toBeNull();
    expect(
      detect(
        a().map((p) => ({ ...p, tier: "MASTER" })),
        b().map((p) => ({ ...p, tier: "GRANDMASTER" })),
      ),
    ).toBeNull();
  });
  it("rejects different platforms, queues, identities and 5v5", () => {
    expect(
      detectLeadershipChange(
        player("a", a()),
        { ...player("b", b()), platform: "LA1" },
        "soloq",
        options,
      ),
    ).toBeNull();
    expect(
      detect(
        a(),
        b().map((p) => ({ ...p, queue: "RANKED_FLEX_SR" })),
      ),
    ).toBeNull();
    expect(
      detect(
        a(),
        b().map((p) => ({ ...p, queue: undefined })),
      ),
    ).toBeNull();
    expect(detectLeadershipChange(player("a", a()), player("a", b()), "soloq", options)).toBeNull();
    expect(detectLeadershipChange(player("a", a()), player("b", b()), "5v5", options)).toBeNull();
    expect(
      detectLeadershipChange(
        player(
          "a",
          a().map((p) => ({ ...p, queue: "RANKED_FLEX_SR" })),
        ),
        player(
          "b",
          b().map((p) => ({ ...p, queue: "RANKED_FLEX_SR" })),
        ),
        "flex",
        options,
      ),
    ).not.toBeNull();
  });
  it.each([
    "2025-12-31T10:00:00Z",
    "2026-10-15T10:00:00Z",
    "invalid",
    "2026-02-30T10:00:00Z",
    "2026-10-14T10:00:00",
  ])("rejects invalid/out-of-season/future timestamp %s", (timestamp) => {
    expect(detect([{ ...a()[0], timestamp }, a()[1]], b())).toBeNull();
  });
  it.each([
    { leaguePoints: -1 },
    { leaguePoints: NaN },
    { leaguePoints: 1.5 },
    { leaguePoints: 100 },
    { wins: -1 },
    { losses: NaN },
    { tier: "UNRANKED" },
  ])("rejects invalid snapshot %j", (patch) => {
    expect(detect([{ ...a()[0], ...patch }, a()[1]], b())).toBeNull();
  });
  it("rejects counter resets and disagreement with the current official rank", () => {
    expect(detect([a()[0], { ...a()[1], wins: 19 }], b())).toBeNull();
    expect(
      detectLeadershipChange(
        { ...player("a", a()), rank: { ...a()[1], leaguePoints: 61 } },
        player("b", b()),
        "soloq",
        options,
      ),
    ).toBeNull();
  });
  it("does not use rankCheckedAt or imported games when snapshots are missing", () => {
    expect(
      detectLeadershipChange(
        { ...player("a", []), rivalryHistory: undefined },
        player("b", b()),
        "soloq",
        options,
      ),
    ).toBeNull();
  });
  it("rejects oversized histories instead of silently discarding invalid evidence", () => {
    expect(
      detect(
        Array.from({ length: RIVALRY_HISTORY_LIMIT + 1 }, () => a()[0]),
        b(),
      ),
    ).toBeNull();
  });
});
