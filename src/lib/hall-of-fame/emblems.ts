import type { HallProposalId } from "./proposals";
export type HallEmblemAsset = { readonly src: string; readonly width: 512; readonly height: 512 };
/** Visual assets only. IDs are proposals, not granted achievements. */
export const HALL_EMBLEM_ASSETS = Object.freeze({
  intocable: { src: "/achievements/hall-of-fame/el-intocable.webp", width: 512, height: 512 },
  "primero-de-su-nombre": {
    src: "/achievements/hall-of-fame/el-primero-de-su-nombre.webp",
    width: 512,
    height: 512,
  },
  monarca: { src: "/achievements/hall-of-fame/el-monarca.webp", width: 512, height: 512 },
} satisfies Record<HallProposalId, HallEmblemAsset>);
export function hallEmblemAsset(id: string): HallEmblemAsset | null {
  return Object.hasOwn(HALL_EMBLEM_ASSETS, id) ? HALL_EMBLEM_ASSETS[id as HallProposalId] : null;
}
