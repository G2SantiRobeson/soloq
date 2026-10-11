import type { ReactNode } from "react";

/**
 * Summary content of a section-level native disclosure. The <details> element owns the
 * expanded state (announced by assistive technology); the visible Mostrar/Ocultar text
 * and chevron only make that state recognizable before hover, so they are hidden from AT.
 */
export function DisclosureLabel({
  icon,
  title,
  badge,
  hint,
}: {
  icon?: ReactNode;
  title: ReactNode;
  badge?: string;
  hint?: ReactNode;
}) {
  return (
    <>
      {icon && (
        <span className="disclosure-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="disclosure-text">
        <strong>
          {title}
          {badge && (
            <>
              {" "}
              <span className="disclosure-badge">{badge}</span>
            </>
          )}
        </strong>
        {hint && <span className="disclosure-hint">{hint}</span>}
      </span>
      <span className="disclosure-toggle" aria-hidden="true">
        <span className="disclosure-show">Mostrar</span>
        <span className="disclosure-hide">Ocultar</span>
        <span className="disclosure-chevron" />
      </span>
    </>
  );
}
