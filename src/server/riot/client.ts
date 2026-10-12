import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accountRouting, platformRouting, regionalRouting, type Platform } from "@/lib/routing";
import { accountSchema, leagueSchema, matchSchema, summonerSchema } from "./schemas";
import { isDemo } from "../env";
import { RANKED_QUEUES } from "@/lib/queues";
import {
  RANKED_CAPTURE_VERSION,
  type RankedBinding,
  type RankedCaptureHandle,
  type RankedRecord,
} from "./ranked-capture";
// Compare against the transport present at module initialization; substituted globals are not evidence.
const initialFetch = globalThis.fetch;
import {
  MATCH_CAPTURE_VERSION,
  MatchCaptureError,
  minimalMatchDetail,
  validMatchId,
  validStoredMatchKey,
  type MatchCaptureBinding,
  type MatchCaptureHandle,
  type MatchCaptureRecord,
  type MatchQuery,
  type MatchReception,
} from "./match-capture";
export class RiotError extends Error {
  constructor(
    public status: number,
    public retryAfterMs = 0,
  ) {
    super(
      status === 429
        ? "Riot ha limitado las solicitudes. Se reintentará en la próxima sincronización."
        : status === 403 || status === 401
          ? "La clave de Riot no es válida o ha expirado."
          : status === 404
            ? "No se encontró la cuenta o partida en la región indicada."
            : "Riot no está disponible temporalmente.",
    );
  }
}
export class SyncDeadline extends Error {
  constructor() {
    super("Sincronización parcial guardada; continuará en la siguiente ejecución.");
  }
}
export class SyncBudget extends SyncDeadline {
  constructor(public reason: "time_budget" | "request_budget") {
    super();
  }
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value?.trim()) return 60_000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 && Math.abs(now + delay) < 8.64e15
    ? Math.max(1300, delay)
    : 60_000;
}
type Dependencies = {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  interval?: number;
  random?: () => number;
  onRateLimit?: (delay: number) => Promise<void>;
};
// Only instantiated inside the database-backed global sync lease. One request at a time.
export class RiotClient {
  #ranked = new WeakMap<
    RankedCaptureHandle,
    { binding: RankedBinding; puuid: string | null; record: RankedRecord }
  >();
  #sharedRemakes = new WeakMap<MatchCaptureHandle, Platform>();
  #captures = new WeakMap<
    MatchCaptureHandle,
    { binding: MatchCaptureBinding; record: MatchCaptureRecord }
  >();
  #observation: { host: string; path: string; receptions: MatchReception[] } | null = null;
  private simulatedTransport: boolean;
  private unattributedTransport: boolean;
  private nextRequestAt = 0;
  private slot: { deadline: number; remaining: number } | null = null;
  private fetcher: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private interval: number;
  private random: () => number;
  private onRateLimit?: Dependencies["onRateLimit"];
  constructor(
    private deadline = Date.now() + 230_000,
    deps: Dependencies = {},
  ) {
    this.simulatedTransport =
      process.env.NODE_ENV === "test" || Object.keys(deps).some((key) => key !== "onRateLimit");
    // Framework wrapping is not a synthetic dataset, but its origin is not established here.
    this.unattributedTransport = !deps.fetcher && globalThis.fetch !== initialFetch;
    this.fetcher = deps.fetcher ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.onRateLimit = deps.onRateLimit;
    const configured = Number(process.env.RIOT_REQUEST_INTERVAL_MS ?? 1300);
    this.interval = Math.max(
      1300,
      deps.interval ?? (Number.isFinite(configured) ? configured : 1300),
    );
  }
  get deadlineAt() {
    return this.deadline;
  }
  canStart(deadline = this.deadline) {
    return Math.max(this.now(), this.nextRequestAt) + 12_000 <= Math.min(deadline, this.deadline);
  }
  assertBudget() {
    if (this.now() >= this.deadline)
      throw this.slot ? new SyncBudget("time_budget") : new SyncDeadline();
    if (this.slot && this.now() >= this.slot.deadline) throw new SyncBudget("time_budget");
  }
  private assertDispatchBudget(wait: number, retryError: RiotError | null) {
    if (this.now() + wait + 12_000 > this.deadline)
      throw retryError ?? (this.slot ? new SyncBudget("time_budget") : new SyncDeadline());
    if (this.slot && this.now() + wait + 12_000 > this.slot.deadline)
      throw retryError ?? new SyncBudget("time_budget");
    if (this.slot && this.slot.remaining <= 0) throw retryError ?? new SyncBudget("request_budget");
  }
  async withBudget<T>(limits: { deadline: number; requests: number }, work: () => Promise<T>) {
    if (this.slot) throw new Error("Los turnos de sincronización deben ser seriales.");
    this.slot = { deadline: Math.min(this.deadline, limits.deadline), remaining: limits.requests };
    try {
      this.assertBudget();
      return await work();
    } finally {
      this.slot = null;
    }
  }
  async request<T>(host: string, path: string, schema: z.ZodType<T>): Promise<T> {
    if (isDemo())
      throw new Error("Las consultas autenticadas a Riot están deshabilitadas en modo demo.");
    const key = process.env.RIOT_API_KEY;
    if (!key) throw new RiotError(401);
    let retryError: RiotError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, this.nextRequestAt - this.now());
      this.assertDispatchBudget(wait, retryError);
      if (wait) await this.sleep(wait);
      this.assertDispatchBudget(0, retryError);
      if (this.slot) this.slot.remaining--;
      this.nextRequestAt = this.now() + this.interval;
      let response: Response;
      try {
        response = await this.fetcher(`https://${host}.api.riotgames.com${path}`, {
          headers: { "X-Riot-Token": key },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        this.recordReception(
          host,
          path,
          attempt,
          null,
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "timeout"
            : "network",
        );
        retryError = new RiotError(503);
        if (attempt === 2) throw retryError;
        this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + this.backoff(attempt));
        continue;
      }
      if (response.ok) {
        const reception = this.recordReception(host, path, attempt, response.status, "success");
        let json: unknown;
        try {
          json = await response.json();
        } catch (error) {
          if (reception) reception.outcome = "invalid_json";
          throw error;
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          if (reception) reception.outcome = "invalid_schema";
          throw new RiotError(502);
        }
        if (reception) reception.validatedAt = new Date().toISOString();
        return parsed.data;
      }
      const reception = this.recordReception(host, path, attempt, response.status, "http_error");
      if (response.status !== 429 && response.status < 500) throw new RiotError(response.status);
      const delay =
        response.status === 429
          ? retryAfterMs(response.headers.get("retry-after"), this.now())
          : this.backoff(attempt);
      if (reception && response.status === 429) reception.retryAfterMs = delay;
      retryError = new RiotError(response.status, delay);
      this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + delay);
      // Persist before retrying: a terminated worker must not forget a shared quota wait.
      if (response.status === 429) await this.onRateLimit?.(delay);
      if (attempt === 2 || this.now() + delay + 12_000 > this.deadline) throw retryError;
    }
    throw new RiotError(503);
  }
  private backoff(attempt: number) {
    return 1000 * 2 ** attempt + Math.floor(this.random() * 500);
  }
  private recordReception(
    host: string,
    path: string,
    attempt: number,
    status: number | null,
    outcome: MatchReception["outcome"],
  ) {
    if (!this.#observation || this.#observation.host !== host || this.#observation.path !== path)
      return null;
    const event: MatchReception = {
      captureId: randomUUID(),
      receptionId: status === null ? null : randomUUID(),
      attempt: attempt + 1,
      receivedAt: status === null ? null : new Date().toISOString(),
      validatedAt: null,
      failedAt: status === null ? new Date().toISOString() : null,
      status,
      retryAfterMs: null,
      outcome,
    };
    this.#observation.receptions.push(event);
    return event;
  }
  /** Internal server boundary. Calls the existing methods; no extra dispatch/retry. */
  private async observeRequest<T>(host: string, path: string, work: () => Promise<T>) {
    if (isDemo()) throw new MatchCaptureError("scope");
    if (this.#observation) throw new MatchCaptureError("conflict");
    const observation = { host, path, receptions: [] as MatchReception[] };
    this.#observation = observation;
    let value: T | undefined;
    let error: unknown;
    try {
      value = await work();
    } catch (caught) {
      error = caught;
    } finally {
      this.#observation = null;
    }
    if (!observation.receptions.length)
      observation.receptions.push({
        captureId: randomUUID(),
        receptionId: null,
        attempt: 1,
        receivedAt: null,
        validatedAt: null,
        failedAt: null,
        status: null,
        retryAfterMs: null,
        outcome: "unobserved",
      });
    return { value, error, receptions: observation.receptions };
  }
  private receptionSource(receptions: MatchReception[]): MatchCaptureRecord["source"] {
    return receptions.every((r) => r.outcome === "unobserved")
      ? "unknown"
      : this.simulatedTransport
        ? "synthetic"
        : this.unattributedTransport
          ? "unknown"
          : receptions.some((r) => r.receptionId !== null)
            ? "server_riot_received"
            : "unknown";
  }
  private async observeMatch<T>(
    binding: MatchCaptureBinding,
    query: MatchQuery | string,
    work: () => Promise<T>,
  ) {
    const ids = typeof query !== "string";
    const path = ids
      ? `/lol/match/v5/matches/by-puuid/${encodeURIComponent(binding.puuid)}/ids?startTime=${query.startTime}&endTime=${query.endTime}&start=${query.start}&count=100`
      : `/lol/match/v5/matches/${encodeURIComponent(query)}`;
    const observation = await this.observeRequest(regionalRouting(binding.platform), path, work);
    let { value, error } = observation;
    let originalIds: string[] | null = null;
    let detail: MatchCaptureRecord["detail"] = null;
    try {
      if (value !== undefined) {
        if (ids) {
          const checked = z.array(z.string()).max(100).safeParse(value);
          if (
            !checked.success ||
            checked.data.some(
              (id) =>
                !(observation.receptions.every((r) => r.outcome === "unobserved")
                  ? validStoredMatchKey(id)
                  : validMatchId(id, binding.platform)),
            )
          )
            throw new MatchCaptureError("invalid");
          originalIds = [...checked.data];
        } else {
          const checked = matchSchema.safeParse(value);
          if (
            !checked.success ||
            !(observation.receptions.every((r) => r.outcome === "unobserved")
              ? validStoredMatchKey(checked.data.metadata.matchId)
              : validMatchId(checked.data.metadata.matchId, binding.platform))
          )
            throw new MatchCaptureError("invalid");
          detail = minimalMatchDetail(checked.data, binding.puuid);
        }
      }
    } catch (caught) {
      // Keep the real reception even when the bounded projection cannot be confirmed.
      // No source or cursor may advance from a failed normalization.
      error = caught;
      value = undefined;
      const last = observation.receptions.at(-1);
      if (last?.outcome === "success") last.outcome = "invalid_normalization";
    }
    const capture = Object.freeze({ key: randomUUID() });
    this.#captures.set(capture, {
      binding: { ...binding },
      record: {
        version: MATCH_CAPTURE_VERSION,
        normalizationVersion: "minimal-match-v1",
        requestId: capture.key,
        endpoint: ids ? "MATCH-V5-IDS" : "MATCH-V5-DETAIL",
        source: this.receptionSource(observation.receptions),
        query: ids ? query : null,
        requestedMatchId: ids ? null : query,
        receptions: observation.receptions,
        ids: originalIds,
        detail,
        certification: "not_established",
        grantAuthorized: false,
      },
    });
    return { value, error, capture };
  }
  observeMatchIds(binding: MatchCaptureBinding, query: MatchQuery) {
    const owner = { ...binding };
    const effective = { ...query };
    return this.observeMatch(owner, effective, () =>
      this.matchIds(
        owner.platform,
        owner.puuid,
        effective.startTime,
        effective.endTime,
        effective.start,
      ),
    );
  }
  observeMatchDetail(binding: MatchCaptureBinding, id: string) {
    const owner = { ...binding };
    return this.observeMatch(owner, id, () => this.match(owner.platform, id));
  }
  /** A copied object/UUID or a handle from another client cannot retrieve a receipt. */
  confirmedMatchInput(capture: MatchCaptureHandle, binding: MatchCaptureBinding) {
    const stored = this.#captures.get(capture);
    if (
      !stored ||
      stored.binding.playerId !== binding.playerId ||
      stored.binding.platform !== binding.platform ||
      stored.binding.puuid !== binding.puuid
    )
      throw new MatchCaptureError("scope");
    return structuredClone(stored.record);
  }
  private async observeRanked<T>(
    binding: RankedBinding,
    endpoint: RankedRecord["endpoint"],
    path: string,
    host: string,
    work: () => Promise<T>,
  ) {
    const observation = await this.observeRequest(host, path, work);
    let { value, error } = observation;
    let receivedPuuid: string | null = null;
    let entries: RankedRecord["entries"] = null;
    let ignoredEntries: number | null = null;
    try {
      if (value !== undefined && endpoint !== "LEAGUE-V4") {
        const parsed = accountSchema.safeParse(value);
        if (!parsed.success) throw new MatchCaptureError("invalid");
        receivedPuuid = parsed.data.puuid;
      } else if (value !== undefined) {
        const parsed = leagueSchema.max(32).safeParse(value);
        if (!parsed.success) throw new MatchCaptureError("invalid");
        entries = [];
        ignoredEntries = 0;
        for (const entry of parsed.data) {
          const queue = RANKED_QUEUES.find((q) => q === entry.queueType);
          if (!queue) {
            ignoredEntries++;
            continue;
          }
          if (
            !/^[A-Z_]{1,32}$/.test(entry.tier) ||
            !/^[IV]{1,4}$/.test(entry.rank) ||
            [entry.leaguePoints, entry.wins, entry.losses].some(
              (n) => !Number.isSafeInteger(n) || n < 0,
            )
          )
            throw new MatchCaptureError("invalid");
          entries.push({
            queue,
            tier: entry.tier,
            division: entry.rank,
            leaguePoints: entry.leaguePoints,
            wins: entry.wins,
            losses: entry.losses,
          });
        }
      }
    } catch (caught) {
      value = undefined;
      error = caught;
      entries = null;
      ignoredEntries = null;
      receivedPuuid = null;
      const last = observation.receptions.at(-1);
      if (last?.outcome === "success") last.outcome = "invalid_normalization";
    }
    const capture = Object.freeze({ key: randomUUID() });
    this.#ranked.set(capture, {
      binding: { ...binding },
      puuid: receivedPuuid,
      record: {
        version: RANKED_CAPTURE_VERSION,
        normalizationVersion: "minimal-ranked-identity-v1",
        requestId: capture.key,
        endpoint,
        source: this.receptionSource(observation.receptions),
        receptions: observation.receptions,
        entries,
        ignoredEntries,
        certification: "not_established",
        grantAuthorized: false,
      },
    });
    return { value, error, capture };
  }
  observeAccount(binding: RankedBinding, gameName: string, tagLine: string) {
    const owner = { ...binding };
    return this.observeRanked(
      owner,
      "ACCOUNT-V1",
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      accountRouting(owner.platform),
      () => this.account(owner.platform, gameName, tagLine),
    );
  }
  observeIdentity(binding: RankedBinding) {
    const owner = { ...binding };
    if (!owner.puuid) throw new MatchCaptureError("scope");
    return this.observeRanked(
      owner,
      "IDENTITY-V1",
      `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(owner.puuid)}`,
      accountRouting(owner.platform),
      () => this.identity(owner.platform, owner.puuid!),
    );
  }
  observeLeagues(binding: RankedBinding) {
    const owner = { ...binding };
    if (!owner.puuid) throw new MatchCaptureError("scope");
    return this.observeRanked(
      owner,
      "LEAGUE-V4",
      `/lol/league/v4/entries/by-puuid/${encodeURIComponent(owner.puuid)}`,
      platformRouting(owner.platform),
      () => this.leagues(owner.platform, owner.puuid!),
    );
  }
  confirmedRankedInput(capture: RankedCaptureHandle, binding: MatchCaptureBinding) {
    const stored = this.#ranked.get(capture);
    if (
      !stored ||
      stored.binding.playerId !== binding.playerId ||
      stored.binding.platform !== binding.platform ||
      (stored.binding.puuid !== null && stored.binding.puuid !== binding.puuid)
    )
      throw new MatchCaptureError("scope");
    return {
      record: structuredClone(stored.record),
      identityMatch: stored.puuid === null ? null : stored.puuid === binding.puuid,
    };
  }
  async observeRemakeDetail(platform: Platform, id: string) {
    const observed = await this.observeMatch(
      { playerId: randomUUID(), platform, puuid: "" },
      id,
      () => this.match(platform, id),
    );
    this.#sharedRemakes.set(observed.capture, platform);
    return observed;
  }
  confirmedRemakeInput(capture: MatchCaptureHandle, platform: Platform) {
    if (this.#sharedRemakes.get(capture) !== platform) throw new MatchCaptureError("scope");
    const stored = this.#captures.get(capture);
    if (!stored) throw new MatchCaptureError("scope");
    return structuredClone(stored.record);
  }
  account(platform: Platform, gameName: string, tagLine: string) {
    return this.request(
      accountRouting(platform),
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      accountSchema,
    );
  }
  identity(platform: Platform, puuid: string) {
    return this.request(
      accountRouting(platform),
      `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
      accountSchema,
    );
  }
  summoner(platform: Platform, puuid: string) {
    return this.request(
      platformRouting(platform),
      `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
      summonerSchema,
    );
  }
  leagues(platform: Platform, puuid: string) {
    return this.request(
      platformRouting(platform),
      `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
      leagueSchema,
    );
  }
  matchIds(platform: Platform, puuid: string, startTime: number, endTime: number, start: number) {
    return this.request(
      regionalRouting(platform),
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?startTime=${startTime}&endTime=${endTime}&start=${start}&count=100`,
      z.array(z.string()),
    );
  }
  match(platform: Platform, matchId: string) {
    return this.request(
      regionalRouting(platform),
      `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
      matchSchema,
    );
  }
}
