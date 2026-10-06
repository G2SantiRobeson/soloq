import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import { PLATFORMS } from "@/lib/routing";
import { periodStart, seasonEnd, type MetricsPeriod } from "@/lib/season";
// Regional season boundaries are shared by storage and queries. Windows never delete data.
export function seasonFilter(
  timestamp: SQLWrapper,
  platform: SQLWrapper,
  period: MetricsPeriod = "season",
  now = Date.now(),
) {
  const branches = PLATFORMS.map(
    (p) => sql`when ${p} then ${periodStart(p, period, now).toISOString()}::timestamptz`,
  );
  return sql`${timestamp} >= (case ${platform} ${sql.join(branches, sql` `)} end)
    and ${timestamp} < ${new Date(Math.min(now, seasonEnd()?.getTime() ?? Infinity)).toISOString()}::timestamptz`;
}
