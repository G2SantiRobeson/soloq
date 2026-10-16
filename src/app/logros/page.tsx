import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { parseView } from "@/lib/queues";
import { achievementCenterHref } from "@/lib/achievements/experience";
import { readAchievementCenter, ACHIEVEMENT_DEMO_CASES } from "@/server/achievements/center";
import { isDemo } from "@/server/env";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
import { PageHeading } from "@/components/page-heading";
import { QueueTabs } from "@/components/queue-tabs";
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
  const profilePicker = (
    <section className={styles.profilePicker} aria-labelledby="achievement-profile-title">
      <h2 id="achievement-profile-title">Jugador consultado</h2>
      {/* Outside Demo the server knows only the public ID, already shown in the form below. */}
      {(demo || !selection.id) && (
        <p className={styles.profileName} data-empty={!selection.name}>
          {selection.name ?? "Elige un perfil"}
        </p>
      )}
      {selection.id && presentation?.status === "available" && (
        <Link className={styles.profileLink} href={`/player/${selection.id}?queue=${view}`}>
          Ver perfil relacionado →
        </Link>
      )}
      {demo ? (
        <>
          <nav
            className={`segmented ${styles.demoCases}`}
            aria-label="Casos ficticios de demostración"
          >
            {ACHIEVEMENT_DEMO_CASES.map((example) => (
              <Link
                key={example.id}
                href={achievementCenterHref(example.id, view)}
                aria-current={selection.id === example.id ? "page" : undefined}
              >
                {example.label}
              </Link>
            ))}
          </nav>
          <small className={styles.demoNote}>
            Ficticio · Demo; cada caso usa los registros del mismo perfil.
          </small>
        </>
      ) : (
        <form className={styles.profileForm} action="/logros" method="get">
          <input type="hidden" name="queue" value={view} />
          <label htmlFor="achievement-player">ID público del perfil</label>
          <span>
            <input
              id="achievement-player"
              name="player"
              maxLength={36}
              defaultValue={selection.id ?? ""}
            />
            <button className="button secondary" type="submit">
              Consultar
            </button>
          </span>
        </form>
      )}
    </section>
  );
  return (
    <div className={styles.page}>
      <PageHeading
        title="Logros"
        lead="Descubre los desafíos que definen tu estilo competitivo."
        meta={
          <>
            <span className={styles.experimentalTag}>Experimental</span> Señales observadas, sin
            insignias permanentes.{" "}
            <a className={styles.metaLink} href="#achievement-methodology">
              Cómo funciona ↓
            </a>
          </>
        }
        aside={profilePicker}
      />
      <QueueTabs
        view={view}
        views={["soloq", "flex"]}
        label="Modalidad de logros"
        hrefFor={(queue) =>
          selection.id ? achievementCenterHref(selection.id, queue) : `/logros?queue=${queue}`
        }
      />
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
        <summary>
          <span>Cómo funciona · evidencia y límites</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
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
    </div>
  );
}
