import { TIERS, type Rank, type Tier } from "./ranking";

/** A tier key for presentation. Unknown or missing tiers are "UNRANKED", never guessed. */
export type TierKey = Tier | "UNRANKED";

export function tierKey(rank: Rank | null | undefined): TierKey {
  const tier = rank?.tier;
  return tier && (TIERS as readonly string[]).includes(tier) ? (tier as Tier) : "UNRANKED";
}

export function tierName(key: TierKey): string {
  return key === "UNRANKED" ? "Sin clasificar" : key[0] + key.slice(1).toLowerCase();
}

/** Lower-case token used by the existing `rank-<tier>` colour classes. */
export function tierClass(key: TierKey): string {
  return key.toLowerCase();
}

/** The tier colour token for a `--rank-color` custom property; unranked stays neutral. */
export function tierColorVar(key: TierKey): string {
  return key === "UNRANKED" ? "var(--muted)" : `var(--tier-${tierClass(key)})`;
}

export type Stratum<T> = { key: TierKey; rows: T[] };

/**
 * Splits an already ordered list into consecutive runs of the same tier. Order is never
 * changed here, so the caller's sort (and the preserved ladder positions) stay authoritative.
 */
export function strata<T>(rows: readonly T[], rankOf: (row: T) => Rank | null): Stratum<T>[] {
  const groups: Stratum<T>[] = [];
  for (const row of rows) {
    const key = tierKey(rankOf(row));
    const last = groups.at(-1);
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

/** Players per tier, highest tier first, unranked last. Only tiers that have players appear. */
export function tierDistribution<T>(
  rows: readonly T[],
  rankOf: (row: T) => Rank | null,
): { key: TierKey; count: number }[] {
  const counts = new Map<TierKey, number>();
  for (const row of rows) {
    const key = tierKey(rankOf(row));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order: TierKey[] = [...[...TIERS].reverse(), "UNRANKED"];
  return order.filter((key) => counts.has(key)).map((key) => ({ key, count: counts.get(key)! }));
}
