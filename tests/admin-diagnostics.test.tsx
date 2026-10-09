import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPlayerDiagnostics } from "@/components/admin-player-diagnostics";
import { AdminPanel } from "@/components/admin-panel";
import { adminFixture } from "@/app/dev/admin/fixtures";
import { attemptActivity } from "@/lib/admin-sync";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const context = { serverNow: "2026-10-09T12:00:00Z", leaseUntil: null };

describe("administrative diagnosis rendering", () => {
  it("labels unknown observations independently and does not certify success", () => {
    const html = renderToStaticMarkup(
      <AdminPlayerDiagnostics player={adminFixture(0, "not_started")} context={context} />,
    );
    expect(html).toMatch(/Verificación desconocida/);
    expect(html).toMatch(/Cobertura desconocida/);
    expect(html).toMatch(/sin intento registrado/);
    expect(html).toMatch(/esto no certifica éxito/);
    expect(html).not.toMatch(/Verificaciones y cobertura registradas/);
  });
  it("explains discovered IDs, missing details and a completed scan honestly", () => {
    const html = renderToStaticMarkup(
      <AdminPlayerDiagnostics player={adminFixture(0, "completed")} context={context} />,
    );
    expect(html).toMatch(/205 \/ 205 IDs procesados entre los descubiertos hasta ahora/);
    expect(html).toMatch(/No es un porcentaje de toda la temporada/);
    expect(html).toMatch(/exploración terminó, pero esos detalles no pudieron importarse/);
    expect(html).not.toMatch(/Cursor histórico guardado/);
  });
  it("shows prior phase errors and unclassified legacy messages separately", () => {
    const player = adminFixture(0, "failed");
    player.legacyError = "Existe un error previo sin clasificar.";
    player.syncState.rank.checkedAt = "2026-10-09T11:00:00Z";
    player.syncState.recent.error = {
      occurredAt: "2026-10-01T00:00:00Z",
      code: 503,
      step: "recent",
      message: "Riot no está disponible temporalmente.",
    };
    player.syncState.lastAttempt = {
      phase: "recent",
      startedAt: "2026-10-09T11:00:00Z",
      finishedAt: "2026-10-09T11:01:00Z",
      outcome: "partial",
    };
    const html = renderToStaticMarkup(<AdminPlayerDiagnostics player={player} context={context} />);
    expect(html).toMatch(/Error anterior aún pendiente/);
    expect(html).toMatch(/Error previo sin clasificar/);
    expect(html).toMatch(/No se ha atribuido a ninguna fase/);
    expect(html).toMatch(/Parcial/);
    expect(html).toMatch(/describe una sola fase/);
    expect(html).toMatch(/Cursor histórico guardado/);
  });
  it("never uses a shared lease as proof that a player's running attempt is active", () => {
    const player = adminFixture(0, "running");
    player.syncState.lastAttempt = {
      phase: "rank",
      startedAt: "2026-10-09T11:59:00Z",
      finishedAt: null,
      outcome: "running",
    };
    expect(attemptActivity(player.syncState, context)).toMatch(/sin ejecución activa confirmada/);
    expect(
      attemptActivity(player.syncState, { ...context, leaseUntil: "2026-10-09T12:01:00Z" }),
    ).toMatch(/no confirma este intento activo/);
    expect(
      attemptActivity(player.syncState, { ...context, serverNow: "2026-10-09T12:05:00Z" }),
    ).toMatch(/Posiblemente interrumpido/);
  });
  it("retains all management controls and individual sync for completed history", () => {
    const html = renderToStaticMarkup(
      <AdminPanel
        players={[
          adminFixture(0, "completed"),
          adminFixture(1, "failed"),
          adminFixture(2, "running", false),
        ]}
        context={context}
      />,
    );
    for (const label of [
      "Añadir jugador",
      "Actualizar todos",
      "Actualizar jugador",
      "Reintentar historial",
      "Continuar historial",
      "Seguimiento activo",
      "Seguimiento pausado",
      "Eliminar a",
      "Cerrar sesión",
    ])
      expect(html).toContain(label);
    expect(html.match(/Actualizar jugador/g)).toHaveLength(3);
    expect(html).toContain("<details");
    expect(html).toContain('disabled=""');
  });
});
