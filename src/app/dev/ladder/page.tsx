import { notFound } from "next/navigation";
import { Leaderboard } from "@/components/leaderboard";
import { SyncCountdownAudit } from "@/components/sync-countdown-audit";
import { demoPlayers } from "@/server/demo";
import { getAssets } from "@/server/riot/assets";
import { nextExpectedSyncAt, type SyncStatus } from "@/lib/sync-status";
export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría de ladder", robots: { index: false, follow: false } };
export default async function LadderAudit() {
  if (process.env.NODE_ENV !== "development") notFound();
  const now = new Date();
  const last = new Date(now.getTime() - 598000).toISOString();
  const initial: SyncStatus = {
    lastSuccessfulSyncAt: last,
    nextExpectedSyncAt: nextExpectedSyncAt(last),
    updatedAt: last,
    status: "success",
    schedulerConfigured: false,
    serverNow: now.toISOString(),
  };
  const assets = await getAssets();
  const players = demoPlayers("soloq")
    .slice(0, 4)
    .map((player, i) => ({ ...player, weeklyLp: [154, -130, 0, null][i] }));
  return (
    <>
      <h1>Auditoría de ladder</h1>
      <p className="notice">
        Datos ficticios; solo desarrollo. Se simula un éxito a los 8 segundos y se detecta mediante
        polling. Sin escrituras ni llamadas a Riot.
      </p>
      <p>
        Render del servidor: <time>{now.toISOString()}</time>
      </p>
      <SyncCountdownAudit initial={initial} />
      <Leaderboard
        players={players}
        view="soloq"
        version={assets.version}
        champions={assets.champions}
      />
    </>
  );
}
