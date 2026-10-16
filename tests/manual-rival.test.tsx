import { expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoPlayers } from "@/server/demo";
import { manualComparison, validManualChoice } from "@/lib/manual-rival";
import { ManualRival } from "@/components/manual-rival";
import { ManualDuel } from "@/components/manual-duel";
import { getLocalRivalOptions } from "@/server/local-rival-options";
import { POST } from "@/app/api/player/[id]/rival/route";
const database = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: () => database }));
vi.mock("@/server/profile-rival", () => ({
  getProfileRivalPool: async (view: "soloq" | "flex", platform: string) =>
    demoPlayers(view).filter((p) => p.platform === platform),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each(["true", "false"])(
  "blocks legacy public writes even with storage enabled, Demo=%s",
  async (demo) => {
    vi.stubEnv("DEMO_MODE", demo);
    vi.stubEnv("MANUAL_RIVALS_ENABLED", "true");
    const response = await POST(
      new Request("http://localhost:3001/api/player/demo-4/rival", {
        method: "POST",
        body: JSON.stringify({ queue: "soloq", rivalId: "demo-5" }),
      }),
      { params: Promise.resolve({ id: "demo-4" }) },
    );
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(database.execute).not.toHaveBeenCalled();
  },
);
it("loads only public candidates and ignores server selections and flags", async () => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("MANUAL_RIVALS_ENABLED", "true");
  const a = demoPlayers("soloq")[3],
    options = await getLocalRivalOptions(a, "soloq");
  expect(options.available).toBe(true);
  expect(options.selectedId).toBeNull();
  expect(options.candidates.some((p) => p.id === "demo-5")).toBe(true);
  expect(options.candidates.some((p) => p.id === "demo-1")).toBe(true);
  expect(options.candidates.some((p) => p.id === a.id || p.platform !== a.platform)).toBe(false);
  expect(database.execute).not.toHaveBeenCalled();
  expect((await getLocalRivalOptions(a, "5v5")).available).toBe(false);
});
it("preserves genuine LP and avoids SSR preference leakage", () => {
  const [a, b] = demoPlayers("soloq").slice(3, 5);
  expect(validManualChoice(a, b)).toBe(true);
  expect(validManualChoice(a, a)).toBe(false);
  expect(manualComparison(a, b)).toEqual({ leaderId: a.id, gap: 25 });
  const html = renderToStaticMarkup(
    <ManualRival
      player={a}
      view="soloq"
      initial={{ available: true, demo: true, selectedId: b.id, candidates: [b] }}
    />,
  );
  expect(html).toContain("Tu rival elegido en este navegador");
  expect(html).toContain("Esta selección es local");
  expect(html).not.toContain("Cualquiera puede cambiar");
  expect(html).not.toContain("Demo Marea</strong>");
  expect(
    renderToStaticMarkup(<ManualDuel players={[a, b]} view="soloq" version={null} demo />),
  ).toContain("25 LP");
});
