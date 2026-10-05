"use client";
import { useState, type CSSProperties } from "react";
import { RANK_ASSETS } from "@/lib/rank-assets.generated";

export function RankEmblem({
  tier,
  size = 64,
  variant = "full",
  decorative = false,
}: {
  tier?: string | null;
  size?: number;
  variant?: "full" | "compact";
  decorative?: boolean;
}) {
  const key = tier?.toUpperCase() ?? "UNRANKED";
  const asset = Object.hasOwn(RANK_ASSETS, key) ? RANK_ASSETS[key] : undefined;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const available = asset && failedSrc !== asset.src;
  const label = key === "UNRANKED" ? "Sin clasificar" : tier || "Sin clasificar";
  return (
    <span
      className={`rank-emblem rank-emblem-${variant}`}
      style={{ "--emblem-size": `${size}px` } as CSSProperties}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={
        decorative ? undefined : `Emblema ${label}${!available && asset ? " no disponible" : ""}`
      }
    >
      {available ? (
        <svg
          viewBox={asset.viewBox}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
        >
          <image
            href={asset.src}
            width={asset.width}
            height={asset.height}
            onError={() => setFailedSrc(asset.src)}
          />
        </svg>
      ) : (
        <span className="rank-emblem-fallback">—</span>
      )}
    </span>
  );
}
