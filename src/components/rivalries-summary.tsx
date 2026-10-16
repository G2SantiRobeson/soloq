"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Rivalries } from "./rivalries";
import { watchWeekChange } from "@/lib/weekly-refresh";
import { ladderQuery, type LadderFilters } from "@/lib/ladder-filters";
import type { Rivalry } from "@/lib/rivalries";
import type { View } from "@/lib/queues";
export function RivalriesSummary(props: {
  rivalries: Rivalry[];
  view: View;
  version: string | null;
  demo: boolean;
  filters: LadderFilters;
  weekStartedAt: string;
}) {
  const router = useRouter(),
    [observedWeek, setObservedWeek] = useState(props.weekStartedAt);
  useEffect(() => {
    const watcher = watchWeekChange({
      weekStartedAt: props.weekStartedAt,
      visible: () => document.visibilityState !== "hidden",
      onChange: (week) => {
        setObservedWeek(week);
        router.refresh();
      },
    });
    window.addEventListener("focus", watcher.check);
    document.addEventListener("visibilitychange", watcher.check);
    return () => {
      watcher.stop();
      window.removeEventListener("focus", watcher.check);
      document.removeEventListener("visibilitychange", watcher.check);
    };
  }, [props.weekStartedAt, router]);
  return (
    <Rivalries
      {...props}
      weeklyEnabled={observedWeek === props.weekStartedAt}
      rankingHref={"/" + ladderQuery(props.view, props.filters) + "#clasificacion"}
    />
  );
}
