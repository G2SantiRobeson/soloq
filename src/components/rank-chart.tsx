"use client";
import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from "recharts";
import {
  rankLabel,
  rankSortValue,
  chartRankCoordinate,
  chartRankLabel,
  type Rank,
} from "@/lib/ranking";
import {
  rankTrajectory,
  rankAtTime,
  validRankObservation,
  type RankCursor,
} from "@/lib/rank-trajectory";
import type { RankSnapshot } from "@/lib/lp-metrics";
import { ChartDataTable, CHART_KEYBOARD_HINT } from "./chart-data-table";

function TrajectoryCursor({
  history,
  cursor,
  onChange,
  onHover,
}: {
  history: RankSnapshot[];
  cursor: RankCursor | null;
  onChange: (point: RankCursor | null) => void;
  onHover: (active: boolean) => void;
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!plot || !xScale || !yScale) return null;
  const times = history.map((point) => Date.parse(point.timestamp)).filter(Number.isFinite);
  const first = Math.min(...times),
    last = Math.max(...times);
  return (
    <g>
      {cursor && (
        <g pointerEvents="none">
          <line
            x1={xScale(cursor.time)}
            x2={xScale(cursor.time)}
            y1={plot.y}
            y2={plot.y + plot.height}
            stroke="var(--border)"
          />
          <circle
            cx={xScale(cursor.time)}
            cy={yScale(cursor.value)}
            r={5}
            fill={cursor.official ? "var(--accent)" : "var(--surface)"}
            stroke="var(--accent)"
            strokeWidth={2}
          />
        </g>
      )}
      <rect
        x={plot.x}
        y={plot.y}
        width={plot.width}
        height={plot.height}
        fill="transparent"
        onPointerEnter={() => onHover(true)}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          const time = first + (last - first) * ratio;
          // Snap only near the real dot, never label an intermediate point as official.
          const nearest = history
            .filter((point) => Number.isFinite(Date.parse(point.timestamp)))
            .reduce((a, b) =>
              Math.abs(Date.parse(a.timestamp) - time) < Math.abs(Date.parse(b.timestamp) - time)
                ? a
                : b,
            );
          const nearestX = xScale(Date.parse(nearest.timestamp));
          const cursorX = xScale(time);
          const nearDot =
            nearestX !== undefined && cursorX !== undefined && Math.abs(nearestX - cursorX) <= 5;
          onChange(rankAtTime(history, nearDot ? Date.parse(nearest.timestamp) : time));
        }}
        onPointerLeave={() => {
          onChange(null);
          onHover(false);
        }}
      />
    </g>
  );
}

export function RankChart({ history }: { history: (Rank & { timestamp: string })[] }) {
  const [cursor, setCursor] = useState<RankCursor | null>(null);
  const [hovering, setHovering] = useState(false);
  const fillId = useId();
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
    value: validRankObservation(h) ? chartRankCoordinate(h) : null,
    order: rankSortValue(h),
    label: `${rankLabel(h)} · ${h.leaguePoints} LP`,
  }));

  const ranked = data.filter((d) => d.value !== null);
  const net = (ranked.at(-1)?.order ?? 0) - (ranked[0]?.order ?? 0);
  const shortWindow = (data.at(-1)?.time ?? 0) - (data[0]?.time ?? 0) < 2 * 86400_000;
  const lineColor = net > 0 ? "var(--win)" : net < 0 ? "var(--loss)" : "var(--accent)";
  if (ranked.length < 2)
    return (
      <div className="chart-empty">
        <p>Aquí empieza tu recorrido.</p>
        <span>El gráfico aparecerá cuando haya al menos dos observaciones de rango válidas.</span>
      </div>
    );
  const highest = ranked.reduce((a, b) => (b.order > a.order ? b : a));
  const lowest = ranked.reduce((a, b) => (b.order < a.order ? b : a));
  const trend = net > 0 ? "sube" : net < 0 ? "baja" : "se mantiene";
  const summary = `Rango oficial: ${trend} de ${ranked[0].label} a ${ranked.at(-1)?.label}. Punto más alto: ${highest.label} (${highest.date} UTC); más bajo: ${lowest.label} (${lowest.date} UTC). ${data.length} registros. La trayectoria entre puntos es aproximada; los intervalos indeterminados no se conectan.`;
  return (
    <figure className="chart">
      <figcaption className="chart-range">
        <span>{ranked[0].label}</span>
        <span aria-hidden="true">→</span>
        <strong>{ranked.at(-1)?.label}</strong>
        <span className="chart-extremes">
          Máx. {highest.label} · Mín. {lowest.label} · {data.length} registros
        </span>
        <span className="sr-only">{summary}</span>
      </figcaption>
      <div className="rank-chart-plot">
        {hovering && (
          <div className="chart-tooltip rank-cursor-tooltip">
            {cursor ? (
              <>
                {new Date(cursor.time).toLocaleString("es-CL", { timeZone: "UTC" })} UTC
                <strong>{cursor.label}</strong>
                <span>
                  {cursor.official
                    ? "Snapshot oficial de Riot"
                    : "Interpolación aproximada · no es un registro de Riot"}
                </span>
              </>
            ) : (
              <span>Intervalo indeterminado · sin interpolación</span>
            )}
          </div>
        )}
        <ResponsiveContainer width="100%" height={225}>
          <AreaChart
            data={rankTrajectory(history)}
            margin={{ top: 15, right: 12, left: 0, bottom: 5 }}
            title={`Evolución de rango: ${trend}`}
            desc={CHART_KEYBOARD_HINT}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
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
              cursor={hovering ? false : { stroke: "var(--border)" }}
              content={({ active, payload }) =>
                !hovering &&
                active &&
                payload?.[0]?.payload.official &&
                payload[0].value !== null ? (
                  <div className="chart-tooltip">
                    {new Date(payload[0].payload.time).toLocaleString("es-CL", { timeZone: "UTC" })}{" "}
                    UTC
                    <strong>{payload[0].payload.label}</strong>
                    Snapshot oficial de Riot
                  </div>
                ) : null
              }
            />
            <Area
              type="linear"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              dot={{ r: 3, fill: lineColor, stroke: "var(--surface)", strokeWidth: 1 }}
              activeDot={
                hovering
                  ? false
                  : { r: 5, fill: lineColor, stroke: "var(--surface)", strokeWidth: 2 }
              }
              connectNulls={false}
              isAnimationActive={false}
            />
            <TrajectoryCursor
              history={history}
              cursor={cursor}
              onChange={setCursor}
              onHover={setHovering}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Registros de rango oficiales (fecha UTC)"
        columns={["Fecha", "Rango y LP"]}
        rows={data.map((d) => [`${d.date} UTC`, d.label] as const)}
      />
      <p className="chart-note">
        Puntos sólidos: snapshots oficiales. Línea: interpolación aproximada, no LP reales de Riot
        ni resultados de partidas. Las bandas representan tier y división. Cambios de rango,
        Unranked, datos inválidos, reinicios y huecos de más de 7 días no se conectan.
      </p>
    </figure>
  );
}
