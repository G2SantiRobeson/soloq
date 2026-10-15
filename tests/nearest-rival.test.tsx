import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { selectNearestRival, type RivalIdentity } from "@/lib/nearest-rival";
import { selectRivalries } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
import { ProfileRival } from "@/components/profile-rival";
const player = (id: string, lp = 50): RivalIdentity => ({
  id,
  gameName: id,
  tagLine: "LAS",
  platform: "LA2",
  profileIconId: null,
  observedAt: "2026-10-14T12:00:00Z",
  rank: { tier: "DIAMOND", division: "I", leaguePoints: lp, wins: 20, losses: 10 },
});
afterEach(() => vi.restoreAllMocks());
describe("individual nearest eligible official neighbour", () => {
  it("selects proximity before direction, deterministically", () => {
    const pool = [player("me"), player("a", 49), player("z", 51)],
      copy = structuredClone(pool);
    expect(selectNearestRival(pool, "me", "soloq")?.rival.id).toBe("a");
    expect(selectNearestRival(pool.toReversed(), "me", "soloq")?.rival.id).toBe("a");
    expect(pool).toEqual(copy);
    expect(selectNearestRival(pool, "me", "soloq")?.relation).toBe("behind");
  });
  it("does not require membership in the three featured pairs", () => {
    const pool = [90, 89, 70, 69, 50, 49, 30, 29].map((lp, i) => player("p" + i, lp));
    expect(selectRivalries(pool, "soloq").flatMap((r) => r.players.map((p) => p.id))).not.toContain(
      "p7",
    );
    expect(selectNearestRival(pool, "p7", "soloq")?.rival.id).toBe("p6");
  });
  it.each(["missing", "rank", "platform", "tier", "bad", "duplicate", "far"] as const)(
    "does not create a rival with %s input",
    (reason) => {
      const me = player("me"),
        other = player("other");
      let pool = [me, other];
      if (reason === "missing") pool = [other];
      if (reason === "rank") me.rank = null;
      if (reason === "platform") other.platform = "EUW1";
      if (reason === "tier") other.rank = { ...other.rank!, tier: "MASTER" };
      if (reason === "bad") other.rank = { ...other.rank!, leaguePoints: -1 };
      if (reason === "duplicate") pool.push({ ...me });
      if (reason === "far") other.rank = { ...other.rank!, leaguePoints: 90 };
      expect(selectNearestRival(pool, "me", "soloq")).toBeNull();
    },
  );
  it("preserves a tied rank without claiming a lead", () => {
    expect(selectNearestRival([player("me"), player("other")], "me", "soloq")?.relation).toBe(
      "tied",
    );
  });
  it("does not invent an LP gap across adjacent divisions", () => {
    const me = player("me", 5),
      other = player("other", 95);
    other.rank = { ...other.rank!, division: "II" };
    const selection = selectNearestRival([me, other], "me", "soloq")!;
    expect(selection.pair.lpDifference).toBeNull();
    expect(selection.relation).toBe("behind");
    const html = renderToStaticMarkup(
      <ProfileRival
        result={{ status: "ready", selection, visibleOnLadder: false }}
        view="soloq"
        version={null}
        demo={false}
      />,
    );
    expect(html).toContain("no hay diferencia de LP comparable");
    expect(html).not.toContain("90 LP por");
  });
  it("keeps apex categories distinct and rejects 5v5", () => {
    const me = player("me"),
      other = player("other");
    me.rank = { ...me.rank!, tier: "MASTER" };
    other.rank = { ...other.rank!, tier: "GRANDMASTER" };
    expect(selectNearestRival([me, other], "me", "soloq")).toBeNull();
    expect(selectNearestRival([player("me"), player("other")], "me", "5v5")).toBeNull();
  });
  it.each(["soloq", "flex"] as const)("renders coherent Demo profile navigation for %s", (view) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z"));
    const selection = selectNearestRival(demoPlayers(view), "demo-4", view)!;
    expect(selection.rival.id).toBe("demo-5");
    expect(selection.pair.lpDifference).toBe(view === "soloq" ? 25 : 1);
    const html = renderToStaticMarkup(
      <ProfileRival
        result={{ status: "ready", selection, visibleOnLadder: true }}
        view={view}
        version={null}
        demo
      />,
    );
    expect(html).toContain("Rival en la mira");
    expect(html).toContain("Ficticio");
    expect(html).toContain("/player/demo-5?queue=" + view);
    expect(html).toContain("/rivalidad/demo-4/demo-5");
    expect(html).toContain("region=LA2");
    expect(html).toContain("#DEMO");
  });
  it("keeps empty or incomplete states discrete and distinguishes changed ranks", () => {
    const html = renderToStaticMarkup(
      <ProfileRival result={{ status: "none" }} view="soloq" version={null} demo />,
    );
    expect(html).toContain("No hay un rival cercano");
    expect(
      renderToStaticMarkup(
        <ProfileRival result={{ status: "incomplete" }} view="soloq" version={null} demo />,
      ),
    ).toContain("lectura completa");
    expect(
      renderToStaticMarkup(
        <ProfileRival result={{ status: "changed" }} view="soloq" version={null} demo />,
      ),
    ).toContain("Recarga el perfil");
    expect(
      renderToStaticMarkup(
        <ProfileRival result={{ status: "none" }} view="5v5" version={null} demo />,
      ),
    ).toBe("");
  });
});
