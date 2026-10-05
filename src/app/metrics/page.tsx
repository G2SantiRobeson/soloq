import type { Metadata } from "next";
import Link from "next/link";
import { parseView } from "@/lib/queues";
import { getLeaderboard } from "@/server/queries";
import { GlobalMetricsSection } from "@/components/global-metrics-section";
import { QueueTabs } from "@/components/queue-tabs";
export const metadata: Metadata = { title: "Métricas" };
export const dynamic = "force-dynamic";
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const view = parseView((await searchParams).queue);
  const players = await getLeaderboard(view);
  return (
    <>
      <Link href={`/?queue=${view}`} className="back-link">
        ← Volver a la clasificación
      </Link>
      <section className="ladder-heading">
        <div>
          <div className="eyebrow">LA COMUNIDAD EN NÚMEROS</div>
          <h1>
            Métricas<span className="heading-dot">.</span>
          </h1>
        </div>
      </section>
      <QueueTabs view={view} base="/metrics" />
      <GlobalMetricsSection players={players} view={view} />
    </>
  );
}
