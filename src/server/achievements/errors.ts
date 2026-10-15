import "server-only";

export class InvalidAchievementRecordError extends Error {
  constructor() {
    super("Invalid achievement record");
  }
}

/** Never log messages, stacks, SQL, identity or connection parameters. */
export function reportAchievementFailure(
  stage: "read" | "evaluate" | "service" | "presentation",
  error: unknown,
) {
  let kind: "infrastructure" | "invalid_data" | "unexpected" = "unexpected";
  if (error instanceof InvalidAchievementRecordError) kind = "invalid_data";
  else {
    let cause: unknown = error;
    for (let i = 0; i < 4 && cause && typeof cause === "object"; i++) {
      const record = cause as { code?: unknown; cause?: unknown };
      if (
        typeof record.code === "string" &&
        /^(08\w{3}|53\w{3}|57\w{3}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(
          record.code,
        )
      )
        kind = "infrastructure";
      cause = record.cause;
    }
  }
  console.error(`[achievements] ${stage}:${kind}`);
  return kind;
}
