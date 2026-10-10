import "server-only";

/** Fail closed. No client input, NEXT_PUBLIC variable or persisted activation. */
export function achievementsExperimentalEnabled(): boolean {
  if (process.env.ACHIEVEMENTS_EXPERIMENTAL !== "true") return false;
  const { VERCEL, VERCEL_ENV, VERCEL_TARGET_ENV, NODE_ENV } = process.env;
  if (VERCEL_ENV === "production" || VERCEL_TARGET_ENV === "production") return false;
  if (VERCEL === "1")
    return VERCEL_ENV === "preview" && (!VERCEL_TARGET_ENV || VERCEL_TARGET_ENV === "preview");
  return !VERCEL && !VERCEL_ENV && !VERCEL_TARGET_ENV && NODE_ENV === "development";
}
