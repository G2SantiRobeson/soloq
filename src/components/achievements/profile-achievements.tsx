import { Suspense } from "react";
import type { View } from "@/lib/queues";
import type { ChampionCatalog } from "@/lib/champion-assets";
import { achievementsExperimentalEnabled } from "@/server/achievements/feature";
import { profileAchievementPresentation } from "@/server/achievements/profile";
import { AchievementPanel } from "./achievement-panel";
import styles from "./achievements.module.css";

type Props = { playerId: string; view: View; asOf: string; champions: ChampionCatalog };

export async function ProfileAchievementsContent(props: Props) {
  const presentation = await profileAchievementPresentation(
    props.playerId,
    props.view,
    props.asOf,
    props.champions,
  );
  return presentation ? (
    <AchievementPanel presentation={presentation} champions={props.champions} />
  ) : null;
}

/** Native collapsed disclosure: streaming does not push essential information down. */
export function ProfileAchievements(props: Props) {
  if (!achievementsExperimentalEnabled() || props.view === "5v5") return null;
  return (
    <details className={styles.profile}>
      <summary>
        <span className={styles.entry}>
          <strong>
            Señales competitivas <span className={styles.experimental}>· Experimental</span>
          </strong>
          <span className={styles.entryHint}>Observaciones y evidencia</span>
        </span>
      </summary>
      <Suspense
        fallback={
          <p role="status" aria-busy="true">
            Leyendo evidencia registrada…
          </p>
        }
      >
        <ProfileAchievementsContent {...props} />
      </Suspense>
    </details>
  );
}
