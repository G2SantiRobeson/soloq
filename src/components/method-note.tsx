import type { ReactNode } from "react";

/** Collapsible methodology note: the figures stay in view, the fine print one click away. */
export function MethodNote({
  summary = "Cómo se calcula",
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="metric-method">
      <summary>{summary}</summary>
      <div className="metric-method-body">{children}</div>
    </details>
  );
}
