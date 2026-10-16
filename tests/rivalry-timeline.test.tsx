import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { rivalryTimeline, rivalryEventKey } from "@/lib/rivalry-timeline";
import { selectRivalries } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
import { Rivalries } from "@/components/rivalries";
const asOf = "2026-10-14T12:00:00Z";
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf)));
afterEach(() => vi.restoreAllMocks());
function pair(gaps = [25, 20, 15, 10, 15, 20, 0, -10]) {
  const r = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
  for (const [index, p] of r.players.entries()) {
    p.rivalryHistory = gaps.map((gap, i) => ({
      tier: "DIAMOND",
      division: "I",
      leaguePoints: index ? 50 : 50 - gap,
      wins: 100 + i,
      losses: 20,
      queue: r.queue,
      timestamp: new Date(Date.parse("2026-10-14T09:00:00Z") + i * 60000).toISOString(),
    }));
    p.rank = { ...p.rank, ...p.rivalryHistory.at(-1)! };
    p.observedAt = asOf;
  }
  return r;
}
describe("bounded observed weekly activity", () => {
  it("coalesces consecutive direction changes and preserves original endpoints", () => {
    const r = pair(),
      original = structuredClone(r),
      events = rivalryTimeline(r, "soloq", { asOf });
    expect(events.map((e) => e.kind)).toEqual(["tie", "separating", "approaching"]);
    expect(events.at(-1)!.previousGap).toBe(25);
    expect(events.at(-1)!.observedGap).toBe(10);
    expect(events.at(-1)!.before.observations[0]).toBe(r.players[0].rivalryHistory![0]);
    expect(r).toEqual(original);
    expect(rivalryTimeline(r, "soloq", { asOf })).toEqual(events);
  });
  it("does not merge over neutral cuts", () => {
    expect(rivalryTimeline(pair([25, 20, 20, 15]), "soloq", { asOf }).map((e) => e.kind)).toEqual([
      "approaching",
      "approaching",
    ]);
  });
  it("limits events, keeps newest first and avoids duplicate keys", () => {
    const r = pair([25, -20, 15, -10, 15, -20, 25, -10]);
    const events = rivalryTimeline(r, "soloq", { asOf });
    expect(events).toHaveLength(5);
    expect(new Set(events.map(rivalryEventKey)).size).toBe(5);
    expect(
      events.every(
        (e, i) => i === 0 || Date.parse(events[i - 1].after.to) > Date.parse(e.after.to),
      ),
    ).toBe(true);
    expect(rivalryTimeline(r, "soloq", { asOf, limit: 2 })).toHaveLength(2);
  });
  it.each([0, 6, -1, 1.5])("rejects invalid visible limit %i", (limit) =>
    expect(rivalryTimeline(pair(), "soloq", { asOf, limit })).toEqual([]),
  );
  it("never bridges ties into leadership changes or labels unchanged snapshots", () => {
    expect(rivalryTimeline(pair([0, 0, 0]), "soloq", { asOf })).toEqual([]);
    expect(rivalryTimeline(pair([25, 0, -10]), "soloq", { asOf }).map((e) => e.kind)).toEqual([
      "tie",
    ]);
  });
  it("does not manufacture a week or unavailable history", () => {
    const r = pair();
    expect(rivalryTimeline(r, "soloq", { asOf: "2026-10-19T03:00:00Z" })).toEqual([]);
    r.players[0].rivalryHistory = [];
    expect(rivalryTimeline(r, "soloq", { asOf })).toEqual([]);
    expect(rivalryTimeline(pair(), "soloq", { asOf: "bad" })).toEqual([]);
  });
  it.each(["duplicate", "platform", "division", "incomplete", "future"] as const)(
    "rejects unsafe input: %s",
    (kind) => {
      const r = pair(),
        p = r.players[0];
      if (kind === "duplicate") p.rivalryHistory = [p.rivalryHistory![0], ...p.rivalryHistory!];
      if (kind === "platform") p.platform = "EUW1";
      if (kind === "division") p.rank = { ...p.rank, division: "II" };
      if (kind === "incomplete") p.weeklyRivalryHistoryComplete = false;
      if (kind === "future")
        p.rivalryHistory = p.rivalryHistory!.map((q) => ({
          ...q,
          timestamp: "2026-10-15T12:00:00Z",
        }));
      expect(rivalryTimeline(r, "soloq", { asOf })).toEqual([]);
    },
  );
  it("keeps queues independent", () => {
    expect(rivalryTimeline(pair(), "5v5", { asOf })).toEqual([]);
    expect(rivalryTimeline(pair(), "flex", { asOf })).toEqual([]);
    const r = pair();
    r.queue = "RANKED_FLEX_SR";
    for (const p of r.players)
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({ ...q, queue: r.queue }));
    expect(rivalryTimeline(r, "flex", { asOf }).length).toBeGreaterThan(0);
  });
  it("adds activity only inside the existing closed disclosure, even without a reversal", () => {
    const html = renderToStaticMarkup(
      <Rivalries rivalries={[pair([25, 20, 15])]} view="soloq" version={null} />,
    );
    expect(html).toContain("Historial de la rivalidad");
    expect(html).toContain("Actividad reciente de esta rivalidad");
    expect(html.indexOf('class="rivalry-timeline"')).toBeGreaterThan(html.indexOf("<details"));
    expect(html).toContain("no en tiempo real");
    expect(html).not.toContain('<details class="leadership-evolution" open');
    expect(html.match(/class="rivalry-row"/g)).toHaveLength(1);
    expect(html).toContain("archivo completo");
  });
});
