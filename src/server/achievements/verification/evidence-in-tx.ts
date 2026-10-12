import "server-only";
import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import {
  achievementEvidenceHeaders as headers,
  achievementEvidenceUnits as units,
} from "@/db/schema";
import { LOCAL_LIMITS, LocalEvidenceError } from "./persistence-contracts";

// Common installed PostgreSQL builder API, not a cast between drivers. No transaction/URL/IO port.
export type EvidenceTransaction = Pick<
  PgDatabase<PgQueryResultHKT, typeof schema>,
  "select" | "insert" | "update"
>;
export const evidenceBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
export const conservativeEvidenceBytes = (v: unknown) => 2 * evidenceBytes(v);

/** Caller holds owner/header locks. Shared with D; no revision mutation, transaction or savepoint. */
export async function assertEvidenceCapacityInTx(
  tx: EvidenceTransaction,
  playerId: string,
  headerId: string | null,
  addHeaders: number,
  addUnits: number,
  addBytes: number,
) {
  const [hc] = await tx
    .select({
      count: sql<string>`count(*)::text`,
      bytes: sql<string>`coalesce(sum(octet_length(${headers.data}::text)), 0)::text`,
    })
    .from(headers)
    .where(eq(headers.playerId, playerId));
  const [uc] = await tx
    .select({
      count: sql<string>`count(*)::text`,
      bytes: sql<string>`coalesce(sum(octet_length(${units.data}::text)), 0)::text`,
    })
    .from(units)
    .where(eq(units.playerId, playerId));
  if (
    Number(hc.count) + addHeaders > LOCAL_LIMITS.headersPerPlayer ||
    Number(hc.bytes) + Number(uc.bytes) + addBytes > LOCAL_LIMITS.bytesPerPlayer
  )
    throw new LocalEvidenceError("limit");
  if (headerId !== null) {
    const [c] = await tx
      .select({
        count: sql<string>`count(*)::text`,
        bytes: sql<string>`coalesce(sum(octet_length(${units.data}::text)), 0)::text`,
      })
      .from(units)
      .where(eq(units.headerId, headerId));
    const [h] = await tx
      .select({ data: headers.data })
      .from(headers)
      .where(eq(headers.id, headerId));
    if (!h) throw new LocalEvidenceError("missing");
    if (
      Number(c.count) + addUnits > LOCAL_LIMITS.unitsPerHeader ||
      Number(c.bytes) + evidenceBytes(h.data) + addBytes > LOCAL_LIMITS.bytesPerHeader
    )
      throw new LocalEvidenceError("limit");
  }
}
