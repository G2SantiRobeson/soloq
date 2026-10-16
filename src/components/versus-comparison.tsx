import type { PublicPlayer } from "@/lib/types";
import type { View } from "@/lib/queues";
import type { ChampionCatalog } from "@/lib/champion-assets";
import {
  versusMetrics,
  versusMoment,
  versusWeeklyLp,
  type VersusMetric,
} from "@/lib/versus-comparison";
import { CURRENT_SEASON, HISTORY_LABELS } from "@/lib/season";
import { winrate } from "@/lib/stats";
import { RIVALRY_EVENT_LABELS } from "@/lib/rivalry-dynamics";
import { ArrowRight } from "lucide-react";
import { RivalryLeadership } from "./rivalry-leadership";
import { RecentChampionForm } from "./recent-champion-form";
import styles from "./versus.module.css";

const date = (value: string) =>
  new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(new Date(value));
function ObservedDate({ value }: { value: string | null | undefined }) {
  return value && Number.isFinite(Date.parse(value)) ? (
    <time dateTime={value}>{date(value)} UTC</time>
  ) : (
    <>Sin fecha acreditada</>
  );
}
const sampleLabel = (p: PublicPlayer) =>
  Number.isSafeInteger(p.stats.games) && p.stats.games > 0
    ? p.stats.games.toLocaleString("es-CL") + " partidas importadas"
    : "Sin muestra disponible";
const metricOrder = ["winrate", "kda", "rank", "lp", "record", "weekly"];

export function VersusComparison({
  players,
  view,
  champions,
  demo,
}: {
  players: readonly [PublicPlayer, PublicPlayer];
  view: View;
  champions: ChampionCatalog;
  demo: boolean;
}) {
  const metrics = versusMetrics(players, view);
  const moment = versusMoment(players, view);
  if (!metrics.length)
    return (
      <p className="data-note">Esta comparación no está disponible para la modalidad o región.</p>
    );
  const ordered = metricOrder.flatMap((key) => metrics.filter((m) => m.key === key));
  return (
    <div className={styles.comparison}>
      <section className={styles.board} aria-labelledby="vs-metrics-title">
        <header className={styles.sectionHeading}>
          <h2 id="vs-metrics-title">Los números, frente a frente</h2>
          <span className={styles.sourceTags}>
            {demo && <span className={styles.demo}>Ficticio · Demo</span>}
            <span>{demo ? "Rango simulado" : "Oficial registrado"}</span>
            <span>Historial importado</span>
          </span>
        </header>
        <p className={styles.sourceIntro}>
          Rango y LP {demo ? "simulados" : "oficiales registrados"}. Rendimiento de muestras
          propias; su tamaño y cobertura pueden ser distintos.
        </p>
        <div className={styles.scoreboard} role="list" aria-label="Marcador comparativo">
          {ordered.map((m) => (
            <ScoreRow key={m.key} metric={m} players={players} />
          ))}
        </div>
        <details className={styles.methodology}>
          <summary>Fuentes, cobertura y metodología</summary>
          <div className={styles.methodBody}>
            <p>{CURRENT_SEASON.label} · misma modalidad, muestras propias.</p>
            <p>
              El rango y los LP proceden de clasificación {demo ? "simulada" : "oficial"}. El
              rendimiento se calcula con partidas importadas; no equivale al historial completo de
              Riot.
            </p>
            <div className={styles.samples}>
              {players.map((p) => (
                <div key={p.id}>
                  <h3>{p.gameName}</h3>
                  <p>{sampleLabel(p)}</p>
                  <p>
                    {p.seasonHistory?.season === CURRENT_SEASON.id
                      ? HISTORY_LABELS[p.seasonHistory.status]
                      : "Cobertura desconocida"}{" "}
                    · exhaustividad no acreditada
                  </p>
                  <p>
                    {demo ? (
                      "Rango ficticio de Demo"
                    ) : (
                      <>
                        Verificación del jugador: <ObservedDate value={p.rankCheckedAt} />
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
            <p>
              Las muestras pueden tener tamaños y cobertura distintos. «Mayor valor» compara la
              cifra mostrada; no determina quién es mejor ni quién ganaría una partida.
            </p>
            <dl className={styles.methodMetrics}>
              {ordered.map((m) => (
                <div key={m.key}>
                  <dt>{m.label}</dt>
                  <dd>
                    <strong>{m.verdict}.</strong> {m.note}
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              Las barras de winrate usan una escala independiente de 0 a 100 % por jugador. No suman
              una probabilidad conjunta; KDA, rango, LP y volumen no reciben barras.
            </p>
            <div className={styles.samples}>
              {players.map((p) => (
                <WeeklyInterval key={p.id} player={p} view={view} />
              ))}
            </div>
          </div>
        </details>
      </section>
      <section className={styles.formSection} aria-labelledby="vs-form-title">
        <header className={styles.sectionHeading}>
          <h2 id="vs-form-title">Forma reciente</h2>
          <p>Hasta cinco partidas · más reciente primero en cada lado</p>
        </header>
        <div className={styles.formPair}>
          {players.map((p) => (
            <div className={styles.formPlayer} key={p.id}>
              <h3>{p.gameName}</h3>
              <RecentChampionForm matches={p.recent} champions={champions} size={36} interactive />
              <p>{Math.min(p.recent.length, 5)} registros importados</p>
            </div>
          ))}
        </div>
        <p className={styles.note}>
          V: victoria · D: derrota · R: remake. Resultados individuales, no partidas entre ambos
          jugadores ni evidencia de LP por partida.
        </p>
      </section>
      <CompetitiveMoment moment={moment} view={view} demo={demo} />
    </div>
  );
}

function rowHint(m: VersusMetric) {
  if (m.key === "winrate") return "0–100 % · muestra propia";
  if (m.key === "kda") return "Muestra propia";
  if (m.key === "record") return "Volumen, sin ventaja";
  if (m.key === "weekly")
    return m.verdict === "Sin intervalos equivalentes acreditados"
      ? "Intervalos no equiparados"
      : m.verdict;
  if (m.key === "lp")
    return m.verdict.includes("no comparable")
      ? "LP no comparables"
      : m.verdict.replace("Diferencia: ", "");
  return m.verdict === "Mismo rango registrado" ? "Mismo rango" : m.verdict;
}
function ScoreRow({
  metric: m,
  players,
}: {
  metric: VersusMetric;
  players: readonly [PublicPlayer, PublicPlayer];
}) {
  return (
    <div className={styles.scoreRow} role="listitem" data-metric={m.key}>
      <div className={styles.metricHeading}>
        <h3 id={"vs-metric-" + m.key}>{m.label}</h3>
        <p>{rowHint(m)}</p>
      </div>
      {players.map((p, i) => (
        <dl
          className={styles.scoreCell}
          data-side={i}
          data-higher={m.higherId === p.id || undefined}
          key={p.id}
        >
          <dt className="sr-only">
            {p.gameName} · {m.label}
          </dt>
          <dd className={styles.metricValue}>{m.values[i]}</dd>
          {m.key === "winrate" && m.values[i] !== "—" && (
            <dd className={styles.bar} aria-hidden="true">
              <span style={{ width: winrate(p.stats.wins, p.stats.losses) + "%" }} />
            </dd>
          )}
          <dd className={styles.valueMeta}>
            {m.values[i] === "—"
              ? "Sin datos compatibles"
              : m.key === "winrate" || m.key === "kda"
                ? sampleLabel(p)
                : m.higherId === p.id
                  ? "Mayor valor registrado"
                  : "Registro propio"}
          </dd>
        </dl>
      ))}
    </div>
  );
}
function WeeklyInterval({ player, view }: { player: PublicPlayer; view: View }) {
  const w = versusWeeklyLp(player, view);
  return w ? (
    <div>
      <h3>{player.gameName} · intervalo semanal</h3>
      <p>
        <ObservedDate value={w.from} /> → <ObservedDate value={w.to} />
        {w.partial && " · parcial"}
      </p>
    </div>
  ) : null;
}
function CompetitiveMoment({
  moment,
  view,
  demo,
}: {
  moment: ReturnType<typeof versusMoment>;
  view: View;
  demo: boolean;
}) {
  const change = moment?.event?.kind === "leadership-change" ? moment.event : null;
  const before = change && moment!.rivalry.players.find((p) => p.id === change.before.leaderId);
  const after = change && moment!.rivalry.players.find((p) => p.id === change.after.leaderId);
  return (
    <section
      className={styles.moment}
      data-observed={!!moment?.hasHistory}
      aria-labelledby="vs-moment-title"
    >
      <header className={styles.sectionHeading}>
        <h2 id="vs-moment-title">Momento competitivo</h2>
        {demo && <span className={styles.demo}>Ficticio · Demo</span>}
      </header>
      {change && before && after ? (
        <>
          <h3 className={styles.changeTitle}>Cambio de liderazgo observado</h3>
          <div className={styles.leadershipSwap}>
            <div>
              <span>Antes lideraba</span>
              <strong>{before.gameName}</strong>
            </div>
            <ArrowRight size={28} aria-hidden="true" />
            <div>
              <span>Después · corte observado</span>
              <strong>{after.gameName}</strong>
            </div>
          </div>
        </>
      ) : moment?.event ? (
        <p className={styles.event}>
          {RIVALRY_EVENT_LABELS[moment.event.kind]} · de {moment.event.previousGap} a{" "}
          {moment.event.observedGap} LP entre cortes históricos.
        </p>
      ) : null}
      {moment ? (
        <>
          <p className={styles.proximity}>
            Próximos en clasificación ·{" "}
            {moment.rivalry.lpDifference === null
              ? "divisiones próximas, sin distancia de LP comparable"
              : moment.rivalry.lpDifference + " LP de diferencia actual"}
            .
          </p>
          {moment.hasHistory ? (
            <div className={styles.history}>
              <RivalryLeadership
                rivalry={moment.rivalry}
                view={view}
                demo={demo}
                showSummary={false}
              />
            </div>
          ) : (
            <p className={styles.note}>
              No hay cortes históricos compatibles suficientes para mostrar evolución. La proximidad
              actual no demuestra un cambio de liderazgo.
            </p>
          )}
        </>
      ) : (
        <p className={styles.note}>
          No hay una señal de proximidad e historial compatible para este par. La comparación actual
          sigue disponible; no se inventa una tendencia.
        </p>
      )}
      {moment?.hasHistory && (
        <p className={styles.note}>
          Registros históricos; no indican el instante de un adelantamiento ni una partida
          específica. La ventaja actual se muestra arriba.
        </p>
      )}
    </section>
  );
}
