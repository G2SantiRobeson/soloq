import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseSharedRivalry,
  resolveSharedRivalry,
  sharedRivalryPath,
  normalizedRivalIds,
  visibleSharedRivalries,
} from "@/lib/shared-rivalry";
import { parseLadderFilters } from "@/lib/ladder-filters";
import { selectRivalries } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
import { Leaderboard } from "@/components/leaderboard";
import { ShareRivalry } from "@/components/share-rivalry";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z")));
afterEach(() => vi.restoreAllMocks());
const params = { queue: "soloq", rivalA: "demo-4", rivalB: "demo-5" };
describe("validated share links and current-pair resolution", () => {
  it("generates a canonical pair URL preserving queue and reconstructible filters", () => {
    const filters = parseLadderFilters("soloq", {
      q: "Demo#TAG",
      region: "LA2",
      sort: "winrate",
      dir: "asc",
    });
    const path = sharedRivalryPath("soloq", ["demo-5", "demo-4"], filters)!;
    const url = new URL(path, "http://localhost:3001");
    expect(url.pathname).toBe("/rivalidad/demo-4/demo-5");
    expect(url.searchParams.has("rivalA")).toBe(false);
    expect(url.searchParams.has("rivalB")).toBe(false);
    expect(url.searchParams.get("q")).toBe("Demo#TAG");
    expect(url.searchParams.get("region")).toBe("LA2");
    expect(url.searchParams.get("sort")).toBe("winrate");
    expect(url.searchParams.get("dir")).toBe("asc");
    expect(url.hash).toBe("");
    expect(path).toBe(sharedRivalryPath("soloq", ["demo-4", "demo-5"], filters));
  });
  it.each([
    { rivalA: "demo-4" },
    { ...params, rivalA: ["demo-4", "demo-5"] },
    { ...params, rivalA: "../../secret" },
    { ...params, rivalA: "javascript:alert(1)" },
    { ...params, rivalA: "Demo Ronin#DEMO" },
    { ...params, rivalA: "demo-5" },
    { ...params, queue: "wrong" },
  ])("rejects invalid parameters %j", (p) => {
    expect(parseSharedRivalry(p, "soloq").status).toBe("invalid");
  });
  it("normalizes UUID case but never accepts a name or arbitrary external identifier", () => {
    expect(
      normalizedRivalIds([
        "ABCDEF01-0000-0000-0000-000000000000",
        "00000001-0000-0000-0000-000000000000",
      ]),
    ).toEqual(["00000001-0000-0000-0000-000000000000", "abcdef01-0000-0000-0000-000000000000"]);
    expect(sharedRivalryPath("soloq", ["unsafe", "demo-4"])).toBeNull();
    expect(sharedRivalryPath("5v5", ["demo-4", "demo-5"])).toBeNull();
    expect(parseSharedRivalry({}, "soloq").status).toBe("none");
    expect(parseSharedRivalry(params, "flex").status).toBe("invalid");
  });
  it.each(["soloq", "flex"] as const)(
    "resolves only current public %s candidates without duplication",
    (view) => {
      const players = demoPlayers(view),
        request = parseSharedRivalry({ ...params, queue: view }, view),
        result = resolveSharedRivalry(players, view, request);
      expect(result.status).toBe("ready");
      const visible = visibleSharedRivalries(selectRivalries(players, view), result);
      expect(visible).toHaveLength(3);
      expect(visible[0].players.map((p) => p.id).sort()).toEqual(["demo-4", "demo-5"]);
    },
  );
  it("preserves the normal ladder for old, filtered or incompatible pairs", () => {
    const players = demoPlayers("soloq"),
      request = parseSharedRivalry(params, "soloq");
    expect(
      resolveSharedRivalry(
        players.filter((p) => p.id !== "demo-5"),
        "soloq",
        request,
      ).status,
    ).toBe("unavailable");
    const changed = structuredClone(players);
    changed.find((p) => p.id === "demo-5")!.rank!.leaguePoints = 0;
    expect(resolveSharedRivalry(changed, "soloq", request).status).toBe("unavailable");
    const other = structuredClone(players);
    other.find((p) => p.id === "demo-5")!.platform = "EUW1";
    expect(resolveSharedRivalry(other, "soloq", request).status).toBe("unavailable");
    const ordinary = selectRivalries(players, "soloq");
    expect(visibleSharedRivalries(ordinary, { status: "unavailable" })).toEqual(ordinary);
  });
  it("never forces non-adjacent ranked players", () => {
    const players = demoPlayers("soloq").filter((p) => ["demo-4", "demo-5"].includes(p.id));
    const middle = structuredClone(players[0]);
    middle.id = "demo-99";
    middle.rank = { ...middle.rank!, leaguePoints: 45 };
    players.push(middle);
    expect(resolveSharedRivalry(players, "soloq", parseSharedRivalry(params, "soloq")).status).toBe(
      "unavailable",
    );
  });
  it("can highlight an eligible pair outside the ordinary three, dropping overlapping duels", () => {
    const base = demoPlayers("soloq")[3];
    const players = [90, 89, 70, 69, 50, 49, 30, 29].map((lp, i) => ({
      ...structuredClone(base),
      id: "demo-" + (101 + i),
      rank: { ...base.rank!, leaguePoints: lp },
    }));
    const ordinary = selectRivalries(players, "soloq");
    expect(ordinary).toHaveLength(3);
    const result = resolveSharedRivalry(
      players,
      "soloq",
      parseSharedRivalry({ queue: "soloq", rivalA: "demo-107", rivalB: "demo-108" }, "soloq"),
    );
    expect(result.status).toBe("ready");
    const visible = visibleSharedRivalries(ordinary, result);
    expect(visible).toHaveLength(3);
    const ids = visible.flatMap((r) => r.players.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(visible[0].players.map((p) => p.id)).toEqual(["demo-107", "demo-108"]);
  });
  it("renders accessible share action without premature success", () => {
    const html = renderToStaticMarkup(<ShareRivalry ids={["demo-4", "demo-5"]} view="soloq" />);
    expect(html).toContain("Compartir rivalidad");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Enlace copiado.");
    expect(
      renderToStaticMarkup(<ShareRivalry ids={["unsafe", "demo-5"]} view="soloq" />),
    ).toContain("disabled");
  });
  it("preserves legacy shared links without embedding a duel in the homepage", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        players={demoPlayers("soloq")}
        view="soloq"
        demo
        version={null}
        champions={{}}
        initialSharedRivalry={parseSharedRivalry(params, "soloq")}
      />,
    );
    expect(html).not.toContain('class="rivalry-row');
    expect(html).toContain("/rivalidad/demo-4/demo-5?queue=soloq");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('href="/rivalidades?queue=soloq"');
    expect(html).toContain("Abrir enfrentamiento compartido");
  });
  it("reports unavailable or invalid links while keeping ranking content", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        players={demoPlayers("soloq")}
        view="soloq"
        demo
        version={null}
        champions={{}}
        initialSharedRivalry={parseSharedRivalry(params, "soloq")}
        initialFilters={parseLadderFilters("soloq", { q: "Demo Ronin" })}
      />,
    );
    expect(html).toContain("ya no está disponible");
    expect(html).toContain("Demo Ronin");
    expect(html).toContain("Clasificación");
    const invalid = renderToStaticMarkup(
      <Leaderboard
        players={demoPlayers("soloq")}
        view="soloq"
        demo
        version={null}
        champions={{}}
        initialSharedRivalry={{ status: "invalid" }}
      />,
    );
    expect(invalid).toContain("Enlace de rivalidad inválido");
  });
});
