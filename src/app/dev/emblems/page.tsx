import { notFound } from "next/navigation";
import { TIERS } from "@/lib/ranking";
import { RankEmblem } from "@/components/rank-emblem";
import { RankAvatar } from "@/components/rank-avatar";
import { RankDisplay } from "@/components/rank-display";
import { LPDisplay } from "@/components/lp-display";
import { Leaderboard } from "@/components/leaderboard";
import { demoPlayers } from "@/server/demo";
export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría de emblemas", robots: { index: false, follow: false } };
export default function EmblemAudit() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <h1>Auditoría de emblemas</h1>
      <p className="metric-note">Fixtures de revisión visual. Datos ficticios; solo desarrollo.</p>
      <div className="emblem-audit-grid">
        {[...TIERS, "UNRANKED", "MISSING"].map((tier) => (
          <div key={tier}>
            <RankAvatar tier={tier} size={112} name="Jugador" src="/champ-icons/103.png" />
            <RankEmblem tier={tier} size={112} />
            <strong>{tier}</strong>
            <div>
              <RankEmblem tier={tier} size={64} />
              <RankEmblem tier={tier} size={26} variant="compact" />
            </div>
          </div>
        ))}
      </div>
      <Leaderboard players={demoPlayers("soloq")} view="soloq" version={null} champions={{}} />
      <h2>Perfil: nombre de rango largo</h2>
      <div className="profile-grid">
        <section className="panel rank-panel">
          <div className="card-label">RANGO ACTUAL</div>
          <div className="profile-rank-heading">
            <RankEmblem tier="GRANDMASTER" size={112} decorative />
            <RankDisplay
              rank={{ tier: "GRANDMASTER", division: "I", leaguePoints: 999, wins: 1, losses: 1 }}
              emblem={false}
            />
          </div>
          <div className="profile-lp">
            <LPDisplay
              rank={{ tier: "GRANDMASTER", division: "I", leaguePoints: 999, wins: 1, losses: 1 }}
            />
          </div>
        </section>
      </div>
    </>
  );
}
