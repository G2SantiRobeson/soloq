import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import NotFound, { metadata } from "@/app/not-found";
import RivalriesLoading from "@/app/rivalidades/loading";
import { LpDeltaSummary } from "@/components/lp-delta-summary";
import type { LpObservation } from "@/lib/history";

const observation: LpObservation = {
  from: "2026-10-01T12:00:00Z",
  to: "2026-10-01T13:00:00Z",
  confidence: "aggregated",
  delta: 0,
  games: 2,
  matchId: null,
  label: "Intervalo agregado",
};

describe("RC3.1 recovery and loading", () => {
  it("offers general recovery links and a specific title without a new route", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(metadata.title).toBe("Página no encontrada");
    expect(metadata.description).toContain("página disponible en SoloQ");
    expect(html).not.toContain("<title>");
    expect(html).toContain('class="page-heading"');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Volver a SoloQ"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/rivalidades"');
    expect(html).not.toContain("El jugador puede no existir");
  });

  it("announces loading once without fake players, statistics or interactive placeholders", () => {
    const html = renderToStaticMarkup(<RivalriesLoading />);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("Cargando las rivalidades…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="page-heading"');
    expect(html).not.toMatch(/<a[ >]|<button|<input|tabindex=|\d+ LP|Demo Ronin/);
  });

  it("keeps the new loading placeholders static in both motion preferences", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/\.rivalries-loading \.skeleton \{([^}]+)\}/)?.[1];
    expect(rule).toContain("animation: none");
    expect(rule).toContain("background: var(--surface-2)");
    expect(rule).not.toMatch(/gradient|pulse/);
  });
});

describe("keyboard access to LP observations", () => {
  it("names the focusable scrolling region and preserves an observed zero delta", () => {
    const html = renderToStaticMarkup(<LpDeltaSummary observations={[observation]} demo />);
    expect(html).toContain(
      'class="lp-observations" tabindex="0" role="region" aria-label="Observaciones históricas de LP"',
    );
    expect(html).toContain(">0 LP<");
    expect(html).toContain("Intervalo agregado");
    expect(html).toMatch(/dateTime="2026-10-01T13:00:00Z"/i);
  });

  it("preserves unknown rank transitions instead of calculating LP", () => {
    const html = renderToStaticMarkup(
      <LpDeltaSummary
        observations={[
          { ...observation, delta: null, confidence: "unknown", label: "Cambio de rango" },
        ]}
      />,
    );
    expect(html).toContain("Cambio de rango");
    expect(html).toContain("LP indeterminados");
    expect(html).not.toContain(">0 LP<");
  });

  it("does not add an empty tab stop when no observations exist", () => {
    const html = renderToStaticMarkup(<LpDeltaSummary observations={[]} />);
    expect(html).toContain("Hacen falta dos registros de rango comparables");
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toContain('role="region"');
  });

  it("gives the keyboard region a two-pixel token-based focus ring", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/\.lp-observations:focus-visible \{([^}]+)\}/)?.[1]).toContain(
      "outline: 2px solid var(--accent)",
    );
  });
});
