export const APP_TIMEZONE = "America/Santiago";

/** Monday midnight in the community timezone, returned as a UTC instant. */
export function weekStart(now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallTime = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const n = (name: string) => Number(parts.find((p) => p.type === name)!.value);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  };
  const local = new Date(wallTime(now));
  const monday = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - ((local.getUTCDay() + 6) % 7),
  );
  let instant = monday;
  // Resolve the offset at Monday itself, not today's offset (DST can change on Sunday).
  for (let i = 0; i < 3; i++) instant += monday - wallTime(new Date(instant));
  return new Date(instant);
}
