import { describe, expect, it } from "vitest";
import {
  computeSignature,
  signatureBaseline,
  toSignaturePlayer,
  type SignaturePlayer,
} from "@/lib/signature";
import { emptyTotals } from "@/lib/stats";
import type { PlayerProfile, RecentMatch } from "@/lib/types";
import Engine from "@/lib/signature-metrics.cjs";
import type { SignatureBaseline, SignatureMetric } from "@/lib/signature";

const legacyMetric = (metric: SignatureMetric) =>
  Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "referenceSource"));

function match(i: number, overrides: Partial<RecentMatch> = {}): RecentMatch {
  return {
    matchId: `M${i}`,
    queueId: 420,
    timestamp: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    champion: "LeeSin",
    championId: 64,
    position: "JUNGLE",
    kills: 5 + (i % 4),
    deaths: 2 + (i % 5),
    assists: 6 + (i % 3),
    cs: 150 + i * 5,
    duration: 1500 + i * 60,
    damage: 20000,
    win: i % 3 !== 0,
    isRemake: false,
    killParticipation: 0.5 + (i % 4) * 0.05,
    ...overrides,
  };
}

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: "p1",
    gameName: "Tester",
    tagLine: "LAS",
    platform: "LA2",
    profileIconId: null,
    lastSyncedAt: null,
    observedAt: "",
    createdAt: "",
    rank: { tier: "GOLD", division: "II", leaguePoints: 40, wins: 30, losses: 25 },
    stats: { ...emptyTotals(), games: 12, wins: 7, losses: 5 },
    momentum: null,
    recent: Array.from({ length: 10 }, (_, i) => match(i)),
    champions: [
      {
        ...emptyTotals(),
        champion: "LeeSin",
        championId: 64,
        games: 12,
        wins: 8,
        losses: 4,
        kills: 60,
        deaths: 30,
        assists: 90,
      },
      {
        ...emptyTotals(),
        champion: "MonkeyKing",
        championId: 62,
        games: 3,
        wins: 1,
        losses: 2,
        kills: 9,
        deaths: 0,
        assists: 6,
      },
    ],
    history: [],
    performance: [
      { timestamp: "2026-09-01T00:00:00Z", winrate: 40, sample: 10 },
      { timestamp: "2026-09-10T00:00:00Z", winrate: 30, sample: 20 },
      { timestamp: "2026-09-20T00:00:00Z", winrate: 65, sample: 20 },
      { timestamp: "2026-10-01T00:00:00Z", winrate: 55, sample: 20 },
    ],
    trackingSince: null,
    lpObservations: [],
    ...overrides,
  };
}

describe("signature input mapping", () => {
  it("maps existing profile data without inventing fields", () => {
    const input = toSignaturePlayer(
      profile({
        recent: [match(1), match(2, { isRemake: true }), match(3, { killParticipation: null })],
      }),
      "soloq",
      (id, fallback) => (id === 62 ? "Wukong" : fallback),
    );
    expect(input.wins).toBe(30);
    expect(input.losses).toBe(25);
    expect(input.form).toEqual({ start: 40, min: 30, max: 65, now: 55 });
    expect(input.champs[1]).toEqual({ name: "Wukong", games: 3, wins: 1, losses: 2, kda: 15 });
    expect(input.recent).toHaveLength(2);
    expect(input.recent[0]).toMatchObject({ dur: 1560, k: 6, d: 3, a: 7, cs: 155 });
    expect(input.recent[0].kp).toBeCloseTo(55);
    expect(input.recent[1]).not.toHaveProperty("kp");
  });
  it("uses the imported record for 5v5 and leaves form empty without a rolling winrate", () => {
    const input = toSignaturePlayer(profile({ performance: [] }), "5v5");
    expect(input).toMatchObject({ wins: 7, losses: 5, form: undefined });
  });
});

describe("signature engine integration", () => {
  const fullBaseline: SignatureBaseline = Object.fromEntries(
    Engine.metrics.map(({ id }) => [id, { mean: 0.2, sd: 0.6 }]),
  );
  it.each([undefined, null, {}, fullBaseline, { kp: fullBaseline.kp }])(
    "preserves every number, score, order and selected group with baseline %j",
    (baseline) => {
      const input = toSignaturePlayer(profile(), "soloq");
      const before = Engine.compute(input, baseline ?? undefined);
      const after = computeSignature(input, baseline);
      for (const group of ["all", "featured", "others"] as const)
        expect(after[group].map(legacyMetric)).toEqual(before[group]);
      for (const metric of after.all)
        expect(metric.referenceSource).toBe(baseline?.[metric.id] ? "community" : "default");
    },
  );
  it("annotates an empty non-null baseline as default", () => {
    const baseline = signatureBaseline(
      Array.from({ length: 5 }, () => toSignaturePlayer(profile(), "soloq")),
    );
    expect(baseline).toEqual({}); // Every valid metric has zero community variance.
    expect(
      computeSignature(toSignaturePlayer(profile(), "soloq"), baseline).all.every(
        (m) => m.referenceSource === "default",
      ),
    ).toBe(true);
  });
  it("uses defaults for a metric missing five valid community samples", () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      toSignaturePlayer(
        profile({
          recent: [match(i), match(i + 1), match(i + 2)].map((m) => ({
            ...m,
            killParticipation: i === 0 ? 0.7 : null,
          })),
        }),
        "soloq",
      ),
    );
    const baseline = signatureBaseline(inputs)!;
    expect(baseline).not.toHaveProperty("kp");
    const kp = computeSignature(toSignaturePlayer(profile(), "soloq"), baseline).all.find(
      (m) => m.id === "kp",
    );
    expect(kp?.referenceSource).toBe("default");
  });
  it("still omits unavailable metrics rather than manufacturing a reference", () => {
    const input = toSignaturePlayer(
      profile({ rank: null, stats: emptyTotals(), recent: [], champions: [], performance: [] }),
      "soloq",
    );
    expect(computeSignature(input, fullBaseline)).toEqual({ all: [], featured: [], others: [] });
  });
  it("returns up to four featured metrics with the fields the profile renders", () => {
    const { featured, others, all } = computeSignature(toSignaturePlayer(profile(), "soloq"));
    expect(featured.length).toBe(4);
    expect(others.length).toBeLessThanOrEqual(3);
    expect(all.length).toBeGreaterThanOrEqual(featured.length + others.length);
    for (const metric of featured)
      expect(metric).toEqual(
        expect.objectContaining({
          label: expect.any(String),
          num: expect.any(String),
          title: expect.any(String),
          text: expect.any(String),
          z: expect.any(Number),
        }),
      );
  });
  it("skips metrics silently when a player has very few games", () => {
    const sparse = toSignaturePlayer(
      profile({ recent: [match(1)], champions: [], performance: [] }),
      "soloq",
    );
    const { all } = computeSignature(sparse);
    expect(all.map((m) => m.id)).toEqual(["balance"]);
  });
  it("only builds a community baseline from five or more players", () => {
    const players: SignaturePlayer[] = Array.from({ length: 5 }, (_, i) =>
      toSignaturePlayer(
        profile({ recent: Array.from({ length: 8 }, (_, j) => match(i + j)) }),
        "soloq",
      ),
    );
    expect(signatureBaseline(players.slice(0, 4))).toBeNull();
    const baseline = signatureBaseline(players);
    expect(baseline).not.toBeNull();
    expect(Object.keys(baseline!).length).toBeGreaterThan(0);
  });
});
