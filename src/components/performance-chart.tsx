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
const date = (v: number | string) =>
  new Date(v).toLocaleDateString("es-CL", { timeZone: "UTC", day: "numeric", month: "short" });
export function PerformanceChart({ points }: { points: PerformancePoint[] }) {
  if (!points.length)
    return (
      <div className="chart-empty">
        <p>Aún no hay partidas disponibles.</p>
        <span>El rendimiento aparecerá al importar partidas de esta temporada.</span>
      </div>
    );
  return (
    <div
      className="chart"
      role="img"
      aria-label="Winrate móvil de hasta veinte partidas, durante la temporada"
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={points.map((p) => ({ ...p, time: Date.parse(p.timestamp) }))}
          margin={{ left: 0, right: 15, top: 12, bottom: 5 }}
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
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="chart-tooltip">
                  {date(payload[0].payload.time)}
                  <strong>
                    {Number(payload[0].payload.winrate).toFixed(1)}% · {payload[0].payload.sample}{" "}
                    partidas
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
            fillOpacity={0.08}
            strokeWidth={2}
            dot={points.length === 1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="chart-note">
        Winrate móvil de las últimas 20 partidas. Con menos partidas, se usa la muestra disponible.
        Última observación de cada día UTC; remakes excluidos.
      </p>
    </div>
  );
}
export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  if (!points.length)
    return <p className="empty-copy">Todavía no hay actividad importada en este período.</p>;
  return (
    <div className="chart" role="img" aria-label="Participaciones de jugadores por semana">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={points} margin={{ right: 12 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={date}
            minTickGap={45}
            stroke="var(--chart-axis)"
            fontSize={11}
          />
          <YAxis allowDecimals={false} width={42} stroke="var(--chart-axis)" fontSize={11} />
          <Tooltip
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
      <p className="chart-note">
        Cada jugador cuenta una participación: una partida compartida puede sumar varias. Remakes
        excluidos. Las semanas vacías entre observaciones indican cero participaciones importadas;
        durante un backfill, la cobertura todavía es parcial.
      </p>
    </div>
  );
}
