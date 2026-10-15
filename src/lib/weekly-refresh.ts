import { weekStart } from "./time";

// Local clock checks only: no requests until the rendered weekly period expires.
export function watchWeekChange(options: {
  weekStartedAt: string;
  onChange: (weekStartedAt: string) => void;
  now?: () => number;
  visible?: () => boolean;
}) {
  let stopped = false;
  let lastRefresh = -Infinity;
  const check = () => {
    if (stopped || options.visible?.() === false) return;
    const now = (options.now ?? Date.now)();
    const current = weekStart(new Date(now)).toISOString();
    if (current !== options.weekStartedAt && now - lastRefresh >= 60_000) {
      lastRefresh = now;
      options.onChange(current);
    }
  };
  const timer = setInterval(check, 60_000);
  check();
  return {
    check,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
