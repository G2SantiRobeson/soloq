"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerformancePoint, ActivityPoint } from "@/lib/history";
import { ChartDataTable, CHART_KEYBOARD_HINT } from "./chart-data-table";
import { countLabel } from "@/lib/format";
const date = (v: number | string) =>
  new Date(v).toLocaleDateString("es-CL", { timeZone: "UTC", day: "numeric", month: "short" });
const percent = (v: number) => `${v.toFixed(1)}%`;
export function PerformanceChart({
  points,
  demo = false,
}: {
  points: PerformancePoint[];
  demo?: boolean;
}) {
  if (!points.length)
    return (
      <div className="chart-empty">
        <p>Aún no hay partidas disponibles.</p>
        <span>El rendimiento aparecerá al importar partidas de esta temporada.</span>
      </div>
    );
  const first = points[0];
  const last = points[points.length - 1];
  const best = points.reduce((a, b) => (b.winrate > a.winrate ? b : a));
  const worst = points.reduce((a, b) => (b.winrate < a.winrate ? b : a));
  return (
    <figure className="chart">
      <figcaption className="chart-range">
        <span>
          {percent(first.winrate)} ({date(first.timestamp)})
        </span>
        <span aria-hidden="true">→</span>
        <strong>
          {percent(last.winrate)} ({date(last.timestamp)})
        </strong>
        <span className="chart-extremes">
          Máx. {percent(best.winrate)} · Mín. {percent(worst.winrate)}
        </span>
        <span className="sr-only">
          Winrate móvil de hasta veinte partidas: de {percent(first.winrate)} el{" "}
          {date(first.timestamp)} a {percent(last.winrate)} el {date(last.timestamp)}. Máximo{" "}
          {percent(best.winrate)} el {date(best.timestamp)}; mínimo {percent(worst.winrate)} el{" "}
          {date(worst.timestamp)}.
        </span>
      </figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={points.map((p) => ({ ...p, time: Date.parse(p.timestamp) }))}
          margin={{ left: 0, right: 15, top: 12, bottom: 5 }}
          title="Winrate móvil de la temporada"
          desc={CHART_KEYBOARD_HINT}
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={date}
            minTickGap={45}
            stroke="var(--chart-axis)"
            fontSize={11}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            width={42}
            stroke="var(--chart-axis)"
            fontSize={11}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="chart-tooltip">
                  {date(payload[0].payload.time)}
                  <strong>
                    {Number(payload[0].payload.winrate).toFixed(1)}% ·{" "}
                    {countLabel(payload[0].payload.sample, "partida", "partidas")}
                  </strong>
                </div>
              ) : null
            }
          />
          <Area
            type="linear"
            dataKey="winrate"
            stroke="var(--win)"
            fill="var(--win)"
            fillOpacity={0.12}
            strokeWidth={2}
            dot={points.length === 1}
            activeDot={{ r: 5, fill: "var(--win)", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption={demo ? "Winrate móvil por partida ficticia (UTC)" : "Winrate móvil por día (UTC)"}
        columns={["Día", "Winrate y muestra"]}
        rows={points.map(
          (p) =>
            [
              date(p.timestamp),
              `${percent(p.winrate)} · ${countLabel(p.sample, "partida", "partidas")}`,
            ] as const,
        )}
      />
      <p className="chart-note">
        Winrate móvil de las últimas 20 partidas. Con menos partidas, se usa la muestra disponible.{" "}
        {demo
          ? "Observaciones por partida ficticia; pueden existir varias del mismo día UTC."
          : "Última observación de cada día UTC; remakes excluidos."}
      </p>
    </figure>
  );
}
export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  if (!points.length)
    return <p className="empty-copy">Todavía no hay actividad importada en este período.</p>;
  const total = points.reduce((sum, p) => sum + p.games, 0);
  const busiest = points.reduce((a, b) => (b.games > a.games ? b : a));
  return (
    <figure className="chart">
      <figcaption className="chart-range">
        <strong>{total.toLocaleString("es-CL")} participaciones</strong>
        <span>en {countLabel(points.length, "semana", "semanas")}</span>
        <span className="chart-extremes">
          Semana más activa: {date(busiest.timestamp)} ({busiest.games})
        </span>
      </figcaption>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart
          data={points}
          margin={{ right: 12 }}
          title="Participaciones de jugadores por semana"
          desc={CHART_KEYBOARD_HINT}
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={date}
            minTickGap={45}
            stroke="var(--chart-axis)"
            fontSize={12}
          />
          <YAxis allowDecimals={false} width={42} stroke="var(--chart-axis)" fontSize={12} />
          <Tooltip
            cursor={{ fill: "var(--surface-raised)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="chart-tooltip">
                  Semana del {date(payload[0].payload.timestamp)}
                  <strong>
                    {payload[0].payload.games} participaciones · {payload[0].payload.wins} V /{" "}
                    {payload[0].payload.losses} D
                  </strong>
                </div>
              ) : null
            }
          />
          <Bar dataKey="games" fill="var(--accent)" maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption="Participaciones por semana"
        columns={["Semana del", "Participaciones"]}
        rows={points.map(
          (p) => [date(p.timestamp), `${p.games} (${p.wins} V / ${p.losses} D)`] as const,
        )}
      />
    </figure>
  );
}
