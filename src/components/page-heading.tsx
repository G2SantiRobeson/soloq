import type { ReactNode } from "react";

/**
 * Page masthead shared by every section: one large title, an optional lead sentence and
 * context line under it (never a label above it), and optional headline figures or a side
 * panel (the profile picker in Logros) aligned with the bottom of the title.
 */
export function PageHeading({
  title,
  lead,
  meta,
  figures = [],
  dot = true,
  aside,
}: {
  title: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
  figures?: readonly { label: string; value: string }[];
  dot?: boolean;
  aside?: ReactNode;
}) {
  return (
    <section className="page-heading">
      <div className="page-title">
        <h1>
          {title}
          {dot && <span className="heading-dot">.</span>}
        </h1>
        {lead && <p className="page-lead">{lead}</p>}
        {meta && <p className="page-meta">{meta}</p>}
      </div>
      {figures.length > 0 && (
        <dl className="page-figures">
          {figures.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {aside}
    </section>
  );
}
