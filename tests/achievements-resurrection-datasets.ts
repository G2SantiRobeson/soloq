import { snapshot } from "./achievements-fixtures";

export const recoveryScenarios = [
  "constant",
  "ascending",
  "descending",
  "oscillating",
  "recoveries",
  "interrupted",
  "near_threshold",
  "adversarial",
] as const;
export type RecoveryScenario = (typeof recoveryScenarios)[number];

/** Fixed, synthetic series; timestamps packed into 28 days to exercise the active window. */
export function recoveryDataset(n: number, scenario: RecoveryScenario) {
  return Array.from({ length: n }, (_, i) => {
    const fraction = i / Math.max(1, n - 1);
    const lp =
      scenario === "constant"
        ? 80
        : scenario === "ascending"
          ? Math.floor(fraction * 99)
          : scenario === "descending"
            ? 99 - Math.floor(fraction * 99)
            : scenario === "oscillating"
              ? i % 2
                ? 70
                : 90
              : scenario === "recoveries"
                ? [90, 30, 90][i % 3]
                : scenario === "interrupted"
                  ? [80, 25, 80][i % 3]
                  : scenario === "near_threshold"
                    ? i % 2
                      ? 41
                      : 90
                    : // A=100, B=49, C=99: the numerical precheck can pass, but no anchor recovers.
                      i < n / 2
                      ? 100
                      : i % 2
                        ? 49
                        : 99;
    return snapshot(lp, fraction * 28, {
      id: `synthetic-${String(i).padStart(6, "0")}`,
      wins: i,
      losses: i,
      ...(scenario === "interrupted" ? { division: i % 2 ? "I" : "II" } : {}),
    });
  });
}
