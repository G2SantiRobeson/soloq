import { LOCAL_CHAMPION_IDS } from "./champion-icons.generated";
const localIds = new Set(LOCAL_CHAMPION_IDS);
/** Demo portraits reuse existing local artwork; they are not account profile icons. */
export function profileIconAsset(
  version: string | null | undefined,
  id: number | null,
): string | null {
  if (id === null || !version) return null;
  if (version === "local-demo") return localIds.has(id) ? "/champ-icons/" + id + ".png" : null;
  return "https://ddragon.leagueoflegends.com/cdn/" + version + "/img/profileicon/" + id + ".png";
}
