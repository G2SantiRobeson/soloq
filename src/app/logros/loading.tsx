import styles from "@/components/achievements/experience.module.css";

/** Mirrors the page: masthead, queue tabs and the three challenge rows. */
export default function AchievementsLoading() {
  return (
    <div className={styles.page} role="status">
      <span className="sr-only">Cargando los logros…</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      <div className={styles.gallery} aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 168 }} />
        ))}
      </div>
    </div>
  );
}
