import Link from "next/link";
import { QUEUE_LABELS, VIEWS, type View } from "@/lib/queues";
const details = { soloq: "Solo / dúo", flex: "Ranked en equipo", "5v5": "Summoner’s Rift" };
export function QueueTabs({
  view,
  base = "/",
  period,
  views = VIEWS,
  hrefFor,
  label = "Tipo de partida",
}: {
  view: View;
  base?: string;
  period?: string;
  /** Sections without 5v5 (rivalries, achievements) list only the ranked queues. */
  views?: readonly View[];
  /** Sections whose links carry their own filters build the destination themselves. */
  hrefFor?: (queue: View) => string;
  label?: string;
}) {
  return (
    <nav className="queue-tabs" aria-label={label}>
      {views.map((q) => (
        <Link
          key={q}
          href={
            hrefFor?.(q) ??
            `${base}?queue=${q}${period ? `&period=${encodeURIComponent(period)}` : ""}`
          }
          className={`queue-tab ${q === view ? "active" : ""}`}
          aria-current={q === view ? "page" : undefined}
        >
          <span className="queue-name">
            {QUEUE_LABELS[q]}
            <small>{details[q]}</small>
          </span>
        </Link>
      ))}
    </nav>
  );
}
