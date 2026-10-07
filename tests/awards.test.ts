import { describe, expect, it } from "vitest";
import {
  computeAwards,
  formExtremes,
  formRanking,
  longestStreaks,
  recentResults,
  type Award,
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

describe("community awards", () => {
  const a = player("Ana", 14, 6, 4);
  const b = player("Beto", 6, 14, 30);
  const c = player("Caro", 10, 10, 10);
  const tiny = player("Tiny", 3, 0);
  const sequences = [
    { playerId: "Ana", results: results("WWWWWLWWWWWWWWLWWLLW") },
    { playerId: "Beto", results: results("LLLLLLWLLWLLLLLLLWLL") },
    { playerId: "Caro", results: results("WLWLWLWLWLWLWLWLWLWL") },
    { playerId: "Tiny", results: results("WWW") },
  ];
  it("ignores players under the shared sample threshold", () => {
    const { honor } = computeAwards([a, b, c, tiny], "soloq", sequences);
    expect(find(honor, "best-winrate").player?.id).toBe("Ana");
    expect(find(honor, "best-form").player?.id).toBe("Ana");
    expect(formRanking([a, b, c, tiny], sequences).map((r) => r.player.id)).not.toContain("Tiny");
  });
  it("computes the shame side from the same real data", () => {
    const { shame } = computeAwards([a, b, c, tiny], "soloq", sequences);
    expect(find(shame, "worst-winrate").player?.id).toBe("Beto");
    expect(find(shame, "most-deaths")).toMatchObject({ player: { id: "Beto" }, value: "1.5" });
    expect(find(shame, "loss-streak")).toMatchObject({
      player: { id: "Beto" },
      value: "7 seguidas",
    });
  });
  it("breaks ties by more games, then name", () => {
    const x = player("Zeta", 10, 10);
    const y = player("Alfa", 10, 10);
    const z = player("Beta", 15, 15);
    expect(find(computeAwards([x, y], "soloq", []).honor, "best-winrate").player?.id).toBe("Alfa");
    expect(find(computeAwards([x, y, z], "soloq", []).honor, "best-winrate").player?.id).toBe(
      "Beta",
    );
  });
  it("shows one-line empty states instead of inventing a winner", () => {
    const { honor, shame } = computeAwards([tiny], "soloq", []);
    expect(find(honor, "best-winrate")).toMatchObject({ player: null, value: "—" });
    expect(find(shame, "worst-winrate").player).toBeNull();
    expect(find(honor, "win-streak").player).toBeNull();
  });
  it("omits LP awards for 5v5", () => {
    const { honor, shame } = computeAwards([a, b], "5v5", sequences);
    expect(honor.map((h) => h.key)).not.toContain("best-climb");
    expect(shame.map((s) => s.key)).not.toContain("worst-drop");
  });
  it("never lists the same player in top and bottom form", () => {
    const rows = formRanking([a, b, c], sequences);
    const { top, bottom } = formExtremes(rows);
    expect(top.map((r) => r.player.id)).toEqual(["Ana", "Caro", "Beto"]);
    expect(bottom).toEqual([]);
  });
});
