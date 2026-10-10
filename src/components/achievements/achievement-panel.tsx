import { useId } from "react";
import type { AchievementDisplay, AchievementPresentation } from "@/lib/achievements/presentation";
import styles from "./achievements.module.css";

export function AchievementBadge({ status }: Pick<AchievementDisplay, "status">) {
  return (
    <span className={styles.badge} data-status={status} aria-hidden="true">
      {status === "observed" ? "◆" : "◇"}
    </span>
  );
}

export function AchievementItem({ item }: { item: AchievementDisplay }) {
  const id = useId();
  return (
    <li className={styles.item} data-status={item.status} aria-labelledby={id}>
      <div className={styles.identity}>
        <AchievementBadge status={item.status} />
        <div>
          <h3 id={id}>{item.name}</h3>
          <p className={styles.description}>{item.description}</p>
        </div>
      </div>
      <p className={styles.state}>{item.statusText}</p>
      {item.measurement ? <p className={styles.measurement}>{item.measurement}</p> : null}
      <details className={styles.details}>
        <summary>Criterio y evidencia de {item.name}</summary>
        <p>
          Regla {item.ruleVersion} · {item.conditions}
        </p>
        <p>Sin certificación ni concesión permanente.</p>
        <dl>
          {item.evidence.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <ul aria-label="Límites de evidencia">
          {item.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export type FutureAchievement = { key: string; name: string; description: string };
/** Display-only composition. Native details also work without JavaScript. */
export function AchievementPanel({
  presentation,
  future = [],
}: {
  presentation: AchievementPresentation;
  future?: readonly FutureAchievement[];
}) {
  const id = useId();
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <header className={styles.heading}>
        <h2 id={id}>Señales competitivas · Experimental</h2>
        <span>Sin concesiones permanentes</span>
      </header>
      {presentation.status !== "available" ? (
        <p>{presentation.message}</p>
      ) : (
        <>
          <p className={styles.context}>
            {presentation.mode} · Temporada {presentation.season} · {presentation.sourceText}
          </p>
          {presentation.demo ? (
            <p className={styles.demo}>
              Datos ficticios: estos resultados no pertenecen a un jugador real.
            </p>
          ) : null}
          <p className={styles.context}>{presentation.coverageText}</p>
          <details className={styles.details}>
            <summary>Origen y cobertura de los datos</summary>
            <p>
              Ventana UTC: <time dateTime={presentation.from}>{presentation.from}</time> (incluido)
              a <time dateTime={presentation.to}>{presentation.to}</time> (excluido).
            </p>
            <ul>
              {presentation.coverageDetails.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
          <ul className={styles.list}>
            {presentation.items.map((item) => (
              <AchievementItem key={item.code} item={item} />
            ))}
          </ul>
        </>
      )}
      {future.length ? (
        <ul className={styles.list} aria-label="Conceptos de logros futuros">
          {future.map((item) => (
            <li className={styles.future} key={item.key}>
              <h3>{item.name}</h3>
              <p>Futuro · no disponible</p>
              <p>{item.description}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
