import { describe, expect, it } from "vitest";
import {
  evaluateOtpSpecialist,
  evaluateResurrection,
  evaluateUnstoppable,
  RESURRECTION_RULE,
} from "@/lib/achievements";
import type { AchievementSnapshot } from "@/lib/achievements";
import {
  deepFreeze,
  match,
  matchContext,
  rankInput,
  shuffle,
  snapshot,
} from "./achievements-fixtures";

/** Independent exhaustive triple oracle for small clean segments, including the minimum tie policy. */
function recoveryOracle(rows: readonly AchievementSnapshot[]) {
  for (let c = 2; c < rows.length; c++) {
    const candidates: { a: number; b: number; drop: number }[] = [];
    for (let a = 0; a < c - 1; a++) {
      if (
        Date.parse(rows[c].timestamp) - Date.parse(rows[a].timestamp) >
        RESURRECTION_RULE.maxRecoveryMs
      )
        continue;
      const minimum = Math.min(...rows.slice(a + 1, c).map((s) => s.leaguePoints));
      for (let b = a + 1; b < c; b++) {
        if (
          rows[b].leaguePoints !== minimum ||
          rows[b].losses <= rows[a].losses ||
          rows[c].wins <= rows[b].wins
        )
          continue;
        const drop = rows[a].leaguePoints - minimum;
        if (drop >= 50 && rows[c].leaguePoints >= rows[a].leaguePoints) {
          candidates.push({ a, b, drop });
          break;
        }
      }
    }
    candidates.sort((x, y) => y.drop - x.drop || x.a - y.a || x.b - y.b);
    if (candidates[0]) return { ...candidates[0], c };
  }
  return null;
}
describe("seeded adversarial properties", () => {
  it("recovery search agrees with an exhaustive oracle across 250 reproducible histories", () => {
    let state = 1337;
    for (let trial = 0; trial < 250; trial++) {
      let wins = 20,
        losses = 10;
      const rows = Array.from({ length: 12 }, (_, i) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        wins += trial < 125 || state % 3 === 0 ? 1 : 0;
        losses += trial < 125 || state % 5 === 0 ? 1 : 0;
        return snapshot(state % 101, i, { wins, losses });
      });
      const oracle = recoveryOracle(rows);
      const result = evaluateResurrection(deepFreeze(rankInput(shuffle(rows, trial))));
      expect(result.status === "observed").toBe(oracle !== null);
      if (oracle && result.status === "observed")
        expect([
          result.evidence.before.id,
          result.evidence.minimum.id,
          result.evidence.recovered.id,
        ]).toEqual([rows[oracle.a].id, rows[oracle.b].id, rows[oracle.c].id]);
    }
  });
  it("rank evidence is drawn entirely from input snapshots, and adding an intervening reset cannot manufacture it", () => {
    const rows = [snapshot(80, 0), snapshot(25, 2), snapshot(80, 4)];
    const result = evaluateResurrection(rankInput(rows));
    if (result.status !== "observed") throw new Error("Expected recovery");
    expect(
      result.evidence.observations.every((point) =>
        rows.some((row) => JSON.stringify(row) === JSON.stringify(point)),
      ),
    ).toBe(true);
    expect(
      evaluateResurrection(rankInput([...rows, snapshot(0, 3, { wins: 0, losses: 0 })])).status,
    ).toBe("insufficient_evidence");
  });
  it("matches agree with simple independent streak/count oracles over fixed seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let state = seed;
      const rows = Array.from({ length: 100 }, (_, i) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return match(i, {
          win: state % 5 !== 0,
          isRemake: state % 13 === 0,
          championId: (state % 4) + 1,
        });
      });
      let run = 0,
        max = 0;
      const counts = new Map<number, number>();
      let n = 0;
      for (const m of rows) {
        if (m.isRemake) continue;
        run = m.win ? run + 1 : 0;
        max = Math.max(max, run);
        n++;
        counts.set(m.championId!, (counts.get(m.championId!) ?? 0) + 1);
      }
      const frozen = deepFreeze(matchContext(shuffle(rows, seed)));
      const streak = evaluateUnstoppable(frozen);
      const otp = evaluateOtpSpecialist(frozen);
      expect(streak.evidence?.maxObservedWins ?? 0).toBe(max);
      expect(otp.evidence?.validGames).toBe(n);
      expect(otp.evidence?.championGames).toBe(Math.max(...counts.values()));
      expect(evaluateUnstoppable(frozen)).toEqual(streak);
      expect(evaluateOtpSpecialist(frozen)).toEqual(otp);
    }
  });
});
