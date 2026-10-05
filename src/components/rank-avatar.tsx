"use client";

import { useState, type CSSProperties } from "react";
import { RANK_WINGS } from "@/lib/rank-assets.generated";
import { Avatar } from "./avatar";

export function RankAvatar({
  tier,
  size = 78,
  ...avatar
}: {
  tier?: string | null;
  size?: number;
  src?: string | null;
  name: string;
  decorative?: boolean;
}) {
  const key = tier?.toUpperCase() ?? "UNRANKED";
  const wings = Object.hasOwn(RANK_WINGS, key) ? RANK_WINGS[key] : undefined;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!wings || failedSource === wings.src) return <Avatar {...avatar} size={size * 0.54} />;
  return (
    <span className="rank-avatar" style={{ "--rank-avatar-size": `${size}px` } as CSSProperties}>
      <svg
        viewBox={wings.viewBox}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <image
          href={wings.src}
          width={wings.width}
          height={wings.height}
          onError={() => setFailedSource(wings.src)}
        />
      </svg>
      <span
        className="rank-avatar-portrait"
        style={{
          left: `${wings.avatarLeft}%`,
          top: `${wings.avatarTop}%`,
          width: `${wings.avatarSize}%`,
          height: `${wings.avatarSize}%`,
        }}
      >
        <Avatar {...avatar} size={(size * wings.avatarSize) / 100} />
      </span>
    </span>
  );
}
