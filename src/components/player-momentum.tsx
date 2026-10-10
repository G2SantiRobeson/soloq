import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { signedLp, type LpMetrics, type FiveMatchLp } from "@/lib/lp-metrics";
import { InfoTip } from "./info-tip";
import type { WeeklyLp } from "@/lib/weekly-lp";
import { APP_TIMEZONE } from "@/lib/time";

export function WeeklyMomentum({ summary }: { summary?: WeeklyLp | null }) {
  if (!summary) return <small className="muted">Sin datos suficientes</small>;
  const format = (iso: string) => new Date(iso).toLocaleString("es-CL", { timeZone: APP_TIMEZONE });
  return (
    <>
      <InfoTip term={`${signedLp(summary.net)} LP`}>
        Variación neta de rango y balance oficial entre {format(summary.from)} y{" "}
        {format(summary.to)} ({APP_TIMEZONE}).
        {summary.partial
          ? " Referencia parcial: no hay baseline válido anterior al lunes."
          : " Referencia oficial anterior o igual al lunes 00:00; puede incluir actividad anterior al lunes."}{" "}
        No son LP individuales de MATCH-V5.
      </InfoTip>
      <small className="weekly-record">
        {summary.wins}V · {summary.losses}D
      </small>
      <small className="weekly-reference muted">
        {summary.partial ? "Δ parcial · desde " : "Semana observada · desde "}
        {new Date(summary.from).toLocaleString("es-CL", {
          timeZone: APP_TIMEZONE,
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </small>
    </>
  );
}
export function LastFiveMomentum({ metrics }: { metrics?: FiveMatchLp }) {
  const explanation =
    metrics?.reason ??
    "Faltan observaciones oficiales que delimiten exactamente las cinco partidas visibles.";
  const value = metrics?.net;
  return (
    <span
      className={`momentum last-five-momentum ${value == null ? "unavailable" : value > 0 ? "rising" : value < 0 ? "falling" : "steady"}`}
    >
      <InfoTip
        term={
          value == null ? (
            "LP últimas 5: no verificable"
          ) : (
            <>
              {signedLp(value)} LP <small>/ últimas 5</small>
            </>
          )
        }
      >
        {explanation}
        {metrics?.from &&
          metrics.to &&
          ` Intervalo oficial: ${new Date(metrics.from).toLocaleString("es-CL", { timeZone: "America/Santiago" })} – ${new Date(metrics.to).toLocaleString("es-CL", { timeZone: "America/Santiago" })} (America/Santiago).`}
      </InfoTip>
    </span>
  );
}
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
