import type { PublicPlayer } from "@/lib/types";
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
        src={
          version && player.profileIconId !== null
            ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${player.profileIconId}.png`
            : null
        }
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
