import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { selectWeeklyRivalry, rivalryKey } from "@/lib/weekly-rivalry";
import { detectLeadershipChange } from "@/lib/rivalry-leadership";
import { selectRivalries, type Rivalry } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
import { Rivalries } from "@/components/rivalries";
import { parseLadderFilters } from "@/lib/ladder-filters";
import { weekStart } from "@/lib/time";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const asOf = "2026-10-14T12:00:00Z";
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
});
afterEach(() => vi.restoreAllMocks());
function pair(
  id = "a",
  gap = 10,
  after = "2026-10-14T11:00:00Z",
  before = "2026-10-14T10:00:00Z",
): Rivalry {
  const result = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
  result.players.forEach((p, i) => {
    p.id = id + i;
    p.rivalryHistory = [
      {
        tier: "DIAMOND",
        division: "I",
        leaguePoints: i ? 70 : 20,
        wins: 20,
        losses: 10,
        queue: result.queue,
        timestamp: before,
      },
      {
        tier: "DIAMOND",
        division: "I",
        leaguePoints: i ? 60 - gap : 60,
        wins: 21,
        losses: 10,
        queue: result.queue,
        timestamp: after,
      },
    ];
    p.rank = { ...p.rank, ...p.rivalryHistory.at(-1)! };
    p.observedAt = asOf;
  });
  result.lpDifference = gap;
  return result;
}
const choose = (pairs: Rivalry[], instant = asOf, view: "soloq" | "flex" | "5v5" = "soloq") =>
  selectWeeklyRivalry(pairs, view, { asOf: instant });
describe("calendar-week rivalry recognition", () => {
  it("uses Monday midnight Santiago and preserves the original observations", () => {
    const rivalry = pair();
    const prior = structuredClone(rivalry);
    const result = choose([rivalry])!;
    expect(result.weekStartedAt).toBe("2026-10-12T03:00:00.000Z");
    expect(result.change.before.observations[0]).toBe(rivalry.players[0].rivalryHistory![0]);
    expect(result.rivalry).toBe(rivalry);
    expect(rivalry).toEqual(prior);
    expect(choose([rivalry])).toEqual(result);
  });
  it.each(["2026-10-12T02:59:59Z", "2026-10-10T18:00:00Z"])(
    "rejects a first cut before the calendar week: %s",
    (before) => {
      expect(choose([pair("a", 10, "2026-10-12T04:00:00Z", before)])).toBeNull();
    },
  );
  it("accepts Monday itself and clears the award at the next Monday", () => {
    const rivalry = pair("a", 10, "2026-10-12T04:00:00Z", "2026-10-12T03:00:00Z");
    expect(choose([rivalry])).not.toBeNull();
    expect(choose([rivalry], "2026-10-19T03:00:00Z")).toBeNull();
  });
  it.each(["2026-07-08T12:00:00Z", "2026-09-07T04:00:00Z"])(
    "uses the existing timezone utility through DST: %s",
    (instant) => {
      const start = weekStart(new Date(instant));
      const rivalry = pair("a", 10, new Date(+start + 3600000).toISOString(), start.toISOString());
      expect(choose([rivalry], instant)?.weekStartedAt).toBe(start.toISOString());
    },
  );
  it("prioritizes recency over current gap", () => {
    const earlier = pair("a", 1),
      later = pair("b", 30, "2026-10-14T11:30:00Z");
    expect(choose([earlier, later])?.rivalry).toBe(later);
  });
  it("then prioritizes current comparable LP and stable canonical player IDs", () => {
    const wider = pair("a", 15),
      closer = pair("z", 5);
    expect(choose([wider, closer])?.rivalry).toBe(closer);
    const tied = pair("a", 5);
    expect(rivalryKey(choose([closer, tied])!.rivalry)).toBe(rivalryKey(tied));
    expect(rivalryKey(choose([tied, closer])!.rivalry)).toBe(rivalryKey(tied));
    const reversed = { ...tied, players: [tied.players[1], tied.players[0]] as const };
    expect(rivalryKey(choose([closer, reversed])!.rivalry)).toBe(rivalryKey(tied));
  });
  it("does not award mere proximity or a tied cut", () => {
    const rivalry = pair();
    rivalry.players[1].rivalryHistory = [...rivalry.players[1].rivalryHistory!].map((p, i) => ({
      ...p,
      leaguePoints: i ? 60 : 70,
    }));
    rivalry.players[1].rank = { ...rivalry.players[1].rank, leaguePoints: 60 };
    expect(choose([rivalry])).toBeNull();
    expect(choose([])).toBeNull();
  });
  it("finds an earlier weekly change without altering the latest-two-cut detector", () => {
    const rivalry = pair();
    for (const p of rivalry.players) {
      const last = p.rivalryHistory!.at(-1)!;
      p.rivalryHistory = [
        ...p.rivalryHistory!,
        { ...last, wins: 22, timestamp: "2026-10-14T11:30:00Z" },
      ];
      p.rank = { ...p.rank, wins: 22 };
    }
    expect(detectLeadershipChange(...rivalry.players, "soloq", { asOf })).toBeNull();
    expect(choose([rivalry])?.change.after.to).toBe("2026-10-14T11:00:00Z");
  });
  it.each([
    "platform",
    "division",
    "tier",
    "missing",
    "incompatible",
    "counter",
    "future",
    "queue",
    "gap",
  ] as const)("rejects unsafe weekly evidence: %s", (reason) => {
    const r = pair(),
      p = r.players[1];
    if (reason === "platform") p.platform = "EUW1";
    if (reason === "division") p.rank = { ...p.rank, division: "II" };
    if (reason === "tier") p.rank = { ...p.rank, tier: "MASTER" };
    if (reason === "missing") p.rivalryHistory = [];
    if (reason === "incompatible")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({
        ...q,
        timestamp: new Date(Date.parse(q.timestamp) + 31 * 60000).toISOString(),
      }));
    if (reason === "counter")
      p.rivalryHistory = p.rivalryHistory!.map((q, i) => ({ ...q, wins: i ? 1 : 20 }));
    if (reason === "future")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({
        ...q,
        timestamp: "2026-10-15T12:00:00Z",
      }));
    if (reason === "queue")
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({ ...q, queue: "RANKED_FLEX_SR" }));
    if (reason === "gap") p.rank = { ...p.rank, leaguePoints: 0 };
    expect(choose([r])).toBeNull();
  });
  it("separates SoloQ, Flex and 5v5", () => {
    const r = pair();
    expect(choose([r], asOf, "flex")).toBeNull();
    expect(choose([r], asOf, "5v5")).toBeNull();
    r.queue = "RANKED_FLEX_SR";
    for (const p of r.players)
      p.rivalryHistory = p.rivalryHistory!.map((q) => ({ ...q, queue: r.queue }));
    expect(choose([r], asOf, "flex")).not.toBeNull();
  });
  it("rejects unknown or incomplete coverage, invalid reference and non-comparable adjacent divisions", () => {
    const r = pair();
    r.players[0].weeklyRivalryHistoryComplete = false;
    expect(choose([pair("b"), r])).toBeNull();
    expect(choose([pair()], "bad")).toBeNull();
    const adjacent = pair();
    adjacent.players[0].rank = { ...adjacent.players[0].rank, division: "II", leaguePoints: 95 };
    adjacent.players[1].rank = { ...adjacent.players[1].rank, leaguePoints: 5 };
    adjacent.lpDifference = null;
    expect(choose([adjacent])).toBeNull();
  });
  it("uses the bounded weekly batch even when the 30-snapshot series missed the event", () => {
    const r = pair();
    for (const [index, p] of r.players.entries()) {
      const original = p.rivalryHistory!;
      p.weeklyRivalryHistory = Array.from({ length: 40 }, (_, i) => ({
        ...original[i === 0 ? 0 : 1],
        wins: 100 + i,
        timestamp: new Date(Date.parse("2026-10-14T10:00:00Z") + i * 60000).toISOString(),
      }));
      p.rivalryHistory = p.weeklyRivalryHistory.slice(-30);
      p.rank = { ...p.rank, wins: 139 };
      p.weeklyRivalryHistoryComplete = true;
      expect(p.weeklyRivalryHistory[0].leaguePoints).toBe(index ? 70 : 20);
    }
    expect(detectLeadershipChange(...r.players, "soloq", { asOf })).toBeNull();
    expect(choose([r])).not.toBeNull();
  });
});
describe("weekly badge integration without duplicating the approved duel", () => {
  const markup = (view: "soloq" | "flex" | "5v5", params = {}) => {
    const filters = parseLadderFilters(view, params);
    const pool = demoPlayers(view).filter(
      (p) =>
        (filters.region === "all" || p.platform === filters.region) &&
        (p.gameName + "#" + p.tagLine).toLowerCase().includes(filters.search.toLowerCase()),
    );
    return renderToStaticMarkup(
      <Rivalries rivalries={selectRivalries(pool, view)} view={view} demo version={null} />,
    );
  };
  it.each(["soloq", "flex"] as const)(
    "recognizes fictional evidence in %s with original 60/40 structure and a stable message",
    (view) => {
      const html = markup(view);
      expect(html.match(/class="weekly-rivalry-badge"/g)).toHaveLength(1);
      expect(html.match(/class="rivalry-row"/g)).toHaveLength(3);
      expect(html).toContain("Rivalidad de la semana");
      expect(html).toContain("Ficticio · Demo");
      expect(html).toContain("rivalry-current");
      expect(html).toContain("rivalry-leadership");
      expect(html).toContain("Ver evolución");
      expect(html).toContain("#DEMO");
      expect(markup(view)).toBe(html);
    },
  );
  it.each([
    { view: "5v5" as const, params: {} },
    { view: "soloq" as const, params: { region: "EUW1" } },
    { view: "soloq" as const, params: { q: "Demo Ronin#DEMO" } },
  ])("hides awards outside visible candidates: %j", ({ view, params }) => {
    expect(markup(view, params)).not.toContain("weekly-rivalry-badge");
  });
  it("supports shared search and region and remains independent of ranking sort", () => {
    expect(markup("soloq", { q: "Demo", region: "LA2", sort: "winrate", dir: "asc" })).toContain(
      "weekly-rivalry-badge",
    );
  });
  it("keeps the ordinary rivalry in a week without events", () => {
    const r = pair();
    const html = renderToStaticMarkup(
      <Rivalries rivalries={[r]} view="soloq" version={null} asOf="2026-10-19T03:00:00Z" />,
    );
    expect(html).toContain("rivalry-row");
    expect(html).not.toContain("weekly-rivalry-badge");
  });
  it("can suppress expired recognition without hiding current rivalry", () => {
    const html = renderToStaticMarkup(
      <Rivalries
        rivalries={[pair()]}
        view="soloq"
        version={null}
        asOf={asOf}
        weeklyEnabled={false}
      />,
    );
    expect(html).not.toContain("weekly-rivalry-badge");
    expect(html).toContain("Ventaja actual");
  });
});

it.each(["soloq", "flex"] as const)(
  "demo %s does not fabricate evidence just after Monday starts",
  (view) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T03:30:00Z"));
    const rivalries = selectRivalries(demoPlayers(view), view);
    expect(selectWeeklyRivalry(rivalries, view, { asOf: "2026-10-19T03:30:00Z" })).toBeNull();
    const html = renderToStaticMarkup(
      <Rivalries rivalries={rivalries} view={view} version={null} demo />,
    );
    expect(html).not.toContain("weekly-rivalry-badge");
    expect(html).toContain("rivalry-row");
  },
);
