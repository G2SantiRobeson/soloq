import Link from "next/link";
import type { ReactNode } from "react";
import {
  CloudRain,
  Flame,
  Layers,
  Wheat,
  Sprout,
  Crosshair,
  HandHeart,
  HeartCrack,
  Bird,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { PublicPlayer } from "@/lib/types";
import type { View } from "@/lib/queues";
import type { Award, FormRow } from "@/lib/awards";
import { InfoTip } from "./info-tip";
import { countLabel } from "@/lib/format";

/**
 * One bento cell: short heading, optional data-provenance tag, optional
 * "how it's calculated" toggletip, content.
 */
export function Block({
  title,
  info,
  tag,
  className = "",
  children,
}: {
  title: string;
  info?: ReactNode;
  tag?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`bento-block ${className}`} aria-label={title}>
      <header className="bento-head">
        <h2>{title}</h2>
        {tag && <span className="bento-tag">{tag}</span>}
        {info && (
          <InfoTip label={`Cómo se calcula: ${title}`} align="end">
            {info}
          </InfoTip>
        )}
      </header>
      {children}
    </section>
  );
}

export function PlayerLink({ player, view }: { player: PublicPlayer; view: View }) {
  return (
    <Link className="bento-player" href={`/player/${player.id}?queue=${view}`}>
      {player.gameName}
      <span>#{player.tagLine}</span>
    </Link>
  );
}

export function HeroStat({
  value,
  player,
  view,
  note,
  aside,
  badge,
}: {
  value: string;
  badge?: ReactNode;
  player: PublicPlayer | null | undefined;
  view: View;
  note: string;
  aside?: ReactNode;
}) {
  return (
    <div className="hero-stat">
      <div>
        <strong className="hero-value">{value}</strong>
        {badge}
        {player ? (
          <PlayerLink player={player} view={view} />
        ) : (
          <span className="bento-empty">Muestra insuficiente</span>
        )}
        <small>{note}</small>
      </div>
      {aside}
    </div>
  );
}

const ICONS: Record<string, LucideIcon> = {
  "best-climb": TrendingUp,
  "win-streak": Zap,
  "champion-diversity": Layers,
  "best-farm": Wheat,
  "damage-per-minute": Flame,
  "most-assists": HandHeart,
  "least-assists": HeartCrack,
  "worst-drop": TrendingDown,
  "most-deaths": Crosshair,
  "loss-streak": CloudRain,
  "worst-farm": Sprout,
  "zero-kills": Bird,
};

export function AwardList({ awards, view }: { awards: Award[]; view: View }) {
  return (
    <ul className="award-list">
      {awards.map((award) => {
        const Icon = ICONS[award.key] ?? Trophy;
        return (
          <li key={award.key}>
            <Icon size={18} aria-hidden="true" className="award-icon" />
            <span className="award-title">
              {award.title}
              <InfoTip label={`Cómo se calcula: ${award.title}`} align="start">
                {award.criterion}
                {award.partial &&
                  " Muestra parcial: el premio puede cambiar cuando se complete el historial."}
              </InfoTip>
            </span>
            {award.player ? (
              <>
                <PlayerLink player={award.player} view={view} />
                <span className="award-value">
                  {award.value}
                  {award.detail && <small>{award.detail}</small>}
                  {award.partial && <small className="award-partial">Historial parcial</small>}
                </span>
              </>
            ) : (
              <span className="bento-empty award-empty">{award.empty}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function FormDots({ results }: { results: boolean[] }) {
  const wins = results.filter(Boolean).length;
  return (
    <span
      className="form-dots"
      role="img"
      aria-label={`${countLabel(wins, "victoria", "victorias")} y ${countLabel(results.length - wins, "derrota", "derrotas")} en las últimas ${results.length}, la más reciente primero`}
    >
      {results.map((win, i) => (
        <span key={i} className={win ? "dot-win" : "dot-loss"} aria-hidden="true" />
      ))}
    </span>
  );
}

export function FormRows({ rows, view }: { rows: FormRow[]; view: View }) {
  return (
    <ol className="form-rows">
      {rows.map((row) => (
        <li key={row.player.id}>
          <PlayerLink player={row.player} view={view} />
          <FormDots results={row.results} />
          <strong>{((100 * row.wins) / row.games).toFixed(0)}%</strong>
        </li>
      ))}
    </ol>
  );
}

export function TrendBar({
  segments,
}: {
  segments: { key: string; label: string; count: number }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="trend">
      <div className="trend-bar" aria-hidden="true">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span
              key={s.key}
              className={`trend-${s.key}`}
              style={{ width: `${(100 * s.count) / Math.max(1, total)}%` }}
            />
          ))}
      </div>
      <ul className="trend-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`trend-swatch trend-${s.key}`} aria-hidden="true" />
            <strong>{s.count}</strong> {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
