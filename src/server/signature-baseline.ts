import "server-only";
import { unstable_cache } from "next/cache";
import type { View } from "@/lib/queues";
import { championAsset } from "@/lib/champion-assets";
import {
  SIGNATURE_BASELINE_MIN_PLAYERS,
  signatureBaseline,
  toSignaturePlayer,
  type SignatureBaseline,
} from "@/lib/signature";
import { getLeaderboard, getProfile } from "./queries";
import { getAssets } from "./riot/assets";
import { isDemo } from "./env";
import { demoPlayers } from "./demo";

/**
 * Real community averages for the signature engine, one per queue.
 * Recomputed at most once an hour (not on every profile visit); with fewer than
 * five active players it returns null and the engine keeps its default baseline.
 * Profiles are loaded one after another to keep database load flat.
 */
const getCachedSignatureBaseline = unstable_cache(
  async (view: View, mode: "demo" | "live"): Promise<SignatureBaseline | null> => {
    const fixtures = mode === "demo" ? demoPlayers(view) : null;
    const players = fixtures ?? (await getLeaderboard(view));
    if (players.length < SIGNATURE_BASELINE_MIN_PLAYERS) return null;
    const { champions } = await getAssets();
    const name = (id: number, fallback: string) => championAsset(id, fallback, champions).name;
    const inputs = [];
    for (const player of players) {
      const profile = fixtures
        ? fixtures.find((p) => p.id === player.id)
        : await getProfile(player.id, view);
      if (profile) inputs.push(toSignaturePlayer(profile, view, name));
    }
    return signatureBaseline(inputs);
  },
  ["signature-baseline-v1"],
  { revalidate: 3600, tags: ["signature-baseline"] },
);

export function getSignatureBaseline(view: View) {
  return getCachedSignatureBaseline(view, isDemo() ? "demo" : "live");
}
