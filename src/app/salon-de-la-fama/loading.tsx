import styles from "@/components/hall-of-fame/hall.module.css";

/** Mirrors the page: masthead, queue tabs and the board of three plaques. */
export default function HallLoading() {
  return (
    <div className={styles.page} role="status">
      <span className="sr-only">Cargando el Salón de la Fama…</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      <div className={styles.gallery} aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 420 }} />
        ))}
      </div>
    </div>
  );
}
