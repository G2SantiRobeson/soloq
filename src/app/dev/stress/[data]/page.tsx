import Link from "next/link";
import { notFound } from "next/navigation";
import { Leaderboard } from "@/components/leaderboard";
import { demoPlayers } from "@/server/demo";
import { getAssets } from "@/server/riot/assets";
import type { PublicPlayer } from "@/lib/types";
import { Rivalries } from "@/components/rivalries";
import { selectRivalries } from "@/lib/rivalries";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Prueba de casos extremos",
  robots: { index: false, follow: false },
};

/*
 * Development-only stress fixture for the RC3 ladder (break-ui). Data enters through the same
 * `players` prop as production; the component is never edited to provoke a break.
 * Riot IDs: 3–16 character names and 3–5 character tags (Riot's limits; the schema has none).
 */
const STATES = ["demo", "worst", "one", "empty"] as const;
type State = (typeof STATES)[number];
const LABELS: Record<State, string> = {
  demo: "Demo",
  worst: "Caso extremo",
  one: "Un jugador",
  empty: "Vacío",
};

const NAMES = [
  "Wiśniewska Kowal", // 16 characters, diacritics and a space
  "정글은 내가 책임진다", // Korean, allowed by Riot
  "MMMMMMMMMMMMMMMM", // widest Latin glyph at the 16-character limit
  "Jo1", // the 3-character minimum
  "🐉 Dragón Soul", // emoji: Riot does not allow it, tested anyway
  "Bartholomew Fitz",
];
const TAGS = ["WWWWW", "KR1", "LAS", "0001", "ÑAÑA", "EUW"];

function worstCase(players: PublicPlayer[]): PublicPlayer[] {
  return players.map((player, index) => {
    // Every row gets a hard name, so whichever pairs the rivalry selection picks meet them too.
    const named = {
      ...player,
      gameName: NAMES[index % NAMES.length],
      tagLine: TAGS[index % TAGS.length],
    };
    // Apex LP above a thousand needs the separator and the widest LP cell.
    if (index === 0 && named.rank) named.rank = { ...named.rank, leaguePoints: 1987 };
    return named;
  });
}

// The state lives in the path: the ladder rewrites the query string with its own filters.
export default async function StressPage({ params }: { params: Promise<{ data: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const requested = (await params).data;
  if (!STATES.includes(requested as State)) notFound();
  const state = requested as State;
  const assets = await getAssets();
  const base = demoPlayers("soloq");
  const players =
    state === "demo"
      ? base
      : state === "worst"
        ? worstCase(base)
        : state === "one"
          ? base.slice(0, 1)
          : [];
  return (
    <>
      <h1>Casos extremos</h1>
      <p className="page-note">
        Datos ficticios, solo desarrollo. Sin escrituras ni llamadas a Riot.
      </p>
      <Leaderboard
        key={state}
        players={players}
        view="soloq"
        version={assets.version}
        champions={assets.champions}
        demo
      />
      {/* The same rows through the rivalry selection, so duels meet the worst case too. */}
      <Rivalries
        rivalries={selectRivalries(players, "soloq")}
        view="soloq"
        version={assets.version}
        demo
        rankingHref="#clasificacion"
      />
      {/* Dev chrome, deliberately plain and outside the design under test. */}
      <nav
        aria-label="Conjunto de datos"
        style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 999,
          background: "#d9d9d9",
          font: "13px system-ui, sans-serif",
        }}
      >
        {STATES.map((value) => (
          <Link
            key={value}
            href={`/dev/stress/${value}`}
            aria-current={value === state ? "page" : undefined}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              color: "#111",
              background: value === state ? "#fff" : "transparent",
            }}
          >
            {LABELS[value]}
          </Link>
        ))}
      </nav>
    </>
  );
}
