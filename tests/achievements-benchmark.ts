/** Opt-in synthetic benchmark. No imports from server, environment files or real player data. */
import { performance } from "node:perf_hooks";
import {
  evaluateOtpSpecialist,
  evaluateResurrection,
  evaluateUnstoppable,
} from "../src/lib/achievements/index";
import { fixedScope, match, matchContext, rankInput, snapshot } from "./achievements-fixtures";

for (const n of [50, 500, 5_000, 50_000]) {
  const input = {
    ...matchContext(Array.from({ length: n }, (_, i) => match(i))),
    scope: { ...fixedScope, asOf: "2026-12-31T23:59:59Z" },
  };
  for (const [name, evaluate] of [
    ["unstoppable", evaluateUnstoppable],
    ["otp", evaluateOtpSpecialist],
  ] as const) {
    const start = performance.now();
    const result = evaluate(input);
    console.log(
      JSON.stringify({
        name,
        n,
        elapsedMs: +(performance.now() - start).toFixed(2),
        status: result.status,
      }),
    );
  }
}
for (const n of [30, 300, 3_000]) {
  // Flat dense history stresses the no-recovery search and retains all candidates for 30 days.
  const input = rankInput(
    Array.from({ length: n }, (_, i) => snapshot(80, (i / n) * 28, { wins: i, losses: i })),
  );
  const start = performance.now();
  const result = evaluateResurrection(input);
  console.log(
    JSON.stringify({
      name: "resurrection-flat",
      n,
      elapsedMs: +(performance.now() - start).toFixed(2),
      status: result.status,
    }),
  );
}
