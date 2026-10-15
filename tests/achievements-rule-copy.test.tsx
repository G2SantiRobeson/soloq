import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AchievementPanel } from "@/components/achievements/achievement-panel";
import {
  ACHIEVEMENTS,
  RESURRECTION_RULE,
  UNSTOPPABLE_RULE,
  OTP_RULE,
  evaluateResurrection,
} from "@/lib/achievements";
import { ACHIEVEMENT_STATUS_TEXT } from "@/lib/achievements/presentation";
import { computeAwards } from "@/lib/awards";
import { demoPlayers } from "@/server/demo";
import { rankInput, snapshot } from "./achievements-fixtures";
import { uiFixture, uiPresentation, uiStateFixture } from "./achievements-ui-fixtures";

describe("approved 1.1.G copy preserves rule semantics", () => {
  it("keeps all rule versions, parameters and internal catalog identifiers", () => {
    expect(RESURRECTION_RULE).toEqual({
      version: "1.1.A-observed-v1",
      minDropLp: 50,
      maxRecoveryMs: 30 * 86400000,
      maxGapMs: 7 * 86400000,
    });
    expect(UNSTOPPABLE_RULE).toEqual({ version: "1.1.A-observed-v1", minWins: 5 });
    expect(OTP_RULE).toEqual({
      version: "1.1-otp-observed-v2",
      minGames: 50,
      minShare: { numerator: 13, denominator: 20 },
    });
    expect(ACHIEVEMENTS.map((item) => item.code)).toEqual([
      "resurrection",
      "unstoppable",
      "otp-specialist",
    ]);
  });

  it.each([30, 31])("counts the %i-day recovery window from A, never from B", (day) => {
    const result = evaluateResurrection(
      rankInput([
        snapshot(80, 0),
        snapshot(25, 7),
        snapshot(25, 14),
        snapshot(25, 21),
        snapshot(25, 28),
        snapshot(80, day),
      ]),
    );
    // Both recoveries are less than 30 days after B; only the first is within 30 of A.
    expect(result.status).toBe(day === 30 ? "observed" : "not_observed");
    expect(result.ruleVersion).toBe("1.1.A-observed-v1");
  });

  it.each(["observed", "not_observed", "insufficient_evidence", "invalid_input"] as const)(
    "explains the existing %s result without changing evidence or granting",
    async (status) => {
      const result = await uiStateFixture(status);
      if (result.status !== "available") throw new Error("fixture");
      const original = JSON.stringify(result);
      const dto = uiPresentation(result);
      if (dto.status !== "available") throw new Error("fixture");
      expect(dto.items.map((item) => item.status)).toEqual([status, status, status]);
      expect(dto.items.map((item) => item.ruleVersion)).toEqual([
        "1.1.A-observed-v1",
        "1.1.A-observed-v1",
        "1.1-otp-observed-v2",
      ]);
      for (const item of dto.items) {
        expect(item.statusText).toBe(ACHIEVEMENT_STATUS_TEXT[status]);
        expect(item.certification).toBe("not_established");
        expect(item.grantAuthorized).toBe(false);
      }
      const recovery = dto.items.find((item) => item.code === "resurrection")!;
      expect(recovery.conditions).toContain(
        "≤30 días desde la observación previa a la caída, no desde el mínimo",
      );
      expect(recovery.conditions).toContain("alcanzar o superar el nivel inicial");
      expect(recovery.conditions).toContain("Mismo tier y división");
      expect(recovery.conditions).toContain("huecos ≤7 días entre snapshots oficiales comparables");
      expect(dto.items.find((item) => item.code === "unstoppable")?.name).toBe("Racha imparable");
      if (status === "invalid_input") {
        expect(
          dto.items.every((item) => item.measurement === null && item.evidence.length === 0),
        ).toBe(true);
      }
      const html = renderToStaticMarkup(<AchievementPanel presentation={dto} />);
      expect(html).toContain("Sin certificación ni concesión permanente");
      expect(html).toContain("Criterio y evidencia de Racha imparable");
      expect(html).not.toMatch(/desbloqueado|obtenido oficialmente/);
      expect(JSON.stringify(result)).toBe(original);
    },
  );

  it.each(["soloq", "flex"] as const)(
    "keeps %s and fictitious provenance explicit",
    async (view) => {
      const dto = uiPresentation(await uiFixture(view));
      if (dto.status !== "available") throw new Error("fixture");
      expect(dto.mode).toBe(view === "soloq" ? "SoloQ" : "Flex");
      const streak = dto.items.find((item) => item.code === "unstoppable")!;
      expect(streak.conditions).toContain("≥5 victorias consecutivas");
      expect(streak.conditions).toContain("esta modalidad");
      expect(streak.conditions).toContain(
        "Remakes confirmados se ignoran; derrotas registradas cortan",
      );
      expect(streak.conditions).toContain(
        "desconocidos y fechas ambiguas interrumpen la evidencia",
      );
      expect(streak.evidence.find((row) => row.label === "Límite")?.value).toContain(
        "puede cambiar al incorporar nuevos registros",
      );
      expect(streak.description).toContain("Imparable del Salón de Honor");
      expect(streak.description).toContain("mejor racha comparativa del período");
      expect(renderToStaticMarkup(<AchievementPanel presentation={dto} />)).toContain(
        "Datos ficticios",
      );
    },
  );

  it("keeps the community Imparable title and win-streak key with its different eligibility", () => {
    const player = demoPlayers("soloq")[0];
    const { honor } = computeAwards(
      [player],
      "soloq",
      [
        {
          playerId: player.id,
          games: 10,
          champions: 1,
          zeroKills: 0,
          winStreak: 2,
          lossStreak: 1,
          cs: 1000,
          duration: 18000,
          damage: 10000,
          deaths: 10,
          assists: 20,
        },
      ],
      [],
    );
    expect(honor.find((award) => award.key === "win-streak")).toMatchObject({
      title: "Imparable",
      player: { id: player.id },
      value: "2 seguidas",
    });
  });
});
