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
import { ChartDataTable, CHART_KEYBOARD_HINT } from "./chart-data-table";
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
  const ranked = data.filter((d) => d.value !== null);
  if (ranked.length < 2)
    return (
      <div className="chart-empty">
        <p>Aquí empieza tu recorrido.</p>
        <span>El gráfico aparecerá cuando haya al menos dos cambios de rango registrados.</span>
      </div>
    );
  const highest = ranked.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
  const lowest = ranked.reduce((a, b) => ((b.value ?? 0) < (a.value ?? 0) ? b : a));
  const trend = net > 0 ? "sube" : net < 0 ? "baja" : "se mantiene";
  const summary = `Rango oficial: ${trend} de ${data[0].label} a ${data.at(-1)?.label}. Punto más alto: ${highest.label} (${highest.date} UTC); más bajo: ${lowest.label} (${lowest.date} UTC). ${data.length} registros.`;
  return (
    <figure className="chart">
      <figcaption className="chart-range">
        <span>{data[0].label}</span>
        <span aria-hidden="true">→</span>
        <strong>{data.at(-1)?.label}</strong>
        <span className="chart-extremes">
          Máx. {highest.label} · Mín. {lowest.label} · {data.length} registros
        </span>
        <span className="sr-only">{summary}</span>
      </figcaption>
      <ResponsiveContainer width="100%" height={225}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 12, left: 0, bottom: 5 }}
          title={`Evolución de rango: ${trend}`}
          desc={CHART_KEYBOARD_HINT}
        >
          <defs>
            <linearGradient id="rankFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
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
            stroke="var(--chart-axis)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={45}
          />
          <YAxis
            stroke="var(--chart-axis)"
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
            cursor={{ stroke: "var(--border)" }}
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
            activeDot={{ r: 5, fill: lineColor, stroke: "var(--surface)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption="Registros de rango oficiales (fecha UTC)"
        columns={["Fecha", "Rango y LP"]}
        rows={data.map((d) => [`${d.date} UTC`, d.label] as const)}
      />
      <p className="chart-note">
        Solo observaciones oficiales desde el inicio del seguimiento. Las bandas representan tier y
        división; el tooltip muestra los LP oficiales.
      </p>
    </figure>
  );
}
