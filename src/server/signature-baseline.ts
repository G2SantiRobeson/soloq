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

/**
 * Real community averages for the signature engine, one per queue.
 * Recomputed at most once an hour (not on every profile visit); with fewer than
 * five active players it returns null and the engine keeps its default baseline.
 * Profiles are loaded one after another to keep database load flat.
 */
export const getSignatureBaseline = unstable_cache(
  async (view: View): Promise<SignatureBaseline | null> => {
    const players = await getLeaderboard(view);
    if (players.length < SIGNATURE_BASELINE_MIN_PLAYERS) return null;
    const { champions } = await getAssets();
    const name = (id: number, fallback: string) => championAsset(id, fallback, champions).name;
    const inputs = [];
    for (const player of players) {
      const profile = await getProfile(player.id, view);
      if (profile) inputs.push(toSignaturePlayer(profile, view, name));
    }
    return signatureBaseline(inputs);
  },
  ["signature-baseline-v1"],
  { revalidate: 3600, tags: ["signature-baseline"] },
);
