"use client";
import Image from "next/image";
import { useState } from "react";
export function Avatar({
  src,
  fallbackSrc,
  name,
  size = 42,
  champion = false,
  decorative = false,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  name: string;
  size?: number;
  champion?: boolean;
  decorative?: boolean;
}) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const imageSrc = [src, fallbackSrc].find(
    (candidate): candidate is string => !!candidate && !failedSources.includes(candidate),
  );
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`avatar ${champion ? "champion-avatar" : ""}`}
      style={{ width: size, height: size, minWidth: size }}
    >
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={decorative ? "" : name}
          width={size}
          height={size}
          unoptimized
          onError={() => setFailedSources((previous) => [...previous, imageSrc])}
        />
      ) : (
        <span aria-label={name}>{name.replace("Demo ", "").slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}
