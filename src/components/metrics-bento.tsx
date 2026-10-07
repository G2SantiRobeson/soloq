import Link from "next/link";
import type { ReactNode } from "react";
import {
  CloudRain,
  Flame,
  Gamepad2,
  Ghost,
  Skull,
  Snowflake,
  Swords,
  ThumbsDown,
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

/** One bento cell: short heading, optional "how it's calculated" toggletip, content. */
export function Block({
  title,
  info,
  className = "",
  children,
}: {
  title: string;
  info?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`bento-block ${className}`} aria-label={title}>
      <header className="bento-head">
        <h2>{title}</h2>
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
  "best-winrate": Trophy,
  "best-kda": Swords,
  "best-form": Flame,
  "best-climb": TrendingUp,
  "most-games": Gamepad2,
  "win-streak": Zap,
  "worst-winrate": ThumbsDown,
  "worst-kda": Skull,
  "worst-form": Snowflake,
  "worst-drop": TrendingDown,
  "most-deaths": Ghost,
  "loss-streak": CloudRain,
};

export function AwardList({ awards, view }: { awards: Award[]; view: View }) {
  return (
    <ul className="award-list">
      {awards.map((award) => {
        const Icon = ICONS[award.key] ?? Trophy;
        return (
          <li key={award.key}>
            <Icon size={18} aria-hidden="true" className="award-icon" />
            <span className="award-title">{award.title}</span>
            {award.player ? (
              <>
                <PlayerLink player={award.player} view={view} />
                <span className="award-value">
                  {award.value}
                  {award.detail && <small>{award.detail}</small>}
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
      aria-label={`${wins} victorias y ${results.length - wins} derrotas en las últimas ${results.length}, la más reciente primero`}
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
