import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { versusMetrics, versusWeeklyLp, versusMoment } from "@/lib/versus-comparison";
import { VersusComparison } from "@/components/versus-comparison";
import { ManualDuel } from "@/components/manual-duel";
import { sharedRivalryPath } from "@/lib/shared-rivalry";
import { emptyTotals } from "@/lib/stats";
import { summarizeLp, type RankSnapshot } from "@/lib/lp-metrics";
import { weeklyRankSummary } from "@/lib/weekly-lp";
import { demoPlayers } from "@/server/demo";
import type { PublicPlayer } from "@/lib/types";
const now = "2026-10-16T12:00:00.000Z";
const player = (id: string, lp = 50): PublicPlayer => ({
  ...demoPlayers("soloq")[3],
  id,
  gameName: id,
  observedAt: now,
  rank: { tier: "DIAMOND", division: "I", leaguePoints: lp, wins: 20, losses: 10 },
  stats: { ...emptyTotals(), games: 10, wins: 6, losses: 4, kills: 40, deaths: 20, assists: 20 },
  rivalryHistory: [],
  momentum: null,
  weeklySummary: null,
});
const row = (a: PublicPlayer, b: PublicPlayer, key: string) =>
  versusMetrics([a, b], "soloq").find((m) => m.key === key)!;
afterEach(() => vi.restoreAllMocks());
describe("VS display metrics, without a global winner", () => {
  it("compares official rank, LP, imported WR and KDA independently", () => {
    const a = player("demo-4", 57),
      b = player("demo-5", 32);
    b.stats = { ...b.stats, wins: 8, losses: 2, kills: 20 };
    expect(row(a, b, "rank")).toMatchObject({ higherId: null, verdict: "Mismo rango registrado" });
    expect(row(a, b, "lp")).toMatchObject({
      values: ["57 LP", "32 LP"],
      higherId: a.id,
      verdict: "Diferencia: 25 LP",
    });
    expect(row(a, b, "winrate")).toMatchObject({ values: ["60 %", "80 %"], higherId: b.id });
    expect(row(a, b, "kda")).toMatchObject({ values: ["3", "2"], higherId: a.id });
    expect(row(a, b, "record").higherId).toBeNull();
  });
  it("preserves ties at the displayed precision", () => {
    const a = player("demo-4"),
      b = player("demo-5");
    for (const key of ["rank", "lp", "winrate", "kda"]) expect(row(a, b, key).higherId).toBeNull();
    expect(row(a, b, "lp").verdict).toBe("Mismos LP registrados");
  });
  it("shows missing samples as unknown, never zero percent or zero KDA", () => {
    const a = { ...player("demo-4"), rank: null, stats: emptyTotals() },
      b = player("demo-5");
    expect(row(a, b, "rank").values[0]).toBe("Sin rango");
    for (const key of ["lp", "winrate", "kda", "weekly"])
      expect(row(a, b, key).values[0]).toBe("—");
  });
  it.each([NaN, Infinity, -1, 1.5])("rejects invalid sample counts %s", (n) => {
    const a = player("demo-4"),
      b = player("demo-5");
    a.stats.games = n;
    expect(row(a, b, "winrate").values[0]).toBe("—");
    expect(row(a, b, "kda").higherId).toBeNull();
  });
  it("keeps a genuine zero winrate and a zero-death KDA using the existing formula", () => {
    const a = player("demo-4"),
      b = player("demo-5");
    a.stats = { ...a.stats, wins: 0, losses: 10, deaths: 0 };
    expect(row(a, b, "winrate").values[0]).toBe("0 %");
    expect(row(a, b, "kda").values[0]).toBe("60");
  });
  it.each([
    ["DIAMOND", "II"],
    ["GOLD", "I"],
  ])("does not subtract LP across %s %s", (tier, division) => {
    const a = player("demo-4"),
      b = player("demo-5", 90);
    b.rank = { ...b.rank!, tier, division };
    expect(row(a, b, "lp").higherId).toBeNull();
    expect(row(a, b, "lp").verdict).toContain("no comparable");
  });
  it("keeps Apex categories distinct even when the lower category has more LP", () => {
    const a = player("demo-4", 900),
      b = player("demo-5", 300);
    a.rank!.tier = "MASTER";
    b.rank!.tier = "CHALLENGER";
    expect(row(a, b, "rank").higherId).toBe(b.id);
    expect(row(a, b, "lp").higherId).toBe(a.id);
    expect(row(a, b, "lp").verdict).toContain("600 LP");
    expect(row(a, b, "lp").note).toContain("categorías Apex");
  });
  it("rejects cross-region, 5v5 and self comparisons", () => {
    const a = player("demo-4"),
      b = player("demo-5");
    expect(versusMetrics([a, { ...b, platform: "EUW1" }], "soloq")).toEqual([]);
    expect(versusMetrics([a, b], "5v5")).toEqual([]);
    expect(versusMetrics([a, a], "soloq")).toEqual([]);
  });
  it("discloses unequal samples and incomplete coverage instead of a match prediction", () => {
    const a = player("demo-4"),
      b = player("demo-5");
    b.stats = { ...b.stats, games: 5, wins: 4, losses: 1 };
    const html = renderToStaticMarkup(
      <VersusComparison players={[a, b]} view="soloq" demo champions={{}} />,
    );
    expect(html).toContain("10 partidas importadas");
    expect(html).toContain("5 partidas importadas");
    expect(html).toContain("muestras pueden tener tamaños y cobertura distintos");
    expect(html).toContain("exhaustividad no acreditada");
    expect(html).toContain("no determina quién es mejor");
    expect(html).not.toContain("Ganador del VS");
  });
  it("retains empty recent form and neutral historical states", () => {
    const a = { ...player("demo-4"), recent: [] },
      b = player("demo-5");
    const html = renderToStaticMarkup(
      <VersusComparison players={[a, b]} view="soloq" demo champions={{}} />,
    );
    expect(html).toContain("Sin partidas");
    expect(html).toContain("No hay cortes históricos compatibles");
    expect(html).not.toContain("Cambio de liderazgo observado");
  });
});
function weekly(id: string, net: number, from = "2026-10-12T03:00:00.000Z") {
  const p = player(id, 40 + net);
  const points: RankSnapshot[] = [
    {
      ...p.rank!,
      leaguePoints: 40,
      wins: 10,
      losses: 5,
      timestamp: from,
      queue: "RANKED_SOLO_5x5",
    },
    { ...p.rank!, wins: 12, losses: 6, timestamp: now, queue: "RANKED_SOLO_5x5" },
  ];
  p.rivalryHistory = points;
  p.momentum = summarizeLp(points);
  p.weeklySummary = weeklyRankSummary(points, new Date(now), p.platform, "RANKED_SOLO_5x5");
  return p;
}
describe("weekly observed intervals", () => {
  it("shows existing same-rank weekly LP only with matching evidence", () => {
    const a = weekly("demo-4", 20),
      b = weekly("demo-5", 10);
    expect(versusWeeklyLp(a, "soloq")?.net).toBe(20);
    expect(row(a, b, "weekly")).toMatchObject({ higherId: a.id, values: ["+20 LP", "+10 LP"] });
  });
  it("does not rank unequal or partial intervals", () => {
    const a = weekly("demo-4", 20),
      b = weekly("demo-5", 10, "2026-10-13T03:00:00.000Z");
    expect(row(a, b, "weekly").higherId).toBeNull();
    expect(row(a, b, "weekly").values[1]).toContain("parcial");
  });
  it("does not reuse weeklyLp alone or mislabel a rank coordinate as LP", () => {
    const p = weekly("demo-4", 20);
    p.momentum = null;
    p.rivalryHistory = [];
    expect(versusWeeklyLp({ ...p, weeklyLp: 999 }, "soloq")).toBeNull();
    const moved = weekly("demo-4", 20);
    moved.momentum = null;
    moved.rivalryHistory = moved.rivalryHistory!.map((s, i) => (i ? { ...s, division: "II" } : s));
    expect(versusWeeklyLp(moved, "soloq")).toBeNull();
  });
  it("rejects future or invalid weekly boundaries", () => {
    const p = weekly("demo-4", 20);
    expect(versusWeeklyLp({ ...p, observedAt: "invalid" }, "soloq")).toBeNull();
    expect(versusWeeklyLp({ ...p, observedAt: "2026-10-14T12:00:00Z" }, "soloq")).toBeNull();
  });
});
it("reuses the historical detector on actual Demo observations, without generating cuts", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  const players = demoPlayers("soloq"),
    a = players[3],
    b = players[4];
  expect(versusMoment([a, b], "soloq")?.hasHistory).toBe(true);
  expect(versusMoment([{ ...a, rivalryHistory: [] }, b], "soloq")?.hasHistory).toBe(false);
  expect(versusMoment([a, b], "flex")).toMatchObject({ hasHistory: false });
});
it("preserves canonical IDs, queue, filters and manual mode in share links", () => {
  const path = sharedRivalryPath(
    "flex",
    ["demo-5", "demo-4"],
    { search: "Ronin", region: "LA2", sort: "kda", ascending: true },
    true,
  )!;
  const url = new URL(path, "http://localhost");
  expect(url.pathname).toBe("/rivalidad/demo-4/demo-5");
  for (const [key, value] of Object.entries({
    queue: "flex",
    tipo: "elegida",
    q: "Ronin",
    region: "LA2",
    sort: "kda",
    dir: "asc",
  }))
    expect(url.searchParams.get(key)).toBe(value);
  expect(sharedRivalryPath("5v5", ["demo-4", "demo-5"], undefined, true)).toBeNull();
});
it("keeps long names and unranked identities as real profile links", () => {
  const a = { ...player("demo-4"), gameName: "NombreLargo".repeat(8), rank: null },
    b = player("demo-5");
  const html = renderToStaticMarkup(
    <ManualDuel players={[a, b]} view="flex" demo version={null} />,
  );
  expect(html).toContain("/player/demo-4?queue=flex");
  expect(html).toContain("Sin datos de rango");
  expect(html).not.toContain(">0 LP<");
});
