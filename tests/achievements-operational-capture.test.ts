import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPERATIONAL_CAPTURE_VERSION as VERSION,
  SCAN_LIFECYCLE_VERSION,
  CAPTURE_ERROR_CODES,
  CAPTURE_TRUST_LEVELS,
  CapturePreparationError,
  type CapturePreparationInput,
} from "@/server/achievements/verification/operational-capture-contracts";
import {
  prepareOperationalCapture,
  prepareEvidenceScan,
} from "@/server/achievements/verification/prepare-operational-capture";
import {
  captureSchema as oldCaptureSchema,
  LOCAL_EVIDENCE_VERSION,
} from "@/server/achievements/verification/persistence-contracts";
import { EVIDENCE_FORMAT_VERSION } from "@/server/achievements/verification/materialization-contracts";
import { STRUCTURAL_RECEIPT_VERSION } from "@/server/achievements/verification/receipt-contracts";

const owner = {
  playerId: "00000000-0000-4000-8000-000000000001",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
const otherPlayer = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const instant = "2026-10-01T00:00:00.000Z";
const later = "2026-10-02T00:00:00.000Z";
const interval = { from: instant, to: later, bounds: "half_open" } as const;
const binding = {
  state: "matching_declared",
  playerId: owner.playerId,
  platform: owner.platform,
} as const;
function base() {
  return {
    version: VERSION,
    owner: { ...owner },
    attempt: 1,
    capture: {
      trust: "synthetic",
      captureId: id,
      receptionId: id,
      receivedAt: later,
      validatedAt: later,
      createdAt: null,
      committedAt: null,
      schemaVersion: VERSION,
      normalizationVersion: "minimal-capture-v1",
    },
    source: { state: "none" },
    response: { state: "http_success", status: 200, completeness: "complete" },
  } as const;
}
function page(): Extract<CapturePreparationInput, { endpoint: "MATCH-V5-IDS" }> {
  return {
    ...base(),
    endpoint: "MATCH-V5-IDS",
    scanId: id,
    interval: { ...interval },
    query: {
      startTime: Date.parse(instant) / 1000,
      endTime: Date.parse(later) / 1000,
      start: 0,
      count: 100,
      queue: null,
      type: null,
      timeSemantics: "unconfirmed",
    },
    ids: ["LA2_1"],
    indexChange: "unproven",
  };
}
function detail(): Extract<CapturePreparationInput, { endpoint: "MATCH-V5-DETAIL" }> {
  return {
    ...base(),
    endpoint: "MATCH-V5-DETAIL",
    requestedMatchId: "LA2_1",
    interval: { ...interval },
    detail: {
      matchId: "LA2_1",
      timestampMs: Date.parse(instant),
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      participant: { binding: { ...binding }, matchingCount: 1 },
      win: true,
      championId: 107,
      remake: {
        truePresent: 0,
        falsePresent: 10,
        absent: 0,
        observationalIsRemake: false,
        classifierVersion: "any-early-surrender-true-v1",
        evidentiarySufficiency: "unknown",
      },
    },
  };
}
function league(): Extract<CapturePreparationInput, { endpoint: "LEAGUE-V4" }> {
  return {
    ...base(),
    endpoint: "LEAGUE-V4",
    snapshot: { state: "none" },
    entries: [
      {
        queue: owner.queue,
        tier: "DIAMOND",
        division: "I",
        leaguePoints: 49,
        wins: 20,
        losses: 10,
      },
    ],
  };
}
function scan() {
  return {
    version: SCAN_LIFECYCLE_VERSION,
    scanId: id,
    owner: { ...owner },
    phase: "season_backfill",
    interval: { ...interval },
    query: page().query,
    lifecycle: "active",
    prefix: "declared_from_zero",
    runId: null,
    checkpointId: null,
    structuralReceiptId: null,
    sealId: null,
    finishedAt: null,
  };
}
function errorInput(response: CapturePreparationInput["response"]) {
  return { ...page(), response, ids: null };
}
function freeze(value: unknown) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
}

describe("private operational capture preparation", () => {
  it("prepares a controlled synthetic fixture without granting, authenticating or writing", () => {
    const result = prepareOperationalCapture(page());
    expect(result).toMatchObject({
      mode: "capture_preparation",
      certification: "not_established",
      grantAuthorized: false,
      writes: "none",
      provenanceAuthentication: "not_performed",
      revisionValidation: "not_performed",
      scanComplete: false,
    });
    expect(result.issues).toEqual(["synthetic_only"]);
  });
  it("accepts a declaration without promoting supplied receipt metadata", () => {
    const input = page();
    input.capture.trust = "declared";
    expect(prepareOperationalCapture(input)).toMatchObject({
      issues: ["declared_only"],
      provenanceAuthentication: "not_performed",
    });
  });
  it.each(["received_by_server", "validated", "committed", "authenticated", "riot"])(
    "rejects forged trust %s",
    (trust) => {
      const input = page();
      expect(() =>
        prepareOperationalCapture({ ...input, capture: { ...input.capture, trust } }),
      ).toThrow("invalid_capture");
    },
  );
  it.each([
    "source",
    "origin",
    "grantAuthorized",
    "certification",
    "puuid",
    "url",
    "headers",
    "payload",
    "token",
  ])("rejects extra top-level %s without echoing its value", (key) => {
    expect(() => prepareOperationalCapture({ ...page(), [key]: "PRIVATE_FIXTURE_VALUE" })).toThrow(
      "Capture preparation: invalid_capture",
    );
  });
  it.each(["puuid", "url", "headers", "payload", "token"])("rejects nested %s", (key) => {
    const input = detail();
    expect(() =>
      prepareOperationalCapture({
        ...input,
        detail: { ...input.detail, [key]: "PRIVATE_FIXTURE_VALUE" },
      }),
    ).toThrow("invalid_capture");
  });
  it.each(["captureId", "receptionId"] as const)(
    "rejects a URL/PUUID-shaped arbitrary %s",
    (key) => {
      const input = page();
      for (const value of [
        "https://example.invalid/by-puuid/fixture",
        "fixture-puuid",
        "RGAPI-fixture-secret",
      ])
        expect(() =>
          prepareOperationalCapture({ ...input, capture: { ...input.capture, [key]: value } }),
        ).toThrow("invalid_capture");
    },
  );
  it.each(["old", EVIDENCE_FORMAT_VERSION, STRUCTURAL_RECEIPT_VERSION, LOCAL_EVIDENCE_VERSION])(
    "rejects other format %s",
    (version) => {
      expect(() => prepareOperationalCapture({ ...page(), version })).toThrow("invalid_capture");
    },
  );
  it("does not reinterpret D v1 as the new operational preparation format", () => {
    expect(oldCaptureSchema.safeParse(page().capture).success).toBe(false);
    expect(
      oldCaptureSchema.safeParse({
        state: "legacy",
        source: "stored",
        endpoint: "unknown",
        captureId: null,
        receivedAt: null,
      }).success,
    ).toBe(true);
    expect(CAPTURE_TRUST_LEVELS).toEqual([
      "synthetic",
      "declared",
      "received_by_server",
      "validated",
      "committed",
    ]);
  });
  it.each([
    "bad",
    "2026-02-30T00:00:00.000Z",
    "2026-10-02T00:00:00.000000Z",
    "2026-10-02T00:00:00.000+01:00",
  ])("rejects noncanonical/invalid receipt time %s", (receivedAt) => {
    const input = page();
    expect(() =>
      prepareOperationalCapture({ ...input, capture: { ...input.capture, receivedAt } }),
    ).toThrow("invalid_capture");
  });
  it("keeps missing receipt dates/IDs unknown without filling them", () => {
    const input = page();
    Object.assign(input.capture, {
      receivedAt: null,
      validatedAt: null,
      captureId: null,
      receptionId: null,
    });
    expect(prepareOperationalCapture(input).issues).toEqual([
      "capture_id_unknown",
      "receipt_time_unknown",
      "reception_id_unknown",
      "synthetic_only",
      "validation_time_unknown",
    ]);
    expect(prepareOperationalCapture(input).data.capture.receivedAt).toBeNull();
  });
  it("rejects validation before receipt and caller-declared persistence dates", () => {
    const input = page();
    input.capture.validatedAt = instant;
    expect(() => prepareOperationalCapture(input)).toThrow("invalid_capture");
    for (const key of ["createdAt", "committedAt"])
      expect(() =>
        prepareOperationalCapture({ ...page(), capture: { ...page().capture, [key]: later } }),
      ).toThrow("invalid_capture");
  });
  it.each([
    [0, "empty"],
    [99, "short"],
    [100, "full"],
  ] as const)("preserves a %i ID page as %s without claiming scan coverage", (n, shape) => {
    const input = page();
    input.ids = Array.from({ length: n }, (_, i) => `LA2_${i + 1}`);
    expect(prepareOperationalCapture(input)).toMatchObject({
      pageShape: shape,
      scanComplete: false,
      recoverableCoverage: "not_established",
    });
    expect(prepareOperationalCapture(input).data).toEqual(input);
  });
  it("does not reorder/deduplicate original IDs", () => {
    const input = page();
    input.ids = ["LA2_3", "LA2_1", "LA2_3"];
    expect(prepareOperationalCapture(input).data).toEqual(input);
    expect(prepareOperationalCapture(input).issues).toContain("ids_repeated");
  });
  it("preserves distinct retry attempts without hiding changed index contents", () => {
    const a = page();
    const b = page();
    b.attempt = 2;
    b.ids = ["LA2_2"];
    b.indexChange = "observed_change";
    expect(prepareOperationalCapture(b).issues).toContain("index_changed");
    expect(prepareOperationalCapture(a).data.attempt).toBe(1);
    expect(prepareOperationalCapture(b).data.attempt).toBe(2);
  });
  it("does not treat a partial empty response as a terminal page", () => {
    const input = page();
    input.response = { state: "http_success", status: 200, completeness: "partial" };
    input.ids = [];
    expect(prepareOperationalCapture(input)).toMatchObject({
      pageShape: "partial",
      scanComplete: false,
    });
    expect(prepareOperationalCapture(input).issues).toContain("partial_response");
  });
  it.each([
    { state: "http_404", status: 404 },
    { state: "http_429", status: 429, retryAfterMs: 60000 },
    { state: "http_5xx", status: 503 },
    { state: "http_other", status: 403 },
    { state: "invalid_json", status: 200 },
    { state: "invalid_schema", status: 200 },
  ] as const)("preserves $state as unresolved without a fabricated empty success", (response) => {
    expect(prepareOperationalCapture(errorInput(response))).toMatchObject({
      pageShape: "unknown",
      scanComplete: false,
      data: { response, ids: null },
    });
    expect(prepareOperationalCapture(errorInput(response)).issues).toContain("request_unresolved");
    expect(() => prepareOperationalCapture({ ...errorInput(response), ids: [] })).toThrow(
      "invalid_capture",
    );
  });
  it.each(["network_failure", "timeout", "pending", "unknown"] as const)(
    "keeps %s free of invented HTTP response time",
    (state) => {
      const response =
        state === "network_failure" || state === "timeout" ? { state, failedAt: later } : { state };
      const input = errorInput(response);
      expect(() => prepareOperationalCapture(input)).toThrow("invalid_capture");
      Object.assign(input.capture, { receivedAt: null, validatedAt: null, receptionId: null });
      expect(prepareOperationalCapture(input).data.capture.receivedAt).toBeNull();
      expect(prepareOperationalCapture(input).issues).toContain("request_unresolved");
    },
  );
  it("preserves legacy as unknown, never retroactively assigning reception", () => {
    const input = page();
    input.source = { state: "legacy", captureId: null, receivedAt: null };
    expect(prepareOperationalCapture(input).issues).toContain("legacy_source");
    expect(() =>
      prepareOperationalCapture({
        ...input,
        source: { state: "legacy", captureId: id, receivedAt: later },
      }),
    ).toThrow("invalid_capture");
  });
  it("keeps existing attestation merely declared and reports a mismatched owner/scope", () => {
    const input = page();
    input.source = {
      state: "existing_declared",
      referenceId: id,
      version: VERSION,
      owner: { ...owner, playerId: otherPlayer, queue: "RANKED_FLEX_SR" },
      concordance: "conflicting",
    };
    expect(prepareOperationalCapture(input).issues).toEqual(
      expect.arrayContaining([
        "existing_source_unproven",
        "conflicting_source",
        "identity_mismatch",
        "query_scope_mismatch",
      ]),
    );
  });
  it("requires a complete query and detects incompatible queue/type or bounds", () => {
    const input = page();
    input.query.queue = 440;
    input.query.type = "normal";
    input.query.startTime++;
    expect(prepareOperationalCapture(input).issues).toEqual(
      expect.arrayContaining(["query_scope_mismatch", "query_does_not_cover_target"]),
    );
    expect(() =>
      prepareOperationalCapture({ ...input, query: { ...input.query, count: 0 } }),
    ).toThrow("invalid_capture");
  });
  it("rejects overlong pages, unsafe values and inverted intervals", () => {
    const input = page();
    input.ids = Array.from({ length: 101 }, (_, i) => `LA2_${i}`);
    expect(() => prepareOperationalCapture(input)).toThrow("invalid_capture");
    expect(() =>
      prepareOperationalCapture({ ...page(), attempt: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow("invalid_capture");
    expect(() =>
      prepareOperationalCapture({ ...page(), interval: { ...interval, to: instant } }),
    ).toThrow("invalid_capture");
  });
  it.each(["other_queue", "other_mode_map", "outside_target_interval"] as const)(
    "reports %s from supplied basis",
    (basis) => {
      const input = detail();
      if (!input.detail) throw Error("fixture");
      if (basis === "other_queue") input.detail.queueId = 440;
      if (basis === "other_mode_map") input.detail.mapId = 12;
      if (basis === "outside_target_interval") input.detail.timestampMs = Date.parse(later);
      expect(prepareOperationalCapture(input).issues).toContain(basis);
    },
  );
  it("does not invent an exclusion for unknown queue, mode, map or timestamp", () => {
    const input = detail();
    if (!input.detail) throw Error("fixture");
    Object.assign(input.detail, { queueId: null, mapId: null, gameMode: null, timestampMs: null });
    const issues = prepareOperationalCapture(input).issues;
    expect(issues).toContain("scope_unknown");
    expect(issues).not.toContain("other_queue");
    expect(issues).not.toContain("other_mode_map");
    expect(issues).not.toContain("outside_target_interval");
  });
  it("preserves epoch timestamp precisely and treats target start/end as half-open", () => {
    const input = detail();
    expect(prepareOperationalCapture(input).issues).not.toContain("outside_target_interval");
    if (!input.detail) throw Error("fixture");
    input.detail.timestampMs = Date.parse(later) - 1;
    expect(prepareOperationalCapture(input).data).toEqual(input);
    expect(prepareOperationalCapture(input).issues).not.toContain("outside_target_interval");
  });
  it.each([
    [1, 8, 1, true],
    [0, 10, 0, false],
    [0, 0, 10, false],
    [0, 0, 0, null],
  ] as const)(
    "preserves remake basis %i/%i/%i separately from observed %s",
    (t, f, a, observed) => {
      const input = detail();
      if (!input.detail) throw Error("fixture");
      Object.assign(input.detail.remake, {
        truePresent: t,
        falsePresent: f,
        absent: a,
        observationalIsRemake: observed,
      });
      expect(prepareOperationalCapture(input).data).toEqual(input);
      expect(prepareOperationalCapture(input).issues).toContain("remake_basis_unknown");
      expect(prepareOperationalCapture(input).issues.includes("confirmed_remake_marker")).toBe(
        t > 0,
      );
    },
  );
  it("rejects contradictory remake classification and upgraded sufficiency", () => {
    const input = detail();
    if (!input.detail) throw Error("fixture");
    input.detail.remake.observationalIsRemake = true;
    expect(() => prepareOperationalCapture(input)).toThrow("invalid_capture");
    expect(() =>
      prepareOperationalCapture({
        ...detail(),
        detail: {
          ...detail().detail,
          remake: { ...detail().detail?.remake, evidentiarySufficiency: "proven" },
        },
      }),
    ).toThrow("invalid_capture");
  });
  it.each([
    [0, "participant_missing"],
    [2, "ambiguous_participant"],
  ] as const)("blocks participant count %i", (count, issue) => {
    const input = detail();
    if (!input.detail) throw Error("fixture");
    input.detail.participant.matchingCount = count;
    expect(prepareOperationalCapture(input).issues).toContain(issue);
  });
  it("reports participant identity disagreement and match ID/platform disagreement", () => {
    const input = detail();
    if (!input.detail) throw Error("fixture");
    input.detail.matchId = "LA2_2";
    input.detail.participant.binding.playerId = otherPlayer;
    expect(prepareOperationalCapture(input).issues).toEqual(
      expect.arrayContaining(["match_id_mismatch", "identity_mismatch"]),
    );
    input.requestedMatchId = "NA1_1";
    expect(prepareOperationalCapture(input).issues).toContain("platform_mismatch");
  });
  it("keeps absent identity and competitive fields unknown", () => {
    const input = detail();
    if (!input.detail) throw Error("fixture");
    input.detail.participant.binding = { state: "unknown", playerId: null, platform: null };
    input.detail.win = null;
    input.detail.championId = null;
    expect(prepareOperationalCapture(input).issues).toEqual(
      expect.arrayContaining(["identity_unknown", "competitive_fields_unknown"]),
    );
  });
  it("prepares independent account binding without copying canonical PUUID", () => {
    expect(prepareOperationalCapture({ ...base(), endpoint: "ACCOUNT-V1", binding })).toMatchObject(
      { data: { binding }, provenanceAuthentication: "not_performed" },
    );
    expect(() =>
      prepareOperationalCapture({
        ...base(),
        endpoint: "ACCOUNT-V1",
        binding: { ...binding, puuid: "fictional" },
      }),
    ).toThrow("invalid_capture");
  });
  it("preserves league verification without inventing a new snapshot or historical LP", () => {
    expect(prepareOperationalCapture(league())).toMatchObject({
      entryPresent: true,
      data: { snapshot: { state: "none" }, entries: [{ leaguePoints: 49 }] },
    });
    const input = league();
    input.snapshot = { state: "existing_declared", id, timestamp: instant };
    expect(prepareOperationalCapture(input).data).toEqual(input);
    expect(input.capture.receivedAt).not.toBe(input.snapshot.timestamp);
  });
  it("preserves an absent league entry without manufacturing Unranked values", () => {
    const input = league();
    input.entries = [];
    expect(prepareOperationalCapture(input)).toMatchObject({
      entryPresent: false,
      data: { entries: [] },
    });
    expect(prepareOperationalCapture(input).issues).toContain("league_entry_absent");
  });
  it("reports duplicate queueType even with identical values", () => {
    const input = league();
    input.entries?.push({ ...input.entries[0] });
    expect(prepareOperationalCapture(input).issues).toContain("duplicate_queue_type");
  });
  it("prepares an active evidence scan without a run, checkpoint, cursor or seal", () => {
    expect(prepareEvidenceScan(scan())).toMatchObject({
      data: { lifecycle: "active", runId: null, checkpointId: null, sealId: null },
      coverage: "unproven",
      writes: "none",
    });
  });
  it("preserves unknown prefix and import_finished without declaring coverage", () => {
    expect(
      prepareEvidenceScan({ ...scan(), lifecycle: "prefix_unknown", prefix: "unknown" }).data
        .prefix,
    ).toBe("unknown");
    expect(
      prepareEvidenceScan({ ...scan(), lifecycle: "import_finished", finishedAt: later }),
    ).toMatchObject({
      coverage: "unproven",
      recoverableCoverage: "not_established",
      grantAuthorized: false,
    });
  });
  it.each([
    { lifecycle: "completed" },
    { lifecycle: "import_finished" },
    { lifecycle: "prefix_unknown" },
    { cursor: 100 },
    { structuralReceiptId: id },
    { sealId: id },
    { version: VERSION },
  ])("rejects manufactured lifecycle guarantees $lifecycle", (patch) => {
    expect(() => prepareEvidenceScan({ ...scan(), ...patch })).toThrow("invalid_capture");
  });
  it("keeps failure codes sanitized and stable", () => {
    for (const code of CAPTURE_ERROR_CODES) {
      const error = new CapturePreparationError(code);
      expect(error.message).toBe(`Capture preparation: ${code}`);
    }
  });
  it("is deterministic, does not mutate input, and does not call IO/clock/random", () => {
    const input = detail();
    freeze(input);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw Error("no IO");
    });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw Error("no clock");
    });
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw Error("no random");
    });
    try {
      expect(prepareOperationalCapture(input)).toEqual(prepareOperationalCapture(input));
      expect(prepareOperationalCapture(input).data).toEqual(input);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      clock.mockRestore();
      random.mockRestore();
    }
  });
  it("has no operational consumers or imports capable of writes", () => {
    const names = ["operational-capture-contracts", "prepare-operational-capture"];
    for (const name of names) {
      const contents = readFileSync(
        resolve(`src/server/achievements/verification/${name}.ts`),
        "utf8",
      );
      expect(contents).toContain('import "server-only"');
      expect(contents).not.toMatch(
        /from ["'].*(?:db|sync|riot|local-evidence-repository)|process\.env|\.transaction\(|fetch\(|console\./,
      );
    }
    function inspect(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) inspect(path);
        else if (/\.[cm]?[jt]sx?$/.test(path) && !names.some((name) => entry.name === `${name}.ts`))
          expect(readFileSync(path, "utf8"), path).not.toMatch(
            /(?:from\s*|import\s*\()["'][^"']*(?:operational-capture-contracts|prepare-operational-capture)/,
          );
      }
    }
    inspect(resolve("src"));
    inspect(resolve("scripts"));
  });
});
