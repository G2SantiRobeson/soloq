import { describe, expect, it } from "vitest";
import {
  computeAwards,
  formExtremes,
  formRanking,
  longestStreaks,
  recentResults,
  type Award,
  type AwardMatchStats,
  type AwardLpInterval,
} from "@/lib/awards";
import { emptyTotals } from "@/lib/stats";
import type { PublicPlayer } from "@/lib/types";

function player(name: string, wins: number, losses: number, deaths = losses): PublicPlayer {
  return {
    id: name,
    gameName: name,
    tagLine: "TEST",
    platform: "LA2",
    profileIconId: null,
    createdAt: "",
    lastSyncedAt: null,
    observedAt: "",
    recent: [],
    momentum: null,
    rank: { tier: "GOLD", division: "I", leaguePoints: 50, wins, losses },
    stats: {
      ...emptyTotals(),
      games: wins + losses,
      wins,
      losses,
      kills: wins * 2,
      deaths,
      assists: wins,
    },
  };
}
const results = (pattern: string) => [...pattern].map((c) => c === "W");
const find = (awards: Award[], key: string) => awards.find((a) => a.key === key)!;

describe("streaks and recent results", () => {
  it("finds the longest win and loss runs", () => {
    expect(longestStreaks(results("WWLWWWLLLLW"))).toEqual({ win: 3, loss: 4 });
    expect(longestStreaks([])).toEqual({ win: 0, loss: 0 });
  });
  it("keeps the last 20, most recent first", () => {
    const sequence = results("L".repeat(5) + "W".repeat(19) + "L");
    const recent = recentResults(sequence);
    expect(recent).toHaveLength(20);
    expect(recent[0]).toBe(false);
    expect(recent.slice(1).every(Boolean)).toBe(true);
  });
});

function stats(id: string, overrides: Partial<AwardMatchStats> = {}): AwardMatchStats {
  return {
    playerId: id,
    games: 20,
    champions: 3,
    zeroKills: 1,
    winStreak: 3,
    lossStreak: 2,
    cs: 3000,
    duration: 36000,
    damage: 300000,
    deaths: 100,
    assists: 200,
    ...overrides,
  };
}
const interval = (id: string, delta: number): AwardLpInterval => ({
  playerId: id,
  delta,
  from: "2026-10-06T01:00:00Z",
  to: "2026-10-09T01:00:00Z",
});

describe("distinct community awards", () => {
  const a = player("Ana", 14, 6);
  const b = player("Beto", 6, 14);
  const tiny = player("Tiny", 3, 0);
  const aggregates = [
    stats("Ana", { champions: 12, winStreak: 8, cs: 6000, damage: 900000 }),
    stats("Beto", { zeroKills: 10, lossStreak: 7, deaths: 200 }),
    stats("Tiny", { games: 3, winStreak: 3, champions: 30, cs: 99999 }),
  ];
  it.each(["soloq", "flex"] as const)("selects distinct winners and formulas in %s", (view) => {
    const { honor, shame } = computeAwards([a, b, tiny], view, aggregates, [
      interval("Ana", 49),
      interval("Beto", -28),
    ]);
    expect(honor).toHaveLength(5);
    expect(shame).toHaveLength(5);
    expect(find(honor, "win-streak")).toMatchObject({ player: { id: "Ana" }, value: "8 seguidas" });
    expect(find(honor, "champion-diversity")).toMatchObject({
      player: { id: "Ana" },
      value: "12 campeones",
    });
    expect(find(honor, "best-farm")).toMatchObject({
      player: { id: "Ana" },
      value: "10.00 CS/min",
    });
    expect(find(honor, "damage-per-minute")).toMatchObject({
      player: { id: "Ana" },
      value: "1.500 daño/min",
    });
    expect(find(honor, "best-climb")).toMatchObject({ player: { id: "Ana" }, value: "+49 LP" });
    expect(find(shame, "loss-streak")).toMatchObject({
      player: { id: "Beto" },
      value: "7 seguidas",
    });
    expect(find(shame, "most-deaths")).toMatchObject({
      player: { id: "Beto" },
      value: "10.0 muertes",
    });
    expect(find(shame, "zero-kills")).toMatchObject({
      player: { id: "Beto" },
      value: "50.0% sin kills",
    });
    expect(find(shame, "worst-farm")).toMatchObject({
      player: { id: "Beto" },
      value: "5.00 CS/min",
    });
    expect(find(shame, "worst-drop")).toMatchObject({ player: { id: "Beto" }, value: "-28 LP" });
    expect([...honor, ...shame].some((award) => award.player?.id === "Tiny")).toBe(false);
  });
  it("replaces LP with assist categories in 5v5, ignoring any supplied LP data", () => {
    const { honor, shame } = computeAwards(
      [a, b],
      "5v5",
      [stats("Ana", { assists: 400 }), stats("Beto", { assists: 100 })],
      [interval("Ana", 100)],
    );
    expect(find(honor, "most-assists")).toMatchObject({
      player: { id: "Ana" },
      value: "20.0 asist.",
    });
    expect(find(shame, "least-assists")).toMatchObject({
      player: { id: "Beto" },
      value: "5.0 asist.",
    });
    expect([...honor, ...shame].map((award) => award.key)).not.toContain("best-climb");
    expect([...honor, ...shame].map((award) => award.key)).not.toContain("worst-drop");
  });
  it("requires ten valid matches, and two eligible players for every negative category", () => {
    const single = computeAwards(
      [a, tiny],
      "soloq",
      [stats("Ana", { games: 10 }), stats("Tiny", { games: 9 })],
      [interval("Ana", -100)],
    );
    expect(find(single.honor, "champion-diversity").player?.id).toBe("Ana");
    expect(single.shame.every((award) => award.player === null)).toBe(true);
    const small = computeAwards([tiny], "5v5", [stats("Tiny", { games: 9 })], []);
    expect(
      [...small.honor, ...small.shame].every((award) => !award.player && award.value === "—"),
    ).toBe(true);
  });
  it("counts all comparable players for negative awards, including those with zero decline or no loss run", () => {
    const { shame } = computeAwards(
      [a, b],
      "soloq",
      [stats("Ana", { lossStreak: 0 }), stats("Beto", { lossStreak: 2 })],
      [interval("Ana", 0), interval("Beto", -1)],
    );
    expect(find(shame, "loss-streak").player?.id).toBe("Beto");
    expect(find(shame, "worst-drop").player?.id).toBe("Beto");
  });
  it("does not invent a streak, LP winner, or divide by zero", () => {
    const { honor, shame } = computeAwards(
      [a, b],
      "soloq",
      [
        stats("Ana", { duration: 0, winStreak: 1, lossStreak: 0 }),
        stats("Beto", { duration: 0, winStreak: 1, lossStreak: 1 }),
      ],
      [],
    );
    for (const key of ["win-streak", "best-climb", "best-farm", "damage-per-minute"])
      expect(find(honor, key).player).toBeNull();
    for (const key of ["loss-streak", "worst-drop", "worst-farm"])
      expect(find(shame, key).player).toBeNull();
    expect([...honor, ...shame].some((award) => /NaN|Infinity/.test(award.value))).toBe(false);
    expect(computeAwards([], "flex", [], []).honor.every((award) => award.player === null)).toBe(
      true,
    );
    expect(
      find(
        computeAwards(
          [a, b],
          "5v5",
          [stats("Ana", { zeroKills: 0 }), stats("Beto", { zeroKills: 0 })],
          [],
        ).shame,
        "zero-kills",
      ),
    ).toMatchObject({ player: null, empty: "Nadie terminó una partida sin kills" });
  });
  it("uses weighted per-minute totals rather than games or current official ranked record", () => {
    const { honor } = computeAwards(
      [a, b],
      "soloq",
      [
        stats("Ana", { cs: 1500, duration: 6000, damage: 100000 }),
        stats("Beto", { cs: 2000, duration: 12000, damage: 100000 }),
      ],
      [],
    );
    expect(find(honor, "best-farm")).toMatchObject({
      player: { id: "Ana" },
      value: "15.00 CS/min",
    });
    expect(find(honor, "damage-per-minute")).toMatchObject({
      player: { id: "Ana" },
      value: "1.000 daño/min",
    });
  });
  it("breaks ties by games, name and ID deterministically, without forcing different winners", () => {
    const z = player("Zeta", 20, 10),
      alpha = player("Alfa", 10, 10),
      beta = player("Beta", 15, 15);
    expect(
      find(
        computeAwards([z, alpha], "soloq", [stats("Zeta"), stats("Alfa")], []).honor,
        "champion-diversity",
      ).player?.id,
    ).toBe("Alfa");
    expect(
      find(
        computeAwards(
          [z, alpha, beta],
          "soloq",
          [stats("Zeta"), stats("Alfa"), stats("Beta", { games: 30 })],
          [],
        ).honor,
        "champion-diversity",
      ).player?.id,
    ).toBe("Beta");
    const sameName = { ...alpha, id: "AA" };
    const awards = computeAwards([alpha, sameName], "soloq", [stats("Alfa"), stats("AA")], []);
    expect(find(awards.honor, "champion-diversity").player?.id).toBe("AA");
    expect(find(awards.honor, "best-farm").player?.id).toBe("AA");
  });
  it("selects a single LP interval, never summing intervals or using unscoped momentum", () => {
    const stale = { ...a, momentum: { net: 999 } as PublicPlayer["momentum"] };
    const observed = [interval("Ana", 20), interval("Ana", 30), interval("Beto", 35)];
    expect(
      find(computeAwards([stale, b], "soloq", aggregates, observed).honor, "best-climb").player?.id,
    ).toBe("Beto");
    expect(
      find(computeAwards([stale, b], "soloq", aggregates, []).honor, "best-climb").player,
    ).toBeNull();
  });
  it("distinguishes partial coverage from absence, and does not duplicate hero or recent-form categories", () => {
    const partial = {
      ...a,
      seasonHistory: {
        season: "2026",
        status: "running" as const,
        processed: 20,
        discovered: 40,
        unavailable: 0,
        completedAt: null,
      },
    };
    const { honor, shame } = computeAwards([partial, b], "soloq", aggregates, []);
    expect(find(honor, "win-streak").partial).toBe(true);
    expect(find(honor, "best-climb")).toMatchObject({ partial: false, player: null });
    for (const redundant of [
      "best-winrate",
      "worst-winrate",
      "best-kda",
      "worst-kda",
      "most-games",
      "best-form",
      "worst-form",
    ])
      expect([...honor, ...shame].map((award) => award.key)).not.toContain(redundant);
    expect(new Set([...honor, ...shame].map((award) => award.key)).size).toBe(10);
  });
  it("preserves form ranking and nonoverlapping extremes independently of the awards", () => {
    const sequences = [
      { playerId: "Ana", results: results("WWWWWLWWWWWWWWLWWLLW") },
      { playerId: "Beto", results: results("LLLLLLWLLWLLLLLLLWLL") },
      { playerId: "Tiny", results: results("WWW") },
    ];
    const rows = formRanking([a, b, tiny], sequences);
    expect(rows.map((r) => r.player.id)).toEqual(["Ana", "Beto"]);
    expect(formExtremes(rows).bottom).toEqual([]);
  });
});
