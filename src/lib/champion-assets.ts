import { LOCAL_CHAMPION_IDS } from "./champion-icons.generated";
export type ChampionCatalog = Record<string, { name: string; image: string }>;
const localIds = new Set(LOCAL_CHAMPION_IDS);
export function championAsset(id: number, name: string, catalog: ChampionCatalog) {
  const remote = catalog[id];
  const local = localIds.has(id) ? `/champ-icons/${id}.png` : undefined;
  return {
    name: remote?.name ?? name,
    src: local ?? remote?.image,
    fallbackSrc: local ? remote?.image : undefined,
  };
}
