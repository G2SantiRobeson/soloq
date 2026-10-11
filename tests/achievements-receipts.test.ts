import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { materializeAchievementEvidence } from "@/server/achievements/verification/materialize";
import {
  EVIDENCE_FORMAT_VERSION,
  type EvidenceMaterializationInput,
  type SourceCapture,
} from "@/server/achievements/verification/materialization-contracts";
import {
  STRUCTURAL_RECEIPT_VERSION,
  RECEIPT_CANONICALIZATION_VERSION,
  type StructuralReceiptInput,
  type StructuralReceiptResult,
  type IdDisposition,
} from "@/server/achievements/verification/receipt-contracts";
import {
  fingerprintDeclaredPage,
  reconcileDeclaredEvidence,
} from "@/server/achievements/verification/receipts";
import {
  OTP_RULE,
  RESURRECTION_RULE,
  UNSTOPPABLE_RULE,
  type AchievementMatch,
} from "@/lib/achievements";
import { fixedScope, match, deepFreeze } from "./achievements-fixtures";

const owner = {
  playerId: "00000000-0000-4000-8000-000000000001",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
const sourceRevision = { state: "declared", value: "synthetic-revision-1" } as const;
const capture = (captureId: string): SourceCapture => ({
  state: "declared",
  source: "synthetic",
  endpoint: "MATCH-V5",
  captureId,
  receivedAt: "2026-11-02T00:00:00Z",
});
const rows = (n = 5, c = n): AchievementMatch[] =>
  Array.from({ length: n }, (_, i) => ({
    ...match(i),
    matchId: `LA2_${i + 1}`,
    championId: i < c ? 107 : 360,
  }));

function refreshMaterialization(
  input: StructuralReceiptInput,
  records: AchievementMatch[] = input.materialization.input.kind === "matches"
    ? input.materialization.input.records.map((r) => r.record)
    : [],
) {
  const previous = input.materialization.input;
  const materialInput: EvidenceMaterializationInput = {
    version: EVIDENCE_FORMAT_VERSION,
    identity: { ...owner },
    scope: previous.scope,
    attribution: { state: "known", origin: "synthetic" },
    sourceRevision: { ...sourceRevision },
    coverage: previous.coverage,
    manifest: { state: "declared", recordIds: records.map((r) => r.matchId) },
    kind: "matches",
    code: input.target.kind === "win_streak" ? "unstoppable" : "otp-specialist",
    records: records.map((record) => ({
      record: { ...record },
      identity: { ...owner },
      capture: capture(`source-${record.matchId}`),
    })),
  };
  const result = materializeAchievementEvidence(materialInput);
  if (result.contentFingerprint === null || result.metadataFingerprint === null)
    throw Error("Invalid fixture materialization");
  input.materialization = {
    input: materialInput,
    expectedContentFingerprint: result.contentFingerprint,
    expectedMetadataFingerprint: result.metadataFingerprint,
  };
}
function setPages(input: StructuralReceiptInput, ids: string[]) {
  input.pages = [];
  for (let offset = 0; ; offset += input.query.count) {
    const slice = ids.slice(offset, offset + input.query.count);
    input.pages.push({
      expectedFingerprint: null,
      page: {
        scanId: input.scanId,
        attempt: 1,
        identity: { ...owner },
        query: { ...input.query, start: offset },
        capture: capture(`page-${offset}`),
        response: { state: "success", ids: slice },
      },
    });
    if (slice.length < input.query.count) break;
  }
}
function dispositionFor(record: AchievementMatch): Extract<IdDisposition, { state: "resolved" }> {
  return {
    state: "resolved",
    matchId: record.matchId,
    capture: capture(`detail-${record.matchId}`),
    detail: { ...record, playerId: owner.playerId, platform: owner.platform },
  };
}
function fixture(
  kind: "win_streak" | "otp_history" = "win_streak",
  n = 5,
  c = n,
): StructuralReceiptInput {
  const records = rows(n, c);
  const scope = structuredClone(fixedScope);
  const from = kind === "win_streak" ? records[0].timestamp : scope.season.startAt;
  const to =
    kind === "win_streak"
      ? new Date(Date.parse(records.at(-1)!.timestamp) + 1).toISOString()
      : "2026-10-31T00:00:00Z";
  if (kind === "otp_history") scope.season.endAt = to;
  const materialInput: EvidenceMaterializationInput = {
    version: EVIDENCE_FORMAT_VERSION,
    identity: { ...owner },
    scope,
    attribution: { state: "known", origin: "synthetic" },
    sourceRevision: { ...sourceRevision },
    manifest: { state: "declared", recordIds: [] },
    coverage: {
      source: "imported_history",
      historyStatus: "completed",
      unavailable: 0,
      intervalCoverage: "unproven",
    },
    kind: "matches",
    code: kind === "win_streak" ? "unstoppable" : "otp-specialist",
    records: [],
  };
  const input: StructuralReceiptInput = {
    version: STRUCTURAL_RECEIPT_VERSION,
    nature: "synthetic",
    identity: { ...owner },
    scanId: "synthetic-scan-1",
    sourceRevision: { ...sourceRevision },
    query: {
      startTime: Math.floor(Date.parse(from) / 1000),
      endTime: Math.ceil(Date.parse(to) / 1000),
      start: 0,
      count: kind === "win_streak" ? 2 : 20,
      queue: null,
      type: null,
      timeSemantics: "unconfirmed",
    },
    target:
      kind === "win_streak"
        ? {
            kind,
            interval: { from, to, precision: "milliseconds", bounds: "half_open" },
            chosenWinIds: records.slice(0, 5).map((r) => r.matchId),
          }
        : {
            kind,
            interval: { from, to, precision: "milliseconds", bounds: "half_open" },
            calendar: {
              state: "declared",
              platform: owner.platform,
              season: owner.season,
              startAt: from,
              endAt: to,
            },
          },
    pages: [],
    dispositions: records.map(dispositionFor),
    indexChange: { state: "unproven" },
    materialization: {
      input: materialInput,
      expectedContentFingerprint: "0".repeat(64),
      expectedMetadataFingerprint: "0".repeat(64),
    },
  };
  refreshMaterialization(input, records);
  setPages(
    input,
    records.map((r) => r.matchId),
  );
  return input;
}
function available(result: StructuralReceiptResult) {
  const { content } = result;
  if (content === null) throw Error(`Expected receipt declarations: ${result.reasons.join(",")}`);
  return { ...result, content };
}
const receipt = (input: unknown) => available(reconcileDeclaredEvidence(input));
function detailDisposition(input: StructuralReceiptInput, index = 0) {
  const d = input.dispositions[index];
  if (d.state !== "resolved") throw Error("Resolved fixture expected");
  return d;
}
function checkNoAuthority(result: StructuralReceiptResult) {
  expect(result.certification).toBe("not_established");
  expect(result.grantAuthorized).toBe(false);
  expect(result.writes).toBe("none");
  expect(result.provenanceAuthentication).toBe("not_performed");
  expect(result.revisionValidation).toBe("not_performed");
  expect(result.indexStability).toBe("unproven");
  expect(result.recoverableCoverage).toBe("not_established");
  expect(result.seasonClosure).toBe("not_established");
}

describe("pure structural reconciliation receipts", () => {
  it("matches consecutive supplied pages, the manifest, details and B.2.B without operational authority", () => {
    const result = receipt(fixture());
    expect(result.status).toBe("structurally_complete");
    expect(result.reasons).toEqual([]);
    expect(result.content.effectiveOffsets).toEqual([0, 2, 4]);
    expect(result.content.terminalOffset).toBe(4);
    expect(result.content.counts).toEqual({
      discovered: 5,
      disposed: 5,
      known: 5,
      unresolved: 0,
      rankedInTarget: 5,
    });
    expect(result.content.observation.status).toBe("observed");
    expect(result.content.version).toBe(STRUCTURAL_RECEIPT_VERSION);
    expect(result.content.canonicalizationVersion).toBe(RECEIPT_CANONICALIZATION_VERSION);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.content).not.toHaveProperty("fingerprint");
    checkNoAuthority(result);
  });

  it("is deterministic under declaration permutations, property order, clock and repeated calls", () => {
    const input = fixture();
    const first = receipt(deepFreeze(input));
    const shuffled = JSON.parse(
      JSON.stringify(input, (_key, value) =>
        value !== null && !Array.isArray(value) && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    );
    shuffled.pages.reverse();
    shuffled.dispositions.reverse();
    expect(receipt(shuffled)).toEqual(first);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
      expect(receipt(input)).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original received ID order and binds it to the page fingerprint", () => {
    const input = fixture();
    const page = input.pages[0].page;
    const before = fingerprintDeclaredPage(page);
    if (page.response.state !== "success") throw Error("fixture");
    page.response.ids.reverse();
    const after = receipt(input);
    expect(fingerprintDeclaredPage(page)).not.toBe(before);
    expect(after.content.pages[0].page.response).toEqual({
      state: "success",
      ids: ["LA2_2", "LA2_1"],
    });
    expect(after.status).toBe("structurally_complete");
  });

  it("requires an explicit empty terminal page after a full page", () => {
    const input = fixture();
    input.query.count = 5;
    setPages(
      input,
      rows().map((r) => r.matchId),
    );
    expect(receipt(input).content.terminalOffset).toBe(5);
    input.pages.pop();
    const result = receipt(input);
    expect(result.status).toBe("collecting");
    expect(result.reasons).toContain("terminal_missing");
    expect(result.content.observation.status).toBe("observed");
    checkNoAuthority(result);
  });

  it("an absent middle page cannot be replaced by a later short terminal", () => {
    const input = fixture();
    input.pages.splice(1, 1);
    const result = receipt(input);
    expect(result.status).not.toBe("structurally_complete");
    expect(result.reasons).toContain("page_missing");
    expect(result.content.pages).toHaveLength(2);
  });

  it("retains identical duplicate offsets and identical dispositions without inflating counts", () => {
    const input = fixture();
    input.pages.push(structuredClone(input.pages[0]));
    input.dispositions.push(structuredClone(input.dispositions[0]));
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    expect(result.content.pages).toHaveLength(4);
    expect(result.content.dispositions).toHaveLength(6);
    expect(result.content.counts.discovered).toBe(5);
    expect(result.content.counts.disposed).toBe(5);
  });

  it("retains retries and accepts a failed attempt only when a later explicit success resolves that offset", () => {
    const input = fixture();
    const failed = structuredClone(input.pages[0]);
    failed.page.response = { state: "failed", reason: "network" };
    input.pages[0].page.attempt = 2;
    input.pages[0].page.capture = capture("retry-page-0");
    input.pages.push(failed);
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    expect(result.content.pages).toHaveLength(4);
    expect(result.content.pages[0].page.response.state).toBe("failed");
    checkNoAuthority(result);
    failed.page.attempt = 3;
    failed.page.capture = capture("failed-last-attempt");
    expect(receipt(input).reasons).toContain("page_failed");
  });

  it("does not select a favorable response when two successful attempts disagree", () => {
    const input = fixture();
    const conflict = structuredClone(input.pages[0]);
    conflict.page.attempt = 2;
    conflict.page.capture = capture("conflicting-page");
    conflict.page.response = { state: "success", ids: ["LA2_999", "LA2_1"] };
    input.pages.push(conflict);
    const result = receipt(input);
    expect(result.status).toBe("contradictory");
    expect(result.reasons).toContain("conflicting_page");
    expect(result.content.pages).toHaveLength(4);
    expect(result.content.discoveredIds).toContain("LA2_999");
    expect(result.fingerprint).toBeNull();
  });

  it("detects overlap consistent with an index shift but cannot prove hidden provider stability", () => {
    const input = fixture();
    input.pages[1].page.response = { state: "success", ids: ["LA2_2", "LA2_4"] };
    const result = receipt(input);
    expect(result.reasons).toContain("repeated_page_ids");
    expect(result.status).not.toBe("structurally_complete");
    checkNoAuthority(receipt(fixture()));
  });

  it("retains reported late IDs rather than inventing a stable snapshot token", () => {
    const input = fixture();
    input.indexChange = { state: "reported", reason: "late_ids", ids: ["LA2_999"] };
    const result = receipt(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("index_change_reported");
    expect(result.content.indexChange).toEqual(input.indexChange);
    expect(result).not.toHaveProperty("snapshotToken");
  });

  it.each(["network", "http_429", "http_5xx", "invalid_response"] as const)(
    "does not treat a simulated %s response as an empty terminal",
    (reason) => {
      const input = fixture();
      input.pages.at(-1)!.page.response = { state: "failed", reason };
      const result = receipt(input);
      expect(result.status).not.toBe("structurally_complete");
      expect(result.reasons).toContain("page_failed");
      expect(result.reasons).toContain("terminal_missing");
      expect(result.content.terminalOffset).toBeNull();
    },
  );

  it("a partial response is not proof of a short terminal", () => {
    const input = fixture();
    input.pages.at(-1)!.page.response = { state: "partial", ids: ["LA2_5"] };
    const result = receipt(input);
    expect(result.status).toBe("collecting");
    expect(result.reasons).toContain("page_partial");
    expect(result.content.terminalOffset).toBeNull();
  });

  it("does not mix a different scan or parameter set into the selected scan", () => {
    const input = fixture();
    input.pages[1].page.scanId = "another-scan";
    expect(receipt(input).reasons).toContain("scan_mismatch");
    input.pages[1].page.scanId = input.scanId;
    input.pages[1].page.query.endTime -= 1;
    expect(receipt(input).reasons).toContain("query_mismatch");
  });

  it("rejects pages after a terminal and scans starting past zero", () => {
    const input = fixture();
    input.pages[0].page.response = { state: "success", ids: [] };
    expect(receipt(input).reasons).toContain("page_after_terminal");
    const nonzero = fixture();
    nonzero.query.start = 2;
    expect(receipt(nonzero).reasons).toContain("page_missing");
  });

  it.each(["unavailable_404", "pending", "unknown", "invalid"] as const)(
    "preserves %s as unresolved, never permanent absence or loss",
    (state) => {
      const input = fixture();
      input.dispositions[0] =
        state === "invalid"
          ? { state, matchId: "LA2_1", reason: "schema" }
          : { state, matchId: "LA2_1" };
      const result = receipt(input);
      expect(result.status).not.toBe("structurally_complete");
      expect(result.content.dispositions.some((d) => d.state === state)).toBe(true);
      expect(result.content.counts.unresolved).toBe(1);
      expect(result.content.counts.known).toBe(4);
      checkNoAuthority(result);
    },
  );

  it("does not attest an existing detail, even when its content matches", () => {
    const input = fixture();
    const d = detailDisposition(input);
    input.dispositions[0] = {
      state: "reused_without_attestation",
      matchId: d.matchId,
      detail: d.detail,
    };
    const result = receipt(input);
    expect(result.reasons).toContain("reuse_unattested");
    expect(result.status).toBe("blocked");
    checkNoAuthority(result);
  });

  it("matching declared attestation enables only structural concordance", () => {
    const input = fixture();
    const d = detailDisposition(input);
    input.dispositions[0] = {
      ...d,
      state: "reused_with_matching_attestation_declared",
      attestation: {
        state: "declared",
        identity: { ...owner },
        sourceRevision: { ...sourceRevision },
        contentFingerprint: input.materialization.expectedContentFingerprint,
        metadataFingerprint: input.materialization.expectedMetadataFingerprint,
      },
    };
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    checkNoAuthority(result);
    input.dispositions[0].attestation.contentFingerprint = "0".repeat(64);
    expect(receipt(input).reasons).toContain("attestation_mismatch");
  });

  it.each([
    "queueId",
    "timestamp",
    "playerId",
    "platform",
    "isRemake",
    "win",
    "championId",
  ] as const)("retains unknown %s and blocks relevant reconciliation", (field) => {
    const input = fixture();
    detailDisposition(input).detail[field] = null;
    const result = receipt(input);
    expect(result.status).not.toBe("structurally_complete");
    expect(result.content.counts.unresolved).toBe(1);
    expect(result.content.dispositions[0]).toMatchObject({ detail: { [field]: null } });
  });

  it("does not convert a detail from another player into a valid ranked match", () => {
    const input = fixture();
    detailDisposition(input).detail.playerId = "00000000-0000-4000-8000-000000000002";
    const result = receipt(input);
    expect(result.status).toBe("contradictory");
    expect(result.reasons).toContain("detail_identity_mismatch");
    expect(result.content.counts.rankedInTarget).toBe(4);
    expect(result.content.observation.status).not.toBe("observed");
  });

  it("detects requested/detail ID mismatch and extra/missing dispositions", () => {
    const input = fixture();
    detailDisposition(input).detail.matchId = "LA2_999";
    expect(receipt(input).reasons).toContain("detail_id_mismatch");
    const missing = fixture();
    missing.dispositions.pop();
    expect(receipt(missing).reasons).toContain("disposition_missing");
    const extra = fixture();
    extra.dispositions.push({ state: "unknown", matchId: "LA2_999" });
    expect(receipt(extra).reasons).toContain("disposition_extra");
  });

  it("keeps contradictions in detail/remake classification", () => {
    const input = fixture();
    const conflict = structuredClone(detailDisposition(input));
    conflict.detail.isRemake = true;
    input.dispositions.push(conflict);
    const result = receipt(input);
    expect(result.status).toBe("contradictory");
    expect(result.reasons).toContain("conflicting_disposition");
    expect(result.content.dispositions).toHaveLength(6);
  });

  it("classifies other queues before comparing the ranked source set", () => {
    const input = fixture();
    const other = { ...rows(1)[0], matchId: "LA2_999", queueId: 440 };
    input.dispositions.push({
      ...dispositionFor(other),
      state: "excluded_with_basis",
      basis: "other_queue",
    });
    setPages(input, [...rows().map((r) => r.matchId), other.matchId]);
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    expect(result.content.counts.discovered).toBe(6);
    expect(result.content.counts.rankedInTarget).toBe(5);
    expect(result.content.matchSummary.validGames).toBe(5);
    input.dispositions[input.dispositions.length - 1] = dispositionFor(other);
    expect(receipt(input).reasons).toContain("exclusion_required");
  });

  it("keeps out-of-target details with a justified margin exclusion", () => {
    const input = fixture();
    input.query.startTime -= 60;
    const outside = {
      ...rows(1)[0],
      matchId: "LA2_999",
      timestamp: new Date(Date.parse(rows()[0].timestamp) - 30000).toISOString(),
    };
    input.dispositions.push({
      ...dispositionFor(outside),
      state: "excluded_with_basis",
      basis: "outside_target_interval",
    });
    setPages(input, [...rows().map((r) => r.matchId), outside.matchId]);
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    expect(result.content.dispositions).toHaveLength(6);
    input.query.startTime += 60;
    input.pages.forEach((p) => {
      p.page.query.startTime = input.query.startTime;
    });
    expect(receipt(input).reasons).toContain("detail_outside_query");
  });

  it("rejects an exclusion based on a null remake rather than dropping it", () => {
    const input = fixture();
    const d = detailDisposition(input);
    input.dispositions[0] = {
      ...d,
      state: "excluded_with_basis",
      basis: "confirmed_remake",
      detail: { ...d.detail, isRemake: null },
    };
    const result = receipt(input);
    expect(result.reasons).toContain("exclusion_basis_mismatch");
    expect(result.reasons).toContain("unknown_match_fields");
    expect(result.content.discoveredIds).toContain("LA2_1");
  });

  it("preserves a confirmed interleaved remake, ignoring it only in evaluation", () => {
    const input = fixture();
    const remake = {
      ...rows(1)[0],
      matchId: "LA2_999",
      timestamp: "2026-10-01T12:00:30Z",
      isRemake: true,
      win: null,
      championId: null,
    };
    refreshMaterialization(input, [...rows(), remake]);
    input.dispositions.push({
      ...dispositionFor(remake),
      state: "excluded_with_basis",
      basis: "confirmed_remake",
    });
    setPages(input, [...rows().map((r) => r.matchId), remake.matchId]);
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    expect(result.content.matchSummary.exclusions).toEqual([
      { matchId: remake.matchId, reason: "confirmed_remake" },
    ]);
    expect(result.content.counts.rankedInTarget).toBe(6);
    expect(result.content.observation.status).toBe("observed");
  });

  it("detects a recovered loss missing from the five-win materialization", () => {
    const input = fixture();
    const loss = {
      ...rows(1)[0],
      matchId: "LA2_999",
      timestamp: "2026-10-01T12:00:30Z",
      win: false,
    };
    input.dispositions.push(dispositionFor(loss));
    setPages(input, [...rows().map((r) => r.matchId), loss.matchId]);
    const result = receipt(input);
    expect(result.status).toBe("contradictory");
    expect(result.reasons).toContain("materialization_mismatch");
    expect(result.content.observation.status).not.toBe("observed");
    refreshMaterialization(input, [...rows(), loss]);
    expect(receipt(input).reasons).toContain("chosen_streak_not_supported");
  });

  it("retains ambiguous competitive timestamps instead of using an ID tie-break as proof", () => {
    const input = fixture();
    const records = rows();
    records[1].timestamp = records[0].timestamp;
    refreshMaterialization(input, records);
    input.dispositions = records.map(dispositionFor);
    const result = receipt(input);
    expect(result.reasons).toContain("ambiguous_timestamp");
    expect(result.content.observation.status).not.toBe("observed");
  });

  it("compares only the I1 interval when B.2.B also contains earlier matches in an incomplete season", () => {
    const input = fixture();
    const older = {
      ...rows(1)[0],
      matchId: "LA2_999",
      timestamp: "2026-09-01T00:00:00Z",
      win: false,
    };
    input.materialization.input.coverage.historyStatus = "running";
    refreshMaterialization(input, [...rows(), older]);
    expect(receipt(input).status).toBe("structurally_complete");
  });

  it.each([
    [49, 33, "insufficient_evidence"],
    [50, 32, "not_observed"],
    [50, 33, "observed"],
    [100, 65, "observed"],
    [100, 64, "not_observed"],
  ] as const)(
    "OTP N=%s C=%s retains exact observational outcome %s without historical grant",
    (n, c, expected) => {
      const result = receipt(fixture("otp_history", n, c));
      expect(result.status).toBe("structurally_complete");
      expect(result.content.observation.status).toBe(expected);
      expect(result.content.matchSummary.validGames).toBe(n);
      if (result.content.observation.evidence?.kind !== "recorded_champion_share")
        throw Error("fixture");
      const evidence = result.content.observation.evidence;
      expect(evidence.championGames).toBe(c);
      expect(evidence.share).toEqual({ numerator: c, denominator: n });
      expect(evidence.rule.minShare).toEqual({ numerator: 13, denominator: 20 });
      expect(evidence.rule.minGames).toBe(50);
      checkNoAuthority(result);
    },
  );

  it("blocks an incomplete OTP denominator rather than certifying the available numerator", () => {
    const input = fixture("otp_history", 50, 33);
    input.dispositions.pop();
    const result = receipt(input);
    expect(result.status).not.toBe("structurally_complete");
    expect(result.reasons).toContain("source_concordance_pending");
    expect(result.content.counts.unresolved).toBe(1);
  });

  it("does not infer operational season closure from an open source, a fixture date or a declared calendar", () => {
    const closed = receipt(fixture("otp_history", 50, 33));
    expect(closed.status).toBe("structurally_complete");
    checkNoAuthority(closed);
    const input = fixture("otp_history", 50, 33);
    input.materialization.input.scope.season.endAt = null;
    refreshMaterialization(input);
    const result = receipt(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("season_open");
    checkNoAuthority(result);
    if (input.target.kind !== "otp_history") throw Error("fixture");
    input.target.calendar = { state: "unknown" };
    expect(receipt(input).reasons).toContain("calendar_missing");
  });

  it("checks declared calendar platform, season and bounds without authenticating them", () => {
    const input = fixture("otp_history", 50, 33);
    if (input.target.kind !== "otp_history" || input.target.calendar.state !== "declared")
      throw Error("fixture");
    input.target.calendar.season = "2025";
    expect(receipt(input).reasons).toContain("calendar_mismatch");
  });

  it.each(["page", "detail", "materialization"] as const)(
    "keeps %s legacy provenance unestablished",
    (where) => {
      const input = fixture();
      const legacy: SourceCapture = {
        state: "legacy",
        source: "stored",
        endpoint: "unknown",
        captureId: null,
        receivedAt: null,
      };
      if (where === "page") input.pages[0].page.capture = legacy;
      if (where === "detail") detailDisposition(input).capture = legacy;
      if (where === "materialization") {
        input.materialization.input.records[0].capture = legacy;
        const m = materializeAchievementEvidence(input.materialization.input);
        if (!m.contentFingerprint || !m.metadataFingerprint) throw Error("fixture");
        input.materialization.expectedContentFingerprint = m.contentFingerprint;
        input.materialization.expectedMetadataFingerprint = m.metadataFingerprint;
      }
      const result = receipt(input);
      expect(result.status).toBe("blocked");
      expect(result.reasons).toContain("legacy_unattested");
      checkNoAuthority(result);
    },
  );

  it.each(["content", "metadata", "revision", "page"] as const)(
    "detects incorrect declared %s integrity",
    (field) => {
      const input = fixture();
      if (field === "content") input.materialization.expectedContentFingerprint = "0".repeat(64);
      if (field === "metadata") input.materialization.expectedMetadataFingerprint = "0".repeat(64);
      if (field === "revision")
        input.sourceRevision = { state: "declared", value: "different-revision" };
      if (field === "page") input.pages[0].expectedFingerprint = "0".repeat(64);
      const result = receipt(input);
      expect(result.status).toBe("contradictory");
      expect(result.fingerprint).toBeNull();
    },
  );

  it("accepts matching page fingerprints only as content integrity", () => {
    const input = fixture();
    input.pages.forEach((p) => {
      p.expectedFingerprint = fingerprintDeclaredPage(p.page);
    });
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    checkNoAuthority(result);
  });

  it("detects capture ID reuse for different declarations", () => {
    const input = fixture();
    input.pages[1].page.capture = { ...input.pages[0].page.capture };
    const result = receipt(input);
    expect(result.reasons).toContain("capture_conflict");
    expect(result.status).toBe("contradictory");
  });

  it.each([
    { grantAuthorized: true },
    { puuid: "fake-private-field" },
    { token: "fake-private-field" },
    { version: "unsupported-version" },
    { query: { count: 0 } },
  ])("rejects extra authority/secrets or invalid input without echoing it: %j", (change) => {
    const result = reconcileDeclaredEvidence({ ...fixture(), ...change });
    expect(result.status).toBe("invalid_input");
    expect(result.content).toBeNull();
    expect(JSON.stringify(result)).not.toContain("fake-private-field");
    checkNoAuthority(result);
  });

  it("checks malformed timestamps, millisecond precision and effective query coverage", () => {
    const input = fixture();
    const malformed = {
      ...input,
      target: {
        ...input.target,
        interval: { from: "2026-02-30T00:00:00Z", to: input.target.interval.to },
      },
    };
    expect(reconcileDeclaredEvidence(malformed).status).toBe("invalid_input");
    detailDisposition(input).detail.timestamp = "2026-10-01T12:00:00.0001Z";
    expect(reconcileDeclaredEvidence(input).status).toBe("invalid_input");
    const margin = fixture();
    margin.query.endTime -= 1;
    expect(receipt(margin).reasons).toContain("query_margin_insufficient");
  });

  it("does not wire receipt production into B.1, consumers, SQL, Riot or grants", () => {
    const code = readFileSync(resolve("src/server/achievements/verification/receipts.ts"), "utf8");
    expect(code).toContain('import "server-only"');
    expect(code).not.toMatch(
      /fetch\(|process\.env|Date\.now|new Date\(\)|console\.|simulateBadgeVerification|from ["'](?:@\/db|.*sync\/|node:fs|.*riot)/,
    );
    function walk(path: string): string[] {
      return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)],
      );
    }
    for (const path of walk(resolve("src"))) {
      if (path.includes(resolve("src/server/achievements/verification"))) continue;
      expect(readFileSync(path, "utf8")).not.toMatch(
        /reconcileDeclaredEvidence|verification\/receipts|verification\/receipt-contracts/,
      );
    }
    expect(OTP_RULE).toMatchObject({
      version: "1.1-otp-observed-v2",
      minGames: 50,
      minShare: { numerator: 13, denominator: 20 },
    });
    expect(RESURRECTION_RULE).toMatchObject({ version: "1.1.A-observed-v1", minDropLp: 50 });
    expect(UNSTOPPABLE_RULE).toMatchObject({ version: "1.1.A-observed-v1", minWins: 5 });
  });

  it("the exact half-open I1 interval must include the fifth victory, not end on its timestamp", () => {
    const input = fixture();
    input.target.interval.to = rows().at(-1)!.timestamp;
    const result = receipt(input);
    expect(result.reasons).toContain("chosen_streak_not_supported");
    expect(result.content.counts.rankedInTarget).toBe(4);
    expect(result.content.target.interval.precision).toBe("milliseconds");
    expect(result.content.target.interval.bounds).toBe("half_open");
    expect(result.status).not.toBe("structurally_complete");
  });

  it("scope changes in a page cannot migrate evidence between players", () => {
    const input = fixture();
    input.pages[0].page.identity.playerId = "00000000-0000-4000-8000-000000000002";
    const result = receipt(input);
    expect(result.reasons).toContain("identity_mismatch");
    expect(result.status).toBe("contradictory");
    expect(result.identity).toEqual(owner);
  });

  it("requires compatible ranked filters and preserves the actual sent seconds", () => {
    const input = fixture();
    input.query.type = "normal";
    input.pages.forEach((p) => {
      p.page.query.type = "normal";
    });
    const result = receipt(input);
    expect(result.reasons).toContain("query_mismatch");
    expect(result.content.query.timeSemantics).toBe("unconfirmed");
    expect(result.content.query.startTime).toBe(input.query.startTime);
  });

  it("does not accept a disposition that contradicts B.2.B's known remake classification", () => {
    const input = fixture();
    detailDisposition(input).detail.isRemake = true;
    const result = receipt(input);
    expect(result.reasons).toContain("materialization_mismatch");
    expect(result.status).toBe("contradictory");
    expect(result.content.discoveredIds).toHaveLength(5);
  });

  it("reports scope, format and explicitly unknown counts on a structurally invalid materialization", () => {
    const input = fixture();
    const result = reconcileDeclaredEvidence({
      ...input,
      materialization: { ...input.materialization, input: {} },
    });
    expect(result.version).toBe(STRUCTURAL_RECEIPT_VERSION);
    expect(result.canonicalizationVersion).toBe(RECEIPT_CANONICALIZATION_VERSION);
    expect(result.identity).toEqual(owner);
    expect(result.target?.kind).toBe("win_streak");
    expect(result.counts).toBeNull();
    expect(result.fingerprint).toBeNull();
    checkNoAuthority(result);
  });

  it("a declared Riot capture with matching hashes is still not authenticated", () => {
    const input = fixture();
    const capture = input.pages[0].page.capture;
    if (capture.state !== "declared") throw Error("fixture");
    capture.source = "riot";
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    checkNoAuthority(result);
  });

  it("binds identical detail captures across receipt and B.2.B without authenticating them", () => {
    const input = fixture();
    detailDisposition(input).capture = structuredClone(
      input.materialization.input.records[0].capture,
    );
    const result = receipt(input);
    expect(result.status).toBe("structurally_complete");
    checkNoAuthority(result);
  });

  it("detects conflicting capture metadata across B.2.B and a matching receipt detail", () => {
    const input = fixture();
    const original = input.materialization.input.records[0].capture;
    if (original.state !== "declared") throw Error("fixture");
    detailDisposition(input).capture = { ...original, receivedAt: "2026-11-03T00:00:00Z" };
    const result = receipt(input);
    expect(result.status).toBe("contradictory");
    expect(result.reasons).toContain("capture_conflict");
    expect(result.fingerprint).toBeNull();
    checkNoAuthority(result);
  });
});
