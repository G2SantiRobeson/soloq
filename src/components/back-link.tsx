"use client";
import { useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import { lastLadderUrl } from "@/lib/ladder-memory";
import type { View } from "@/lib/queues";

const subscribe = () => () => {};

/**
 * Single "back to the ladder" link for every page. It returns to the last ladder
 * view of the same queue (with its filters) when this tab has one.
 * A full navigation keeps the return path usable independently of the client router.
 */
export function BackToLadder({ view }: { view: View }) {
  const fallback = `/?queue=${view}`;
  const href = useSyncExternalStore(
    subscribe,
    () => lastLadderUrl(view) ?? fallback,
    () => fallback,
  );
  return (
    <a href={href} className="back-link">
      <ArrowLeft size={16} aria-hidden="true" />
      Volver a la clasificación
    </a>
  );
}
