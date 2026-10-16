import { Suspense } from "react";
import Link from "next/link";
import { Medal } from "lucide-react";
import type { View } from "@/lib/queues";
import type { AchievementPresentation } from "@/lib/achievements/presentation";
import { achievementCenterHref } from "@/lib/achievements/experience";
import { achievementExperienceEnabled } from "@/server/achievements/feature";
import type { ProfileAchievementLoader } from "@/server/achievements/profile";
import { AchievementEmblem, achievementArt } from "./achievement-emblem";
import styles from "./experience.module.css";
export function AchievementShowcaseContent({
  presentation,
}: {
  presentation: AchievementPresentation | null;
}) {
  if (!presentation || presentation.status !== "available")
    return (
      <p className={styles.empty}>
        No hay una lectura evaluable de señales. Consulta el centro para ver los requisitos.
      </p>
    );
  const observed = presentation.items.filter((item) => item.status === "observed");
  return (
    <>
      <div className={styles.badgeStrip}>
        {observed.map((item) => (
          <span
            className={styles.signalBadge}
            key={item.code}
            data-theme={achievementArt[item.code].theme}
          >
            <AchievementEmblem code={item.code} specialization={item.specialization} compact />
            <span>
              {item.name}
              <span className={styles.badgeMotto}>{achievementArt[item.code].motto}</span>
              <small>Condición observada{presentation.demo ? " · Ficticio · Demo" : ""}</small>
            </span>
          </span>
        ))}
      </div>
      {!observed.length && (
        <p className={styles.empty}>
          No hay condiciones observadas en esta lectura. Puede haber reglas pendientes o datos
          insuficientes.
        </p>
      )}
      <p className={styles.showcaseNote}>
        Observaciones experimentales · sin insignias permanentes ni certificación.
      </p>
    </>
  );
}
export async function AchievementShowcaseLoaded({ load }: { load: ProfileAchievementLoader }) {
  return <AchievementShowcaseContent presentation={await load()} />;
}
export function AchievementShowcase({
  playerId,
  view,
  load,
}: {
  playerId: string;
  view: View;
  load: ProfileAchievementLoader;
}) {
  if (view === "5v5") return null;
  const enabled = achievementExperienceEnabled();
  return (
    <section className={styles.showcase} aria-label="Vitrina de señales competitivas">
      <header>
        <h2>
          <Medal size={17} aria-hidden="true" />
          Logros e insignias
        </h2>
        <Link href={achievementCenterHref(playerId, view)}>Ver requisitos y estados →</Link>
      </header>
      {enabled ? (
        <Suspense
          fallback={
            <p role="status" className={styles.empty}>
              Leyendo señales registradas…
            </p>
          }
        >
          <AchievementShowcaseLoaded load={load} />
        </Suspense>
      ) : (
        <p className={styles.empty}>
          Evaluación experimental desactivada. Puedes explorar el catálogo.
        </p>
      )}
    </section>
  );
}
