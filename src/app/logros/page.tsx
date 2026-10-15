import type { Metadata } from "next";
import Link from "next/link";
import { Medal } from "lucide-react";
import { parseView } from "@/lib/queues";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import { achievementCenterHref } from "@/lib/achievements/experience";
import { readAchievementCenter, ACHIEVEMENT_DEMO_CASES } from "@/server/achievements/center";
import { isDemo } from "@/server/env";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
import styles from "@/components/achievements/experience.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Logros e insignias",
  description: "Catálogo de reglas implementadas y observaciones experimentales de SoloQ.",
};
type Query = { queue?: string; player?: string | string[] };
export default async function AchievementCenterPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const params = await searchParams,
    view = parseView(params.queue),
    demo = isDemo();
  const selection = await readAchievementCenter(params.player, view, new Date().toISOString());
  const presentation = selection.presentation;
  return (
    <>
      <section className={styles.hero}>
        <div>
          <div className="eyebrow">LOGROS E INSIGNIAS · COMUNIDAD SOLOQ</div>
          <h1>
            Deja tu marca
            <br />
            en la <span className={styles.heroAccent}>Grieta.</span>
          </h1>
          <p className={styles.intro}>Descubre los desafíos que definen tu estilo competitivo.</p>
        </div>
        <dl className={styles.heroContext}>
          <div>
            <dt>
              {view === "flex" ? "FLEX" : view === "5v5" ? "5V5" : "SOLOQ"} · PERFIL CONSULTADO
            </dt>
            <dd>{selection.name ?? "Elige tu perfil"}</dd>
            <dd className={styles.heroFootnote}>
              {ACHIEVEMENTS.length} desafíos implementados · sin equipamiento
            </dd>
          </div>
        </dl>
      </section>
      <div className={styles.experimentalNote}>
        <Medal size={18} aria-hidden="true" />
        <p>
          Experimental · señales observadas, sin insignias permanentes.{" "}
          <a href="#achievement-methodology">Cómo funciona ↓</a>
        </p>
      </div>
      <nav className="queue-tabs" aria-label="Modalidad de logros">
        {(["soloq", "flex"] as const).map((queue) => (
          <Link
            key={queue}
            className={`queue-tab${view === queue ? " active" : ""}`}
            aria-current={view === queue ? "page" : undefined}
            href={
              selection.id ? achievementCenterHref(selection.id, queue) : `/logros?queue=${queue}`
            }
          >
            {queue === "soloq" ? "SoloQ" : "Flex"}
          </Link>
        ))}
      </nav>
      <section className={styles.consultation} aria-label="Jugador consultado">
        <div>
          <h2>{demo ? "Explora los casos Demo" : "Consulta un perfil"}</h2>
          <p>
            {selection.id
              ? "Tu estilo, según los registros disponibles."
              : "Elige un perfil y explora sus señales competitivas."}
          </p>
          {selection.id && presentation?.status === "available" && (
            <Link href={`/player/${selection.id}?queue=${view}`}>Ver perfil relacionado →</Link>
          )}
        </div>
        {demo ? (
          <nav className={styles.demoCases} aria-label="Casos ficticios de demostración">
            {ACHIEVEMENT_DEMO_CASES.map((example) => (
              <Link
                key={example.id}
                href={achievementCenterHref(example.id, view)}
                aria-current={selection.id === example.id ? "page" : undefined}
              >
                {example.label}
              </Link>
            ))}
            <small>Ficticio · Demo; cada caso usa los registros del mismo perfil.</small>
          </nav>
        ) : (
          <form action="/logros" method="get">
            <input type="hidden" name="queue" value={view} />
            <label htmlFor="achievement-player">ID público del perfil</label>
            <input
              id="achievement-player"
              name="player"
              maxLength={36}
              defaultValue={selection.id ?? ""}
            />
            <button className="button secondary" type="submit">
              Consultar
            </button>
          </form>
        )}
      </section>
      {selection.invalid && (
        <p role="status" className={styles.notice}>
          El identificador del perfil no es válido o no pertenece a esta Demo. No se evaluaron
          señales.
        </p>
      )}
      {!selection.enabled && (
        <p className={styles.notice}>
          Evaluación desactivada en este entorno. El catálogo sigue disponible; no se leen logros
          del jugador.
        </p>
      )}
      {view === "5v5" && (
        <p className={styles.notice}>5v5 no combina logros ranked. Elige SoloQ o Flex.</p>
      )}
      <AchievementCatalog
        presentation={presentation}
        enabled={selection.enabled}
        selected={!!selection.id}
        view={view}
        playerId={selection.id}
      />
      <details id="achievement-methodology" className={styles.methodology}>
        <summary>Cómo funciona · evidencia y límites</summary>
        <p>
          Las tres reglas son experimentales. SoloQ no concede ni equipa insignias permanentes con
          estos resultados. Condición observada significa que los registros examinados cumplen la
          regla; no es una recompensa concedida.
        </p>
        {presentation?.status === "available" && (
          <section aria-label="Contexto de evaluación">
            <p>
              {presentation.mode} · Temporada {presentation.season} · {presentation.sourceText}
            </p>
            <p>{presentation.coverageText}</p>
            <p>
              Ventana UTC: {presentation.from} (incluido) → {presentation.to} (excluido).
            </p>
            <ul>
              {presentation.coverageDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </section>
        )}
        <p>
          Las cifras describen la muestra disponible. No acreditan historial exhaustivo ni progreso
          hacia una insignia permanente.
        </p>
      </details>
    </>
  );
}
