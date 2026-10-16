import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { selectRivalries } from "@/lib/rivalries";
import { selectWeeklyRivalry, rivalryKey } from "@/lib/weekly-rivalry";
import { demoPlayers } from "@/server/demo";
import { Rivalries } from "@/components/rivalries";
import { PageHeading } from "@/components/page-heading";
import { QueueTabs } from "@/components/queue-tabs";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const asOf = "2026-10-14T12:00:00Z";
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
});
afterEach(() => vi.restoreAllMocks());

describe("shared page heading", () => {
  it("puts context under the title, never a label above it", () => {
    const html = renderToStaticMarkup(
      <PageHeading
        title="Rivalidades"
        lead="Quién va por delante."
        meta="Duelos de clasificación"
        figures={[{ label: "Duelos", value: "3" }]}
      />,
    );
    expect(html).toMatch(/^<section class="page-heading"><div class="page-title"><h1>Rivalidades/);
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf('class="page-lead"'));
    expect(html.indexOf('class="page-lead"')).toBeLessThan(html.indexOf('class="page-meta"'));
    expect(html).toContain("<dt>Duelos</dt><dd>3</dd>");
    expect(html).not.toContain("eyebrow");
  });
  it("omits the dot and the figures when asked", () => {
    const html = renderToStaticMarkup(<PageHeading title="A vs B" dot={false} />);
    expect(html).not.toContain("heading-dot");
    expect(html).not.toContain("<dl");
  });
});

describe("queue tabs for sections without 5v5", () => {
  it("lists only the given queues and keeps each section's own links", () => {
    const html = renderToStaticMarkup(
      <QueueTabs
        view="flex"
        views={["soloq", "flex"]}
        label="Modalidad de rivalidades"
        hrefFor={(q) => `/rivalidades?queue=${q}&region=LA2`}
      />,
    );
    expect(html).toContain('aria-label="Modalidad de rivalidades"');
    expect(html).not.toContain("5v5");
    expect(html).toContain('href="/rivalidades?queue=soloq&amp;region=LA2"');
    expect(html).toMatch(/class="queue-tab active" aria-current="page"[^>]*>|aria-current="page"/);
    expect(html.match(/class="queue-tab /g)).toHaveLength(2);
  });
});

describe("rivalry duel strips", () => {
  it.each(["soloq", "flex"] as const)("%s: the week's rivalry leads the list", (view) => {
    const rivalries = selectRivalries(demoPlayers(view), view);
    const weekly = selectWeeklyRivalry(rivalries, view, { asOf });
    const html = renderToStaticMarkup(
      <Rivalries rivalries={rivalries} view={view} demo version={null} asOf={asOf} />,
    );
    const rows = [...html.matchAll(/<li class="rivalry-row"[^>]*>/g)].map((m) => m[0]);
    expect(rows).toHaveLength(rivalries.length);
    if (weekly) {
      expect(rows[0]).toContain("data-weekly");
      expect(rows.slice(1).some((row) => row.includes("data-weekly"))).toBe(false);
      const [first] = weekly.rivalry.players;
      expect(html.indexOf(first.gameName)).toBeLessThan(
        html.indexOf(
          rivalries.find((r) => rivalryKey(r) !== rivalryKey(weekly.rivalry))!.players[0].gameName,
        ),
      );
    }
  });

  it("tints each half with its own player's tier and keeps the honesty note", () => {
    const rivalries = selectRivalries(demoPlayers("soloq"), "soloq");
    const html = renderToStaticMarkup(
      <Rivalries rivalries={rivalries} view="soloq" demo version={null} asOf={asOf} />,
    );
    const tints = [
      ...html.matchAll(/class="rivalry-player[^"]*"[^>]*style="--rank-color:([^"]+)"/g),
    ];
    expect(tints).toHaveLength(rivalries.length * 2);
    for (const [, value] of tints) expect(value).toMatch(/^var\(--tier-[a-z]+\)$/);
    expect(html).toContain("No representa partidas entre ambos jugadores");
  });

  it("marks a gap without comparable LP so it is never shown as a number", () => {
    const [rivalry] = selectRivalries(demoPlayers("soloq"), "soloq");
    const html = renderToStaticMarkup(
      <Rivalries
        rivalries={[{ ...rivalry, lpDifference: null }]}
        view="soloq"
        demo
        version={null}
        asOf={asOf}
        weeklyEnabled={false}
      />,
    );
    expect(html).toContain('data-comparable="false"');
    expect(html).toContain("Sin ventaja de LP comparable");
  });
});
