import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { getWeeklyLpSummary } from "@/server/weekly-lp";

const pg = new PGlite();
const database = drizzle(pg, { schema });
vi.mock("@/db", () => ({ db: () => database }));
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
afterAll(() => pg.close());

it("queries the new week independently and keeps LP/V/D on the same official endpoints", async () => {
  const [player, partial] = await database
    .insert(schema.players)
    .values(
      ["weekly", "partial"].map((puuid) => ({
        gameName: "Example",
        tagLine: "TEST",
        platform: "LA2" as const,
        puuid,
        scanStart: new Date("2026-09-01T00:00:00Z"),
      })),
    )
    .returning();
  const base = {
    playerId: player.id,
    queue: "RANKED_SOLO_5x5" as const,
    tier: "GOLD",
    division: "II",
    leaguePoints: 50,
    wins: 20,
    losses: 10,
  };
  await database.insert(schema.rankedSnapshots).values([
    { ...base, timestamp: new Date("2026-10-04T23:00:00Z") },
    {
      ...base,
      leaguePoints: 75,
      wins: 23,
      losses: 12,
      timestamp: new Date("2026-10-11T20:00:00Z"),
    },
  ]);
  expect(
    (await getWeeklyLpSummary([player.id], "soloq", new Date("2026-10-12T02:59:59Z"))).get(
      player.id,
    ),
  ).toMatchObject({ net: 25, wins: 3, losses: 2 });
  expect(
    (await getWeeklyLpSummary([player.id], "soloq", new Date("2026-10-12T03:00:00Z"))).get(
      player.id,
    ),
  ).toBeNull();
  const next = new Date("2026-10-12T04:00:00Z");
  await database.insert(schema.rankedSnapshots).values([
    { ...base, leaguePoints: 90, wins: 24, losses: 12, timestamp: next },
    { ...base, playerId: partial.id, timestamp: next },
    {
      ...base,
      playerId: partial.id,
      leaguePoints: 35,
      losses: 11,
      timestamp: new Date("2026-10-12T05:00:00Z"),
    },
  ]);
  expect(
    (await getWeeklyLpSummary([player.id, partial.id], "soloq", next)).get(player.id),
  ).toMatchObject({
    net: 15,
    wins: 1,
    losses: 0,
    partial: false,
    from: "2026-10-11T20:00:00.000Z",
    to: next.toISOString(),
  });
  expect((await getWeeklyLpSummary([partial.id], "soloq", next)).get(partial.id)).toBeNull();
  expect(
    (await getWeeklyLpSummary([partial.id], "soloq", new Date("2026-10-12T05:00:00Z"))).get(
      partial.id,
    ),
  ).toMatchObject({
    net: -15,
    wins: 0,
    losses: 1,
    partial: true,
    from: next.toISOString(),
    to: "2026-10-12T05:00:00.000Z",
  });
});
