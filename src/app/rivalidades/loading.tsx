import { PageHeading } from "@/components/page-heading";

export default function RivalriesLoading() {
  return (
    <div className="rivalries-loading" role="status">
      <span className="sr-only">Cargando las rivalidades…</span>
      <div aria-hidden="true">
        <PageHeading
          title="Rivalidades"
          lead={<span className="skeleton rivalries-loading-line" />}
          meta={<span className="skeleton rivalries-loading-line short" />}
        />
        <div className="rivalries-toolbar">
          <div className="skeleton skeleton-tabs" />
          <div className="skeleton rivalries-loading-filters" />
        </div>
        <div className="rivalries-loading-list">
          {[0, 1, 2].map((row) => (
            <div className="rivalries-loading-row" key={row}>
              <div className="skeleton rivalries-loading-player" />
              <div className="skeleton rivalries-loading-gap" />
              <div className="skeleton rivalries-loading-player" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
