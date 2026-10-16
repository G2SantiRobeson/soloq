import type { CSSProperties } from "react";
import { tierClass, tierName, type TierKey } from "@/lib/ladder-strata";
import { countLabel } from "@/lib/format";
import { RankEmblem } from "./rank-emblem";

/**
 * The ladder's shape: one segment per tier present, as wide as its share of the visible
 * players. Counts come from the rows on screen (filters included); nothing is estimated.
 * When the table is grouped by tier, every segment jumps to its stratum.
 */
export function TierDistribution({
  items,
  total,
  linked,
  hrefFor,
}: {
  items: { key: TierKey; count: number }[];
  total: number;
  /** Same-page strata exist (the ladder sorted by official rank). */
  linked: boolean;
  /** Elsewhere (metrics), each segment can open its stratum on the ladder instead. */
  hrefFor?: (key: TierKey) => string;
}) {
  if (!items.length) return null;
  return (
    <figure className="tier-distribution">
      <figcaption className="sr-only">
        Distribución por rango: {countLabel(total, "jugador", "jugadores")}
      </figcaption>
      <ol className="tier-distribution-bar">
        {items.map(({ key, count }, index) => {
          const content = (
            <>
              <span className="tier-segment-fill" aria-hidden="true" />
              <span className="tier-segment-label">
                <RankEmblem
                  tier={key === "UNRANKED" ? null : key}
                  size={22}
                  variant="compact"
                  decorative
                />
                {/* Narrow segments hide the visible name; the accessible text never drops it. */}
                <span className="tier-segment-name" aria-hidden="true">
                  {tierName(key)}
                </span>
                <span className="tier-segment-count numeric" aria-hidden="true">
                  {count}
                </span>
                <span className="sr-only">
                  {tierName(key)}: {countLabel(count, "jugador", "jugadores")}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={key}
              className={`tier-segment rank-${tierClass(key)}`}
              style={{ flexGrow: count, "--segment-index": index } as CSSProperties}
            >
              {linked || hrefFor ? (
                <a
                  href={hrefFor?.(key) ?? `#estrato-${tierClass(key)}`}
                  className="tier-segment-link"
                >
                  {content}
                </a>
              ) : (
                <span className="tier-segment-link">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
