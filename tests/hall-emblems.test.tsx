import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { hallEmblemAsset, HALL_EMBLEM_ASSETS } from "@/lib/hall-of-fame/emblems";
import { HallEmblem, HallOfFame, HallLegacyShowcase } from "@/components/hall-of-fame/hall-of-fame";
const cases = [
  [
    "intocable",
    "el-intocable.webp",
    "350a12a6dc3f62df979778d96da020cf6119eaa82b765c001df814f26c70dd49",
  ],
  [
    "primero-de-su-nombre",
    "el-primero-de-su-nombre.webp",
    "866e498056e13c3dd62c280182e93c4a9988efb29c8d492854b227875580289a",
  ],
  [
    "monarca",
    "el-monarca.webp",
    "04ae64e2dc48f1dd5c9cc9e089a44d41bbfaedd38cd7585e0a3a113800fde008",
  ],
] as const;
beforeEach(() => vi.stubEnv("DEMO_MODE", "true"));
afterEach(() => vi.unstubAllEnvs());
it.each(cases)("maps %s to its exact original, valid local WebP", (id, name, hash) => {
  const asset = hallEmblemAsset(id)!;
  expect(asset.src).toBe(`/achievements/hall-of-fame/${name}`);
  expect(asset.width).toBe(512);
  expect(asset.height).toBe(512);
  const data = readFileSync(`public${asset.src}`);
  expect(createHash("sha256").update(data).digest("hex")).toBe(hash);
  expect(data.toString("ascii", 0, 4)).toBe("RIFF");
  expect(data.readUInt32LE(4)).toBe(data.length - 8);
  expect(data.toString("ascii", 8, 12)).toBe("WEBP");
  expect(data.toString("ascii", 12, 16)).toBe("VP8X");
  expect(data[20] & 16).toBe(16);
  expect(data.readUIntLE(24, 3) + 1).toBe(512);
  expect(data.readUIntLE(27, 3) + 1).toBe(512);
  const html = renderToStaticMarkup(<HallEmblem id={id} />);
  expect(html).toContain(`src="${asset.src}"`);
  expect(html).toContain('alt=""');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('width="512"');
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("/_next/image");
  for (const [otherId, otherName] of cases)
    if (otherId !== id) expect(html).not.toContain(otherName);
});
it("publishes only the three WebP, not original PNGs or the ZIP", () => {
  expect(Object.keys(HALL_EMBLEM_ASSETS)).toHaveLength(3);
  expect(readdirSync("public/achievements/hall-of-fame").sort()).toEqual(
    cases.map((c) => c[1]).sort(),
  );
});
it.each(["unknown", "__proto__", "toString", "El Monarca"])(
  "uses a decorative local fallback for missing ID %s",
  (id) => {
    expect(hallEmblemAsset(id)).toBeNull();
    const html = renderToStaticMarkup(<HallEmblem id={id} />);
    expect(html).toContain("lucide-shield");
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
  },
);
it("reuses exact mapped art in all concept cards and the read-only Demo showcase", () => {
  const hall = renderToStaticMarkup(<HallOfFame view="soloq" />);
  for (const [, name] of cases) expect(hall).toContain(name);
  expect(hall).toContain("acreditación real todavía no disponible");
  expect(hall).toContain("Ficticio · Demo");
  const profile = renderToStaticMarkup(<HallLegacyShowcase playerId="demo-5" view="soloq" />);
  expect(profile).toContain(cases[0][1]);
  expect(profile).not.toContain(cases[1][1]);
  expect(profile).not.toContain(cases[2][1]);
  expect(profile).toContain("Acreditación simulada");
  expect(profile).toContain("Consultar evidencia ficticia");
  expect(profile).not.toMatch(/<button|<form|Equipar/);
  vi.stubEnv("DEMO_MODE", "false");
  expect(HallLegacyShowcase({ playerId: "demo-5", view: "soloq" })).toBeNull();
});
