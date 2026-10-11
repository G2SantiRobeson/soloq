import { useId } from "react";
import type { AchievementDisplay, AchievementPresentation } from "@/lib/achievements/presentation";
import styles from "./achievements.module.css";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { Avatar } from "@/components/avatar";

export function AchievementBadge({ status }: Pick<AchievementDisplay, "status">) {
  return (
    <span className={styles.badge} data-status={status} aria-hidden="true">
      {status === "observed"
        ? "◆"
        : status === "insufficient_evidence"
          ? "?"
          : status === "invalid_input"
            ? "!"
            : "◇"}
    </span>
  );
}

export function AchievementItem({
  item,
  champions = {},
}: {
  item: AchievementDisplay;
  champions?: ChampionCatalog;
}) {
  const id = useId();
  // Decorative lookup only: retain the complete server measurement unchanged.
  // An exact catalog name prefix identifies artwork, never achievement evidence.
  const measurement = item.measurement;
  const candidates =
    item.code === "otp-specialist" && measurement
      ? Object.entries(champions).filter(([, entry]) => measurement.startsWith(`${entry.name} · `))
      : [];
  const champion = candidates.length === 1 ? candidates[0] : undefined;
  const asset = champion ? championAsset(Number(champion[0]), champion[1].name, champions) : null;
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
      {item.measurement ? (
        <div className={styles.measurement}>
          {asset ? <Avatar decorative champion {...asset} size={44} /> : null}
          <p>{item.measurement}</p>
        </div>
      ) : null}
      <details className={styles.details}>
        <summary aria-label={`Criterio y evidencia de ${item.name}`}>Criterio y evidencia</summary>
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
  champions = {},
}: {
  presentation: AchievementPresentation;
  future?: readonly FutureAchievement[];
  champions?: ChampionCatalog;
}) {
  const id = useId();
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <header className={styles.heading}>
        <h2 id={id}>Señales competitivas · Experimental</h2>
        <span className={styles.notice}>Sin concesiones permanentes</span>
      </header>
      {presentation.status !== "available" ? (
        <p className={styles.unavailable} role="status">
          {presentation.message}
        </p>
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
          <p className={styles.context}>
            Observaciones provisionales · Cobertura exhaustiva no acreditada
          </p>
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
              <AchievementItem key={item.code} item={item} champions={champions} />
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
