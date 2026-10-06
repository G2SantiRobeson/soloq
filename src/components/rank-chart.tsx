"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { rankLabel, chartRankCoordinate, chartRankLabel, type Rank } from "@/lib/ranking";
export function RankChart({ history }: { history: (Rank & { timestamp: string })[] }) {
  const data = history.map((h) => ({
    time: Date.parse(h.timestamp),
    date: new Date(h.timestamp).toLocaleString("es-CL", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    value: chartRankCoordinate(h),
    label: `${rankLabel(h)} · ${h.leaguePoints} LP`,
  }));

  const net = (data.at(-1)?.value ?? 0) - (data[0]?.value ?? 0);
  const shortWindow = (data.at(-1)?.time ?? 0) - (data[0]?.time ?? 0) < 2 * 86400_000;
  const lineColor = net > 0 ? "var(--win)" : net < 0 ? "var(--loss)" : "var(--accent)";
  if (data.filter((d) => d.value !== null).length < 2)
    return (
      <div className="chart-empty">
        <p>Aquí empieza tu recorrido.</p>
        <span>El gráfico aparecerá cuando haya al menos dos cambios de rango registrados.</span>
      </div>
    );
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Evolución de rango y LP oficiales: ${data[0]?.label} a ${data.at(-1)?.label}`}
    >
      <div className="chart-range">
        <span>{data[0]?.label}</span>
        <span aria-hidden="true">→</span>
        <strong>{data.at(-1)?.label}</strong>
      </div>
      <ResponsiveContainer width="100%" height={225}>
        <AreaChart data={data} margin={{ top: 15, right: 12, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="rankFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.08} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#272b31" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) =>
              new Date(v).toLocaleString("es-CL", {
                timeZone: "UTC",
                ...(shortWindow
                  ? { hour: "2-digit", minute: "2-digit", hour12: false }
                  : { day: "numeric", month: "short" }),
              })
            }
            stroke="#8a919c"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={45}
          />
          <YAxis
            stroke="#8a919c"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            domain={[
              (min: number) => Math.max(0, Math.floor(min)),
              (max: number) => Math.floor(max) + 1,
            ]}
            width={92}
            allowDecimals={false}
            tickFormatter={chartRankLabel}
          />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="chart-tooltip">
                  {payload[0].payload.date} UTC
                  <strong>{payload[0].payload.label}</strong>
                </div>
              ) : null
            }
          />
          <Area
            type="stepAfter"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#rankFill)"
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="chart-note">
        Solo observaciones oficiales desde el inicio del seguimiento. Las bandas representan tier y
        división; el tooltip muestra los LP oficiales.
      </p>
    </div>
  );
}
