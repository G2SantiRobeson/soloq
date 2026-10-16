import type { PublicPlayer } from "@/lib/types";
import { profileIconAsset } from "@/lib/profile-icon";
import { PLATFORM_LABELS } from "@/lib/routing";
import { RankAvatar } from "./rank-avatar";
import { Freshness } from "./freshness";
export function PlayerIdentity({
  player,
  version,
}: {
  player: PublicPlayer;
  version: string | null;
}) {
  return (
    <span className="player-identity">
      <RankAvatar
        tier={player.rank?.tier}
        decorative
        name={player.gameName}
        src={profileIconAsset(version, player.profileIconId)}
      />
      <span className="identity-copy">
        <span className="player-name">
          {player.gameName}
          <span className="tagline">#{player.tagLine}</span>
        </span>
        <span className="player-sub">
          <span className="region-tag">{PLATFORM_LABELS[player.platform]}</span>
          <Freshness timestamp={player.lastSyncedAt} observedAt={player.observedAt} compact />
        </span>
      </span>
    </span>
  );
}
