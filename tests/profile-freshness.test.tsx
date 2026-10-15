import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileFreshness } from "@/components/profile-freshness";
import { Freshness } from "@/components/freshness";
import type { View } from "@/lib/queues";
import { demoPlayers } from "@/server/demo";

const now = "2026-10-10T12:00:00.000Z";
const checked = "2026-10-10T11:40:00.000Z";
const covered = "2026-10-10T11:25:00.000Z";
function render(
  rankCheckedAt: string | null = checked,
  lastSyncedAt: string | null = covered,
  view: View = "soloq",
  demo = false,
) {
  return renderToStaticMarkup(
    <ProfileFreshness {...{ rankCheckedAt, lastSyncedAt, view, demo }} observedAt={now} />,
  );
}

describe("independent profile freshness", () => {
  it("keeps demo DTOs unverified while preserving their fictional coverage", () => {
    for (const view of ["soloq", "flex", "5v5"] as const) {
      const fixtures = demoPlayers(view);
      expect(fixtures.every((player) => player.rankCheckedAt === null)).toBe(true);
      const player = fixtures[0];
      expect(render(null, player.lastSyncedAt, view, true)).toContain("Cobertura simulada:");
    }
  });
  it.each(["soloq", "flex"] as const)(
    "shows player-wide verification and distinct coverage in %s",
    (view) => {
      const html = render(checked, covered, view);
      expect(html).toContain("Rangos verificados:");
      expect(html).toContain("Cobertura reciente:");
      expect(html).toContain("hace 20 min");
      expect(html).toContain("hace 35 min");
      expect(html).not.toMatch(/SoloQ verificado|Flex verificado|Actualizado/);
    },
  );
  it.each([
    [checked, "2026-10-07T12:00:00.000Z", "hace 20 min", "hace 3 días"],
    ["2026-10-07T12:00:00.000Z", covered, "hace 3 días", "hace 35 min"],
  ])("never lets one timestamp replace the other", (rank, recent, rankAge, recentAge) => {
    const html = render(rank, recent);
    expect(html).toMatch(
      new RegExp(
        `Rangos verificados:[\\s\\S]*?${rankAge}[\\s\\S]*?Cobertura reciente:[\\s\\S]*?${recentAge}`,
      ),
    );
  });
  it.each([
    [null, covered],
    [checked, null],
    [null, null],
  ])("keeps missing evidence unknown and neutral", (rank, recent) => {
    const html = render(rank, recent);
    if (!rank) expect(html).toContain("Sin verificación registrada");
    if (!recent) expect(html).toContain("Sin cobertura registrada");
    expect((html.match(/<time /g) ?? []).length).toBe(Number(!!rank) + Number(!!recent));
    expect(html).not.toMatch(/stale|negative|desactualizado|Actualizado/);
  });
  it("omits rank verification in 5v5 even when a timestamp exists", () => {
    const html = render(checked, covered, "5v5");
    expect(html).not.toContain("Rangos");
    expect(html).not.toContain(checked);
    expect(html).toContain(covered);
  });
  it("does not depend on a ranked snapshot (Unranked is still verifiable)", () => {
    expect(render()).toContain(`dateTime="${checked}"`);
    expect(render(null)).toContain("Sin verificación registrada");
  });
  it.each(["soloq", "flex", "5v5"] as const)("labels demo evidence as fictional in %s", (view) => {
    const html = render(null, covered, view, true);
    expect(html).toContain("Cobertura simulada:");
    expect(html).not.toContain("Rangos verificados");
    if (view !== "5v5") expect(html).toContain("Simulados");
    else expect(html).not.toContain("Rangos de demo");
  });
  it("exposes exact UTC dates to assistive technology and accessible explanation buttons", () => {
    const html = render();
    expect(html).toContain('aria-label="Actualización del perfil"');
    expect(html).toContain(`<time dateTime="${checked}">`);
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("11:40:00 UTC");
    expect(html).toContain("11:25:00 UTC");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
  });
  it("treats malformed timestamps as unknown rather than inventing dates", () => {
    expect(render("invalid", "invalid")).not.toMatch(/<time|Invalid Date|NaN/);
  });
  it("preserves the existing leaderboard Freshness presentation", () => {
    const html = renderToStaticMarkup(<Freshness timestamp={checked} observedAt={now} />);
    expect(html).toContain("Actualizado ");
    expect(html).toContain("hace 20 min");
    expect(html).not.toContain("Rangos verificados");
  });
});
