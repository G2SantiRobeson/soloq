import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { detectRivalryDynamics } from "@/lib/rivalry-dynamics";
import { selectRivalries } from "@/lib/rivalries";
import { Rivalries } from "@/components/rivalries";
import { demoPlayers } from "@/server/demo";
const asOf = "2026-10-14T12:00:00Z";
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf)));
afterEach(() => vi.restoreAllMocks());
export function fixture(before: [number, number] = [40, 65], after: [number, number] = [50, 65]) {
  const rivalry = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
  for (const [index, p] of rivalry.players.entries()) {
    p.rivalryHistory = [
      {
        tier: "DIAMOND",
        division: "I",
        leaguePoints: before[index],
        wins: 20,
        losses: 10,
        timestamp: "2026-10-14T10:00:00Z",
        queue: rivalry.queue,
      },
      {
        tier: "DIAMOND",
        division: "I",
        leaguePoints: after[index],
        wins: 21,
        losses: 10,
        timestamp: "2026-10-14T11:00:00Z",
        queue: rivalry.queue,
      },
    ];
    p.rank = { ...p.rank, ...p.rivalryHistory.at(-1)! };
    p.observedAt = asOf;
  }
  rivalry.lpDifference = Math.abs(after[0] - after[1]);
  return rivalry;
}
describe("observed competitive dynamics", () => {
  it.each([
    { before: [40, 65], after: [50, 65], kind: "approaching", gap: 15 },
    { before: [50, 65], after: [40, 65], kind: "separating", gap: 25 },
    { before: [40, 65], after: [65, 40], kind: "leadership-change", gap: 25 },
  ] as const)("classifies $kind with unchanged snapshots", ({ before, after, kind, gap }) => {
    const r = fixture([...before], [...after]),
      original = structuredClone(r);
    const result = detectRivalryDynamics(r, "soloq", { asOf })!;
    expect(result.kind).toBe(kind);
    expect(result.observedGap).toBe(gap);
    expect(result.after.observations[0]).toBe(r.players[0].rivalryHistory![1]);
    expect(r).toEqual(original);
    expect(detectRivalryDynamics(r, "soloq", { asOf })).toEqual(result);
  });
  it.each([
    { before: [40, 65], after: [40, 65] },
    { before: [40, 65], after: [65, 65] },
    { before: [65, 65], after: [40, 65] },
  ] as const)("does not label equality or ties as a trend: %j", ({ before, after }) =>
    expect(detectRivalryDynamics(fixture([...before], [...after]), "soloq", { asOf })).toBeNull(),
  );
  it.each([
    "platform",
    "division",
    "tier",
    "missing",
    "timestamp",
    "season",
    "counter",
    "queue",
  ] as const)("rejects $0 incompatibility", (kind) => {
    const r = fixture(),
      p = r.players[1];
    if (kind === "platform") p.platform = "EUW1";
    if (kind === "division") p.rank = { ...p.rank, division: "II" };
    if (kind === "tier") p.rank = { ...p.rank, tier: "MASTER" };
    if (kind === "missing") p.rivalryHistory = [];
    if (kind === "timestamp")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({
        ...q,
        timestamp: new Date(Date.parse(q.timestamp) + 31 * 60000).toISOString(),
      }));
    if (kind === "season")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({
        ...q,
        timestamp: "2025-10-14T10:00:00Z",
      }));
    if (kind === "counter")
      p.rivalryHistory = p.rivalryHistory!.map((q, i) => ({ ...q, wins: i ? 1 : 20 }));
    if (kind === "queue")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({ ...q, queue: "RANKED_FLEX_SR" }));
    expect(detectRivalryDynamics(r, "soloq", { asOf })).toBeNull();
  });
  it("preserves asynchronous cuts within tolerance", () => {
    const r = fixture();
    r.players[1].rivalryHistory = r.players[1].rivalryHistory!.map((q) => ({
      ...q,
      timestamp: new Date(Date.parse(q.timestamp) + 20 * 60000).toISOString(),
    }));
    expect(detectRivalryDynamics(r, "soloq", { asOf })?.after.to).toBe("2026-10-14T11:20:00.000Z");
  });
  it("separates ranked queues and excludes 5v5", () => {
    const r = fixture();
    expect(detectRivalryDynamics(r, "flex", { asOf })).toBeNull();
    expect(detectRivalryDynamics(r, "5v5", { asOf })).toBeNull();
    r.queue = "RANKED_FLEX_SR";
    for (const p of r.players)
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({ ...q, queue: r.queue }));
    expect(detectRivalryDynamics(r, "flex", { asOf })?.kind).toBe("approaching");
  });
  it("renders a compact observed indicator without creating another rivalry", () => {
    const html = renderToStaticMarkup(
      <Rivalries rivalries={[fixture()]} view="soloq" version={null} />,
    );
    expect(html).toContain("Acercamiento observado");
    expect(html.match(/class="rivalry-row"/g)).toHaveLength(1);
    expect(html).toContain("no en tiempo real");
  });
});
