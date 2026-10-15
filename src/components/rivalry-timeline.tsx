import { ArrowLeftRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { Rivalry } from "@/lib/rivalries";
import { rivalryEventKey } from "@/lib/rivalry-timeline";
import type { RivalryEvent, RivalryEventKind } from "@/lib/rivalry-dynamics";
const titles: Record<RivalryEventKind, string> = {
  "leadership-change": "La corona cambió de dueño 👑",
  approaching: "La ventaja se acortó 👀",
  separating: "El líder abrió distancia 💨",
  tie: "Empate en el corte observado",
};
const format = (s: string) =>
  new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(new Date(s));
export function RivalryTimeline({
  events,
  rivalry,
}: {
  events: readonly RivalryEvent[];
  rivalry: Rivalry;
}) {
  if (!events.length) return null;
  const name = (id: string) => rivalry.players.find((p) => p.id === id)?.gameName ?? "Empate";
  return (
    <section className="rivalry-timeline" aria-label="Actividad reciente de esta rivalidad">
      <h4>Actividad reciente de esta rivalidad</h4>
      <ol>
        {events.map((event) => {
          const Icon =
            event.kind === "leadership-change"
              ? ArrowLeftRight
              : event.kind === "approaching"
                ? TrendingDown
                : event.kind === "separating"
                  ? TrendingUp
                  : Minus;
          return (
            <li key={rivalryEventKey(event)}>
              <p>
                <Icon size={13} aria-hidden="true" />
                <strong>{titles[event.kind]}</strong>
              </p>
              <p className="rivalry-event-fact">
                {event.kind === "leadership-change"
                  ? name(event.before.leaderId) +
                    " lideraba; en un corte posterior " +
                    name(event.after.leaderId) +
                    " pasó a liderar."
                  : "Brecha observada: " +
                    event.previousGap +
                    " → " +
                    event.observedGap +
                    " LP" +
                    (event.after.leaderId
                      ? "; " + name(event.after.leaderId) + " seguía liderando."
                      : "; empate en ese corte.")}
              </p>
              <p className="rivalry-event-time">
                <time dateTime={event.before.from} title={event.before.from}>
                  {format(event.before.from)}
                </time>{" "}
                →{" "}
                <time dateTime={event.after.to} title={event.after.to}>
                  {format(event.after.to)}
                </time>{" "}
                UTC
              </p>
            </li>
          );
        })}
      </ol>
      <p className="rivalry-event-note">
        Actividad observada del enfrentamiento seleccionado durante la semana de Santiago. No es un
        archivo completo de rivalidades ni identifica una partida.
      </p>
    </section>
  );
}
