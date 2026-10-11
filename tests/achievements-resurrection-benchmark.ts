/** Optional; no DB/network, no CI timing thresholds. Run with node --import tsx. */
import { performance } from "node:perf_hooks";
import { evaluateResurrection } from "../src/lib/achievements/resurrection";
import { referenceResurrection } from "./achievements-resurrection-reference";
import { rankInput } from "./achievements-fixtures";
import { recoveryDataset, recoveryScenarios } from "./achievements-resurrection-datasets";

const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
for (const n of [30, 300, 3000, 10000]) {
  for (const scenario of recoveryScenarios) {
    const prepare = performance.now();
    const input = rankInput(recoveryDataset(n, scenario));
    const preparationMs = performance.now() - prepare;
    const measurements: Record<string, unknown> = {};
    for (const [name, run] of [
      ["reference", referenceResurrection],
      ["current", evaluateResurrection],
    ] as const) {
      run(rankInput(recoveryDataset(30, scenario))); // Warm validation paths without hiding large costs.
      const times: number[] = [],
        heaps: number[] = [];
      for (let trial = 0; trial < 3; trial++) {
        const heap = process.memoryUsage().heapUsed,
          start = performance.now();
        run(input);
        times.push(performance.now() - start);
        heaps.push((process.memoryUsage().heapUsed - heap) / 1048576);
      }
      measurements[name] = {
        medianMs: +median(times).toFixed(2),
        minMs: +Math.min(...times).toFixed(2),
        maxMs: +Math.max(...times).toFixed(2),
        heapDeltaMiB: +median(heaps).toFixed(2),
        totalMedianMs: +(preparationMs + median(times)).toFixed(2),
      };
    }
    console.log(
      JSON.stringify({ n, scenario, preparationMs: +preparationMs.toFixed(2), ...measurements }),
    );
  }
}
