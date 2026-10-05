import type { Rank } from "@/lib/ranking";
export function LPDisplay({ rank, noRank = false }: { rank: Rank | null; noRank?: boolean }) {
  return (
    <span className="lp-display numeric">
      <strong>
        {!noRank && rank && rank.tier !== "UNRANKED"
          ? rank.leaguePoints.toLocaleString("es-CL")
          : "—"}
      </strong>
      <span>LP</span>
    </span>
  );
}
