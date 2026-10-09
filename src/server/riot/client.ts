import "server-only";
import { z } from "zod";
import { accountRouting, platformRouting, regionalRouting, type Platform } from "@/lib/routing";
import { accountSchema, leagueSchema, matchSchema, summonerSchema } from "./schemas";
import { isDemo } from "../env";
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
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 2000;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - now) || 2000;
}
type Dependencies = {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  interval?: number;
};
// Only instantiated inside the database-backed global sync lease. One request at a time.
export class RiotClient {
  private nextRequestAt = 0;
  private fetcher: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private interval: number;
  constructor(
    private deadline = Date.now() + 230_000,
    deps: Dependencies = {},
  ) {
    this.fetcher = deps.fetcher ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    const configured = Number(process.env.RIOT_REQUEST_INTERVAL_MS ?? 1300);
    this.interval =
      deps.interval ?? (Number.isFinite(configured) ? Math.max(1300, configured) : 1300);
  }
  async request<T>(host: string, path: string, schema: z.ZodType<T>): Promise<T> {
    if (isDemo())
      throw new Error("Las consultas autenticadas a Riot están deshabilitadas en modo demo.");
    const key = process.env.RIOT_API_KEY;
    if (!key) throw new RiotError(401);
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, this.nextRequestAt - this.now());
      if (this.now() + wait + 12_000 > this.deadline) throw new SyncDeadline();
      if (wait) await this.sleep(wait);
      this.nextRequestAt = this.now() + this.interval;
      let response: Response;
      try {
        response = await this.fetcher(`https://${host}.api.riotgames.com${path}`, {
          headers: { "X-Riot-Token": key },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        if (attempt === 2) throw new RiotError(503);
        this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + 1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        const parsed = schema.safeParse(await response.json());
        if (!parsed.success) throw new RiotError(502);
        return parsed.data;
      }
      if (response.status !== 429 && response.status < 500) throw new RiotError(response.status);
      const delay =
        response.status === 429
          ? retryAfterMs(response.headers.get("retry-after"), this.now())
          : 1000 * 2 ** attempt;
      if (attempt === 2 || this.now() + delay + 12_000 > this.deadline)
        throw new RiotError(response.status, delay);
      this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + delay);
    }
    throw new RiotError(503);
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
