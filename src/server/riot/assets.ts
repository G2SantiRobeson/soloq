import "server-only";
import { unstable_cache } from "next/cache";
import { z } from "zod";
const cdn = "https://ddragon.leagueoflegends.com";
export type Assets = {
  version: string | null;
  champions: Record<string, { name: string; image: string }>;
};
const getCachedAssets = unstable_cache(
  async (): Promise<Assets> => {
    const override = process.env.DDRAGON_VERSION;
    const versions = override
      ? [override]
      : z
          .array(z.string())
          .parse(
            await (
              await fetch(`${cdn}/api/versions.json`, { signal: AbortSignal.timeout(5000) })
            ).json(),
          );
    const version = z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .parse(versions[0]);
    const schema = z.object({
      data: z.record(
        z.string(),
        z.object({ key: z.string(), name: z.string(), image: z.object({ full: z.string() }) }),
      ),
    });
    const champions = schema.parse(
      await (
        await fetch(`${cdn}/cdn/${version}/data/es_MX/champion.json`, {
          signal: AbortSignal.timeout(5000),
        })
      ).json(),
    );
    return {
      version,
      champions: Object.fromEntries(
        Object.values(champions.data).map((c) => [
          c.key,
          { name: c.name, image: `${cdn}/cdn/${version}/img/champion/${c.image.full}` },
        ]),
      ),
    };
  },
  ["data-dragon-assets-v1"],
  { revalidate: 86400 },
);
export async function getAssets(): Promise<Assets> {
  try {
    return await getCachedAssets();
  } catch {
    return { version: null, champions: {} };
  }
}
export function profileIconUrl(version: string | null, id: number | null) {
  return version && id !== null ? `${cdn}/cdn/${version}/img/profileicon/${id}.png` : null;
}
