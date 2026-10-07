import { parseView, type View } from "./queues";

const KEY = "soloq:last-ladder";

/** Remembers the ladder URL (with filters) for this tab only; storage failures are ignored. */
export function rememberLadderUrl(url: string) {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    /* Private mode or blocked storage: the back link falls back to the plain queue URL. */
  }
}

export function lastLadderUrl(view: View): string | null {
  try {
    const url = sessionStorage.getItem(KEY);
    if (!url?.startsWith("/?")) return null;
    const queue = new URLSearchParams(url.slice(2)).get("queue") ?? undefined;
    return parseView(queue) === view ? url : null;
  } catch {
    return null;
  }
}
