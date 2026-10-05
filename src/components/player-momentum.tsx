import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { signedLp, type LpMetrics } from "@/lib/lp-metrics";
export function PlayerMomentum({ metrics }: { metrics: LpMetrics | null }) {
  if (!metrics || metrics.net === null)
    return <span className="momentum unavailable">Sin tendencia</span>;
  const Icon = metrics.net > 0 ? ArrowUpRight : metrics.net < 0 ? ArrowDownRight : Minus;
  const direction = metrics.net > 0 ? "Sube" : metrics.net < 0 ? "Baja" : "Estable";
  const period =
    metrics.from && metrics.to
      ? `${new Date(metrics.from).toLocaleString("es-CL", { timeZone: "UTC" })} — ${new Date(metrics.to).toLocaleString("es-CL", { timeZone: "UTC" })} UTC`
      : "";
  return (
    <span
      className={`momentum ${metrics.net > 0 ? "rising" : metrics.net < 0 ? "falling" : "steady"}`}
      title={`${direction} · ${metrics.intervals} intervalos observados · ${period}`}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="sr-only">{direction}: </span>
      {signedLp(metrics.net)}
      <span>LP recientes</span>
    </span>
  );
}
