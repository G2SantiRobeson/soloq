import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AchievementEmblem } from "@/components/achievements/achievement-emblem";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
import { AchievementShowcaseContent } from "@/components/achievements/achievement-showcase";
import { uiFixture, uiPresentation, uiStateFixture } from "./achievements-ui-fixtures";

const context = { enabled: true, selected: true, view: "soloq" as const };
const otp = { championId: 412, champion: "Thresh", games: 80, sample: 100, share: "80" };
const markup = (code: "resurrection" | "unstoppable" | "otp-specialist", compact = false) =>
  decodeURIComponent(renderToStaticMarkup(<AchievementEmblem code={code} compact={compact} />));

describe("original achievement artwork", () => {
  it.each(["resurrection", "unstoppable", "otp-specialist"] as const)(
    "preserves the full square %s artwork in normal and compact displays",
    (code) => {
      for (const compact of [false, true]) {
        const html = markup(code, compact);
        expect(html).toContain(`/achievements/catalog/${code}.webp`);
        expect(html).toContain('width="768" height="768"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).not.toContain("<svg");
      }
    },
  );
  it("puts the evaluated champion behind the OTP frame", () => {
    const html = renderToStaticMarkup(
      <AchievementEmblem code="otp-specialist" specialization={otp} />,
    );
    expect(html).toContain("/champ-icons/412.png");
    expect(html.indexOf("/champ-icons/412.png")).toBeLessThan(html.indexOf("otp-specialist.webp"));
  });
  it("leaves a neutral opening without a known local champion", () => {
    for (const specialization of [null, { ...otp, championId: 999999 }]) {
      const html = renderToStaticMarkup(
        <AchievementEmblem code="otp-specialist" specialization={specialization} />,
      );
      expect(html).not.toContain("/champ-icons/");
      expect(html).not.toContain("https://");
    }
  });
  it("does not put a champion into the other two emblems", () => {
    for (const code of ["resurrection", "unstoppable"] as const) {
      expect(
        renderToStaticMarkup(<AchievementEmblem code={code} specialization={otp} />),
      ).not.toContain("/champ-icons/");
    }
  });
  it("uses the same evaluated OTP identity in the catalog and compact profile", async () => {
    const result = await uiFixture();
    if (result.status !== "available") throw new Error("fixture");
    const evidence = result.evaluations.find((e) => e.code === "otp-specialist")?.evidence;
    if (evidence?.kind !== "recorded_champion_share") throw new Error("fixture OTP evidence");
    const presentation = uiPresentation(result);
    for (const element of [
      <AchievementCatalog key="catalog" {...context} presentation={presentation} />,
      <AchievementShowcaseContent key="profile" presentation={presentation} />,
    ]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain(`/champ-icons/${evidence.championId}.png`);
      expect(html).toMatch(/experimental/i);
      expect(html).not.toMatch(/Insignia desbloqueada|Logro equipado/);
    }
  });
  it.each(["not_observed", "insufficient_evidence", "invalid_input"] as const)(
    "does not suggest an observed OTP identity for %s",
    async (status) => {
      const presentation = uiPresentation(await uiStateFixture(status));
      for (const element of [
        <AchievementCatalog key="catalog" {...context} presentation={presentation} />,
        <AchievementShowcaseContent key="profile" presentation={presentation} />,
      ])
        expect(renderToStaticMarkup(element)).not.toContain("/champ-icons/");
    },
  );
});
