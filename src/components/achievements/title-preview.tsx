import styles from "./achievements.module.css";

/** Concept only: cannot select, save, grant or replace a Riot ID. */
export function AchievementTitlePreview({ title }: { title: string }) {
  return (
    <aside className={styles.title} aria-label="Concepto ficticio de título destacado">
      <span>Título · vista conceptual ficticia</span>
      <strong>{title}</strong>
      <p>No concedido. Selección y persistencia no disponibles.</p>
    </aside>
  );
}
