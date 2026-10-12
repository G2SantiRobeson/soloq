import { materializeAchievementEvidence } from "@/server/achievements/verification/materialize";
import { EVIDENCE_FORMAT_VERSION } from "@/server/achievements/verification/materialization-contracts";
import {
  STRUCTURAL_RECEIPT_VERSION,
  type StructuralReceiptInput,
} from "@/server/achievements/verification/receipt-contracts";
import { localEvidenceRepository } from "@/server/achievements/verification/local-evidence-repository";
import type {
  LocalHeaderInput,
  LocalUnitInput,
} from "@/server/achievements/verification/persistence-contracts";
import { fixedScope, match } from "./achievements-fixtures";

export const identity = {
  playerId: "11111111-1111-4111-8111-111111111111",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
export const other = { ...identity, playerId: "22222222-2222-4222-8222-222222222222" };
const records = Array.from({ length: 5 }, (_, i) => match(i, { matchId: `LA2_${i + 1}` }));
const interval = {
  from: records[0].timestamp,
  to: new Date(Date.parse(records.at(-1)!.timestamp) + 1).toISOString(),
};
const capture = (id: string) =>
  ({
    state: "declared",
    source: "synthetic",
    endpoint: "MATCH-V5",
    captureId: id,
    receivedAt: "2026-11-02T00:00:00Z",
  }) as const;
export const headerInput = (key: string, owner = identity): LocalHeaderInput => ({
  identity: owner,
  operationKey: key,
  kind: "match_scan",
  source: "unknown",
  parentId: null,
  interval,
  capture: {
    state: "legacy",
    source: "stored",
    endpoint: "unknown",
    captureId: null,
    receivedAt: null,
  },
});
// Same synthetic five-win recipe as the D persistence tests, with no operational adapter.
export async function sealFixture(repo: ReturnType<typeof localEvidenceRepository>) {
  const h = await repo.insertHeader(headerInput("scan:1"), await repo.revision(identity));
  const query = {
    startTime: Math.floor(Date.parse(interval.from) / 1000),
    endTime: Math.ceil(Date.parse(interval.to) / 1000),
    start: 0,
    count: 10,
    queue: null,
    type: null,
    timeSemantics: "unconfirmed",
  } as const;
  const values: LocalUnitInput[] = [
    {
      kind: "page",
      unitKey: "page:0:1",
      ordinal: 0,
      page: {
        scanId: "scan:1",
        attempt: 1,
        identity,
        query,
        capture: capture("page:0"),
        response: { state: "success", ids: records.map((r) => r.matchId) },
      },
    },
    ...records.map((r, i) => ({
      kind: "disposition" as const,
      unitKey: `detail:${i + 1}`,
      ordinal: i + 1,
      previousUnitId: null,
      disposition: {
        state: "resolved" as const,
        matchId: r.matchId,
        detail: { ...r, playerId: identity.playerId, platform: identity.platform },
        capture: capture(`detail:${i + 1}`),
      },
    })),
  ];
  await repo.insertUnits(identity, h.id, values, await repo.revision(identity));
  const material = {
    version: EVIDENCE_FORMAT_VERSION,
    identity,
    scope: fixedScope,
    attribution: { state: "known", origin: "synthetic" },
    sourceRevision: { state: "declared", value: await repo.revision(identity) },
    coverage: {
      source: "imported_history",
      historyStatus: "completed",
      unavailable: 0,
      intervalCoverage: "unproven",
    },
    manifest: { state: "declared", recordIds: records.map((r) => r.matchId) },
    kind: "matches",
    code: "unstoppable",
    records: records.map((record, i) => ({
      record,
      identity,
      capture: capture(`detail:${i + 1}`),
    })),
  } as const;
  const result = materializeAchievementEvidence(material);
  if (!result.contentFingerprint || !result.metadataFingerprint)
    throw Error("Invalid synthetic fixture");
  const input: Omit<
    StructuralReceiptInput,
    "pages" | "dispositions" | "identity" | "sourceRevision" | "nature"
  > = {
    version: STRUCTURAL_RECEIPT_VERSION,
    scanId: "scan:1",
    query,
    target: {
      kind: "win_streak",
      interval: { ...interval, precision: "milliseconds", bounds: "half_open" },
      chosenWinIds: records.map((r) => r.matchId),
    },
    indexChange: { state: "unproven" },
    materialization: {
      input: structuredClone(material),
      expectedContentFingerprint: result.contentFingerprint,
      expectedMetadataFingerprint: result.metadataFingerprint,
    },
  };
  return { h, token: await repo.prepareSeal(identity, h.id, input), input };
}
