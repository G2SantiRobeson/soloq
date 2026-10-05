import { rankLabel, type Rank } from "@/lib/ranking";
import { RankEmblem } from "./rank-emblem";
export function RankDisplay({
  rank,
  noRank = false,
  emblem = true,
  size = 26,
}: {
  rank: Rank | null;
  noRank?: boolean;
  emblem?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`rank-display rank-${noRank ? "unranked" : (rank?.tier.toLowerCase() ?? "unranked")}`}
    >
      {emblem && (
        <RankEmblem tier={noRank ? null : rank?.tier} size={size} variant="compact" decorative />
      )}
      <span>{noRank ? "Sin rango propio" : rankLabel(rank)}</span>
    </span>
  );
}
