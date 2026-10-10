import { describe, expect, it, vi } from "vitest";
import { evaluateStoredAchievements } from "@/server/achievements/evaluate";
import type { AchievementReader, AchievementPlayerContext } from "@/server/achievements/contracts";
import { demoAchievementReader, ACHIEVEMENT_DEMO_PLAYER_ID } from "@/server/achievements/demo";
import { currentAchievementScope } from "@/lib/achievements";
import { InvalidAchievementRecordError } from "@/server/achievements/errors";

const request = {
  playerId: ACHIEVEMENT_DEMO_PLAYER_ID,
  view: "soloq",
  season: "2026",
  asOf: "2026-11-01T00:00:00Z",
};
describe("coherent materialization (controlled race simulation, not concurrent PostgreSQL sessions)", () => {
  it.each(["matches", "snapshots", "context", "backfill"])(
    "does not mix a %s change into the captured view",
    async (change) => {
      const player = (await demoAchievementReader.player(request.playerId))!;
      const records = await demoAchievementReader.records(
        player,
        currentAchievementScope("soloq", "LA2", request.asOf),
      );
      const capturedPlayer = structuredClone(player);
      const capturedRecords = structuredClone(records);
      const simulatedReader: AchievementReader = {
        ...demoAchievementReader,
        snapshot: async (read) =>
          read({
            player: async () => {
              if (change === "matches") records.matches.length = 0;
              if (change === "snapshots") records.snapshots.length = 0;
              if (change === "context") player.rankCheckedAt = new Date("2026-11-02");
              if (change === "backfill") player.backfillStatus = "completed";
              return capturedPlayer;
            },
            records: async () => capturedRecords,
          }),
      };
      const result = await evaluateStoredAchievements(simulatedReader, request);
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error("fixture");
      expect(result.coverage).toMatchObject({
        storedMatches: 50,
        storedSnapshots: 3,
        historyStatus: "running",
        rankCheckedAt: null,
        intervalCoverage: "unproven",
      });
      expect(result.evaluations.map((e) => e.status)).toEqual(["observed", "observed", "observed"]);
      expect(
        result.evaluations.every(
          (e) => e.certification === "not_established" && e.grantAuthorized === false,
        ),
      ).toBe(true);
    },
  );
  it("runs evaluators only after the snapshot closes", async () => {
    let active = false;
    const r: AchievementReader = {
      ...demoAchievementReader,
      snapshot: async (read) => {
        active = true;
        try {
          return await read({
            player: demoAchievementReader.player,
            records: async (...args) => {
              const data = await demoAchievementReader.records(...args);
              return {
                snapshots: data.snapshots,
                get matches() {
                  expect(active).toBe(false);
                  return data.matches;
                },
              };
            },
          });
        } finally {
          active = false;
        }
      },
    };
    expect((await evaluateStoredAchievements(r, request)).status).toBe("available");
  });
  it.each(["running", "completed", "failed"] as const)(
    "does not certify %s coverage with unavailable details",
    async (status) => {
      const player = (await demoAchievementReader.player(request.playerId))!;
      const result = await evaluateStoredAchievements(
        { ...demoAchievementReader, player: async () => ({ ...player, backfillStatus: status }) },
        request,
      );
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error("fixture");
      expect(result.coverage.availability).toBe("partial");
      expect(result.coverage.intervalCoverage).toBe("unproven");
    },
  );
  it("invalid normalization is distinct from infrastructure failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await evaluateStoredAchievements(
          {
            ...demoAchievementReader,
            records: async () => {
              throw new InvalidAchievementRecordError();
            },
          },
          request,
        ),
      ).toEqual({ status: "invalid_data" });
      expect(log).toHaveBeenCalledWith("[achievements] read:invalid_data");
    } finally {
      log.mockRestore();
    }
  });
  it("a programming defect remains detectable with sanitized diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await evaluateStoredAchievements(
          {
            ...demoAchievementReader,
            records: async () => {
              throw new TypeError("secret");
            },
          },
          request,
        ),
      ).toEqual({ status: "unavailable" });
      expect(log).toHaveBeenCalledWith("[achievements] read:unexpected");
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally {
      log.mockRestore();
    }
  });
  it("rejects corrupt or mismatched player context before records", async () => {
    const records = vi.fn(demoAchievementReader.records);
    const player = await demoAchievementReader.player(request.playerId);
    const bad = { ...player, backfillProcessed: -1 } as AchievementPlayerContext;
    expect(await evaluateStoredAchievements({ player: async () => bad, records }, request)).toEqual(
      { status: "invalid_data" },
    );
    expect(records).not.toHaveBeenCalled();
  });
});
