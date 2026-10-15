import Link from "next/link";
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Power,
  UserRound,
  CloudOff,
  Ban,
  ChevronDown,
} from "lucide-react";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import {
  ACHIEVEMENT_CATEGORIES,
  achievementDisplayName,
  achievementExperienceState,
} from "@/lib/achievements/experience";
import type { AchievementPresentation } from "@/lib/achievements/presentation";
import type { View } from "@/lib/queues";
import { AchievementEmblem, achievementArt } from "./achievement-emblem";
import styles from "./experience.module.css";
const stateIcons = {
  observed: CircleCheck,
  pending: CircleDashed,
  insufficient: CircleHelp,
  invalid: CircleX,
  disabled: Power,
  unselected: UserRound,
  unavailable: CloudOff,
  not_applicable: Ban,
};
const evidenceNames = {
  rank_recovery: "Snapshots de rango comparables, recogidos por SoloQ. Match-V5 no reconstruye LP.",
  recorded_win_streak:
    "Resultados de partidas importadas de una sola modalidad; no acredita cobertura exhaustiva.",
  recorded_champion_share:
    "Campeones y partidas válidas en la muestra importada; no equivale a una certificación anual.",
};
export function AchievementCatalog({
  presentation,
  enabled,
  selected,
  view,
  playerId,
}: {
  presentation: AchievementPresentation | null;
  enabled: boolean;
  selected: boolean;
  view: View;
  playerId?: string | null;
}) {
  return (
    <section className={styles.catalog} aria-labelledby="achievement-gallery-title">
      <header className={styles.galleryHeading}>
        <div>
          <span className={styles.overline}>TU MARCA COMPETITIVA</span>
          <h2 id="achievement-gallery-title">Tres desafíos. Tu estilo.</h2>
        </div>
        <nav className={styles.categoryNav} aria-label="Categorías de logros">
          {ACHIEVEMENT_CATEGORIES.map((c) => (
            <a key={c.code} href={`#logros-${c.code}`}>
              {c.name}
            </a>
          ))}
        </nav>
      </header>
      <ul className={styles.gallery} aria-label="Galería de desafíos">
        {ACHIEVEMENTS.map((definition) => {
          const item =
            presentation?.status === "available"
              ? presentation.items.find((value) => value.code === definition.code)
              : undefined;
          const state = achievementExperienceState(item, presentation, { enabled, selected, view });
          const StateIcon = stateIcons[state.kind];
          const name = item?.name ?? achievementDisplayName(definition);
          const art = achievementArt[definition.code];
          const category = ACHIEVEMENT_CATEGORIES.find((c) => c.code === definition.category)!;
          const titleId = `achievement-${definition.code}`;
          return (
            <li
              key={definition.code}
              id={`logros-${category.code}`}
              className={styles.catalogItem}
              data-state={state.kind}
              data-theme={art.theme}
              aria-labelledby={titleId}
            >
              <div className={styles.emblemStage}>
                <span className={styles.categoryLabel}>{category.name}</span>
                <AchievementEmblem code={definition.code} />
                <span className={styles.motto}>{art.motto}</span>
              </div>
              <div className={styles.cardBody}>
                <h3 id={titleId}>{name}</h3>
                <p className={styles.challengeCopy}>{art.description}</p>
                <div className={styles.catalogState}>
                  <span className={styles.status}>
                    <StateIcon size={16} aria-hidden="true" />
                    {state.label}
                  </span>
                  <span className={styles.experimental}>Experimental</span>
                </div>
                {presentation?.status === "available" && presentation.demo && (
                  <span className={styles.demoMarker}>Ficticio · Demo</span>
                )}
                <div className={styles.evidenceSummary}>
                  {item?.measurement ? (
                    <>
                      <span className={styles.overline}>EVIDENCIA REGISTRADA</span>
                      <p className={styles.measurement}>{item.measurement}</p>
                    </>
                  ) : (
                    <p className={styles.explanation}>
                      {state.kind === "observed"
                        ? "Respaldado por los registros de esta lectura."
                        : state.explanation}
                    </p>
                  )}
                </div>
                <details className={styles.criteria}>
                  <summary>
                    <span>
                      Ver requisitos<span className="sr-only"> y evidencia de {name}</span>
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className={styles.detailBody}>
                    <h4>{name}</h4>
                    <p>{definition.description}</p>
                    <h5>El desafío exacto</h5>
                    <p>{item?.conditions ?? definition.provisionalConditions}</p>
                    <h5>Tu evaluación</h5>
                    <p>
                      {state.label}. {state.explanation}
                    </p>
                    {item && (
                      <>
                        <ul aria-label="Explicaciones de la evaluación">
                          {item.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <dl>
                          {item.evidence.map((row) => (
                            <div key={row.label}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}
                    <h5>Cómo se acredita</h5>
                    <p>{evidenceNames[definition.evidence]}</p>
                    {presentation?.status === "available" && <p>{presentation.coverageText}</p>}
                    <p className={styles.version}>
                      Regla {item?.ruleVersion ?? definition.ruleVersion}
                    </p>
                    {definition.code === "otp-specialist" && (
                      <p>
                        Nombre del catálogo: «{definition.name}». No constituye una certificación de
                        SoloQ ni de Riot.
                      </p>
                    )}
                    <p>Sin concesión permanente ni equipamiento de insignias.</p>
                    {item?.status === "observed" && playerId && (
                      <Link
                        className={styles.profileLink}
                        href={`/player/${playerId}?queue=${view}`}
                      >
                        Ver perfil relacionado →
                      </Link>
                    )}
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
