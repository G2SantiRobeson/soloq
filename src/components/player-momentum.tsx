import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { signedLp, type LpMetrics } from "@/lib/lp-metrics";
export function PlayerMomentum({
  metrics,
  detailed = false,
}: {
  metrics: LpMetrics | null;
  detailed?: boolean;
}) {
  if (!metrics || metrics.net === null)
    return <span className="momentum unavailable">Sin tendencia</span>;
  const Icon = metrics.net > 0 ? ArrowUpRight : metrics.net < 0 ? ArrowDownRight : Minus;
  const direction = metrics.net > 0 ? "Sube" : metrics.net < 0 ? "Baja" : "Estable";
  const format = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const period =
    metrics.from && metrics.to ? `${format(metrics.from)} – ${format(metrics.to)} UTC` : "";
  return (
    <>
      <span
        className={`momentum ${metrics.net > 0 ? "rising" : metrics.net < 0 ? "falling" : "steady"}`}
      >
        <Icon size={13} aria-hidden="true" />
        <span className="sr-only">{direction}: </span>
        {signedLp(metrics.net)}
        <span>LP recientes</span>
      </span>
      {detailed && (
        <span className="momentum-detail">
          {metrics.intervals} intervalos observados{period && ` · ${period}`}
        </span>
      )}
    </>
  );
}
