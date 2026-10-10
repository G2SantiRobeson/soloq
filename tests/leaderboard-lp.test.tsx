import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { lastFiveRankDelta, type RankSnapshot } from "@/lib/lp-metrics";
import { weeklyRankSummary } from "@/lib/weekly-lp";
import { LastFiveMomentum } from "@/components/player-momentum";
import { Leaderboard } from "@/components/leaderboard";
import { emptyTotals } from "@/lib/stats";
import type { PublicPlayer } from "@/lib/types";
const now = new Date("2026-10-10T18:00:00Z");
const queue = "RANKED_SOLO_5x5" as const;
const before: RankSnapshot = {
  tier: "GOLD",
  division: "I",
  leaguePoints: 58,
  wins: 18,
  losses: 23,
  queue,
  timestamp: "2026-10-06T10:00:00Z",
};
const after: RankSnapshot = {
  ...before,
  leaguePoints: 26,
  wins: 19,
  losses: 27,
  timestamp: "2026-10-06T16:00:00Z",
};
const form = Array.from({ length: 5 }, (_, i) => ({
  matchId: `match-${i}`,
  queueId: 420,
  champion: "Ahri",
  championId: 103,
  timestamp: `2026-10-06T${15 - i}:00:00Z`,
  duration: 1800,
  win: i === 0,
  isRemake: false,
}));
describe("official LP for the displayed five", () => {
  it("Moonara: isolates one win/four losses and observes -32", () => {
    expect(lastFiveRankDelta([before, after], form, "soloq", "LA2", now)).toMatchObject({
      net: -32,
      from: before.timestamp,
      to: after.timestamp,
    });
  });
  it("JuanTapia: does not attribute a six-game +71 interval to the last five", () => {
    const a = {
      ...before,
      tier: "PLATINUM",
      division: "IV",
      leaguePoints: 0,
      wins: 185,
      losses: 197,
    };
    const b = {
      ...after,
      tier: "PLATINUM",
      division: "IV",
      leaguePoints: 71,
      wins: 190,
      losses: 198,
    };
    expect(
      lastFiveRankDelta(
        [a, b],
        form.map((m, i) => ({ ...m, win: i < 4 })),
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
  });
  it.each(
    [
      form.slice(0, 4),
      [],
      form.map((m) => ({ ...m, isRemake: null })),
      form.map((m) => ({ ...m, queueId: 440 })),
      form.map((m) => ({ ...m, timestamp: "bad" })),
      form.map((m) => ({ ...m, duration: 0 })),
    ].map((matches) => ({ matches })),
  )("rejects missing or incompatible match evidence", ({ matches }) => {
    expect(lastFiveRankDelta([before, after], matches, "soloq", "LA2", now).net).toBeNull();
  });
  it("requires snapshots strictly before the first start and after the last end", () => {
    for (const history of [
      [],
      [before],
      [{ ...before, timestamp: form[4].timestamp }, after],
      [before, { ...after, timestamp: form[0].timestamp }],
    ])
      expect(lastFiveRankDelta(history, form, "soloq", "LA2", now).net).toBeNull();
  });
  it.each([
    ["GOLD", "I", 80, "PLATINUM", "IV", 5, 25],
    ["PLATINUM", "IV", 20, "GOLD", "I", 70, -50],
  ])(
    "uses rankProgress across promotion/demotion",
    (tier, division, lp, nextTier, nextDiv, nextLp, delta) => {
      expect(
        lastFiveRankDelta(
          [
            { ...before, tier: String(tier), division: String(division), leaguePoints: Number(lp) },
            {
              ...after,
              tier: String(nextTier),
              division: String(nextDiv),
              leaguePoints: Number(nextLp),
            },
          ],
          form,
          "soloq",
          "LA2",
          now,
        ).net,
      ).toBe(delta);
    },
  );
  it("remakes contribute no official win/loss and extra remakes prevent isolation", () => {
    const remakes = form.map((m, i) => ({ ...m, isRemake: i === 4 }));
    expect(
      lastFiveRankDelta([before, { ...after, losses: 26 }], remakes, "soloq", "LA2", now).net,
    ).toBe(-32);
    expect(
      lastFiveRankDelta(
        [before, after],
        [
          ...form,
          { ...form[4], matchId: "extra", timestamp: "2026-10-06T10:30:00Z", isRemake: true },
        ],
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
    expect(lastFiveRankDelta([before, after], remakes, "soloq", "LA2", now).net).toBeNull();
  });
  it("respects Flex and rejects mixed queues, placements and intermediate resets", () => {
    const flex = [before, after].map((s) => ({ ...s, queue: "RANKED_FLEX_SR" as const }));
    expect(
      lastFiveRankDelta(
        flex,
        form.map((m) => ({ ...m, queueId: 440 })),
        "flex",
        "LA2",
        now,
      ).net,
    ).toBe(-32);
    for (const middle of [
      { ...before, queue: "RANKED_FLEX_SR" as const },
      { ...before, tier: "UNRANKED" },
      { ...before, wins: 0 },
      { ...before, losses: -1 },
    ])
      expect(
        lastFiveRankDelta(
          [before, { ...middle, timestamp: "2026-10-06T13:45:00Z" }, after],
          form,
          "soloq",
          "LA2",
          now,
        ).net,
      ).toBeNull();
  });
  it("does not bridge seasons or credit future observations", () => {
    expect(
      lastFiveRankDelta(
        [{ ...before, timestamp: "2025-12-31T10:00:00Z" }, after],
        form,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
    expect(
      lastFiveRankDelta(
        [before, { ...after, timestamp: "2026-10-11T00:00:00Z" }],
        form,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
  });
  it("waits for an official post-game counter covering all five instead of accepting an early partial check", () => {
    const lagged = { ...after, wins: before.wins, leaguePoints: 30 };
    const complete = { ...after, timestamp: "2026-10-06T16:15:00Z" };
    expect(lastFiveRankDelta([before, lagged, complete], form, "soloq", "LA2", now)).toMatchObject({
      net: -32,
      to: complete.timestamp,
    });
    expect(lastFiveRankDelta([before, lagged], form, "soloq", "LA2", now).net).toBeNull();
  });
  it("rejects counters that credit a win before its match ended, or reset after the bracket", () => {
    expect(
      lastFiveRankDelta(
        [before, { ...before, wins: 19, timestamp: "2026-10-06T12:45:00Z" }, after],
        form,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
    expect(
      lastFiveRankDelta(
        [before, after, { ...before, wins: 0, losses: 0, timestamp: "2026-10-07T00:00:00Z" }],
        form,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
    const remakes = form.map((m) => ({ ...m, isRemake: true }));
    expect(
      lastFiveRankDelta(
        [before, { ...before, timestamp: after.timestamp }],
        remakes,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBe(0);
    expect(
      lastFiveRankDelta(
        [before, { ...before, leaguePoints: 99, timestamp: after.timestamp }],
        remakes,
        "soloq",
        "LA2",
        now,
      ).net,
    ).toBeNull();
  });
});
describe("weekly official interval and UI", () => {
  it("uses the baseline and the same V/D interval, independently of five-game form", () => {
    const start = { ...before, timestamp: "2026-10-04T23:00:00Z" };
    expect(
      weeklyRankSummary([start, { ...after, wins: 24, losses: 27, leaguePoints: 103 }], now),
    ).toMatchObject({ net: 45, wins: 6, losses: 4, partial: false, from: start.timestamp });
  });
  it("labels the first in-week snapshot as partial and rejects insufficient or reset evidence", () => {
    expect(weeklyRankSummary([before, after], now)).toMatchObject({
      net: -32,
      wins: 1,
      losses: 4,
      partial: true,
      from: before.timestamp,
    });
    expect(weeklyRankSummary([after], now)).toBeNull();
    expect(weeklyRankSummary([before, { ...after, wins: 0 }], now)).toBeNull();
    expect(
      weeklyRankSummary([{ ...before, timestamp: "2025-12-31T10:00:00Z" }, after], now),
    ).toBeNull();
    expect(
      weeklyRankSummary(
        [before, { ...before, tier: "UNRANKED", timestamp: "2026-10-06T13:45:00Z" }, after],
        now,
      ),
    ).toBeNull();
    expect(
      weeklyRankSummary([before, { ...after, timestamp: "2026-10-11T00:00:00Z" }], now),
    ).toBeNull();
  });
  it("renders compact controls, partial reference, V/D and the unchanged five champion list", () => {
    const metrics = lastFiveRankDelta([before, after], form, "soloq", "LA2", now);
    const p: PublicPlayer = {
      id: "test",
      gameName: "Example",
      tagLine: "LAS",
      platform: "LA2",
      profileIconId: null,
      lastSyncedAt: null,
      createdAt: before.timestamp,
      observedAt: now.toISOString(),
      rank: after,
      stats: emptyTotals(),
      recent: form,
      momentum: null,
      lastFiveLp: metrics,
      weeklySummary: weeklyRankSummary([before, after], now),
      weeklyLp: -32,
    };
    const html = renderToStaticMarkup(
      <Leaderboard players={[p]} view="soloq" version={null} champions={{}} />,
    );
    expect(html).toContain("-32 LP");
    expect(html).toContain("/ últimas 5");
    expect(html).toContain("1V · 4D");
    expect(html).toContain("Δ parcial · desde");
    expect(html).toContain('class="mobile-label"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/role="listitem"/g) ?? []).toHaveLength(5);
    expect(renderToStaticMarkup(<LastFiveMomentum />)).toContain("LP últimas 5: no verificable");
    expect(
      renderToStaticMarkup(
        <Leaderboard
          players={[{ ...p, weeklySummary: null }]}
          view="soloq"
          version={null}
          champions={{}}
        />,
      ),
    ).toContain("Sin datos suficientes");
  });
});
