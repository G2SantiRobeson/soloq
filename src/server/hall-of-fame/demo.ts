import "server-only";
import { isDemo } from "@/server/env";
import type { View } from "@/lib/queues";
import type { HallProposalId } from "@/lib/hall-of-fame/proposals";
export type HallDemoRecognition = {
  id: string;
  proposalId: HallProposalId;
  playerId: string;
  playerName: string;
  view: "soloq";
  season: "2026";
  observedAt: string | null;
  accreditedAt: string;
  evidence: string;
  source: "fictional_hall";
};
export type HallDemoRecord = {
  id: string;
  playerId: string;
  playerName: string;
  value: number;
  from: string;
  to: string | null;
  source: "fictional_hall";
};
// Separate stage props, not derived from player stats or the experimental engine.
const recognitions: readonly HallDemoRecognition[] = [
  {
    id: "demo-legend-marea",
    proposalId: "intocable",
    playerId: "demo-5",
    playerName: "Demo Marea",
    view: "soloq",
    season: "2026",
    observedAt: "2026-10-09T18:00:00Z",
    accreditedAt: "2026-10-09T18:05:00Z",
    evidence:
      "Escenario ficticio: 18 victorias seguidas, sin partidas ausentes en el guion. No corresponde al historial experimental del perfil.",
    source: "fictional_hall",
  },
  {
    id: "demo-permanent-ronin",
    proposalId: "monarca",
    playerId: "demo-4",
    playerName: "Demo Ronin",
    view: "soloq",
    season: "2026",
    observedAt: null,
    accreditedAt: "2026-10-10T18:05:00Z",
    evidence:
      "Escenario ficticio: liderazgo del 3 al 10 de octubre. Siete días son un ejemplo escenográfico, no un umbral aprobado; no se conoce una hora exacta de obtención.",
    source: "fictional_hall",
  },
  {
    id: "demo-pioneer-nebula",
    proposalId: "primero-de-su-nombre",
    playerId: "demo-1",
    playerName: "Demo Nebula",
    view: "soloq",
    season: "2026",
    observedAt: "2026-10-07T18:00:00Z",
    accreditedAt: "2026-10-07T18:05:00Z",
    evidence:
      "Escenario ficticio: primera acreditación de El Intocable tras una activación simulada el 1 de octubre. No es la primera persona real de la comunidad.",
    source: "fictional_hall",
  },
];
const records: readonly HallDemoRecord[] = [
  {
    id: "demo-current-streak",
    playerId: "demo-4",
    playerName: "Demo Ronin",
    value: 21,
    from: "2026-10-12T18:00:00Z",
    to: null,
    source: "fictional_hall",
  },
  {
    id: "demo-former-streak",
    playerId: "demo-5",
    playerName: "Demo Marea",
    value: 18,
    from: "2026-10-09T18:00:00Z",
    to: "2026-10-12T18:00:00Z",
    source: "fictional_hall",
  },
];
/** No real-mode lookup, credentials, SQL, evaluator calls or writes. */
export function readHallPreview(view: View) {
  const demo = isDemo();
  return {
    demo,
    recognitions: demo && view === "soloq" ? recognitions : [],
    records: demo && view === "soloq" ? records : [],
  };
}
