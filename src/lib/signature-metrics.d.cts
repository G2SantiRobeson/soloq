// Types for the vendored signature-metrics engine (signature-metrics.cjs, kept verbatim).
declare namespace SignatureMetrics {
  type Form = { start: number; min: number; max: number; now: number };
  type Champ = { name: string; games: number; wins: number; losses: number; kda: number };
  type Game = {
    win: boolean;
    dur: number;
    k: number;
    d: number;
    a: number;
    cs: number;
    kp?: number;
  };
  type Player = {
    wins: number;
    losses: number;
    form?: Form;
    champs: Champ[];
    recent: Game[];
  };
  type Metric = {
    id: string;
    group: string;
    label: string;
    raw: number;
    num: string;
    unit: string;
    title: string;
    text: string;
    z: number;
    score: number;
  };
  type Baseline = Record<string, { mean: number; sd: number }>;
  type Signature = { featured: Metric[]; others: Metric[]; all: Metric[] };
}
declare const SignatureMetrics: {
  compute(
    player: SignatureMetrics.Player,
    baseline?: SignatureMetrics.Baseline | null,
  ): SignatureMetrics.Signature;
  baselineFrom(players: SignatureMetrics.Player[]): SignatureMetrics.Baseline;
  metrics: { id: string; group: string; label: string; formula: string }[];
  groups: Record<string, string>;
  defaultBaseline: SignatureMetrics.Baseline;
};
export = SignatureMetrics;
