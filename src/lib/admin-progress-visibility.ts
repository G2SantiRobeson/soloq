import type { ProgressDto } from "./sync-progress";

/** Presentation only: checkpoints and lease/control state are never discarded. */
export function createAdminProgressVisibility(live = false) {
  let revealed = live;
  return {
    reveal() {
      revealed = true;
    },
    observe(dto: ProgressDto) {
      const run = dto.run;
      const terminal =
        !!run?.finishedAt &&
        (run.state === "completed" || run.state === "partial" || run.state === "failed");
      // A reload can recover active or uncertain work, but not an old final result.
      if (run && !terminal) revealed = true;
      return { progress: run && terminal && !revealed ? { ...dto, run: null } : dto, terminal };
    },
  };
}

/** A deleted/missing player cannot own feedback; global diagnostics remain global. */
export function adminProgressForPlayers(dto: ProgressDto | null, ids: readonly string[]) {
  const run = dto?.run;
  return dto && run && run.action !== "global" && (!run.playerId || !ids.includes(run.playerId))
    ? { ...dto, run: null }
    : dto;
}
