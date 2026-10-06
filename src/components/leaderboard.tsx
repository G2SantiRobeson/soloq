"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Search, X } from "lucide-react";
import type { PublicPlayer } from "@/lib/types";
import type { View } from "@/lib/queues";
import { PLATFORM_LABELS } from "@/lib/routing";
import { rankSortValue } from "@/lib/ranking";
import { kda, winrate } from "@/lib/stats";
import { PlayerIdentity } from "./player-identity";
import { RankDisplay } from "./rank-display";
import { LPDisplay } from "./lp-display";
import { RecentChampionForm } from "./recent-champion-form";
import { PlayerMomentum } from "./player-momentum";
import type { ChampionCatalog } from "@/lib/champion-assets";
import type { SyncStatus } from "@/lib/sync-status";
import { SyncCountdown } from "./sync-countdown";
import { signedLp } from "@/lib/lp-metrics";
type Sort = "rank" | "games" | "winrate" | "kda";
export function Leaderboard({
  players,
  view,
  version,
  champions,
  sync,
}: {
  players: PublicPlayer[];
  view: View;
  version: string | null;
  champions: ChampionCatalog;
  sync?: SyncStatus;
}) {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [sort, setSort] = useState<Sort>(view === "5v5" ? "winrate" : "rank");
  const [ascending, setAscending] = useState(false);
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
  function sortBy(next: Sort) {
    if (sort === next) setAscending(!ascending);
    else {
      setSort(next);
      setAscending(false);
    }
  }
  function heading(label: string, key: Sort, className = "") {
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
          <h2>
            {view === "5v5" ? "Registro 5v5" : "Ladder"}
            <span className="count-tag">{players.length}</span>
          </h2>
          <span>{view === "5v5" ? "RENDIMIENTO IMPORTADO" : "TIER / DIVISIÓN / LP"}</span>
        </div>
        <div className="table-filters">
          <label className="search-input">
            <Search size={16} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar Riot ID…"
              aria-label="Buscar jugador"
            />
            {search && (
              <button aria-label="Borrar búsqueda" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </label>
          <label className="region-filter">
            <span className="sr-only">Filtrar región</span>
            <select
              aria-label="Filtrar región"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="all">Todas las regiones</option>
              {[...new Set(players.map((p) => p.platform))].map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {sync && <SyncCountdown initial={sync} />}
      <div className="mobile-sort">
        <label>
          Ordenar por{" "}
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
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
      <table className="leaderboard" role="table">
        <caption className="sr-only">
          Clasificación de {view}. La posición se conserva al filtrar y ordenar.
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader" className="place-column">
              POS.
            </th>
            <th scope="col" role="columnheader">
              JUGADOR / RIOT ID
            </th>
            {view === "5v5" ? (
              <th scope="col" role="columnheader">
                RANGO
              </th>
            ) : (
              heading("RANGO", "rank")
            )}
            <th scope="col" role="columnheader" className="lp-column">
              LP
            </th>
            {view !== "5v5" && (
              <th
                scope="col"
                role="columnheader"
                className="weekly-column"
                title="Cambio neto de posición ranked desde el lunes 00:00, America/Santiago. No equivale a premios por partida."
              >
                Δ SEMANA
              </th>
            )}
            {heading("WINRATE", "winrate")}
            <th scope="col" role="columnheader" className="record-column">
              V / D
            </th>
            {heading("PARTIDAS", "games", "games-column")}
            {heading("KDA", "kda", "kda-column")}
            <th scope="col" role="columnheader">
              FORMA / 5
            </th>
            <th scope="col" role="columnheader">
              <span className="sr-only">Perfil</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((p) => (
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
                {view !== "5v5" && <PlayerMomentum metrics={p.momentum} />}
              </td>
              {view !== "5v5" && (
                <td
                  role="cell"
                  className={`weekly-cell numeric ${(p.weeklyLp ?? 0) > 0 ? "positive" : (p.weeklyLp ?? 0) < 0 ? "negative" : ""}`}
                  title={
                    p.weeklyLp == null
                      ? "Sin baseline válido anterior al lunes de esta semana"
                      : "Desplazamiento neto semanal de posición ranked"
                  }
                >
                  <span className="mobile-label">Δ SEMANA </span>
                  {p.weeklyLp == null ? "—" : `${signedLp(p.weeklyLp)} LP`}
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
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty-state">
          <span className="eyebrow">SIN RESULTADOS</span>
          <h3>{players.length ? "Ningún jugador coincide." : "El ladder aún está vacío."}</h3>
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
      <div className="table-bottom">
        <span role="status">
          {rows.length} de {players.length} jugadores
        </span>
        <span>Posición global conservada al filtrar · Más reciente ←</span>
      </div>
    </section>
  );
}
