import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/rivalidades/page";
import { HeaderNav } from "@/components/header-nav";
import { demoPlayers } from "@/server/demo";
const state = vi.hoisted(() => ({
  path: "/rivalidades",
  query: "",
  read: vi.fn(),
  router: { refresh: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => state.path,
  useRouter: () => state.router,
}));
vi.mock("@/server/queries", () => ({
  getLeaderboard: async (view: "soloq" | "flex") => {
    state.read(view);
    return demoPlayers(view);
  },
}));
vi.mock("@/server/env", () => ({ isDemo: () => true }));
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: null, champions: {} }),
}));
it("adds an active Rivalidades link beside ranking and metrics", () => {
  const html = renderToStaticMarkup(<HeaderNav />);
  expect(html).toContain("Clasificación");
  expect(html).toContain("Métricas");
  expect(html).toContain("Rivalidades");
  expect(html).toContain('href="/rivalidades"');
  expect(html).toContain('aria-current="page"');
});
it.each(["soloq", "flex"] as const)(
  "summarizes automatic %s duels independently of the ranking table",
  async (queue) => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ queue, region: "LA2" }) }),
    );
    expect(html).toContain("Demo Ronin");
    expect(html).toContain("Demo Marea");
    expect(html).toContain('name="region"');
    expect(html).toContain('name="q"');
    expect(html).toContain("<h1>Rivalidades");
    expect(html).not.toContain('class="leaderboard');
    expect(html).not.toContain("Rival elegido");
    expect(html).toContain("/?queue=" + queue);
  },
);
it("shows a truthful empty state when region or search excludes eligible rivals", async () => {
  for (const params of [
    { queue: "soloq", region: "NA1" },
    { queue: "soloq", q: "missing" },
  ]) {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    expect(html).toContain("No hay rivalidades automáticas");
    expect(html).not.toContain('class="rivalry-row');
  }
});
it("does not load ranks or invent rivalries in 5v5", async () => {
  state.read.mockClear();
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ queue: "5v5" }) }),
  );
  expect(html).toContain("5v5 no tiene rivalidades ranked");
  expect(state.read).not.toHaveBeenCalled();
});

it("preserves ranked modality, region, search and ordering in navigation and filter submission", async () => {
  state.query = "queue=flex&q=Demo&region=LA2&sort=kda&dir=asc";
  try {
    const navigation = renderToStaticMarkup(<HeaderNav />);
    expect(navigation).toContain(
      "/rivalidades?queue=flex&amp;q=Demo&amp;region=LA2&amp;sort=kda&amp;dir=asc",
    );
    expect(navigation).toContain("/?queue=flex&amp;q=Demo&amp;region=LA2&amp;sort=kda&amp;dir=asc");
    expect(navigation).toContain("/metrics?queue=flex");
    const page = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(state.query))),
      }),
    );
    expect(page).toContain('name="sort" value="kda"');
    expect(page).toContain('name="dir" value="asc"');
  } finally {
    state.query = "";
  }
});
