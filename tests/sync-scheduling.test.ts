import { describe, expect, it } from "vitest";
import { compareHistory, compareRecent, recentOpportunity } from "@/server/sync/scheduling";

function candidate(id: string) {
  return {
    id,
    createdAt: new Date(100),
    lastSyncedAt: null,
    lastAttemptAt: null,
    rankCheckedAt: null,
    rankError: null,
    recentError: null,
    lastSyncAttempt: null,
    backfillUpdatedAt: null,
  };
}
describe("deterministic fair ordering", () => {
  it("rotates failures before IDs behind untouched players", () => {
    const failed = {
      ...candidate("a"),
      rankError: {
        occurredAt: new Date(200).toISOString(),
        code: 503,
        step: "identity" as const,
        message: "unavailable",
      },
    };
    expect([failed, candidate("b")].sort(compareRecent).map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("recovers a persisted interrupted rank attempt without confusing history activity", () => {
    const interrupted = {
      ...candidate("a"),
      lastSyncAttempt: {
        phase: "rank" as const,
        startedAt: new Date(500).toISOString(),
        outcome: "running" as const,
        finishedAt: null,
      },
    };
    const history = {
      ...candidate("b"),
      lastSyncAttempt: { ...interrupted.lastSyncAttempt, phase: "history" as const },
    };
    expect(recentOpportunity(interrupted)).toBe(500);
    expect(recentOpportunity(history)).toBe(0);
    expect([interrupted, history].sort(compareRecent).map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("breaks ties by oldest coverage then creation then ID", () => {
    const older = { ...candidate("z"), lastSyncedAt: new Date(10) };
    const newer = { ...candidate("a"), lastSyncedAt: new Date(20) };
    expect([newer, older].sort(compareRecent)[0]).toEqual(older);
    expect([candidate("b"), candidate("a")].sort(compareRecent).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      compareRecent(candidate("a"), { ...candidate("b"), createdAt: new Date(200) }),
    ).toBeLessThan(0);
  });
  it("rotates history independently by last historical work", () => {
    const visited = { ...candidate("a"), backfillUpdatedAt: new Date(500) };
    expect([visited, candidate("b")].sort(compareHistory).map((p) => p.id)).toEqual(["b", "a"]);
  });
});
