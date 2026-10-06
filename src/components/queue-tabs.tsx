import Link from "next/link";
import { QUEUE_LABELS, VIEWS, type View } from "@/lib/queues";
const details = { soloq: "SOLO / DÚO", flex: "RANKED EN EQUIPO", "5v5": "SUMMONER’S RIFT" };
export function QueueTabs({
  view,
  base = "/",
  period,
}: {
  view: View;
  base?: string;
  period?: string;
}) {
  return (
    <nav className="queue-tabs" aria-label="Tipo de partida">
      {VIEWS.map((q, i) => (
        <Link
          key={q}
          href={`${base}?queue=${q}${period ? `&period=${encodeURIComponent(period)}` : ""}`}
          className={`queue-tab ${q === view ? "active" : ""}`}
          aria-current={q === view ? "page" : undefined}
        >
          <span className="queue-number" aria-hidden="true">
            0{i + 1}
          </span>
          <span className="queue-name">
            {QUEUE_LABELS[q]}
            <small>{details[q]}</small>
          </span>
        </Link>
      ))}
    </nav>
  );
}
