"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpRight, Search, Swords, X } from "lucide-react";
import type { PublicPlayer } from "@/lib/types";
import type { View } from "@/lib/queues";
import { PLATFORM_LABELS, type Platform } from "@/lib/routing";
import {
  ladderQuery,
  parseLadderFilters,
  SEARCH_MAX_LENGTH,
  type LadderFilters,
  type LadderSort,
} from "@/lib/ladder-filters";
import { rankSortValue } from "@/lib/ranking";
import { strata, tierClass, tierDistribution, tierName } from "@/lib/ladder-strata";
import { countLabel } from "@/lib/format";
import {
  resolveSharedRivalry,
  visibleSharedRivalries,
  sharedRivalryQuery,
  sharedRivalryPath,
  type SharedRivalryRequest,
} from "@/lib/shared-rivalry";
import { selectRivalries } from "@/lib/rivalries";
import { kda, winrate } from "@/lib/stats";
import { PlayerIdentity } from "./player-identity";
import { RankDisplay } from "./rank-display";
import { LPDisplay } from "./lp-display";
import { RecentChampionForm } from "./recent-champion-form";
import { LastFiveMomentum, WeeklyMomentum } from "./player-momentum";
import type { ChampionCatalog } from "@/lib/champion-assets";
import type { SyncStatus } from "@/lib/sync-status";
import { SyncCountdown } from "./sync-countdown";
import { rememberLadderUrl } from "@/lib/ladder-memory";
import { InfoTip } from "./info-tip";
import { RankEmblem } from "./rank-emblem";
import { TierDistribution } from "./tier-distribution";
import { watchWeekChange } from "@/lib/weekly-refresh";
/** Ranked views: position, player, rank, LP, Δ week, winrate, V/D, games, KDA, form, profile. */
const LADDER_COLUMNS = 11;
export function Leaderboard({
  players,
  view,
  version,
  champions,
  sync,
  demo = false,
  weekStartedAt,
  initialFilters = parseLadderFilters(view, {}),
  initialSharedRivalry = { status: "none" },
}: {
  players: PublicPlayer[];
  view: View;
  version: string | null;
  champions: ChampionCatalog;
  sync?: SyncStatus;
  demo?: boolean;
  weekStartedAt?: string;
  initialFilters?: LadderFilters;
  initialSharedRivalry?: SharedRivalryRequest;
}) {
  const ids = useId();
  const router = useRouter();
  const [observedWeek, setObservedWeek] = useState(weekStartedAt);
  const weeklyExpired = !!weekStartedAt && observedWeek !== weekStartedAt;
  useEffect(() => {
    if (view === "5v5" || !weekStartedAt) return;
    const watcher = watchWeekChange({
      weekStartedAt,
      visible: () => document.visibilityState !== "hidden",
      onChange: (current) => {
        // Hide the old delta even if the refresh fails; retry at the next visible tick.
        setObservedWeek(current);
        router.refresh();
      },
    });
    document.addEventListener("visibilitychange", watcher.check);
    window.addEventListener("focus", watcher.check);
    return () => {
      watcher.stop();
      document.removeEventListener("visibilitychange", watcher.check);
      window.removeEventListener("focus", watcher.check);
    };
  }, [demo, view, weekStartedAt, router]);
  const [search, setSearch] = useState(initialFilters.search);
  const [region, setRegion] = useState<LadderFilters["region"]>(initialFilters.region);
  const [sort, setSort] = useState<LadderSort>(initialFilters.sort);
  const [ascending, setAscending] = useState(initialFilters.ascending);
  useEffect(() => {
    // Keep filters shareable and restorable without a server round trip.
    const filters = { search, region, sort, ascending };
    const query =
      initialSharedRivalry.status === "requested"
        ? sharedRivalryQuery(view, filters, initialSharedRivalry.ids)
        : ladderQuery(view, filters);
    if (window.location.search !== query)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query}${window.location.hash}`,
      );
    if (window.location.pathname === "/") rememberLadderUrl(`/${query}`);
  }, [view, search, region, sort, ascending, initialSharedRivalry]);
  const records = useMemo(() => {
    const list = players.map((p) => {
      const wins = view !== "5v5" && p.rank ? p.rank.wins : p.stats.wins;
      const losses = view !== "5v5" && p.rank ? p.rank.losses : p.stats.losses;
      return {
        ...p,
        wins,
        losses,
        games: wins + losses,
        winrate: winrate(wins, losses),
        kda: kda(p.stats.kills, p.stats.deaths, p.stats.assists),
        rankValue: rankSortValue(p.rank),
      };
    });
    list.sort(
      (a, b) =>
        (view === "5v5" ? b.winrate - a.winrate : b.rankValue - a.rankValue) ||
        a.gameName.localeCompare(b.gameName),
    );
    return list.map((p, index) => ({ ...p, place: index + 1 }));
  }, [players, view]);
  const rows = records
    .filter(
      (p) =>
        `${p.gameName}#${p.tagLine}`.toLowerCase().includes(search.toLowerCase()) &&
        (region === "all" || p.platform === region),
    )
    .sort((a, b) => {
      if (sort === "rank" && a.rankValue < 0 !== b.rankValue < 0) return a.rankValue < 0 ? 1 : -1;
      const value =
        (sort === "rank" ? b.rankValue - a.rankValue : b[sort] - a[sort]) * (ascending ? -1 : 1);
      return value || a.gameName.localeCompare(b.gameName);
    });
  const shared = resolveSharedRivalry(rows, view, initialSharedRivalry);
  const rivalries = visibleSharedRivalries(selectRivalries(rows, view), shared);
  // Tier strata only describe the official order; any other sort shows one plain list.
  const ranked = view !== "5v5";
  const grouped = ranked && sort === "rank";
  const distribution = ranked ? tierDistribution(rows, (p) => p.rank) : [];
  function sortBy(next: LadderSort) {
    if (sort === next) setAscending(!ascending);
    else {
      setSort(next);
      setAscending(false);
    }
  }
  /** One ladder row. Identical cells in every grouping, so no datum depends on the sort. */
  function renderRow(p: (typeof rows)[number]) {
    return (
      <tr role="row" key={p.id} className={`ladder-row ${p.place <= 3 ? "podium-row" : ""}`}>
        <td role="cell" className={`place place-${p.place}`}>
          <span className="place-number">
            <span className="sr-only">Posición </span>#{p.place}
          </span>
        </td>
        <td role="cell" className="identity-cell">
          <Link className="player-link" href={`/player/${p.id}?queue=${view}`}>
            <PlayerIdentity player={p} version={version} />
          </Link>
        </td>
        <td role="cell" className="rank-cell">
          <RankDisplay rank={p.rank} noRank={view === "5v5"} size={44} />
        </td>
        <td role="cell" className="lp-cell">
          <LPDisplay rank={p.rank} noRank={view === "5v5"} />
          {view !== "5v5" && <LastFiveMomentum metrics={p.lastFiveLp} />}
        </td>
        {view !== "5v5" && (
          <td
            role="cell"
            className={`weekly-cell numeric ${weeklyExpired ? "" : (p.weeklyLp ?? 0) > 0 ? "positive" : (p.weeklyLp ?? 0) < 0 ? "negative" : ""}`}
          >
            <span className="mobile-label">Δ semana </span>
            <WeeklyMomentum summary={weeklyExpired ? null : p.weeklySummary} />
          </td>
        )}
        <td role="cell" className="wr-cell">
          <span className={`winrate numeric ${p.games && p.winrate >= 50 ? "positive" : ""}`}>
            {p.games ? p.winrate.toFixed(1) : "—"}
            <small>{p.games ? "%" : ""}</small>
            <span className="mobile-label"> WR</span>
          </span>
          <span className={`winrate-track ${p.games ? "" : "no-games"}`} aria-hidden="true">
            <span style={{ width: `${p.winrate}%` }} />
          </span>
        </td>
        <td role="cell" className="record record-column numeric">
          <span>{p.wins}</span>
          <i>/</i>
          <span>{p.losses}</span>
        </td>
        <td role="cell" className="games-column numeric muted-number">
          {p.games}
        </td>
        <td role="cell" className="kda-column numeric">
          {p.stats.games ? p.kda.toFixed(2) : "—"}
        </td>
        <td role="cell" className="form-cell">
          <RecentChampionForm matches={p.recent} champions={champions} />
        </td>
        <td role="cell" className="link-cell">
          <Link
            href={`/player/${p.id}?queue=${view}`}
            className="row-link"
            aria-label={`Ver perfil de ${p.gameName}`}
          >
            <ArrowUpRight size={18} />
          </Link>
        </td>
      </tr>
    );
  }
  function heading(label: string, key: LadderSort, className = "") {
    return (
      <th
        role="columnheader"
        className={className}
        scope="col"
        aria-sort={sort === key ? (ascending ? "ascending" : "descending") : "none"}
      >
        <button className={`sort ${sort === key ? "active-sort" : ""}`} onClick={() => sortBy(key)}>
          {label}
          {sort === key && ascending ? (
            <ArrowUp size={13} />
          ) : (
            <ArrowDown size={13} className={sort === key ? "" : "sort-faint"} />
          )}
        </button>
      </th>
    );
  }
  return (
    <section className="leaderboard-section" aria-label="Clasificación de jugadores">
      <div className="table-toolbar">
        <div className="table-title">
          <h2 id="clasificacion" tabIndex={-1}>
            {view === "5v5" ? "Registro 5v5" : "Ranking"}
            <span className="count-tag">{players.length}</span>
          </h2>
          <span>
            {view === "5v5" ? "Rendimiento importado" : "Orden oficial: tier, división y LP"}
          </span>
          {rivalries.length > 0 && (
            <Link
              className="rivalries-jump"
              href={"/rivalidades" + ladderQuery(view, { search, region, sort, ascending })}
            >
              <Swords size={16} aria-hidden="true" /> Ver rivalidades
            </Link>
          )}
        </div>
        <div className="table-filters">
          <div className="filter-field search-field">
            <label className="filter-label" htmlFor={`${ids}-search`}>
              Buscar Riot ID
            </label>
            <div className="search-input">
              <Search size={16} aria-hidden="true" />
              <input
                id={`${ids}-search`}
                value={search}
                maxLength={SEARCH_MAX_LENGTH}
                autoComplete="off"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre#TAG"
              />
              {search && (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="Borrar búsqueda"
                  onClick={() => setSearch("")}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <div className="filter-field region-field">
            <label className="filter-label" htmlFor={`${ids}-region`}>
              Región
            </label>
            <div className="region-filter">
              <select
                id={`${ids}-region`}
                value={region}
                onChange={(e) => setRegion(e.target.value as Platform | "all")}
              >
                <option value="all">Todas las regiones</option>
                {[
                  ...new Set([
                    ...players.map((p) => p.platform),
                    ...(region === "all" ? [] : [region]),
                  ]),
                ].map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      {demo ? (
        <p className="page-note">Demo pública · sin sincronización de cuentas reales.</p>
      ) : (
        sync && <SyncCountdown initial={sync} />
      )}
      <div className="mobile-sort">
        <label>
          Ordenar por{" "}
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as LadderSort);
              setAscending(false);
            }}
          >
            {view !== "5v5" && <option value="rank">Rango y LP</option>}
            <option value="winrate">Winrate</option>
            <option value="games">Partidas</option>
            <option value="kda">KDA</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setAscending(!ascending)}
          aria-label={
            ascending
              ? "Orden ascendente; cambiar a descendente"
              : "Orden descendente; cambiar a ascendente"
          }
        >
          {ascending ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          {ascending ? "Ascendente" : "Descendente"}
        </button>
      </div>
      {ranked && rows.length > 0 && (
        <TierDistribution items={distribution} total={rows.length} linked={grouped} />
      )}
      <table className="leaderboard" role="table" hidden={rows.length === 0}>
        <caption className="sr-only">
          Clasificación de {view}. La posición se conserva al filtrar y ordenar.
          {grouped && " Agrupada por tier oficial."}
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader" className="place-column">
              Pos.
            </th>
            <th scope="col" role="columnheader">
              Jugador / Riot ID
            </th>
            {view === "5v5" ? (
              <th scope="col" role="columnheader">
                Rango
              </th>
            ) : (
              heading("Rango", "rank")
            )}
            <th scope="col" role="columnheader" className="lp-column">
              {view === "5v5" ? (
                "LP"
              ) : (
                <InfoTip term="LP">
                  {demo ? "LP ficticios de demo" : "LP oficiales actuales"}. Debajo: variación neta
                  observada solo si los snapshots oficiales aíslan las cinco partidas visibles.
                </InfoTip>
              )}
            </th>
            {view !== "5v5" && (
              <th scope="col" role="columnheader" className="weekly-column">
                <InfoTip term="Δ semana">
                  Referencia: lunes 00:00 de America/Santiago. ΔLP y V/D usan el mismo intervalo
                  entre observaciones oficiales. Sin baseline anterior al lunes se muestra Δ parcial
                  desde el primer registro válido de la semana. Sin dos registros comparables: Sin
                  datos suficientes.
                </InfoTip>
              </th>
            )}
            {heading("Winrate", "winrate")}
            <th scope="col" role="columnheader" className="record-column">
              V / D
            </th>
            {heading("Partidas", "games", "games-column")}
            {heading("KDA", "kda", "kda-column")}
            <th scope="col" role="columnheader">
              Forma
            </th>
            <th scope="col" role="columnheader">
              <span className="sr-only">Perfil</span>
            </th>
          </tr>
        </thead>
        {grouped ? (
          strata(rows, (p) => p.rank).map(({ key, rows: members }) => (
            <tbody role="rowgroup" key={key} className={`tier-group rank-${tierClass(key)}`}>
              <tr role="row" className="tier-break">
                <th role="rowheader" scope="rowgroup" colSpan={LADDER_COLUMNS}>
                  <span className="tier-break-label" id={`estrato-${tierClass(key)}`}>
                    <RankEmblem
                      tier={key === "UNRANKED" ? null : key}
                      size={28}
                      variant="compact"
                      decorative
                    />
                    <span className="tier-break-name">{tierName(key)}</span>
                    <span className="tier-break-count">
                      {countLabel(members.length, "jugador", "jugadores")}
                    </span>
                  </span>
                </th>
              </tr>
              {members.map(renderRow)}
            </tbody>
          ))
        ) : (
          <tbody role="rowgroup">{rows.map(renderRow)}</tbody>
        )}
      </table>
      {!rows.length && (
        <div className="empty-state">
          {players.length > 0 && <Search size={28} aria-hidden="true" />}
          <h3>
            {players.length ? "Ningún jugador coincide." : "La clasificación aún está vacía."}
          </h3>
          <p>
            {players.length
              ? "Prueba otro Riot ID o restablece los filtros."
              : "Añade la primera cuenta para comenzar la clasificación."}
          </p>
          {players.length ? (
            <button
              className="button secondary"
              onClick={() => {
                setSearch("");
                setRegion("all");
              }}
            >
              Restablecer filtros
            </button>
          ) : (
            <Link href="/admin" className="button primary">
              Añadir jugadores <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
      )}
      {(shared.status === "invalid" || shared.status === "unavailable") && (
        <p className="shared-rivalry-status" role="status">
          {shared.status === "invalid"
            ? "Enlace de rivalidad inválido. La clasificación permanece disponible."
            : "El enfrentamiento compartido ya no está disponible con este estado o estos filtros. La clasificación permanece disponible."}
        </p>
      )}
      {shared.status === "ready" && (
        <Link
          className="shared-rivalry-status"
          href={
            sharedRivalryPath(view, [shared.rivalry.players[0].id, shared.rivalry.players[1].id], {
              search,
              region,
              sort,
              ascending,
            }) ?? "/rivalidades"
          }
        >
          Abrir enfrentamiento compartido
        </Link>
      )}
      <div className="table-bottom">
        <span role="status">
          {rows.length} de {countLabel(players.length, "jugador", "jugadores")}
        </span>
        <span>Posición global conservada al filtrar · Más reciente ←</span>
      </div>
    </section>
  );
}
