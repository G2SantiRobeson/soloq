import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  EVIDENCE_FORMAT_VERSION,
  CANONICALIZATION_VERSION,
  type EvidenceMaterializationInput,
  type EvidenceMaterializationResult,
  type SourceCapture,
} from "@/server/achievements/verification/materialization-contracts";
import { materializeAchievementEvidence } from "@/server/achievements/verification/materialize";
import {
  OTP_RULE,
  RESURRECTION_RULE,
  UNSTOPPABLE_RULE,
  evaluateOtpSpecialist,
  evaluateResurrection,
  evaluateUnstoppable,
} from "@/lib/achievements";
import { fixedScope, snapshot, match, otpMatches, deepFreeze } from "./achievements-fixtures";

const identity = {
  playerId: "00000000-0000-4000-8000-000000000001",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
const legacy: SourceCapture = {
  state: "legacy",
  source: "stored",
  endpoint: "unknown",
  captureId: null,
  receivedAt: null,
};
function fixture(code?: "resurrection"): Extract<EvidenceMaterializationInput, { kind: "ranked" }>;
function fixture(
  code: "unstoppable" | "otp-specialist",
): Extract<EvidenceMaterializationInput, { kind: "matches" }>;
function fixture(code: EvidenceMaterializationInput["code"]): EvidenceMaterializationInput;
function fixture(
  code: EvidenceMaterializationInput["code"] = "resurrection",
): EvidenceMaterializationInput {
  const common: Omit<EvidenceMaterializationInput, "kind" | "code" | "records" | "manifest"> = {
    version: EVIDENCE_FORMAT_VERSION,
    identity: { ...identity },
    scope: structuredClone(fixedScope),
    attribution: { state: "known", origin: "synthetic" } as const,
    sourceRevision: { state: "unknown" } as const,
    coverage: {
      source: "imported_history",
      historyStatus: "completed",
      unavailable: 0,
      intervalCoverage: "unproven",
    } as const,
  };
  if (code === "resurrection") {
    const points = [
      snapshot(80, 0, { losses: 10, wins: 20 }),
      snapshot(50, 0.5, { losses: 11, wins: 20 }),
      snapshot(25, 1, { losses: 12, wins: 20 }),
      snapshot(80, 2, { losses: 12, wins: 21 }),
    ].map((point) => ({ ...point, id: point.id! }));
    return {
      ...common,
      kind: "ranked",
      code,
      records: points.map((record) => ({
        identity: { ...identity },
        capture: { ...legacy },
        record,
      })),
      manifest: { state: "declared", recordIds: points.map((p) => p.id) },
    };
  }
  const rows = (
    code === "unstoppable" ? Array.from({ length: 5 }, (_, i) => match(i)) : otpMatches()
  ).map((record, i) => ({ ...record, matchId: `LA2_${i + 1}` }));
  return {
    ...common,
    kind: "matches",
    code,
    records: rows.map((record) => ({ identity: { ...identity }, capture: { ...legacy }, record })),
    manifest: { state: "declared", recordIds: rows.map((m) => m.matchId) },
  };
}
function available(result: EvidenceMaterializationResult) {
  expect(result.content).not.toBeNull();
  const { content, metadata, observation } = result;
  if (content === null || metadata === null || observation === null)
    throw Error("Expected materialized content");
  return { ...result, content, metadata, observation };
}
const materialize = (input: unknown) => available(materializeAchievementEvidence(input));

describe("pure evidence materialization", () => {
  it("is deterministic, immutable and versioned without an implicit clock", () => {
    const input = deepFreeze(fixture());
    const first = materialize(input);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
      expect(materialize(input)).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
    expect(first.content.formatVersion).toBe(EVIDENCE_FORMAT_VERSION);
    expect(first.content.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    expect(first.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    // Pins the byte format: changing canonicalization needs an explicit version decision.
    expect(first.contentFingerprint).toBe(
      "f3311ad619daeab2da7a711ce0ddfc9d223f8d010931363ddecc5c686afc2303",
    );
    expect(first.metadataFingerprint).toBe(
      "3f68a571c40db83f6ffb543b8fc6d3939d37ed49af938fd79fce70e6686445e4",
    );
    expect(first.content).not.toHaveProperty("contentFingerprint");
    expect(first.metadata.contentFingerprint).toBe(first.contentFingerprint);
    expect(first.metadata).not.toHaveProperty("metadataFingerprint");
  });

  it("canonicalizes property order and permutations of the complete source set", () => {
    const input = fixture();
    const first = materialize(input);
    const shuffled = JSON.parse(
      JSON.stringify(input, (_key, value) => {
        if (value !== null && !Array.isArray(value) && typeof value === "object")
          return Object.fromEntries(Object.entries(value).reverse());
        return value;
      }),
    );
    shuffled.records.reverse();
    shuffled.manifest.recordIds.reverse();
    expect(materialize(shuffled)).toEqual(first);
  });

  it("normalizes equivalent offsets to UTC while retaining the original source timestamps", () => {
    const input = fixture("unstoppable");
    const first = materialize(input);
    const original = input.records[0].record.timestamp;
    input.records[0].record.timestamp = "2026-10-01T09:00:00-03:00";
    const second = materialize(input);
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
    expect(second.metadataFingerprint).not.toBe(first.metadataFingerprint);
    expect(second.content.sources.records[0].timestamp).toBe(new Date(original).toISOString());
    expect(second.metadata.records[0].originalTimestamps).toEqual(["2026-10-01T09:00:00-03:00"]);
  });

  it("collapses identical duplicate IDs without inflating N and retains every distinct capture", () => {
    const input = fixture("otp-specialist");
    const first = materialize(input);
    const duplicate = structuredClone(input.records[0]);
    duplicate.capture = {
      state: "declared",
      source: "synthetic",
      endpoint: "MATCH-V5",
      captureId: "fixture-capture",
      receivedAt: "2026-11-01T00:00:00Z",
    };
    input.records.push(duplicate);
    const second = materialize(input);
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
    expect(second.matchSummary?.validGames).toBe(50);
    expect(second.metadata.records[0].captures).toHaveLength(2);
    input.records.reverse();
    expect(materialize(input)).toEqual(second);
  });

  it.each(["resurrection", "unstoppable", "otp-specialist"] as const)(
    "rejects contradictory duplicate IDs for %s without selecting a favorable row",
    (code) => {
      const input = fixture(code);
      const duplicate = structuredClone(input.records[0]);
      if ("leaguePoints" in duplicate.record) duplicate.record.leaguePoints += 1;
      else duplicate.record.win = false;
      const bad = { ...input, records: [...input.records, duplicate] };
      const result = materializeAchievementEvidence(bad);
      expect(result.status).toBe("contradictory");
      expect(result.reasons).toEqual(["conflicting_duplicate"]);
      expect(result.contentFingerprint).toBeNull();
      expect(materializeAchievementEvidence({ ...bad, records: bad.records.toReversed() })).toEqual(
        result,
      );
    },
  );

  it.each(["player", "platform", "queue", "season"])(
    "binds the %s scope to the fingerprint",
    (dimension) => {
      const input = fixture("unstoppable");
      const before = materialize(input).contentFingerprint;
      if (dimension === "player") input.identity.playerId = "00000000-0000-4000-8000-000000000002";
      if (dimension === "season") {
        input.identity.season = "synthetic-season";
        input.scope.season.id = "synthetic-season";
      }
      if (dimension === "queue") {
        input.identity.queue = "RANKED_FLEX_SR";
        input.scope.view = "flex";
        if (input.kind === "matches")
          input.records.forEach((r) => {
            r.record.queueId = 440;
          });
      }
      if (dimension === "platform") {
        input.identity.platform = "LA1";
        input.scope.platform = "LA1";
        if (input.kind === "matches")
          input.records.forEach((r) => {
            r.record.matchId = r.record.matchId.replace("LA2_", "LA1_");
          });
        if (input.manifest.state === "declared")
          input.manifest.recordIds = input.manifest.recordIds.map((id) =>
            id.replace("LA2_", "LA1_"),
          );
      }
      input.records.forEach((r) => {
        r.identity = { ...input.identity };
      });
      expect(materialize(input).contentFingerprint).not.toBe(before);
    },
  );

  it("orders timestamp ties by ordinal ID but retains the ambiguity", () => {
    const input = fixture("unstoppable");
    input.records[1].record.timestamp = input.records[0].record.timestamp;
    input.records.reverse();
    const result = materialize(input);
    expect(
      result.content.sources.records.slice(0, 2).map((m) => ("matchId" in m ? m.matchId : m.id)),
    ).toEqual(["LA2_1", "LA2_2"]);
    expect(result.status).toBe("incomplete");
    expect(result.reasons).toContain("ambiguous_timestamp");
    expect(result.observation.status).not.toBe("observed");
  });

  it("never converts null into false or drops unknown matches to improve OTP", () => {
    const input = fixture("otp-specialist");
    const before = materialize(input);
    if (input.kind !== "matches") throw Error("fixture");
    input.records[0].record.isRemake = null;
    input.records[1].record.win = null;
    input.records[2].record.championId = null;
    const result = materialize(input);
    expect(result.contentFingerprint).not.toBe(before.contentFingerprint);
    expect(result.content.sources.records).toHaveLength(50);
    expect(result.matchSummary?.validGames).toBe(47);
    expect(result.matchSummary?.unresolved).toEqual([
      { matchId: "LA2_1", fields: ["isRemake"] },
      { matchId: "LA2_2", fields: ["win"] },
      { matchId: "LA2_3", fields: ["championId"] },
    ]);
    expect(result.observation.status).toBe("insufficient_evidence");
  });

  it("keeps confirmed remakes in the complete manifest and explains their exclusion", () => {
    const input = fixture("otp-specialist");
    if (input.kind !== "matches") throw Error("fixture");
    input.records[0].record.isRemake = true;
    input.records[0].record.win = null;
    input.records[0].record.championId = null;
    const result = materialize(input);
    expect(result.matchSummary?.validGames).toBe(49);
    expect(result.matchSummary?.exclusions).toEqual([
      { matchId: "LA2_1", reason: "confirmed_remake" },
    ]);
    expect(result.matchSummary?.unresolved).toEqual([]);
    expect(result.content.sources.records).toHaveLength(50);
    expect(result.matchSummary?.championCounts).toEqual([
      { championId: 99, games: 15 },
      { championId: 157, games: 34 },
    ]);
  });

  it.each([undefined, "bad-date", "2026-02-30T00:00:00Z", "2026-10-01T12:00:00.0001Z"])(
    "rejects invalid or lossy source timestamp %s",
    (timestamp) => {
      const input = fixture("unstoppable");
      const bad = {
        ...input,
        records: input.records.map((r, i) =>
          i ? r : { ...r, record: { ...r.record, timestamp } },
        ),
      };
      const result = materializeAchievementEvidence(bad);
      expect(result.status).toBe("invalid_input");
      expect(result.reasons).toContain("invalid_timestamp");
    },
  );

  it.each(["2025-12-31T00:00:00Z", fixedScope.asOf, "2027-01-01T00:00:00Z"])(
    "rejects rather than silently filters outside-window date %s",
    (timestamp) => {
      const input = fixture("unstoppable");
      input.records[0].record.timestamp = timestamp;
      expect(materializeAchievementEvidence(input).reasons).toContain("outside_window");
    },
  );

  it.each(["scope", "identity", "queue", "platform", "endpoint"])(
    "rejects inconsistent %s",
    (field) => {
      const input = fixture("unstoppable");
      if (field === "scope") input.scope.view = "flex";
      if (field === "identity")
        input.records[0].identity.playerId = "00000000-0000-4000-8000-000000000002";
      if (input.kind === "matches") {
        if (field === "queue") input.records[0].record.queueId = 440;
        if (field === "platform") input.records[0].record.matchId = "NA1_1";
      }
      if (field === "endpoint")
        input.records[0].capture = {
          state: "declared",
          source: "riot",
          endpoint: "LEAGUE-V4",
          receivedAt: null,
          captureId: null,
        };
      const result = materializeAchievementEvidence(input);
      expect(result.status).toBe("invalid_input");
      expect(result.reasons).toContain(
        `${field === "scope" ? "scope" : field === "endpoint" ? "capture_endpoint" : field}_mismatch`,
      );
    },
  );

  it("rejects unsafe integers, extra secrets, raw payloads and interpolation flags", () => {
    const input = fixture();
    const variants = [
      { ...input, token: "synthetic-forbidden-field" },
      { ...input, puuid: "synthetic-forbidden-field" },
      { ...input, records: input.records.map((r) => ({ ...r, rawPayload: {} })) },
      {
        ...input,
        records: input.records.map((r) => ({ ...r, record: { ...r.record, interpolated: true } })),
      },
      {
        ...input,
        records: input.records.map((r) => ({
          ...r,
          record: { ...r.record, leaguePoints: Number.MAX_SAFE_INTEGER + 1 },
        })),
      },
    ];
    for (const bad of variants) {
      const result = materializeAchievementEvidence(bad);
      expect(result.status).toBe("invalid_input");
      expect(JSON.stringify(result)).not.toContain("synthetic-forbidden-field");
    }
  });

  it("preserves legacy nulls and never manufactures captures or revision", () => {
    const result = materialize(fixture());
    expect(result.metadata.sourceRevision).toEqual({ state: "unknown" });
    expect(
      result.metadata.records.every(
        (r) => r.captures.length === 1 && JSON.stringify(r.captures[0]) === JSON.stringify(legacy),
      ),
    ).toBe(true);
    expect(result.reasons).toContain("legacy_provenance_unproven");
  });

  it("does not authenticate a synthetic source claiming Riot or a declared revision", () => {
    const input = fixture();
    input.sourceRevision = { state: "declared", value: "123" };
    input.records.forEach((r) => {
      r.capture = {
        state: "declared",
        source: "riot",
        endpoint: "LEAGUE-V4",
        captureId: "synthetic-id",
        receivedAt: "2026-11-01T00:00:00Z",
      };
    });
    const result = materialize(input);
    expect(result.observation.status).toBe("observed");
    expect(result.metadata.attribution).toEqual({ state: "known", origin: "synthetic" });
    expect(result.metadata.sourceRevision).toEqual({ state: "declared", value: "123" });
    expect(result.provenanceAuthentication).toBe("not_performed");
    expect(result.revisionValidation).toBe("not_performed");
    expect(result.reasons).toContain("source_revision_not_verified");
    expect(result.grantAuthorized).toBe(false);
  });

  it.each([
    { state: "unknown" },
    { state: "unproven", claim: "riot" },
    { state: "known", origin: "riot" },
  ] as const)("preserves attribution %j without promoting it", (attribution) => {
    const input = { ...fixture(), attribution };
    const result = materialize(input);
    expect(result.metadata.attribution).toEqual(attribution);
    expect(result.provenanceAuthentication).toBe("not_performed");
    expect(result.certification).toBe("not_established");
  });

  it("retains A/B/C and every intermediate snapshot, not an interpolated trajectory", () => {
    const input = fixture();
    const result = materialize(input);
    expect(result.observation.status).toBe("observed");
    const evidence = result.observation.evidence;
    if (evidence?.kind !== "rank_recovery") throw Error("rank recovery expected");
    expect(evidence.observationCount).toBe(4);
    expect(evidence.observations.map((p) => p.leaguePoints)).toEqual([80, 50, 25, 80]);
    expect(evidence.before.leaguePoints).toBe(80);
    expect(evidence.minimum.leaguePoints).toBe(25);
    expect(evidence.recovered.leaguePoints).toBe(80);
    expect(result.content.sources.records).toHaveLength(4);
  });

  it("marks R1 incomplete when a supplied intermediate source ID is absent", () => {
    const input = fixture();
    input.records.splice(1, 1);
    const result = materialize(input);
    expect(result.status).toBe("incomplete");
    expect(result.reasons).toContain("manifest_mismatch");
    expect(
      result.content.manifest.state === "declared" && result.content.manifest.recordIds,
    ).toHaveLength(4);
    expect(result.grantAuthorized).toBe(false);
  });

  it.each(["unknown", "extra", "missing"])(
    "reports manifest %s without truncating the supplied sources",
    (state) => {
      const input = fixture("unstoppable");
      if (state === "unknown") input.manifest = { state: "unknown" };
      else if (input.manifest.state === "declared") {
        if (state === "extra") input.manifest.recordIds.push("LA2_999");
        else input.manifest.recordIds.pop();
      }
      const result = materialize(input);
      expect(result.status).toBe("incomplete");
      expect(result.content.sources.records).toHaveLength(5);
    },
  );

  it("five wins and completed never manufacture reconciliation", () => {
    const result = materialize(fixture("unstoppable"));
    expect(result.observation.status).toBe("observed");
    expect(result.reconciliation).toEqual({ state: "unknown" });
    expect(result.reasons).toContain("reconciliation_not_materialized");
    expect(result.intervalCoverage).toBe("unproven");
  });

  it("retains the exact partial OTP denominator and does not infer season closure", () => {
    const input = fixture("otp-specialist");
    input.coverage.historyStatus = "running";
    input.scope.season.endAt = "2026-10-31T00:00:00Z";
    const result = materialize(input);
    expect(result.status).toBe("incomplete");
    expect(result.matchSummary?.validGames).toBe(50);
    const evidence = result.observation.evidence;
    if (evidence?.kind !== "recorded_champion_share") throw Error("OTP evidence expected");
    expect(evidence.share).toEqual({ numerator: 35, denominator: 50 });
    expect(result.seasonClosure).toEqual({ state: "unknown" });
    expect(result.reasons).toContain("season_closure_not_established");
  });

  it.each(["resurrection", "unstoppable", "otp-specialist"] as const)(
    "keeps %s rules and full evaluator results equivalent",
    (code) => {
      const input = fixture(code);
      const result = materialize(input);
      const sources = result.content.sources;
      const direct =
        sources.kind === "ranked"
          ? evaluateResurrection({ scope: result.content.scope, snapshots: sources.records })
          : (code === "unstoppable" ? evaluateUnstoppable : evaluateOtpSpecialist)({
              scope: result.content.scope,
              matches: sources.records,
              coverage: result.content.coverage,
            });
      expect(result.observation).toEqual(direct);
      expect(result.content.ruleVersion).toBe(
        code === "otp-specialist" ? "1.1-otp-observed-v2" : "1.1.A-observed-v1",
      );
      expect(OTP_RULE).toMatchObject({
        minGames: 50,
        minShare: { numerator: 13, denominator: 20 },
      });
      expect(RESURRECTION_RULE.minDropLp).toBe(50);
      expect(UNSTOPPABLE_RULE.minWins).toBe(5);
    },
  );

  it("keeps full sets beyond visual limits", () => {
    const input = fixture("otp-specialist");
    if (input.kind !== "matches") throw Error("fixture");
    input.records = Array.from({ length: 600 }, (_, i) => ({
      identity: { ...identity },
      capture: { ...legacy },
      record: { ...match(i), matchId: `LA2_${i + 1}` },
    }));
    input.manifest = { state: "declared", recordIds: input.records.map((r) => r.record.matchId) };
    const result = materialize(input);
    expect(result.content.sources.records).toHaveLength(600);
    expect(result.matchSummary?.validMatchIds).toHaveLength(600);
  });

  it("separates revision metadata from content and never validates the declared revision", () => {
    const input = fixture();
    const before = materialize(input);
    input.sourceRevision = { state: "declared", value: "future-declared-revision" };
    const after = materialize(input);
    expect(after.contentFingerprint).toBe(before.contentFingerprint);
    expect(after.metadataFingerprint).not.toBe(before.metadataFingerprint);
    expect(after.revisionValidation).toBe("not_performed");
  });

  it("does not fill unknown declared capture metadata", () => {
    const input = fixture();
    input.records[0].capture = {
      state: "declared",
      source: "unknown",
      endpoint: "unknown",
      captureId: null,
      receivedAt: null,
    };
    const result = materialize(input);
    expect(result.metadata.records[0].captures).toEqual([input.records[0].capture]);
    expect(result.provenanceAuthentication).toBe("not_performed");
  });

  it("normalizes UTC scope without changing the effective instant or claiming season closure", () => {
    const input = fixture();
    const before = materialize(input);
    input.scope.asOf = "2026-10-31T21:00:00-03:00";
    const after = materialize(input);
    expect(after.contentFingerprint).toBe(before.contentFingerprint);
    expect(after.metadataFingerprint).not.toBe(before.metadataFingerprint);
    expect(after.seasonClosure).toEqual({ state: "unknown" });
  });

  it.each(["start", "end"])("rejects an invalid %s of the local window", (field) => {
    const input = fixture();
    if (field === "start") input.scope.asOf = input.scope.season.startAt;
    else input.scope.season.endAt = input.scope.season.startAt;
    const result = materializeAchievementEvidence(input);
    expect(result.status).toBe("invalid_input");
    expect(result.reasons).toContain("invalid_timestamp");
  });

  it("preserves Unranked as a barrier and never manufactures ranked LP", () => {
    const input = fixture();
    input.records[1].record = {
      ...input.records[1].record,
      tier: "UNRANKED",
      division: "",
      leaguePoints: 0,
      wins: 0,
      losses: 0,
    };
    const result = materialize(input);
    expect(result.observation.status).not.toBe("observed");
    expect(result.content.sources.records).toHaveLength(4);
    expect(result.observation.reasons).toContain("unranked");
    input.records[1].record.leaguePoints = 50;
    expect(materializeAchievementEvidence(input).status).toBe("invalid_input");
  });

  it("keeps empty evidence distinct from a positive observation", () => {
    const input = fixture("unstoppable");
    input.records = [];
    input.manifest = { state: "declared", recordIds: [] };
    const result = materialize(input);
    expect(result.observation.status).toBe("insufficient_evidence");
    expect(result.observation.evidence).toBeNull();
    expect(result.grantAuthorized).toBe(false);
  });

  it.each([
    { version: "future-unsupported-version" },
    { sourceRevision: { state: "known", value: "123" } },
    { reconciliation: { state: "known", value: {} } },
    { grantAuthorized: true },
  ])("rejects claimed operational authority or unsupported format %j", (change) => {
    const result = materializeAchievementEvidence({ ...fixture(), ...change });
    expect(result.status).toBe("invalid_input");
    expect(result.grantAuthorized).toBe(false);
    expect(result.reconciliation).toEqual({ state: "unknown" });
  });

  it("rejects retroactive metadata attached to a legacy capture", () => {
    const input = fixture();
    const result = materializeAchievementEvidence({
      ...input,
      records: input.records.map((r) => ({
        ...r,
        capture: {
          ...legacy,
          receivedAt: "2026-09-01T12:00:00Z",
          captureId: "invented-legacy-capture",
        },
      })),
    });
    expect(result.status).toBe("invalid_input");
    expect(result.contentFingerprint).toBeNull();
  });

  it("is disconnected from production paths and has no IO, environment, grants or B.1 attestation adapter", () => {
    const sourceCode = readFileSync(
      resolve("src/server/achievements/verification/materialize.ts"),
      "utf8",
    );
    expect(sourceCode).toContain('import "server-only"');
    expect(sourceCode).not.toMatch(
      /fetch\(|process\.env|Date\.now|from ["'](?:@\/db|.*sync\/|node:fs|.*riot)/,
    );
    function walk(path: string): string[] {
      return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)],
      );
    }
    for (const path of walk(resolve("src"))) {
      if (path.includes(`${resolve("src/server/achievements/verification")}`)) continue;
      expect(readFileSync(path, "utf8")).not.toMatch(
        /materializeAchievementEvidence|verification\/materialize|verification\/materialization-contracts/,
      );
    }
    for (const input of [fixture(), fixture("unstoppable"), fixture("otp-specialist"), {}]) {
      const result = materializeAchievementEvidence(input);
      expect(result.writes).toBe("none");
      expect(result.grantAuthorized).toBe(false);
      expect(result.certification).toBe("not_established");
    }
  });
});
